import { AbstractInputSuggest, App, Notice, Platform, PluginSettingTab, SecretComponent, Setting, setIcon } from "obsidian";
import type { ButtonComponent, IconName, SettingDefinition, SettingDefinitionItem } from "obsidian";
import { parseRules } from "./core/rules";
import { CLI_MODELS, DEFAULT_MODELS, MAX_CONCURRENCY, clampConcurrency } from "./core/vision";
import type { Effort, VisionProvider } from "./core/vision";
import { slotCandidates, surveyProperties } from "./core/facet-catalog";
import { facetLabel } from "./core/filter";
import {
  ARRIVAL_LABELS,
  COPY,
  HEADINGS,
  INSTALL_LABEL,
  NUMBER_LIMITS,
  PROPERTY_LIST_EMPTY,
  RULES_PLACEHOLDER,
  SCOPE_LABELS,
  toolStatus,
} from "./core/settings-copy";
import type { DesktopOs, SettingCopy, VideoTool } from "./core/settings-copy";
import { conversionAvailable, ffmpegPath, packageManagers, runInstall, ytdlpPath } from "./convert";
import { installPlan, toolList } from "./core/tool-install";
import type { InstallPlan } from "./core/tool-install";
import { GokoView, VIEW_TYPE_GRID } from "./view";
import type GokoPlugin from "./main";

/** How the effort levels read in the pane. Keys are what `claude --effort` takes. */
const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** A definition's words, from the one place every setting's copy is kept. */
function words(copy: SettingCopy): { name: string; desc?: string | DocumentFragment; aliases: string[] } {
  return { name: copy.name, desc: describe(copy), aliases: copy.aliases };
}

/**
 * A row's description as the tab shows it. Each labelled line gets a line
 * of its own, its label in the body colour, so the difference between on
 * and off, or between two choices, reads at a glance.
 */
function describe(copy: SettingCopy): string | DocumentFragment | undefined {
  const lines = copy.lines ?? [];
  if (lines.length === 0) return copy.desc;
  return createFragment((fragment) => {
    if (copy.desc) fragment.createDiv({ cls: "pg-setting-lead", text: copy.desc });
    for (const line of lines) {
      const row = fragment.createDiv({ cls: "pg-setting-line" });
      row.createSpan({ cls: "pg-setting-line-label", text: `${line.label}:` });
      row.appendText(` ${line.text}`);
    }
  });
}

/** Which install line a missing tool's status offers. */
function desktopOs(): DesktopOs {
  if (Platform.isWin) return "windows";
  if (Platform.isMacOS) return "macos";
  return "linux";
}

/**
 * Type-ahead over the property names already in the vault.
 *
 * Obsidian's own suggester rather than a <datalist>: that is drawn by Chromium
 * and takes no styling at all, so it lands on the settings pane as a black box
 * in a bold serif stack, matching neither the theme nor anything else on the
 * page. This renders in the same popover the file and folder suggesters use.
 */
class PropertySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private options: string[],
    private pick: (key: string) => void
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return this.options;
    return this.options.filter((key) => key.toLowerCase().includes(wanted));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.close();
    this.pick(value);
  }
}

export class GokoSettingTab extends PluginSettingTab {
  /**
   * The button rows still at work. Each button is off until its run ends,
   * so a second press on a slow one does not start the same pass over every
   * clipping twice.
   */
  private running = new Set<string>();

  /** Each button row's button as last drawn, to switch off and on again. */
  private buttons = new Map<string, ButtonComponent>();

  constructor(app: App, private plugin: GokoPlugin) {
    super(app, plugin);
  }

  /**
   * Saves, repaints any open wall so a new facet appears without a reload,
   * and redraws this tab so a property moves between the enabled list and the
   * one below it.
   */
  private async commitFilterProperties(properties: string[]): Promise<void> {
    this.plugin.settings.filterProperties = properties;
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof GokoView) leaf.view.refreshFacets();
    }
    this.update();
  }

  /** Same shape as above: an open card repaints its panel on the wall's next refresh. */
  private async commitCardProperties(properties: string[]): Promise<void> {
    this.plugin.settings.cardProperties = properties;
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof GokoView) leaf.view.refresh();
    }
    this.update();
  }

  /** Same shape as above: every open wall redraws its badges in place. */
  private async commitTileSlot(key: "tileProperty", value: string): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof GokoView) leaf.view.refreshTileProperties();
    }
  }

  /** Runs a button row's work once at a time, with its button off meanwhile. */
  private async runAction(id: string, work: () => Promise<void>): Promise<void> {
    if (this.running.has(id)) return;
    this.running.add(id);
    this.buttons.get(id)?.setDisabled(true);
    try {
      await work();
    } finally {
      this.running.delete(id);
      this.buttons.get(id)?.setDisabled(false);
    }
  }

  /**
   * A row that does something, drawn the way Obsidian's own settings draw
   * one: the name and description on the left and a button at the end. Not
   * the API's action row, which turns the whole row into a link and reads
   * as text rather than as something to press.
   */
  private buttonRow(
    copy: SettingCopy & { button: string },
    icon: IconName,
    id: string,
    work: () => Promise<void>
  ): SettingDefinition {
    return {
      ...words(copy),
      render: (setting) => {
        setting.addButton((button) => {
          button.setClass("pg-setting-button").onClick(() => void this.runAction(id, work));
          setIcon(button.buttonEl.createSpan({ cls: "pg-setting-button-glyph" }), icon);
          button.buttonEl.createSpan({ text: copy.button });
          // Drawn again mid-run, the new button starts off as well.
          button.setDisabled(this.running.has(id));
          this.buttons.set(id, button);
        });
      },
    };
  }

  /**
   * The same pass the command runs. A rule can bring a property the filter
   * menu did not offer yet, and applying them adds it there, so the tab is
   * redrawn when the list below has changed under it.
   */
  private async applyRules(): Promise<void> {
    const before = this.plugin.settings.filterProperties.join("\n");
    await this.plugin.applyDomainRules();
    if (this.plugin.settings.filterProperties.join("\n") !== before) this.update();
  }

  /**
   * Which properties a dropdown offers. Dates and everything else are
   * separated by what the vault actually holds under each key, the same
   * test the filter menu uses to decide a facet is a date. The current
   * choice is always listed, so a key that has since left the vault still
   * shows as chosen rather than silently reading as None.
   */
  private slotOptions(dates: boolean, current: string): Record<string, string> {
    const keys = slotCandidates(this.plugin.index.records(), dates, current);
    const options: Record<string, string> = { "": "None" };
    for (const key of keys) options[key] = facetLabel(key);
    return options;
  }

  /**
   * Says which rule lines could not be read, under the box, as they are typed.
   *
   * Errors are shown and never block saving: a rule half-typed is a rule
   * half-typed, and refusing to keep the text until it parses would lose the
   * other lines with it.
   */
  private paintRuleErrors(host: HTMLElement, text: string): void {
    host.querySelector(".pg-rules-errors")?.remove();
    const { errors } = parseRules(text);
    if (errors.length === 0) return;
    const list = host.createDiv({ cls: "pg-rules-errors" });
    for (const error of errors) {
      list.createDiv({ text: `Line ${error.line}: ${error.reason} — "${error.text}"` });
    }
  }

  /**
   * A tool row's description: what the tool is for, then where it was found
   * or what is missing without it. Worked out whenever the tab is drawn, so
   * a tool installed while Obsidian was open shows up the next time the tab
   * is opened.
   */
  private toolDesc(tool: VideoTool, desc: string): DocumentFragment {
    return createFragment((fragment) => {
      fragment.appendText(desc);
      const status = fragment.createDiv({ cls: "pg-tool-status", attr: { "data-tool": tool } });
      this.paintToolStatus(status, tool);
    });
  }

  private paintToolStatus(el: HTMLElement, tool: VideoTool): void {
    const settings = this.plugin.settings;
    const override = tool === "yt-dlp" ? settings.ytdlpPath : settings.ffmpegPath;
    const found = tool === "yt-dlp" ? ytdlpPath() : ffmpegPath();
    const status = toolStatus(tool, desktopOs(), override, found);
    el.empty();
    el.toggleClass("is-missing", !status.found);
    el.createDiv({ text: status.text });
    if (status.install) {
      const line = el.createDiv({ text: `${INSTALL_LABEL} ` });
      line.createEl("code", { text: status.install });
    }
  }

  /** What Install would do right now, or null when nothing is missing or there is no manager. */
  private installPlanNow(): InstallPlan | null {
    const missing: VideoTool[] = [];
    if (!ytdlpPath()) missing.push("yt-dlp");
    if (!ffmpegPath()) missing.push("ffmpeg");
    return installPlan(desktopOs(), missing, packageManagers());
  }

  /**
   * Runs the plan, announced at both ends because it takes minutes and runs
   * where nobody can watch it. Then the tab is drawn again, so the status
   * lines say where the tools now are and the button goes once nothing is
   * missing.
   */
  private async installTools(): Promise<void> {
    const plan = this.installPlanNow();
    if (!plan) return;
    const what = toolList(plan.tools);
    const working = new Notice(`Goko: installing ${what} with ${plan.manager}\u2026`, 0);
    const result = await runInstall(plan);
    working.hide();
    if (result.ok) new Notice(`Goko: ${what} installed`);
    else {
      new Notice(
        `Goko: ${plan.manager} could not install ${what} (${result.detail}). The command under each tool does the same in a terminal.`,
        12000
      );
    }
    this.update();
    this.repaintToolStatus();
  }

  /** Every status line on the page, again, after a path was typed. */
  private repaintToolStatus(): void {
    this.containerEl.querySelectorAll<HTMLElement>(".pg-tool-status").forEach((el) => {
      const tool = el.getAttribute("data-tool");
      if (tool === "yt-dlp" || tool === "ffmpeg") this.paintToolStatus(el, tool);
    });
  }

  /**
   * A list of property names as chips, with a type-ahead to add one. Shared
   * by the filter list and the card list, which are the same control over
   * two settings. The row's name and description come from its definition;
   * this draws what goes under them, and returns what takes it away again.
   *
   * The taking away is not optional. A redraw of the tab keeps each row's
   * element and draws into it again, clearing only what the row itself
   * owns, so without it every redraw would add a second list under the
   * first.
   */
  private paintPropertyList(
    containerEl: HTMLElement,
    spec: {
      enabled: string[];
      empty: string;
      commit: (keys: string[]) => Promise<void>;
    }
  ): () => void {
    const enabled = spec.enabled;
    const body = containerEl.createDiv({ cls: "pg-props-body" });

    // Chips rather than a settings row each. One row per property put a
    // full-height card on screen for every key in the vault, which is a wall
    // of thirteen cards to express a list of two words.
    const chips = body.createDiv({ cls: "pg-props" });
    for (const key of enabled) {
      const chip = chips.createSpan({ cls: "pg-prop" });
      chip.createSpan({ text: facetLabel(key) });
      const remove = chip.createEl("button", { cls: "pg-prop-remove", text: "×" });
      remove.setAttribute("aria-label", `Remove ${facetLabel(key)}`);
      remove.onclick = () => void spec.commit(enabled.filter((k) => k !== key));
    }
    if (enabled.length === 0) {
      chips.createSpan({ cls: "pg-props-empty", text: spec.empty });
    }

    // Suggested first, so type-ahead puts the properties worth filtering by at
    // the top of the list. The counts behind that ranking are not shown: they
    // are how the order is decided, not something to read.
    const available = surveyProperties(this.plugin.index.records())
      .filter((stat) => !enabled.includes(stat.key))
      .map((stat) => stat.key);

    // Set while the text control is built, so the Add button beside it can
    // commit the same value the Enter key does.
    let addTyped: (() => void) | null = null;

    new Setting(body)
      .setName(COPY.addProperty.name)
      .setDesc(COPY.addProperty.desc)
      .addText((text) => {
        text.setPlaceholder("Property name");

        // One shot: commit re-renders the tab and rebuilds these closures, so
        // a suggester pick and the Enter key both landing would otherwise add
        // against a list that is already stale.
        let done = false;
        const add = (key: string): void => {
          const name = key.trim();
          if (done || !name || enabled.includes(name)) return;
          done = true;
          void spec.commit([...enabled, name]);
        };

        new PropertySuggest(this.app, text.inputEl, available, add);

        text.inputEl.onkeydown = (event: KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add(text.getValue());
        };
        addTyped = () => add(text.getValue());
      })
      .addButton((button) => button.setButtonText("Add").onClick(() => addTyped?.()));

    return () => body.remove();
  }

  /**
   * The whole tab, declaratively, so every setting is reachable from
   * Obsidian's settings search. One page, in groups, with every word taken
   * from core/settings-copy.ts. Values flow through getControlValue and
   * setControlValue below, which is where the byte-to-megabyte translation
   * and the folder-change side effects live.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    // Asked once per drawing, and not at all on a phone: asking means loading
    // child_process, which a phone does not have and which Obsidian's mobile
    // emulation answers with a notice every time it is tried.
    const toolsHere = !Platform.isMobile && conversionAvailable();
    return [
      {
        type: "group",
        heading: HEADINGS.clippings,
        items: [
          {
            ...words(COPY.clippingsFolder),
            control: { type: "folder", key: "clippingsFolder", defaultValue: "Clippings" },
          },
          {
            ...words(COPY.attachmentFolder),
            control: {
              type: "folder",
              key: "attachmentFolder",
              defaultValue: "Attachments/Clippings",
            },
          },
          {
            ...words(COPY.sharedClipTarget),
            control: {
              type: "dropdown",
              key: "sharedClipTarget",
              options: {
                "last-opened": "Last opened grid",
                home: `${settings.homeGridName} (home)`,
                ask: "Ask each time",
              },
            },
          },
          {
            ...words(COPY.watchClippings),
            control: { type: "toggle", key: "watchClippings" },
          },
          this.buttonRow(COPY.rescan, "refresh-cw", "rescan", async () => {
            await this.plugin.index.rebuild();
            new Notice("Goko: clippings rescanned");
          }),
        ],
      },
      {
        type: "group",
        heading: HEADINGS.wall,
        items: [
          {
            ...words(COPY.autoplayVideo),
            control: { type: "toggle", key: "autoplayVideo" },
          },
          {
            ...words(COPY.tileTitle),
            control: { type: "toggle", key: "tileTitle" },
          },
          {
            ...words(COPY.tileProperty),
            render: (setting) => {
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOptions(this.slotOptions(false, settings.tileProperty))
                  .setValue(settings.tileProperty)
                  .onChange((value) => void this.commitTileSlot("tileProperty", value))
              );
            },
          },
          {
            ...words(COPY.gridsFollowFolders),
            control: { type: "toggle", key: "gridsFollowFolders" },
          },
          {
            // Only while the switch is on: with it off there are no grid
            // folders to move anything into.
            ...this.buttonRow(COPY.migrate, "folder-input", "migrate", () => this.plugin.migratePlacement()),
            visible: () => settings.gridsFollowFolders,
          },
          {
            ...words(COPY.gridLookScope),
            control: {
              type: "dropdown",
              key: "gridLookScope",
              options: SCOPE_LABELS,
            },
          },
        ],
      },
      {
        type: "group",
        heading: HEADINGS.downloads,
        items: [
          {
            ...words(COPY.archiveOnCreate),
            control: { type: "toggle", key: "archiveOnCreate" },
          },
          {
            ...words(COPY.maxSizeMb),
            control: { type: "number", key: "maxSizeMb", validate: numberCheck("maxSizeMb") },
          },
          {
            ...words(COPY.youtubeVideoMinutes),
            control: {
              type: "number",
              key: "youtubeVideoMinutes",
              validate: numberCheck("youtubeVideoMinutes"),
            },
          },
          {
            ...words(COPY.useResolvers),
            control: { type: "toggle", key: "useResolvers" },
          },
        ],
      },
      {
        type: "group",
        heading: HEADINGS.tools,
        items: [
          {
            ...words(COPY.ytdlpPath),
            desc: toolsHere ? this.toolDesc("yt-dlp", COPY.ytdlpPath.desc) : COPY.ytdlpPath.desc,
            visible: toolsHere,
            control: { type: "text", key: "ytdlpPath" },
          },
          {
            ...words(COPY.ffmpegPath),
            desc: toolsHere ? this.toolDesc("ffmpeg", COPY.ffmpegPath.desc) : COPY.ffmpegPath.desc,
            visible: toolsHere,
            control: { type: "text", key: "ffmpegPath" },
          },
          {
            // Only while something is missing and this computer's own package
            // manager is there to fetch it; otherwise the status lines above
            // carry the command to run by hand.
            ...this.buttonRow(COPY.installTools, "download", "install-tools", () => this.installTools()),
            visible: () => toolsHere && this.installPlanNow() !== null,
          },
          {
            // In place of the two paths on a device that cannot run either,
            // where a path field would only invite typing one in.
            ...words(COPY.toolsElsewhere),
            visible: !toolsHere,
          },
          {
            ...words(COPY.thumbnailWidth),
            control: {
              type: "number",
              key: "thumbnailWidth",
              validate: numberCheck("thumbnailWidth"),
            },
          },
        ],
      },
      {
        type: "group",
        heading: HEADINGS.properties,
        items: [
          {
            ...words(COPY.allowEditingTags),
            control: { type: "toggle", key: "allowEditingTags" },
          },
          {
            ...words(COPY.filterProperties),
            render: (setting) => {
              setting.settingEl.addClass("pg-props-setting");
              return this.paintPropertyList(setting.settingEl, {
                enabled: settings.filterProperties,
                empty: PROPERTY_LIST_EMPTY.filter,
                commit: (keys) => this.commitFilterProperties(keys),
              });
            },
          },
          {
            ...words(COPY.cardProperties),
            render: (setting) => {
              setting.settingEl.addClass("pg-props-setting");
              return this.paintPropertyList(setting.settingEl, {
                enabled: settings.cardProperties,
                empty: PROPERTY_LIST_EMPTY.card,
                commit: (keys) => this.commitCardProperties(keys),
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: HEADINGS.rules,
        items: [
          {
            ...words(COPY.domainRules),
            render: (setting) => {
              setting.settingEl.addClass("pg-rules-setting");
              setting.addTextArea((area) => {
                area.setPlaceholder(RULES_PLACEHOLDER);
                area.setValue(settings.domainRules);
                area.inputEl.rows = 8;
                area.inputEl.spellcheck = false;
                area.inputEl.addClass("pg-rules-input");
                area.onChange((value) => {
                  settings.domainRules = value;
                  void this.plugin.saveSettings();
                  this.paintRuleErrors(setting.settingEl, value);
                });
              });
              this.paintRuleErrors(setting.settingEl, settings.domainRules);
            },
          },
          this.buttonRow(COPY.applyRules, "list-checks", "rules", () => this.applyRules()),
        ],
      },
      {
        type: "group",
        heading: HEADINGS.ai,
        items: this.aiItems(),
      },
      {
        type: "group",
        heading: HEADINGS.help,
        items: [
          this.buttonRow(COPY.openGuide, "book-open", "guide", () => this.plugin.openGuide()),
          words(COPY.privacy),
        ],
      },
    ];
  }

  /**
   * The AI group, which changes shape with the provider: an HTTP provider
   * wants a key and a model name, Claude Code wants a model alias, an effort
   * and maybe a path. Every row is defined and the ones that do not apply
   * are hidden; choosing a provider or a model redraws the tab, because the
   * descriptions and the model field's value change with them.
   */
  private aiItems(): SettingDefinition[] {
    const settings = this.plugin.settings;
    const cli = (): boolean => settings.aiProvider === "claude-cli";
    const alias = (): boolean => settings.aiModel in CLI_MODELS;

    const providers: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic" };
    // Claude Code is a program on this machine; a phone has neither it nor a
    // way to run one. Still listed when it is already chosen, so the pane
    // shows the truth rather than the first option.
    if (Platform.isDesktopApp || cli()) providers["claude-cli"] = "Claude Code (local CLI)";

    const provider: SettingDefinition = {
      ...words(cli() ? COPY.providerCli : COPY.provider),
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOptions(providers)
            .setValue(settings.aiProvider)
            .onChange((value) => {
              const next: VisionProvider = value === "anthropic" || value === "claude-cli" ? value : "openai";
              settings.aiProvider = next;
              // A model name belongs to a provider. Switching keeps a
              // custom one only if it plainly is not another's default.
              if (Object.values(DEFAULT_MODELS).includes(settings.aiModel)) {
                settings.aiModel = DEFAULT_MODELS[next];
              }
              void this.plugin.saveSettings();
              this.update();
            })
        );
      },
    };

    const apiKey: SettingDefinition = {
      ...words(COPY.apiKey),
      visible: () => !cli(),
      // Obsidian's own keychain picker: the key is chosen or added there and
      // only its name is kept here. See aiKeySecret.
      render: (setting) => {
        setting.addComponent((el) =>
          new SecretComponent(this.app, el).setValue(settings.aiKeySecret).onChange((value) => {
            settings.aiKeySecret = value;
            void this.plugin.saveSettings();
          })
        );
      },
    };

    const modelName: SettingDefinition = {
      ...words(COPY.model),
      visible: () => !cli(),
      control: { type: "text", key: "aiModel" },
    };

    // An alias stands for the latest of that model; anything else is a full
    // id typed by hand, shown in its own field.
    const cliModel: SettingDefinition = {
      ...words(COPY.cliModel),
      visible: cli,
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOptions({ ...CLI_MODELS, custom: "Custom…" })
            .setValue(alias() ? settings.aiModel : "custom")
            .onChange((value) => {
              // Leaving an alias for Custom starts blank: the alias was
              // never a name to edit.
              settings.aiModel = value === "custom" ? (alias() ? "" : settings.aiModel) : value;
              void this.plugin.saveSettings();
              this.update();
            })
        );
      },
    };
    const cliModelId: SettingDefinition = {
      ...words(COPY.cliModelId),
      visible: () => cli() && !alias(),
      render: (setting) => {
        setting.addText((text) => {
          text.setPlaceholder("claude-sonnet-5").setValue(settings.aiModel);
          text.onChange((value) => {
            settings.aiModel = value.trim();
            void this.plugin.saveSettings();
          });
        });
      },
    };

    const effort: SettingDefinition = {
      ...words(COPY.effort),
      visible: cli,
      control: { type: "dropdown", key: "aiEffort", options: EFFORT_LABELS },
    };

    const concurrency: SettingDefinition = {
      ...words(COPY.concurrency),
      control: {
        type: "dropdown",
        key: "aiConcurrency",
        options: Object.fromEntries(
          Array.from({ length: MAX_CONCURRENCY }, (_, i) => [String(i + 1), String(i + 1)])
        ),
      },
    };

    const cliPath: SettingDefinition = {
      ...words(COPY.cliPath),
      visible: cli,
      control: { type: "text", key: "aiCliPath" },
    };

    const tagProperty: SettingDefinition = {
      ...words(COPY.tagProperty),
      control: { type: "text", key: "aiTagProperty" },
    };

    const auto: SettingDefinition = {
      ...words(cli() ? COPY.autoDescribeCli : COPY.autoDescribe),
      control: { type: "toggle", key: "aiAutoDescribe" },
    };

    // Only a desktop counts what arrived while it was closed (see
    // arrival-check.ts), so on a phone this row would decide nothing.
    const arrivals: SettingDefinition = {
      ...words(cli() ? COPY.arrivalsCli : COPY.arrivals),
      visible: Platform.isDesktopApp,
      control: { type: "dropdown", key: "aiArrivals", options: ARRIVAL_LABELS },
    };

    return [provider, apiKey, modelName, cliModel, cliModelId, effort, concurrency, cliPath, tagProperty, auto, arrivals];
  }

  getControlValue(key: string): unknown {
    if (key === "maxSizeMb") return Math.round(this.plugin.settings.maxBytes / 1048576);
    if (key === "aiConcurrency") return String(clampConcurrency(this.plugin.settings.aiConcurrency));
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    const settings = this.plugin.settings;
    switch (key) {
      case "clippingsFolder": {
        settings.clippingsFolder = String(value).trim() || "Clippings";
        return this.plugin.saveSettings().then(() => this.plugin.index.rebuild());
      }
      case "attachmentFolder": {
        settings.attachmentFolder = String(value).trim() || "Attachments/Clippings";
        break;
      }
      case "maxSizeMb": {
        const mb = Number(value);
        if (!NUMBER_LIMITS.maxSizeMb.ok(mb)) return;
        settings.maxBytes = Math.round(mb * 1048576);
        break;
      }
      case "youtubeVideoMinutes": {
        const minutes = Number(value);
        if (!NUMBER_LIMITS.youtubeVideoMinutes.ok(minutes)) return;
        settings.youtubeVideoMinutes = minutes;
        break;
      }
      case "aiConcurrency": {
        settings.aiConcurrency = clampConcurrency(value);
        break;
      }
      case "thumbnailWidth": {
        const width = Number(value);
        if (!NUMBER_LIMITS.thumbnailWidth.ok(width)) return;
        settings.thumbnailWidth = Math.round(width);
        break;
      }
      case "gridLookScope": {
        settings.gridLookScope = value === "grid" ? "grid" : "all";
        // Nothing is cleared on the way out. A grid keeps what it was given,
        // unread, and has it back if the switch comes back: the switch is not
        // a door you can only walk through once. Saving is what redraws the
        // open walls: density, tile tags, filter properties and autoplay.
        break;
      }
      case "gridsFollowFolders": {
        // The row that moves notes into grid folders shows only while this
        // is on, so it appears and goes as the switch is flipped.
        settings.gridsFollowFolders = value === true;
        return this.plugin.saveSettings().then(() => this.refreshDomState());
      }
      case "ytdlpPath":
      case "ffmpegPath": {
        // Saving hands the path to the tool lookup, so the status line under
        // it is read again afterwards and follows the field as it is typed.
        settings[key] = String(value);
        return this.plugin.saveSettings().then(() => this.repaintToolStatus());
      }
      default:
        (settings as unknown as Record<string, unknown>)[key] = value;
    }
    return this.plugin.saveSettings();
  }
}

/** A number field's check, as the declarative control wants it: a message, or nothing. */
function numberCheck(key: keyof typeof NUMBER_LIMITS): (value: number) => string | undefined {
  const limit = NUMBER_LIMITS[key];
  return (value) => (limit.ok(value) ? undefined : limit.message);
}
