import { Notice, Platform, Plugin } from "obsidian";
import {
  DESCRIBE_ACTION,
  LAST_SEEN_EVERY_MS,
  LAST_SEEN_KEY,
  arrivalNotification,
  arrivedSince,
  describingNotice,
  planArrivals,
  readLastSeen,
} from "./core/arrivals";
import type { GokoSettings } from "./core/settings";
import type { ClippingIndex } from "./index-store";
import type { NotificationCenter } from "./notifications";
import type { VisionService } from "./vision-service";

/**
 * Finds the clippings that arrived while this computer was closed, and
 * describes them, offers to behind the bell, or leaves them, as the setting
 * says.
 *
 * Two steps, because they need two different moments. The count runs as
 * soon as the library is read, before the session's own mark overwrites the
 * last one. The answer waits for the first archive pass, since a clipping
 * from the phone's Web Clipper arrives with its pictures still on the web,
 * and the model needs them on the disk.
 *
 * Desktop only. A phone's app is closed and reopened all day, so nearly
 * every launch there would find something "new", and what it found would be
 * the desktop's clippings, which the desktop describes itself.
 */
export class ArrivalCheck {
  /** Counted at the start of the session and not yet acted on, or null. */
  private found: string[] | null = null;

  constructor(
    private plugin: Plugin,
    private settings: () => GokoSettings,
    private index: ClippingIndex,
    private vision: VisionService,
    private notifications: NotificationCenter
  ) {}

  /** Whether a count is waiting for its answer. */
  get pending(): boolean {
    return this.found !== null;
  }

  /**
   * Counts what arrived since this device last saw the library, then moves
   * the mark to now and keeps moving it while the session is open.
   *
   * Moved on the minute, not only at the end, because quitting does not
   * reliably unload a plugin. A mark left at the start of a long session
   * would count every note that landed during it as having arrived while
   * this computer was away, which is not what the notification says. The
   * mark moves whatever the answer turns out to be: a notification
   * dismissed, or never opened, was about these clippings, and the next
   * launch speaks only of what comes after.
   */
  count(): void {
    if (!Platform.isDesktopApp) return;
    const app = this.plugin.app;
    const lastSeen = readLastSeen(app.loadLocalStorage(LAST_SEEN_KEY));
    this.found = arrivedSince(
      this.index.records(),
      (path) => app.vault.getFileByPath(path)?.stat.ctime,
      lastSeen
    );

    const mark = (): void => app.saveLocalStorage(LAST_SEEN_KEY, Date.now());
    mark();
    this.plugin.registerInterval(window.setInterval(mark, LAST_SEEN_EVERY_MS));
    this.plugin.register(mark);
  }

  /** Acts on the count, once. Later calls find nothing to do. */
  settle(): void {
    const found = this.found;
    this.found = null;
    if (!found) return;

    const plan = planArrivals(this.settings().aiArrivals, found, this.vision.ready);
    if (plan.kind === "describe") {
      new Notice(describingNotice(plan.paths.length));
      this.vision.describe(plan.paths);
    } else if (plan.kind === "notify") {
      this.notifications.post(arrivalNotification(plan.paths.length), {
        [DESCRIBE_ACTION]: () => this.vision.describe(plan.paths),
      });
    }
  }
}
