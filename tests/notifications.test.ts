import { describe, expect, it } from "vitest";
import {
  addNotification,
  hasUnread,
  markAllRead,
  removeNotification,
} from "../src/core/notifications";
import type { GokoNotification, NotificationDraft } from "../src/core/notifications";

function draft(id: string, body = "Something happened.", label = "Do it"): NotificationDraft {
  return {
    id,
    title: `About ${id}`,
    body,
    actions: [
      { id: "go", label, primary: true },
      { id: "dismiss", label: "Dismiss" },
    ],
  };
}

describe("addNotification", () => {
  it("adds a new one unread, newest first", () => {
    const one = addNotification([], draft("a"));
    const two = addNotification(one, draft("b"));
    expect(two.map((item) => item.id)).toEqual(["b", "a"]);
    expect(two.every((item) => !item.read)).toBe(true);
  });

  it("does not duplicate a notification posted twice under one id", () => {
    const list = addNotification(addNotification([], draft("a")), draft("a"));
    expect(list).toHaveLength(1);
  });

  it("leaves one told again word for word exactly as it was, read or not", () => {
    const read = markAllRead(addNotification([], draft("a")));
    const again = addNotification(read, draft("a"));
    expect(again).toBe(read);
    expect(again[0].read).toBe(true);
  });

  it("takes the new words and is unread again when what it says has changed", () => {
    const read = markAllRead(addNotification(addNotification([], draft("a", "3 things.")), draft("b")));
    const again = addNotification(read, draft("a", "5 things.", "Do 5"));
    expect(again.map((item) => item.id)).toEqual(["b", "a"]);
    expect(again[1]).toMatchObject({ body: "5 things.", read: false });
    expect(again[1].actions[0].label).toBe("Do 5");
    expect(again[0].read).toBe(true);
  });

  it("does not change the list it was given", () => {
    const list: readonly GokoNotification[] = addNotification([], draft("a"));
    addNotification(list, draft("b"));
    addNotification(list, draft("a", "Changed."));
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("Something happened.");
  });

  it("keeps its own copy of the actions", () => {
    const given = draft("a");
    const list = addNotification([], given);
    (given.actions as NotificationDraft["actions"][number][]).push({ id: "late", label: "Late" });
    expect(list[0].actions).toHaveLength(2);
  });
});

describe("removeNotification", () => {
  it("takes the one with that id off the list", () => {
    const list = addNotification(addNotification([], draft("a")), draft("b"));
    expect(removeNotification(list, "a").map((item) => item.id)).toEqual(["b"]);
  });

  it("hands back the same list when there is nothing to remove", () => {
    const list = addNotification([], draft("a"));
    expect(removeNotification(list, "missing")).toBe(list);
  });
});

describe("markAllRead and hasUnread", () => {
  it("puts the dot up while anything is unread, and takes it down once the list is opened", () => {
    const list = addNotification(addNotification([], draft("a")), draft("b"));
    expect(hasUnread(list)).toBe(true);
    const read = markAllRead(list);
    expect(hasUnread(read)).toBe(false);
    expect(read.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("has no dot for an empty list", () => {
    expect(hasUnread([])).toBe(false);
  });

  it("hands back the same list when everything was already read", () => {
    const read = markAllRead(addNotification([], draft("a")));
    expect(markAllRead(read)).toBe(read);
  });
});
