import { describe, expect, it } from "vitest";
import { runPool } from "../src/core/pool";
import { clampConcurrency, isLimitFailure } from "../src/core/vision";

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("runPool", () => {
  it("runs every item, never more at once than its size", async () => {
    const queue = Array.from({ length: 25 }, (_, i) => i);
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await runPool(
      () => queue.shift(),
      async (item) => {
        running++;
        most = Math.max(most, running);
        await tick(1 + (item % 3));
        done.push(item);
        running--;
      },
      10
    );
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(most).toBe(10);
  });

  it("lets a free worker take the next item while a slow one is still busy", async () => {
    const queue = ["slow", "a", "b", "c"];
    const order: string[] = [];
    await runPool(
      () => queue.shift(),
      async (item) => {
        await tick(item === "slow" ? 30 : 1);
        order.push(item);
      },
      2
    );
    expect(order).toEqual(["a", "b", "c", "slow"]);
  });

  it("picks up what is queued while it runs", async () => {
    const queue = [1];
    const done: number[] = [];
    await runPool(
      () => queue.shift(),
      async (item) => {
        if (item === 1) queue.push(2, 3);
        await tick(1);
        done.push(item);
      },
      1
    );
    expect(done).toEqual([1, 2, 3]);
  });

  it("starts nothing more once told to stop, and lets the running ones finish", async () => {
    const queue = Array.from({ length: 10 }, (_, i) => i);
    let stop = false;
    const done: number[] = [];
    await runPool(
      () => queue.shift(),
      async (item) => {
        if (item === 1) stop = true;
        await tick(2);
        done.push(item);
      },
      3,
      () => stop
    );
    // The third worker had not taken an item when the second said stop.
    expect(done.sort()).toEqual([0, 1]);
    expect(queue).toHaveLength(8);
  });

  it("runs one worker for a size below one", async () => {
    let running = 0;
    let most = 0;
    const queue = [1, 2, 3];
    await runPool(
      () => queue.shift(),
      async () => {
        running++;
        most = Math.max(most, running);
        await tick(1);
        running--;
      },
      0
    );
    expect(most).toBe(1);
  });
});

describe("clampConcurrency", () => {
  it("keeps a count between one and ten", () => {
    expect(clampConcurrency(3)).toBe(3);
    expect(clampConcurrency("7")).toBe(7);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(40)).toBe(10);
    expect(clampConcurrency(2.6)).toBe(3);
  });

  it("falls back to the default for nonsense", () => {
    expect(clampConcurrency("many")).toBe(3);
    expect(clampConcurrency(undefined)).toBe(3);
  });
});

describe("isLimitFailure", () => {
  it("knows the two failures that will refuse the rest of a batch", () => {
    expect(isLimitFailure("the Claude subscription's usage limit is reached — wait for the window to reset")).toBe(true);
    expect(isLimitFailure("rate limited — try again in a moment")).toBe(true);
  });

  it("leaves one clipping's own trouble alone", () => {
    expect(isLimitFailure("Claude Code took too long — try again, or lower the effort")).toBe(false);
    expect(isLimitFailure("the model's answer was not the JSON asked for")).toBe(false);
  });
});
