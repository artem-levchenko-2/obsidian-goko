export interface ProgressState {
  /** 0..1, or null for work whose length is unknown. */
  fraction: number | null;
  label: string;
  /**
   * How far through a job of known length, for work made of many things
   * rather than one thing with stages.
   *
   * A single clip is one thing in stages, and a bar creeping 0.3 → 0.7 → 0.9
   * says everything there is to say. Five hundred clips are five hundred of
   * those, and the same bar says nothing at all: it flickers through the
   * same three positions five hundred times while the reader has no idea
   * whether this takes ten seconds or ten minutes. A count does.
   */
  done?: number;
  total?: number;
  /** Called if the reader presses Stop. Absent means the job cannot stop. */
  onStop?: () => void;
}

/**
 * A hairline bar across the top of the grid. Deliberately minimal: capture
 * is usually a few seconds, and a modal or a spinner over the wall would
 * cost more attention than the work is worth.
 */
export class ProgressBar {
  private root: HTMLElement;
  private fill: HTMLElement;
  private text: HTMLElement;
  private count: HTMLElement;
  private stop: HTMLButtonElement;
  private hideTimer = 0;

  constructor(container: HTMLElement) {
    this.root = container.createDiv({ cls: "pg-progress" });
    this.fill = this.root.createDiv({ cls: "pg-progress-fill" });
    this.text = this.root.createDiv({ cls: "pg-progress-label" });
    this.count = this.root.createDiv({ cls: "pg-progress-count" });
    // Made once and hidden, rather than built when a job needs one: a job
    // long enough to want stopping is long enough that the button has to be
    // there the moment the reader looks for it.
    this.stop = this.root.createEl("button", { cls: "pg-progress-stop", text: "Stop" });
    this.stop.hide();
  }

  set(state: ProgressState | null): void {
    window.clearTimeout(this.hideTimer);

    if (!state) {
      this.root.removeClass("is-visible");
      this.stop.hide();
      return;
    }

    this.root.addClass("is-visible");
    this.text.setText(state.label);

    const counted = state.total !== undefined && state.total > 1;
    this.count.setText(counted ? `${state.done ?? 0} / ${state.total}` : "");
    this.root.toggleClass("is-counted", counted);

    this.stop.toggle(Boolean(state.onStop));
    this.stop.onclick = state.onStop ? () => state.onStop?.() : null;

    // A count is a fraction nobody has to be told twice: given one, the bar
    // fills from it rather than from whatever stage the current item is at.
    if (counted && state.total) {
      this.root.removeClass("is-indeterminate");
      const through = Math.min(1, Math.max(0, (state.done ?? 0) / state.total));
      this.fill.setCssStyles({ width: `${Math.round(through * 100)}%` });
      return;
    }

    if (state.fraction === null) {
      this.root.addClass("is-indeterminate");
      this.fill.setCssStyles({ width: "" });
      return;
    }

    this.root.removeClass("is-indeterminate");
    const pct = Math.round(Math.min(1, Math.max(0, state.fraction)) * 100);
    this.fill.setCssStyles({ width: `${pct}%` });
  }

  /** Fills to 100%, then fades out, so the bar never vanishes mid-progress. */
  finish(label: string): void {
    this.set({ fraction: 1, label });
    this.hideTimer = window.setTimeout(() => this.set(null), 900);
  }

  destroy(): void {
    window.clearTimeout(this.hideTimer);
    this.root.remove();
  }
}
