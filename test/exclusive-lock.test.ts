import { describe, expect, test } from "bun:test";

import { createExclusiveRunner } from "../entrypoints/lib/exclusive-lock.ts";

describe("cross-context exclusive runner", () => {
  test("XL-01 delegates production ownership to the same-origin Web Locks API", async () => {
    const requests: string[] = [];
    const locks = {
      request<T>(name: string, operation: () => Promise<T>): Promise<T> {
        requests.push(name);
        return operation();
      },
    };
    const runExclusive = createExclusiveRunner("cloud", locks);

    expect(await runExclusive(async () => 42)).toBe(42);
    expect(requests).toEqual(["cloud"]);
  });

  test("XL-02 fallback serializes work and recovers after a rejection", async () => {
    const events: string[] = [];
    const runExclusive = createExclusiveRunner("cloud", undefined);
    const first = runExclusive(async () => {
      events.push("first");
      throw new Error("failed");
    });
    const second = runExclusive(async () => {
      events.push("second");
      return 2;
    });

    await first.catch(() => undefined);
    expect(await second).toBe(2);
    expect(events).toEqual(["first", "second"]);
  });
});
