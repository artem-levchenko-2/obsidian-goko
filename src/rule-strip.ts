import { setIcon } from "obsidian";

/**
 * A rule the wall has noticed it could learn from where a card was filed.
 *
 * Offered rather than assumed: writing a rule because a card was moved once
 * would mean a single drag quietly changed where everything from that site
 * goes from now on.
 */
export interface RuleOffer {
  text: string;
  onYes: () => void;
  onNo: () => void;
}

/** How long an unanswered question stays up. A question nobody answered is
    not one worth keeping the wall's bottom edge busy with. */
const OFFER_MS = 15_000;

/**
 * One line at the bottom of the wall with a question and two answers.
 *
 * Its own strip rather than a Notice, because a Notice cannot be answered,
 * and rather than a modal, because the question is a courtesy: the card has
 * already been filed, and ignoring the strip costs nothing.
 */
export class RuleStrip {
  private root: HTMLElement;
  private timer = 0;

  constructor(container: HTMLElement) {
    this.root = container.createDiv({ cls: "pg-rule-strip" });
  }

  offer(offer: RuleOffer | null): void {
    window.clearTimeout(this.timer);
    this.root.empty();
    this.root.toggleClass("is-visible", offer !== null);
    if (!offer) return;

    setIcon(this.root.createDiv({ cls: "pg-rule-strip-icon" }), "wand-sparkles");
    this.root.createDiv({ cls: "pg-rule-strip-text", text: offer.text });
    const no = this.root.createEl("button", { cls: "pg-rule-strip-no", text: "No" });
    no.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.offer(null);
      offer.onNo();
    };
    const yes = this.root.createEl("button", { cls: "pg-rule-strip-yes", text: "Yes" });
    yes.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.offer(null);
      offer.onYes();
    };
    this.timer = window.setTimeout(() => this.offer(null), OFFER_MS);
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.root.remove();
  }
}
