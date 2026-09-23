/**
 * The wall's notifications: things worth knowing that are not worth
 * interrupting anyone for.
 *
 * A notice fades in seconds and is gone whether or not it was read; a modal
 * stops whatever was being done. What sits between them is a list behind a
 * bell in the toolbar, with a dot on the bell while something in it has not
 * been seen. Each notification says what happened and carries the few
 * actions that answer it, and answering one takes it off the list.
 *
 * Pure and immutable: every change returns a new list, and notifications.ts
 * keeps the one the session is using, runs the actions and draws the panel.
 * The list lives in memory only. What it reports is found again by whatever
 * posted it, the next time the plugin starts, so there is nothing a note in
 * the vault would add except one more file to sync.
 */

export interface NotificationAction {
  /** What the action is called in the handlers that run it. */
  id: string;
  label: string;
  /** The answer most people will want, drawn as the main button. */
  primary?: boolean;
}

export interface GokoNotification {
  /**
   * Who posted it and about what. A second post under the same id is the
   * same notification told again, not another one: it replaces the first
   * rather than joining it.
   */
  id: string;
  title: string;
  body: string;
  actions: readonly NotificationAction[];
  /** Whether the list has been opened since it arrived. */
  read: boolean;
}

export type NotificationDraft = Omit<GokoNotification, "read">;

function sameContent(a: NotificationDraft, b: NotificationDraft): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.actions.length === b.actions.length &&
    a.actions.every((action, i) => {
      const other = b.actions[i];
      return action.id === other.id && action.label === other.label && !action.primary === !other.primary;
    })
  );
}

/*
 * Every change below hands back the list it was given, the same object,
 * when it changes nothing, so the owner can tell a change from a no-op
 * without comparing contents and redraw only for the first.
 */

/**
 * The list with this notification in it, newest first.
 *
 * One already there under the same id keeps its place. Told again word for
 * word it is left exactly as it was, read or not, so saying the same thing
 * twice does not light the bell a second time. Told with something new — a
 * different count, say — it takes the new words and is unread again.
 */
export function addNotification(
  list: readonly GokoNotification[],
  draft: NotificationDraft
): readonly GokoNotification[] {
  const index = list.findIndex((item) => item.id === draft.id);
  if (index === -1) return [{ ...draft, actions: [...draft.actions], read: false }, ...list];
  if (sameContent(list[index], draft)) return list;
  const next = [...list];
  next[index] = { ...draft, actions: [...draft.actions], read: false };
  return next;
}

export function removeNotification(
  list: readonly GokoNotification[],
  id: string
): readonly GokoNotification[] {
  return list.some((item) => item.id === id) ? list.filter((item) => item.id !== id) : list;
}

/** Opening the list is reading it: everything in it has now been seen. */
export function markAllRead(list: readonly GokoNotification[]): readonly GokoNotification[] {
  return hasUnread(list) ? list.map((item) => (item.read ? item : { ...item, read: true })) : list;
}

/** Whether the bell wears its dot. */
export function hasUnread(list: readonly GokoNotification[]): boolean {
  return list.some((item) => !item.read);
}
