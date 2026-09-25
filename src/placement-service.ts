import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import type { Placement } from "./core/placement";
import {
  folderForPlacement,
  freePath,
  pathForPlacement,
  placementOfPath,
  takenIgnoringCase,
  treeFromFolders,
} from "./core/placement";
import type { FolderTree } from "./core/placement";
import type { GokoSettings } from "./core/settings";

/**
 * The one door through which a clipping changes where it is filed.
 *
 * Two ways to say the same thing, and this is what keeps the rest of the
 * plugin from having to know which is in force:
 *
 * - Frontmatter: a `grid:` key in the note, and the file stays where it is.
 * - Folders: the note moves, and the path is the answer. `Library/Payments`
 *   is the Payments grid; `Library/Payments/Checkout` is a folder on it.
 *
 * Everything above calls `move` and gets the same promise either way: the
 * clipping ends up on that grid, and whatever it was on before is forgotten.
 * The undo history is built on that promise and needs no branch of its own.
 *
 * In folder mode the vault's own explorer is a second, equal way to file:
 * dragging a note between folders there is a move, and the index hears it as
 * a rename. That is the whole point of the mode, and it is why nothing here
 * writes `grid:` while it is on — two places saying where a clipping lives is
 * one place too many.
 */
/**
 * What a move did, and where everything is now.
 *
 * In folder mode a move is a rename, so the path a caller held is stale the
 * moment the move returns. Anything that means to touch the same notes
 * again — an undo, above all — has to be handed the new paths, or it goes
 * looking for files that are no longer there and quietly finds nothing.
 * `paths[i]` is where `paths[i]` of the request is now: the same string when
 * nothing moved it.
 */
export interface MoveResult {
  moved: number;
  paths: string[];
}

export class PlacementService {
  constructor(
    private app: App,
    private settings: () => GokoSettings
  ) {}

  /** Whether the path decides, rather than the frontmatter. */
  get byFolders(): boolean {
    return this.settings().gridsFollowFolders;
  }

  private root(): string {
    return normalizePath(this.settings().clippingsFolder);
  }

  /** What a grid name means as a folder: home is the clippings folder itself. */
  private folderName(grid: string): string {
    return grid === this.settings().homeGridName ? "" : grid;
  }

  /**
   * Files clippings onto a grid, and into a folder on it when one is named.
   * Returns how many actually moved.
   *
   * The two keys are written in one call so they can never disagree after a
   * move: a folder belongs to one grid, and moving to a grid without naming
   * a folder takes the clipping out of whichever folder it was in.
   */
  async move(paths: readonly string[], grid: string, folder = ""): Promise<MoveResult> {
    const placement: Placement = { grid: this.folderName(grid), folder };
    if (this.byFolders) return this.moveFiles(paths, placement);
    return { moved: await this.writeKeys(paths, placement), paths: [...paths] };
  }

  /** Folder mode: the note travels. Obsidian rewrites the links into it. */
  private async moveFiles(paths: readonly string[], placement: Placement): Promise<MoveResult> {
    const root = this.root();
    await this.ensureFolder(folderForPlacement(root, placement));

    let moved = 0;
    const now: string[] = [];
    for (const path of paths) {
      now.push(path);
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) continue;
      const target = pathForPlacement(file.path, root, placement);
      // Already there. Not a move, not a write, and not an error.
      if (!target) continue;
      const free = freePath(target, this.takenBeside(target));
      try {
        await this.app.fileManager.renameFile(file, free);
        now[now.length - 1] = free;
        moved++;
      } catch (error) {
        new Notice(`Goko: could not move ${file.name} (${String(error)})`);
      }
    }
    return { moved, paths: now };
  }

  /**
   * What is already in the folder a note is moving into, compared without
   * case, so a move never lands on a name the disk counts as taken.
   */
  private takenBeside(target: string): (path: string) => boolean {
    const folder = this.app.vault.getFolderByPath(target.slice(0, target.lastIndexOf("/")));
    return takenIgnoringCase((folder?.children ?? []).map((child) => child.path));
  }

  /** Frontmatter mode: the key travels, the note stays. */
  private async writeKeys(paths: readonly string[], placement: Placement): Promise<number> {
    let written = 0;
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) continue;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          // Home is the absence of the key, so moving something back removes
          // it rather than writing the home name in. Loose is the absence of
          // the folder key, on the same terms.
          if (!placement.grid) delete fm.grid;
          else fm.grid = placement.grid;
          if (placement.folder) fm.folder = placement.folder;
          else delete fm.folder;
        });
        written++;
      } catch (error) {
        new Notice(`Goko: could not move ${path} (${String(error)})`);
      }
    }
    return written;
  }

  /**
   * The folder a clipping would be created in for a placement — capture asks,
   * so a new clip lands in the open grid's folder rather than in the root and
   * then moving.
   */
  folderFor(grid: string, folder = ""): string {
    if (!this.byFolders) return this.root();
    return folderForPlacement(this.root(), { grid: this.folderName(grid), folder });
  }

  /** Where a path says a clipping is filed, for the index to read. */
  placementOf(path: string): Placement {
    return placementOfPath(path, this.root());
  }

  /** The grids and folders that exist as folders on disk, in folder mode. */
  tree(): FolderTree {
    if (!this.byFolders) return { grids: [], folders: [] };
    const root = this.app.vault.getFolderByPath(this.root());
    if (!root) return { grids: [], folders: [] };

    const paths: string[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          paths.push(child.path);
          walk(child);
        }
      }
    };
    walk(root);
    return treeFromFolders(paths, this.root());
  }

  /** Whether a change to this path could change the registry. */
  touchesTree(file: TAbstractFile): boolean {
    if (!this.byFolders || !(file instanceof TFolder)) return false;
    const root = this.root();
    return file.path === root || file.path.startsWith(`${root}/`);
  }

  /** Makes a grid's folder, so a grid with nothing in it still exists. */
  async createGrid(grid: string, folder = ""): Promise<void> {
    if (!this.byFolders) return;
    await this.ensureFolder(this.folderFor(grid, folder));
  }

  /**
   * Renames a grid's folder, which moves everything in it in one call and
   * lets Obsidian fix every link that pointed inside.
   */
  async renameGrid(from: string, to: string): Promise<void> {
    if (!this.byFolders) return;
    const source = this.app.vault.getFolderByPath(this.folderFor(from));
    if (!source) return;
    const target = this.folderFor(to);
    if (target === source.path) return;
    try {
      await this.app.fileManager.renameFile(source, target);
    } catch (error) {
      new Notice(`Goko: could not rename the ${from} folder (${String(error)})`);
    }
  }

  /** Renames a folder on a grid: the subdirectory travels with its notes. */
  async renameFolder(grid: string, from: string, to: string): Promise<void> {
    if (!this.byFolders) return;
    const source = this.app.vault.getFolderByPath(this.folderFor(grid, from));
    if (!source) return;
    const target = this.folderFor(grid, to);
    if (target === source.path) return;
    try {
      await this.app.fileManager.renameFile(source, target);
    } catch (error) {
      new Notice(`Goko: could not rename the ${from} folder (${String(error)})`);
    }
  }

  /**
   * Moves a grid's or a folder's directory to where the other kind lives:
   * `Library/Craft/Leather` up to `Library/Leather`, or `Library/Tabletop`
   * down to `Library/Craft/Tabletop`. One rename, as for renaming, so every
   * note and every link travels with it.
   *
   * False when nothing moved: frontmatter mode, where there is no directory
   * and the caller rewrites keys instead; a source that is not there; or a
   * target that is, which is refused rather than merged into.
   */
  async relocate(from: { grid: string; folder?: string }, to: { grid: string; folder?: string }): Promise<boolean> {
    if (!this.byFolders) return false;
    const source = this.app.vault.getFolderByPath(this.folderFor(from.grid, from.folder ?? ""));
    if (!source) return false;
    const target = this.folderFor(to.grid, to.folder ?? "");
    if (await this.app.vault.adapter.exists(target)) {
      new Notice(`Goko: there is already a folder at ${target}`);
      return false;
    }
    try {
      await this.app.fileManager.renameFile(source, target);
      return true;
    } catch (error) {
      new Notice(`Goko: could not move ${source.path} (${String(error)})`);
      return false;
    }
  }

  /** Whether a grid's or a folder's directory is free to be made. */
  async isFree(grid: string, folder = ""): Promise<boolean> {
    if (!this.byFolders) return true;
    return !(await this.app.vault.adapter.exists(this.folderFor(grid, folder)));
  }

  /**
   * Takes a grid's folder away, and its clippings back to the Inbox.
   *
   * Deliberately not a delete of what is inside: a grid is a way of looking
   * at clippings, and losing the clippings because the board they were on is
   * gone is not a trade anyone would make on purpose. What is left after the
   * notes have moved out — an empty folder, or a subfolder holding nothing —
   * goes to the vault's trash, where Obsidian puts everything it removes.
   */
  async removeGrid(grid: string, folder = ""): Promise<string[]> {
    if (!this.byFolders) return [];
    const source = this.app.vault.getFolderByPath(this.folderFor(grid, folder));
    if (!source) return [];

    const notes: TFile[] = [];
    const walk = (from: TFolder): void => {
      for (const child of from.children) {
        if (child instanceof TFile) notes.push(child);
        else if (child instanceof TFolder) walk(child);
      }
    };
    walk(source);

    // Back to where unfiled clippings live: the clippings folder itself when
    // a grid goes, and the grid's own folder when one of its folders goes.
    const home = folder ? this.folderFor(grid) : this.root();
    const landed: string[] = [];
    for (const note of notes) {
      const target = freePath(`${home}/${note.name}`, this.takenBeside(`${home}/${note.name}`));
      try {
        await this.app.fileManager.renameFile(note, target);
        landed.push(target);
      } catch (error) {
        new Notice(`Goko: could not move ${note.name} out of ${grid} (${String(error)})`);
      }
    }

    try {
      await this.app.fileManager.trashFile(source);
    } catch (error) {
      new Notice(`Goko: could not remove the ${grid} folder (${String(error)})`);
    }
    return landed;
  }

  /**
   * Clippings still filed by frontmatter, and where their keys say they
   * belong. The migration command's input; empty once nothing carries a key.
   */
  pendingMigration(
    records: ReadonlyArray<{ path: string; grid: string; folder: string }>
  ): Array<{ path: string; placement: Placement }> {
    if (!this.byFolders) return [];
    const root = this.root();
    const out: Array<{ path: string; placement: Placement }> = [];
    for (const record of records) {
      const grid = record.grid.trim();
      if (!grid) continue;
      const placement: Placement = { grid: this.folderName(grid), folder: record.folder.trim() };
      if (!placement.grid) continue;
      if (pathForPlacement(record.path, root, placement)) out.push({ path: record.path, placement });
    }
    return out;
  }

  /** Makes a folder and every parent of it, quietly when it is already there. */
  private async ensureFolder(path: string): Promise<void> {
    const clean = normalizePath(path);
    if (!clean || this.app.vault.getFolderByPath(clean)) return;
    try {
      await this.app.vault.createFolder(clean);
    } catch {
      // Two moves into the same new folder race here, and the loser's error
      // is that the folder now exists — which is what it wanted.
    }
  }
}
