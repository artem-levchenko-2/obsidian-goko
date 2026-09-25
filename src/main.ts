import {
  MarkdownView,
  Notice,
  ObsidianProtocolData,
  Platform,
  Plugin,
  addIcon,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  parseYaml,
} from "obsidian";
import { buildDiagnostics } from "./core/diagnose";
import { setToolOverrides } from "./convert";
import { ArchiveService } from "./archive-service";
import { CaptureService } from "./capture";
import { AnnotateService } from "./annotate-service";
import { PlacementService } from "./placement-service";
import { mergeByName, mergeFolders } from "./core/placement";
import { mimeForPath, pathFromFileUrl, titleFromPath } from "./core/file-clip";
import { nodeRequire } from "./core/system";
import { VisionService } from "./vision-service";
import { ArrivalCheck } from "./arrival-check";
import { NotificationCenter } from "./notifications";
import { ClippingIndex } from "./index-store";
import { GokoSettings, DEFAULT_SETTINGS, LEGACY_KEY_SECRET } from "./core/settings";
import { GUIDE_PATH, guideMarkdown, guideOwed, guideStep } from "./core/guide";
import { isStage } from "./core/density";
import { settledRules } from "./core/rules";
import { describesOnLanding, isArrivalMode } from "./core/arrivals";
import {
  PLAIN_FOLDER_ICON,
  PLAIN_GRID_ICON,
  SHARED_FILE,
  acceptsShared,
  choosesLooks,
  defaultShared,
  extractShared,
  publishesShared,
  parseShared,
  rebaseShared,
  revisionOf,
  serializeShared,
  sharedOf,
  withShared,
} from "./core/shared-config";
import type { SharedConfig } from "./core/shared-config";
import { describeFiles } from "./core/media-refs";
import { pdfReadReport } from "./core/pdf";
import { installRepair } from "./repair";
import { sharedHttpUrl } from "./core/resolve";
import { isSmartGrid, sharedClipGrid } from "./core/spaces";
import { GOKO_ICON_ID, GOKO_ICON_SVG } from "./core/icon";
import { ConfirmSweepModal } from "./confirm";
import { findOrphans, removeMedia, staleKeys } from "./sweep";
import { GokoSettingTab } from "./settings-tab";
import { GokoView, VIEW_TYPE_GRID } from "./view";

export default class GokoPlugin extends Plugin {
  settings: GokoSettings = DEFAULT_SETTINGS;
  index!: ClippingIndex;
  archiver!: ArchiveService;
  capture!: CaptureService;
  annotator!: AnnotateService;
  placement!: PlacementService;
  vision!: VisionService;
  /** What the bell on every open wall shows. The session's, never saved. */
  notifications = new NotificationCenter();
  private arrivals!: ArrivalCheck;
  /** The last shared file this device wrote, to recognise its own echo. */
  private wroteShared = "";
  /** The revision of the shared file this device last read or wrote. */
  private sharedRevision = 0;
  private archiveTimer = 0;
  /**
   * Notes that appeared in the folder since the last archive pass and have
   * not yet had the rules and the model run over them. Capture announces its
   * own notes through onCreated the moment they exist; everything else — the
   * Web Clipper, a file synced in from the phone — is only known to have
   * arrived, and is dealt with once the pass that downloads its pictures is
   * done, since the model needs those pictures and the Web Clipper writes
   * its note in stages.
   *
   * Each path is kept with whether it arrived while the session was open.
   * The notes Obsidian announces while it loads the vault are the library
   * itself: they get the rules, as they always have, but not the model.
   */
  private landed = new Map<string, boolean>();
  /** The mode as it was at the last save, so a change to it can be noticed. */
  private savedFollowFolders = DEFAULT_SETTINGS.gridsFollowFolders;
  /** Paths capture has already run the rules and the model over, so the pass skips them. */
  private handledByCapture = new Set<string>();
  /**
   * Whether this launch owes the vault the start-here note. Decided from
   * data.json as it was read, since by the time the layout is ready the
   * defaults have been laid over it and a new vault looks like any other.
   */
  private guideDue = false;

  /**
   * Schedules the background archive pass, debounced: a sync storm of
   * created files coalesces into one pass instead of stacking timers, and
   * the pending timer is cleared on unload so nothing fires afterwards.
   */
  private scheduleArchive(delayMs: number): void {
    window.clearTimeout(this.archiveTimer);
    this.archiveTimer = window.setTimeout(
      () => void this.archiver.archiveMissing(this.settings.archiveOnCreate).then(() => this.settleLanded()),
      delayMs
    );
  }

  /**
   * Reads every PDF clipping's words into its note, so search can find them.
   *
   * Announced at both ends, because it opens every document in the library
   * and that is not instant. Notes already read are skipped without being
   * opened, so running it again costs a read of each note and nothing more.
   */
  async readEveryPdf(): Promise<void> {
    new Notice("Goko: reading PDFs\u2026");
    new Notice(pdfReadReport(await this.capture.readEveryPdf()));
  }

  /**
   * Rules, then the model, for every note that arrived from outside since
   * the last pass; the model only for those that came while the session was
   * open, as the field above explains. After the archive pass on purpose: by
   * now the Web Clipper has finished writing and the pictures are on disk. A
   * pass that was already running when this one asked has not finished those
   * downloads, so the notes wait for the next turn rather than being
   * described without their pictures.
   */
  private async settleLanded(): Promise<void> {
    if (this.landed.size === 0 && !this.arrivals.pending) return;
    if (this.archiver.busy) {
      this.scheduleArchive(3000);
      return;
    }
    // What arrived while this computer was closed waits for the same pass,
    // for the same reason.
    this.arrivals.settle();
    if (this.landed.size === 0) return;
    const landed = [...this.landed];
    this.landed.clear();
    for (const [path, arrivedWhileOpen] of landed) {
      if (this.handledByCapture.delete(path)) continue;
      const record = this.index.get(path);
      if (!record) continue;
      const outcome = await this.annotator.applyRulesTo(record);
      if (outcome?.written.length) await this.revealProperties(outcome.written);
      if (describesOnLanding(arrivedWhileOpen, this.settings.aiAutoDescribe) && this.vision.ready) {
        this.vision.describe([path], false, true);
      }
    }
    // Whatever capture announced but the folder never reported is not coming.
    this.handledByCapture.clear();
  }

  async onload(): Promise<void> {
    addIcon(GOKO_ICON_ID, GOKO_ICON_SVG);
    this.register(() => window.clearTimeout(this.archiveTimer));
    await this.loadSettings();
    // After the settings, because it needs the clippings folder to know where
    // to look, and before anything reads a grid.
    await this.syncShared();
    this.watchShared();

    // Before the index, which asks it where a path files a clipping.
    this.placement = new PlacementService(this.app, () => this.settings);
    this.index = new ClippingIndex(
      this.app,
      () => this.settings.clippingsFolder,
      parseYaml,
      (path) => (this.placement.byFolders ? this.placement.placementOf(path) : null)
    );
    this.archiver = new ArchiveService(
      this.app,
      this.index,
      () => this.settings,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/goko`
    );
    await this.archiver.loadCache();
    this.capture = new CaptureService(
      this.app,
      () => this.settings,
      this.archiver,
      this.index,
      (grid) => this.placement.folderFor(grid)
    );
    this.annotator = new AnnotateService(this.app, () => this.settings);
    // Rules run the moment a clipping lands, from here rather than from the
    // wall, so they run whether or not the wall is open.
    this.vision = new VisionService(
      this.app,
      () => this.settings,
      this.index,
      this.archiver,
      this.annotator
    );
    this.arrivals = new ArrivalCheck(this, () => this.settings, this.index, this.vision, this.notifications);
    // A re-clip of something already saved: the rules may have changed since
    // it was first kept, and either way the encounter is stamped so the
    // recently-updated order can carry it to the top.
    this.capture.onDuplicate = async (path) => {
      const record = this.index.get(path);
      const outcome = record ? await this.annotator.applyRulesTo(record) : null;
      if (outcome?.written.length) await this.revealProperties(outcome.written);
      // A write of its own already stamped it; this is for the common case
      // where the rules had nothing left to add.
      if (!outcome?.changed) await this.annotator.touch(path);
    };
    this.capture.onCreated = (path, quiet) => {
      this.handledByCapture.add(path);
      const record = this.index.get(path);
      if (!record) return;
      void this.annotator.applyRulesTo(record).then((outcome) => {
        // The reveal is an animation on one card. In a batch it would be
        // five hundred of them, over cards nobody is looking at yet.
        if (!quiet && outcome?.written.length) void this.revealProperties(outcome.written);
        // After the rules, so the model is offered a vocabulary the rules
        // have already added to, and only when asked to spend the money.
        //
        // Never from a batch. Auto-describe is a per-clip convenience, and a
        // five-hundred-file import would turn it into five hundred paid
        // calls started by a loop rather than by a person. What a batch does
        // instead is offer, once, when it is finished.
        if (!quiet && this.settings.aiAutoDescribe && this.vision.ready) {
          this.vision.describe([path]);
        }
      });
    };

    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new GokoView(leaf, this)
    );
    // obsidian://goko?url=… — the share-sheet route in. An iOS Shortcut
    // hands the shared link straight here, so clipping from another app
    // never touches the clipboard. Prose around the link is tolerated
    // because share sheets send captions, not bare URLs.
    const handleClipUri = (params: ObsidianProtocolData): void => {
      const raw = params.url ?? params.text ?? "";
      const url = sharedHttpUrl(raw);
      if (!url) {
        // The received text is shown so a broken Shortcut diagnoses itself:
        // empty means nothing arrived, %3A soup means over-encoding.
        new Notice(
          raw
            ? `Goko: no link in the shared text (got "${raw.slice(0, 80)}")`
            : "Goko: the share arrived empty"
        );
        return;
      }
      // The view first, so the capture's progress bar has a wall to sit on
      // and the clipped tile has somewhere to fly in.
      void this.activateView().then((view) => {
        const s = this.settings;
        const grid = sharedClipGrid(s.sharedClipTarget, s.activeGrid, s.homeGridName, s.grids);
        if (grid !== null || !view) return this.capture.capture(url, grid ?? undefined);
        view.pickGridAndClip(url);
      });
    };
    this.registerObsidianProtocolHandler("goko", handleClipUri);

    this.addSettingTab(new GokoSettingTab(this.app, this));
    installRepair(this);

    this.addRibbonIcon(GOKO_ICON_ID, "Open Goko", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open",
      name: "Open the wall",
      callback: () => void this.activateView(),
    });

    // Registered as a command rather than left to the view's own key
    // listener: ⌘K is a core default (Insert Markdown link), so Obsidian's
    // dispatcher claims the chord before a DOM listener ever sees it. Going
    // through the command system is what puts the wall's search on the key,
    // and it makes the binding reassignable in Settings → Hotkeys like
    // everything else.
    this.addCommand({
      id: "open-search",
      name: "Search this grid",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(GokoView);
        if (!view) return false;
        if (!checking) view.togglePalette();
        return true;
      },
    });

    // One command for whatever is on the clipboard, as paste is: a picture
    // or a video is saved as itself, text is taken as a link.
    //
    // No default chord, and none of the commands here has one. A plugin that
    // ships bindings takes them from whatever the person already put there,
    // which is why the directory asks not to; the plus button in the dock and
    // this row in the palette are how the action is reached, and Settings →
    // Hotkeys is where anyone who wants a chord picks their own.
    this.addCommand({
      id: "clip-from-clipboard",
      name: "Clip from clipboard",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(GokoView);
        if (!view) return false;
        if (!checking) void this.clipFromClipboard();
        return true;
      },
    });

    // The way back to the start-here note once it has been closed or deleted.
    // The empty wall offers the same thing as a button.
    this.addCommand({
      id: "open-guide",
      name: "Open guide",
      callback: () => void this.openGuide(),
    });

    this.addCommand({
      id: "describe-undescribed",
      name: "Describe every clipping without a summary (AI)",
      callback: () => this.vision.describeUndescribed(),
    });

    this.addCommand({
      id: "apply-domain-rules",
      name: "Apply domain rules to all clippings",
      callback: () => void this.applyDomainRules(),
    });

    // For the PDFs that were in the library before it could read them. New
    // ones are read as they are clipped; this is the way back over the rest.
    this.addCommand({
      id: "read-pdf-text",
      name: "Read the text out of every PDF",
      callback: () => void this.readEveryPdf(),
    });

    this.addCommand({
      id: "migrate-grids-to-folders",
      name: "Move clippings into their grid folders",
      checkCallback: (checking: boolean) => {
        if (!this.placement.byFolders) return false;
        if (!checking) void this.migratePlacement();
        return true;
      },
    });

    this.addCommand({
      id: "rescan-clippings",
      name: "Rescan clippings folder",
      callback: () => {
        void this.index.rebuild().then(() => {
          new Notice("Goko: clippings rescanned");
        });
      },
    });

    this.addCommand({
      id: "sweep-orphan-media",
      name: "Remove orphaned media",
      callback: () => this.sweepOrphanMedia(),
    });

    // The wall's whole pipeline runs blind on mobile, where there is no
    // console to ask; this puts the paint's own arithmetic on the clipboard
    // so a phone can answer "why is this tile missing" by pasting.
    this.addCommand({
      id: "copy-diagnostics",
      name: "Copy grid diagnostics",
      callback: async () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)[0];
        const view = leaf?.view instanceof GokoView ? leaf.view : null;
        const state = view?.diagnosticState();
        const report = buildDiagnostics({
          version: this.manifest.version,
          platform: Platform.isMobile ? "mobile" : "desktop",
          activeGrid: state?.grid ?? this.settings.activeGrid,
          home: this.settings.homeGridName,
          registered: this.settings.grids.map((grid) => grid.name),
          records: this.index.records(),
          cache: this.archiver.cache,
          unloadable: state?.unloadable ?? [],
          filtered: state?.filtered ?? false,
        });
        await navigator.clipboard.writeText(report);
        new Notice("Goko: diagnostics copied to the clipboard");
      },
    });

    this.addCommand({
      id: "archive-clipping-media",
      name: "Download all clipping media",
      callback: () => this.archiveAllMedia(),
    });

    this.watchFolders();
    this.app.workspace.onLayoutReady(() => {
      // Here and not at load: whether the note is already there is a
      // question for the vault index, and a new tab needs a workspace to go in.
      void this.handOverGuide();
      // The folder tree is only readable once the vault index is up, so the
      // registry is reconciled here rather than at load, and before the
      // clippings are read: a card's grid comes from its path either way,
      // but the wall needs the grid to be registered to show it as one.
      //
      // The rebuild is waited for, since what arrived while this computer was
      // closed is counted from the finished library.
      void this.syncRegistry().then(() => this.index.rebuild()).then(() => {
        this.arrivals.count();
        // Archiving runs behind the grid, which is already showing remote
        // covers, and tiles swap to local files as they arrive. With
        // downloads off the pass still runs, for the previews of files
        // already in the vault, and fetches nothing.
        this.scheduleArchive(1500);
      });
    });

    // When the folder is not being watched, only files already on the wall
    // keep tracking their edits; a new arrival waits for a rescan or the
    // next launch. Explicit clips are unaffected: capture feeds the index
    // directly rather than through these events.
    const admits = (path: string): boolean =>
      this.settings.watchClippings || this.index.get(path) !== undefined;

    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (!(f instanceof TFile) || !admits(f.path)) return;
        const isNew = this.index.get(f.path) === undefined;
        // Read now, not once the note is indexed: by then the layout may be
        // ready for a file that was announced while the vault was loading.
        const arrivedWhileOpen = this.app.workspace.layoutReady;
        void this.index.handleModify(f).then(() => {
          // A note the folder gained, whoever wrote it, gets the rules and,
          // if it came while the session was open, the model, once its
          // pictures are down — see settleLanded.
          if (isNew && this.index.get(f.path)) this.landed.set(f.path, arrivedWhileOpen);
          // The Web Clipper writes the body and frontmatter in stages, so
          // give it a moment before scanning for media to download.
          this.scheduleArchive(this.settings.archiveOnCreate ? 2000 : 4000);
        });
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (f: TAbstractFile) => {
        if (f instanceof TFile && admits(f.path)) void this.index.handleModify(f);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f: TAbstractFile) => this.index.handleDelete(f.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
        if (f instanceof TFile && admits(oldPath)) void this.index.handleRename(f, oldPath);
      })
    );

    // Frontmatter arrives through the metadata cache, which resolves after
    // the file write. Without this the first scan of a fresh clipping sees
    // no categories or status.
    this.registerEvent(
      this.app.metadataCache.on("changed", (f: TFile) => {
        if (admits(f.path)) void this.index.handleModify(f);
      })
    );
  }

  /**
   * Offers up everything in the attachment folder that no clipping points
   * at any more: media left behind by deletions that predate reference
   * counting, and captures whose note was removed before it was written.
   *
   * Asks first, always, and moves to Obsidian's trash rather than deleting,
   * because the plugin is guessing about files it did not just create.
   */
  sweepOrphanMedia(): void {
    const orphans = findOrphans(
      this.app,
      this.index.records(),
      this.archiver.cache,
      this.settings.attachmentFolder
    );

    // Rows pointing at files that are already gone cost nothing to keep but
    // make the archiver skip a re-download it should do, so they go either
    // way, sweep or no sweep.
    const stale = staleKeys(this.app, this.archiver.cache);

    if (orphans.paths.length === 0) {
      if (stale.length > 0) {
        for (const key of stale) this.archiver.cache.delete(key);
        void this.archiver.saveCache();
      }
      new Notice("Goko: no orphaned media to remove");
      return;
    }

    new ConfirmSweepModal(this.app, orphans, describeFiles(orphans), () => {
      void (async () => {
        const removed = await removeMedia(this.app, this.archiver.cache, orphans.paths);
        for (const key of stale) this.archiver.cache.delete(key);
        await this.archiver.saveCache();
        new Notice(
          `Goko: ${removed} media file${removed === 1 ? "" : "s"} moved to trash`
        );
      })();
    }).open();
  }

  /** Lifted out of its command so the grid's palette can call it too. */
  async applyDomainRules(): Promise<void> {
    const written = await this.annotator.applyRulesToAll(this.index.records());
    await this.revealProperties(written);
  }

  /**
   * Moves clippings still filed by frontmatter into the folders their keys
   * name, for a vault switching to folder mode.
   *
   * Only what would actually move: a clipping already in the right folder,
   * or one with no key at all, is left alone. The keys themselves are not
   * stripped — turning the mode back off must give the vault its old
   * arrangement back, and a key nothing reads is harmless meanwhile.
   */
  async migratePlacement(): Promise<void> {
    const pending = this.placement.pendingMigration(this.index.records());
    if (pending.length === 0) {
      new Notice("Goko: every clipping is already in its grid's folder");
      return;
    }

    let moved = 0;
    for (const { path, placement } of pending) {
      const result = await this.placement.move(
        [path],
        placement.grid || this.settings.homeGridName,
        placement.folder
      );
      moved += result.moved;
    }
    await this.syncRegistry();
    await this.index.rebuild();
    const notes = moved === 1 ? "1 clipping" : `${moved} clippings`;
    new Notice(`Goko: moved ${notes} into their grid folders`);
  }

  /**
   * Puts a property a rule or the model has just written into the filter
   * menu, so it can be seen. A rule that wrote source-type to fifty notes and
   * showed it nowhere looked like a rule that did nothing: the value was in
   * the frontmatter and in no pane. Additive only, and only for new keys.
   */
  private async revealProperties(keys: Iterable<string>): Promise<void> {
    const missing = [...new Set(keys)].filter(
      (key) => key && !this.settings.filterProperties.includes(key)
    );
    if (missing.length === 0) return;
    this.settings.filterProperties = [...this.settings.filterProperties, ...missing];
    await this.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof GokoView) leaf.view.refreshFacets();
    }
  }

  /** Lifted out of its command so the grid's palette can call it too. */
  archiveAllMedia(): void {
    new Notice("Goko: downloading media…");
    void this.archiver.archiveEverything().then((r) => this.archiver.notifyResult(r));
  }

  /** Lifted out of its command so the grid's create menu can call it too. */
  /**
   * Clips whatever the clipboard holds, deciding as the paste handler does:
   * a picture or a video is saved as itself, anything else is read as text
   * and taken as a link.
   */
  async clipFromClipboard(): Promise<void> {
    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch {
      new Notice("Goko: could not read the clipboard");
      return;
    }
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/") || t.startsWith("video/"));
      if (!type) continue;
      await this.capture.captureMedia(await item.getType(type));
      return;
    }
    if (await this.clipCopiedFile()) return;
    await this.capture.captureFromClipboard();
  }

  /**
   * A file copied in Finder, which the web clipboard cannot see.
   *
   * ⌘C on a file puts a file:// URL on the pasteboard and no bytes, so
   * navigator.clipboard finds nothing and the gesture used to be refused as
   * "not a link". Electron's clipboard reads the URL, the file is on disk,
   * and the wall gets it exactly as a drop would have delivered it. Desktop
   * only, by nature: there is no Finder and no pasteboard on a phone.
   */
  private async clipCopiedFile(): Promise<boolean> {
    if (!Platform.isDesktopApp) return false;
    const electron = nodeRequire("electron") as {
      clipboard?: { read?: (format: string) => string; readText?: () => string };
    } | null;
    const fs = nodeRequire("fs") as {
      readFileSync?: (path: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    } | null;
    if (!electron?.clipboard || !fs?.readFileSync) return false;

    let raw = "";
    try {
      // macOS names the pasteboard type; the generic text often carries the
      // same URL on other platforms.
      raw = electron.clipboard.read?.("public.file-url") || "";
      if (!raw) {
        const text = electron.clipboard.readText?.() ?? "";
        if (/^file:\/\//i.test(text.trim())) raw = text;
      }
    } catch {
      return false;
    }

    const path = pathFromFileUrl(raw);
    if (!path) return false;
    const mime = mimeForPath(path);
    if (!mime) {
      new Notice(`Goko: ${titleFromPath(path)} is not a picture or a video`);
      return true;
    }

    try {
      const data = fs.readFileSync(path);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      await this.capture.captureMedia(new Blob([bytes], { type: mime }), titleFromPath(path));
    } catch (error) {
      new Notice(`Goko: could not read ${titleFromPath(path)} (${String(error)})`);
    }
    return true;
  }

  /**
   * Opens the start-here note on the launch that owes it, once.
   *
   * Marked as shown before the note is written, so a vault where the write
   * fails is not asked again on every launch; Open guide is always there
   * to try once more.
   */
  private async handOverGuide(): Promise<void> {
    const exists = this.app.vault.getFileByPath(normalizePath(GUIDE_PATH)) !== null;
    if (guideStep(this.guideDue, exists) === "none") return;
    this.guideDue = false;
    this.settings.guideShown = true;
    await this.saveSettings();
    await this.openGuide();
  }

  /**
   * Opens the start-here note in a tab of its own, writing it first when it is
   * not there. A note that is there is never written over: it may be one the
   * person has made their own. One already open in a tab is brought forward
   * rather than opened twice.
   */
  async openGuide(): Promise<void> {
    const path = normalizePath(GUIDE_PATH);
    let file = this.app.vault.getFileByPath(path);
    if (!file) {
      try {
        file = await this.app.vault.create(path, guideMarkdown(this.settings));
      } catch (error) {
        new Notice(`Goko: could not write the guide (${String(error)})`);
        return;
      }
    }
    const target = file;
    const open = this.app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === target.path);
    if (open) {
      await this.app.workspace.revealLeaf(open);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(target, { active: true });
  }

  /** Opens the wall, or brings it forward, and hands back its view. */
  async activateView(): Promise<GokoView | null> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID);
    let leaf = existing[0];
    if (leaf) {
      await this.app.workspace.revealLeaf(leaf);
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_GRID, active: true });
    }
    return leaf.view instanceof GokoView ? leaf.view : null;
  }

  /** Where the vault's half of the settings lives. */
  private sharedPath(): string {
    return normalizePath(`${this.settings.clippingsFolder}/${SHARED_FILE}`);
  }

  /** Where it lived before it was markdown. */
  /**
   * Reads the shared half out of the vault, and writes it there the first
   * time if it is missing.
   *
   * The write is the migration: a vault that predates this has its grids in
   * data.json and nowhere else, and the first device to open it publishes
   * them. Devices that already had none, a phone that only ever received the
   * plugin through BRAT, then read that file rather than starting empty.
   */
  /**
   * Brings the grid list in line with the folder tree, in folder mode.
   *
   * The tree says what exists; the shared config says how each one looks and
   * in what order. A folder made in the explorer becomes a grid with the
   * default icon at the end of the list, and a folder deleted there takes its
   * grid with it. Smart views are rules rather than folders and are left
   * alone. Saves only when something actually changed, so this can run on
   * every folder event without writing to the vault each time.
   */
  private async syncRegistry(): Promise<void> {
    if (!this.placement.byFolders) return;
    const tree = this.placement.tree();
    const grids = mergeByName(
      tree.grids,
      this.settings.grids,
      // A grid's own default, not the inbox's: the inbox has an icon of its
      // own that a folder turned grid should not borrow.
      (name) => ({ name, icon: PLAIN_GRID_ICON }),
      isSmartGrid
    );
    const folders = mergeFolders(tree.folders, this.settings.folders, (entry) => ({
      ...entry,
      icon: PLAIN_FOLDER_ICON,
      width: 1 as const,
    }));

    const same =
      JSON.stringify(grids) === JSON.stringify(this.settings.grids) &&
      JSON.stringify(folders) === JSON.stringify(this.settings.folders);
    if (same) return;

    this.settings.grids = grids;
    this.settings.folders = folders;
    await this.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof GokoView) leaf.view.refreshGrids();
    }
  }

  /**
   * Folders appearing, going and being renamed under the clippings folder,
   * which in folder mode is grids appearing, going and being renamed.
   */
  private watchFolders(): void {
    const react = (file: TAbstractFile): void => {
      if (this.placement.touchesTree(file)) void this.syncRegistry();
    };
    this.registerEvent(this.app.vault.on("create", react));
    this.registerEvent(this.app.vault.on("delete", react));
    this.registerEvent(this.app.vault.on("rename", react));
  }

  private async syncShared(): Promise<void> {
    const path = this.sharedPath();
    // Adapter, not the Vault API, throughout this method and writeShared:
    // it runs at onload, before the vault index is populated on a cold
    // start, and getFileByPath answering null here once cost a device its
    // grids. The adapter reads the filesystem and is always ready.
    const adapter = this.app.vault.adapter;
    const backup = this.backupShared();

    if (await adapter.exists(path)) {
      try {
        const body = await adapter.read(path);
        this.wroteShared = body;
        const raw = extractShared(body);
        if (raw !== null) {
          const found = parseShared(raw, sharedOf(this.settings));
          const revision = revisionOf(raw);
          this.sharedRevision = revision;
          // Every grid plain, written by a device that had not seen this
          // one's looks, while this one was closed: the looks come back from
          // the copy and go out again, which is what mends the other device.
          if (backup && !acceptsShared(found, revision, backup.shared, backup.revision)) {
            this.settings = withShared(this.settings, rebaseShared(found, backup.shared));
            this.sharedRevision = Math.max(revision, backup.revision);
            await this.writeShared();
            return;
          }
          this.settings = withShared(this.settings, found);
          this.keepBackup(found, revision);
          return;
        }
      } catch {
        // Fall through to the notice below.
      }
      // Unreadable, or half-written by a sync still in flight. What this
      // device already has beats nothing, and the next save republishes it.
      // What it has is the copy, when there is one: the grids themselves are
      // never in data.json.
      if (backup) this.settings = withShared(this.settings, backup.shared);
      new Notice("Goko: could not read the shared grid configuration.");
      return;
    }

    // Nothing to read, so this device publishes what it has — or stays quiet,
    // if what it has is only the defaults. writeShared decides which.
    if (backup) this.settings = withShared(this.settings, backup.shared);
    await this.writeShared();
  }

  private async writeShared(): Promise<void> {
    const shared = sharedOf(this.settings);
    // saveSettings also runs for the device's own half, the tile size among
    // them, and rewriting an identical file for those is sync churn on every
    // device rather than a change to anything. Compared at the revision it
    // was read or written at, so the same config is the same file.
    if (serializeShared(shared, this.sharedRevision || undefined) === this.wroteShared) return;
    // Both routes to a write come through here, and publishesShared is what
    // decides for both. See it for why a fresh vault stays quiet.
    if (!publishesShared(this.wroteShared, shared)) return;
    const revision = this.sharedRevision + 1;
    const body = serializeShared(shared, revision);
    // Remembered so the modify event our own write raises can be told apart
    // from one that arrived by sync.
    this.wroteShared = body;
    this.sharedRevision = revision;
    const path = this.sharedPath();
    const folder = normalizePath(this.settings.clippingsFolder);
    // A vault with nothing clipped yet has no clippings folder to keep the
    // file in. Skipping the write there lost every grid and folder made
    // before the first clip at the next launch, so the folder is made
    // instead: publishesShared has already said this device has something
    // of its own to keep. Adapter for the same reason syncShared gives: this
    // can run at onload, when the vault index cannot yet answer for either.
    if (folder && !(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.adapter.mkdir(folder);
    }
    await this.app.vault.adapter.write(path, body);
    this.keepBackup(shared, revision);
  }

  /** This device's copy of the looks, when it has one worth having. */
  private backupShared(): { shared: SharedConfig; revision: number } | null {
    const raw = this.settings.sharedBackup;
    if (!raw) return null;
    const shared = parseShared(raw, defaultShared());
    return choosesLooks(shared) ? { shared, revision: revisionOf(raw) } : null;
  }

  /**
   * Keeps a config as this device's copy, if it says how anything looks.
   * A plain one leaves the copy as it was: a plain config is the very thing
   * the copy is there to answer.
   */
  private keepBackup(shared: SharedConfig, revision: number): void {
    if (!choosesLooks(shared)) return;
    const copy = { ...shared, revision };
    if (JSON.stringify(copy) === JSON.stringify(this.settings.sharedBackup)) return;
    this.settings.sharedBackup = copy;
    void this.saveLocal();
  }

  /**
   * Picks up a shared file that has changed underneath us, which is what a
   * sync delivering another device's grids looks like from here.
   */
  private watchShared(): void {
    const reread = async (path: string): Promise<void> => {
      if (path !== this.sharedPath()) return;
      let body: string;
      try {
        body = await this.app.vault.adapter.read(this.sharedPath());
      } catch {
        return;
      }
      // Our own write coming back. Acting on it would be harmless but would
      // rebuild every open wall for nothing.
      if (body === this.wroteShared) return;
      const raw = extractShared(body);
      if (raw === null) return;
      const held = sharedOf(this.settings);
      const read = parseShared(raw, held);
      const revision = revisionOf(raw);
      // Now what is on disk, as far as this device knows, so the next save
      // does not write the same thing straight back at whoever sent it.
      this.wroteShared = body;
      if (acceptsShared(read, revision, held, this.sharedRevision)) {
        this.settings = withShared(this.settings, read);
        this.sharedRevision = revision;
        this.keepBackup(read, revision);
      } else {
        // Every grid plain, from a device that had not read this one's
        // looks. Kept, with whatever grid it found that this device had not,
        // and sent back out, so that device is put right too.
        this.settings = withShared(this.settings, rebaseShared(read, held));
        this.sharedRevision = Math.max(revision, this.sharedRevision);
        await this.writeShared();
      }
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
        if (leaf.view instanceof GokoView) leaf.view.refreshGrids();
      }
    };

    this.registerEvent(this.app.vault.on("modify", (file) => void reread(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => void reread(file.path)));
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<GokoSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
    // Read before anything saves, because the first save writes the key and
    // makes every vault look like one that has run this version before. A
    // vault that ran an older one is settled here as shown, so it stays so.
    this.guideDue = guideOwed(data);
    if (!this.guideDue) this.settings.guideShown = true;
    // Object.assign copies the reference, not the array. Without this, a vault
    // with no saved grids yet would push straight into DEFAULT_SETTINGS, and
    // the module-level default would start carrying real user data.
    this.settings.grids = [...(this.settings.grids ?? [])];
    this.settings.filterProperties = [
      ...(this.settings.filterProperties ?? DEFAULT_SETTINGS.filterProperties),
    ];
    // A stage that no longer exists, or a hand-edited data.json, lands on the
    // default rather than on a wall laid out to an undefined width.
    if (!isStage(this.settings.tileSize)) this.settings.tileSize = DEFAULT_SETTINGS.tileSize;
    if (!isArrivalMode(this.settings.aiArrivals)) this.settings.aiArrivals = DEFAULT_SETTINGS.aiArrivals;
    this.settings.domainRules = settledRules(this.settings.domainRules ?? "");
    await this.moveKeyToKeychain(data);
    // What the mode was when the settings were read, so the first save after
    // load is not mistaken for someone switching it.
    this.savedFollowFolders = this.settings.gridsFollowFolders;
    setToolOverrides({ ytdlp: this.settings.ytdlpPath, ffmpeg: this.settings.ffmpegPath });
  }

  /**
   * A key typed into an earlier version sat in these settings, which are a
   * file in the vault's plugin folder and go wherever the vault goes. It is
   * moved into Obsidian's keychain on this device and out of the file. Only
   * once the keychain has taken it: where the keychain cannot, the key stays
   * where it was rather than being lost, and the move is tried again at the
   * next launch.
   */
  private async moveKeyToKeychain(data: Partial<GokoSettings> | null): Promise<void> {
    const legacy = (data as { aiApiKey?: unknown } | null)?.aiApiKey;
    if (typeof legacy !== "string") return;
    const settings = this.settings as GokoSettings & { aiApiKey?: string };
    if (legacy.trim()) {
      try {
        this.app.secretStorage.setSecret(LEGACY_KEY_SECRET, legacy.trim());
      } catch {
        return;
      }
      if (!settings.aiKeySecret) settings.aiKeySecret = LEGACY_KEY_SECRET;
    }
    delete settings.aiApiKey;
    await this.saveLocal();
  }

  /**
   * The device's half of the settings, and only that: the vault's half goes
   * to the vault and is kept out of data.json, so there is one place a grid
   * is defined rather than two that can disagree.
   */
  private async saveLocal(): Promise<void> {
    const local = { ...this.settings } as Partial<GokoSettings>;
    for (const key of Object.keys(sharedOf(this.settings))) {
      delete local[key as keyof GokoSettings];
    }
    await this.saveData(local);
  }

  async saveSettings(): Promise<void> {
    // Switching the mode changes what every path means, so the registry and
    // the index are read again. Compared before the write, since the write is
    // what the new value has to survive.
    const modeChanged = this.savedFollowFolders !== this.settings.gridsFollowFolders;
    this.savedFollowFolders = this.settings.gridsFollowFolders;
    await this.saveLocal();
    await this.writeShared();
    setToolOverrides({ ytdlp: this.settings.ytdlpPath, ffmpeg: this.settings.ffmpegPath });

    if (modeChanged) {
      await this.syncRegistry();
      await this.index.rebuild();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
        if (leaf.view instanceof GokoView) leaf.view.refreshGrids();
      }
    }

    // Saving is also how an open wall hears about it. Every caller of this
    // already means "the settings have changed", so there is no second thing
    // for the settings tab to remember to call, and no way for a new toggle
    // to be added that silently does not take effect.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof GokoView) leaf.view.applyLiveSettings();
    }
  }
}
