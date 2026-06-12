// Shared test environment: happy-dom globals + a stateful chrome.storage fake.
//
// Design goals (see docs/test-plan.md):
// - The storage fake is STATEFUL: set() mutates a store that later get() calls
//   observe, so persistence bugs are visible (the legacy setup.js fake always
//   returned an empty whitelist and silently dropped writes).
// - The fake supports a "manual" dispatch mode where callbacks are queued and
//   flushed explicitly. This exposes read-modify-write races (XB-BUG-08) that a
//   synchronous fake can never reproduce.
// - Failures can be injected per call (failNextGet/failNextSet) to assert the
//   extension degrades gracefully when chrome.storage errors.
import { Window } from "happy-dom";

const happyWindow = new Window();
const happyDocument = happyWindow.document;

type GlobalAny = typeof globalThis & Record<string, unknown>;
const g = globalThis as GlobalAny;

g.window = happyWindow;
g.document = happyDocument;
g.navigator = happyWindow.navigator;
g.getComputedStyle = (...args: unknown[]) =>
  (happyWindow.getComputedStyle as (...inner: unknown[]) => unknown)(...args);
g.HTMLElement = happyWindow.HTMLElement;
g.HTMLButtonElement = happyWindow.HTMLButtonElement;
g.HTMLInputElement = happyWindow.HTMLInputElement;
g.Element = happyWindow.Element;
g.Node = happyWindow.Node;
g.Event = happyWindow.Event;
g.KeyboardEvent = happyWindow.KeyboardEvent;
g.MouseEvent = happyWindow.MouseEvent;
g.MutationObserver = happyWindow.MutationObserver;
g.location = happyWindow.location;

export type StorageItems = Record<string, unknown>;
export type StorageGetKeys = string | string[] | StorageItems | null | undefined;
export type StorageGetCallback = (items: StorageItems) => void;

type DispatchMode = "sync" | "manual";

export class FakeChromeStorageArea {
  data: StorageItems = {};
  getCalls: StorageGetKeys[] = [];
  setCalls: StorageItems[] = [];
  failNextGet = false;
  failNextSet = false;
  private mode: DispatchMode = "sync";
  private pending: Array<() => void> = [];

  get(keys: StorageGetKeys, callback: StorageGetCallback): void {
    this.getCalls.push(keys);
    this.dispatch(() => {
      if (this.failNextGet) {
        this.failNextGet = false;
        // Real chrome invokes the callback with no items and sets
        // chrome.runtime.lastError. The extension never reads lastError, so the
        // observable contract is simply "callback receives nothing usable".
        callback(undefined as unknown as StorageItems);
        return;
      }
      callback(this.snapshotFor(keys));
    });
  }

  set(items: StorageItems, callback?: () => void): void {
    this.setCalls.push(structuredClone(items));
    this.dispatch(() => {
      if (this.failNextSet) {
        this.failNextSet = false;
        callback?.();
        return;
      }
      Object.assign(this.data, structuredClone(items));
      callback?.();
    });
  }

  /** Queue callbacks instead of running them, until flush() is called. */
  useManualDispatch(): void {
    this.mode = "manual";
  }

  /** Run every queued callback (in FIFO order), including ones queued while flushing. */
  flush(): void {
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      next?.();
    }
  }

  pendingCount(): number {
    return this.pending.length;
  }

  reset(): void {
    this.data = {};
    this.getCalls = [];
    this.setCalls = [];
    this.failNextGet = false;
    this.failNextSet = false;
    this.mode = "sync";
    this.pending = [];
  }

  private dispatch(task: () => void): void {
    if (this.mode === "manual") {
      this.pending.push(task);
      return;
    }
    task();
  }

  private snapshotFor(keys: StorageGetKeys): StorageItems {
    if (keys === null || keys === undefined) {
      return structuredClone(this.data);
    }
    const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const result: StorageItems = {};
    for (const name of names) {
      if (typeof name === "string" && name in this.data) {
        result[name] = structuredClone(this.data[name]);
      }
    }
    return result;
  }
}

export const storageFake = new FakeChromeStorageArea();

g.chrome = {
  runtime: { lastError: undefined },
  storage: {
    local: {
      get: (keys: StorageGetKeys, callback: StorageGetCallback) => storageFake.get(keys, callback),
      set: (items: StorageItems, callback?: () => void) => storageFake.set(items, callback),
    },
  },
} as unknown as typeof chrome;

/** Point window.location/location at a fake URL without happy-dom navigation. */
export function setWindowLocation(href: string): void {
  const url = new URL(href);
  const fakeLocation = { hostname: url.hostname, href };
  Object.defineProperty(g.window, "location", {
    configurable: true,
    value: fakeLocation,
    writable: true,
  });
  g.location = fakeLocation;
}

/** Override document.cookie with a fixed cookie string. */
export function setDocumentCookie(value: string): void {
  Object.defineProperty(g.document, "cookie", {
    configurable: true,
    get: () => value,
    set: () => {},
  });
}

/** Reset DOM + storage between tests. Call from beforeEach. */
export function resetTestEnvironment(): void {
  const doc = g.document as unknown as Document;
  doc.body.innerHTML = "";
  doc.head.innerHTML = "";
  storageFake.reset();
  setDocumentCookie("");
  setWindowLocation("https://x.com/someuser/status/123456789");
}

// Silence extension logging so test output stays readable. Failures are
// asserted on behavior, never on console output.
g.console = {
  ...console,
  log: () => {},
  warn: () => {},
  error: () => {},
};
