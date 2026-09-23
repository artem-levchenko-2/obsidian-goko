import { App, Notice, TFile, normalizePath } from "obsidian";
import { mergeAnnotation } from "./core/annotate";
import type { Annotation, MergeOutcome } from "./core/annotate";
import { todayISO } from "./core/dates";
import type { EditablePolicy } from "./core/editable";
import { applyRules, parseRules } from "./core/rules";
import type { ClippingRecord } from "./core/scan";
import type { GokoSettings } from "./core/settings";

/**
 * The one door through which anything that is not a person writes frontmatter.
 *
 * view.setProperty is the door for clicks. This is the door for rules and for
 * the vision model, and it goes through the same merge and the same
 * `isEditable` so that nothing automatic can reach a key a click cannot. It
 * writes with processFrontMatter, as setProperty does, so the note's body is
 * never touched and the vault's own modify event is what tells the wall.
 */
export class AnnotateService {
  /** Keys that hold prose, where a new value replaces rather than joins. */
  static readonly SCALAR_KEYS: ReadonlySet<string> = new Set(["summary", "note"]);

  constructor(
    private app: App,
    private settings: () => GokoSettings
  ) {}

  private policy(): EditablePolicy {
    return { allowEditingTags: this.settings().allowEditingTags };
  }

  /**
   * Writes an annotation into one note. Returns what the merge did, or null
   * when the path is not a file — a clipping deleted between being queued
   * and being reached is not an error, it is just gone.
   */
  async annotate(path: string, annotation: Annotation): Promise<MergeOutcome | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return null;

    let outcome: MergeOutcome = { changed: false, written: [], refused: [] };
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        outcome = mergeAnnotation(fm, annotation, this.policy(), AnnotateService.SCALAR_KEYS);
        // Same stamp setProperty leaves, for the same reason: the vault's
        // clipping rules list `updated` among the properties tools maintain.
        if (outcome.changed) fm.updated = todayISO();
      });
    } catch (error) {
      new Notice(`Goko: could not update ${file.basename} (${String(error)})`);
      return null;
    }
    return outcome;
  }

  /**
   * Stamps `updated` and writes nothing else. True when it was written.
   *
   * `annotate` cannot do this: an empty annotation merges to no change, and
   * the stamp goes on only when something changed — rightly, or every pass
   * over the library would rewrite every note in it. But meeting a clipping
   * a second time is itself worth recording even when it brings no new
   * value, so that needs a door of its own.
   */
  async touch(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return false;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm.updated = todayISO();
      });
    } catch (error) {
      new Notice(`Goko: could not update ${file.basename} (${String(error)})`);
      return false;
    }
    return true;
  }

  /** What the domain rules say about one clipping, or an empty annotation. */
  rulesFor(record: Pick<ClippingRecord, "source">): Annotation {
    const { rules } = parseRules(this.settings().domainRules);
    return applyRules(rules, record.source);
  }

  /** Applies the domain rules to one clipping, quietly. For the moment it lands. */
  async applyRulesTo(record: Pick<ClippingRecord, "path" | "source">): Promise<MergeOutcome | null> {
    const annotation = this.rulesFor(record);
    if (Object.keys(annotation).length === 0) return null;
    return this.annotate(record.path, annotation);
  }

  /**
   * Applies the domain rules to every clipping, and says what happened.
   *
   * Sequential rather than parallel: each write is a file write, and a
   * hundred at once is how a sync client falls over. Refused keys are counted
   * once, since the same rule refuses the same key on every note.
   */
  async applyRulesToAll(records: readonly ClippingRecord[]): Promise<Set<string>> {
    const written = new Set<string>();
    const { rules, errors } = parseRules(this.settings().domainRules);
    if (errors.length > 0) {
      new Notice(
        `Goko: ${errors.length} rule${errors.length === 1 ? "" : "s"} could not be read — see settings`
      );
    }
    if (rules.length === 0) {
      new Notice("Goko: no domain rules to apply");
      return written;
    }

    let touched = 0;
    let matched = 0;
    const refused = new Set<string>();
    for (const record of records) {
      if (Object.keys(this.rulesFor(record)).length > 0) matched++;
      const outcome = await this.applyRulesTo(record);
      if (!outcome) continue;
      if (outcome.changed) touched++;
      for (const key of outcome.written) written.add(key);
      for (const key of outcome.refused) refused.add(key);
    }

    // Says what happened in the terms a person checks: how many were reached
    // at all, how many gained something, and where it went. "Updated 0" alone
    // read as broken when the rules had simply already been applied.
    const notes = touched === 1 ? "1 clipping" : `${touched} clippings`;
    const where = written.size > 0 ? ` — see ${[...written].join(", ")} in the filters` : "";
    const held = refused.size > 0 ? ` (${[...refused].join(", ")} not editable)` : "";
    if (matched === 0) new Notice("Goko: no clipping's source matches a rule");
    else if (touched === 0) new Notice(`Goko: ${matched} matched, all already up to date${held}`);
    else new Notice(`Goko: domain rules updated ${notes}${where}${held}`);
    return written;
  }
}
