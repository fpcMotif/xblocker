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

const g = globalThis as Record<string, unknown>;

Object.assign(g, {
  window: happyWindow,
  document: happyDocument,
  navigator: happyWindow.navigator,
  getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
  HTMLElement: happyWindow.HTMLElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  HTMLInputElement: happyWindow.HTMLInputElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  KeyboardEvent: happyWindow.KeyboardEvent,
  MouseEvent: happyWindow.MouseEvent,
  SVGCircleElement: happyWindow.SVGCircleElement,
  location: happyWindow.location,
  requestAnimationFrame: happyWindow.requestAnimationFrame.bind(happyWindow),
  cancelAnimationFrame: happyWindow.cancelAnimationFrame.bind(happyWindow),
});

const activeObservers = new Set<MutationObserver>();
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- happy-dom's observer is runtime-compatible with the DOM shape used by these tests.
const BaseMutationObserver = happyWindow.MutationObserver as unknown as typeof MutationObserver;

g.MutationObserver = class TrackedMutationObserver extends BaseMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    activeObservers.add(this);
  }

  disconnect(): void {
    super.disconnect();
    activeObservers.delete(this);
  }
};

export type StorageItems = Record<string, unknown>;
export type StorageGetKeys = string | string[] | StorageItems | null | undefined;
export type StorageGetCallback = (items?: StorageItems) => void;

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
        callback(undefined);
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
      for (const [key, value] of Object.entries(items)) {
        // Real chrome.storage drops undefined values during serialization — the key
        // keeps its old value. Mirroring that here keeps "clear via set-to-undefined"
        // bugs visible in tests; clearing a key must go through remove().
        if (value !== undefined) this.data[key] = structuredClone(value);
      }
      callback?.();
    });
  }

  /** Mirrors chrome.storage.local.remove: deletes the key(s) outright — the only way
   *  to clear a key, since set() drops undefined values. */
  remove(keys: string | string[], callback?: () => void): void {
    this.dispatch(() => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete this.data[key];
      }
      callback?.();
    });
  }

  /** Drop every stored key. Used by the blocked-store suite to start each test
   *  from an empty area; mirrors chrome.storage.local.clear(). */
  clear(callback?: () => void): void {
    this.dispatch(() => {
      this.data = {};
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
    const names =
      typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
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
  // onMessage is a no-op by default so the background worker's message wiring
  // (startBackgroundSync) can register without a stub; tests that assert on it install
  // their own capturing fake. openOptionsPage/sendMessage are intentionally ABSENT here —
  // the popup probes openOptionsPage's absence (PU-17) and rail/background tests install
  // their own per-case.
  runtime: {
    lastError: undefined,
    onMessage: { addListener: () => {}, removeListener: () => {} },
  },
  storage: {
    local: {
      get: (keys: StorageGetKeys, callback: StorageGetCallback) => storageFake.get(keys, callback),
      set: (items: StorageItems, callback?: () => void) => storageFake.set(items, callback),
      remove: (keys: string | string[], callback?: () => void) =>
        storageFake.remove(keys, callback),
      clear: (callback?: () => void) => storageFake.clear(callback),
    },
  },
};

/** Point window.location/location at a fake URL without happy-dom navigation. */
export function setWindowLocation(href: string): void {
  const url = new URL(href);
  const fakeLocation = { hostname: url.hostname, href };
  Object.defineProperty(happyWindow, "location", {
    configurable: true,
    value: fakeLocation,
    writable: true,
  });
  g.location = fakeLocation;
}

/** Override document.cookie with a fixed cookie string. */
export function setDocumentCookie(value: string): void {
  Object.defineProperty(happyDocument, "cookie", {
    configurable: true,
    get: () => value,
    set: () => {},
  });
}

/** Reset DOM + storage between tests. Call from beforeEach. */
export function resetTestEnvironment(): void {
  for (const observer of activeObservers) {
    observer.disconnect();
  }
  activeObservers.clear();

  const doc = happyDocument;
  doc.body.innerHTML = "";
  doc.head.innerHTML = "";
  doc.documentElement.style.colorScheme = "";
  doc.documentElement.removeAttribute("data-theme");
  doc.body.style.backgroundColor = "rgb(255, 255, 255)";
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
