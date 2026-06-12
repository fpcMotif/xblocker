// Test setup file for DOM environment
import { beforeEach, expect } from "bun:test";
import { Window } from "happy-dom";

// Setup Happy DOM environment
const window = new Window();
const document = window.document;

// Set globals
global.window = window;
global.document = document;
global.navigator = window.navigator;
global.getComputedStyle = (...args) => window.getComputedStyle(...args);
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
global.Event = window.Event;
global.KeyboardEvent = window.KeyboardEvent;
global.MouseEvent = window.MouseEvent;
global.location = window.location;

// Mock Chrome extension APIs with a real in-memory storage area so that
// read-modify-write code (the blocked store, whitelist, settings) can be tested
// end to end. Individual test files may still override get/set for focused cases.
function createInMemoryStorage() {
  let data = {};
  const changeListeners = [];

  function selectKeys(keys) {
    if (keys == null) return { ...data };
    if (typeof keys === "string") {
      return keys in data ? { [keys]: data[keys] } : {};
    }
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) {
        if (key in data) out[key] = data[key];
      }
      return out;
    }
    // Object form: keys are defaults.
    const out = {};
    for (const [key, fallback] of Object.entries(keys)) {
      out[key] = key in data ? data[key] : fallback;
    }
    return out;
  }

  const area = {
    get: (keys, callback) => {
      const result = selectKeys(keys);
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    set: (items, callback) => {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      for (const listener of changeListeners) listener(changes, "local");
      if (callback) callback();
      return Promise.resolve();
    },
    remove: (keys, callback) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const key of list) {
        if (key in data) {
          changes[key] = { oldValue: data[key], newValue: undefined };
          delete data[key];
        }
      }
      for (const listener of changeListeners) listener(changes, "local");
      if (callback) callback();
      return Promise.resolve();
    },
    clear: (callback) => {
      data = {};
      if (callback) callback();
      return Promise.resolve();
    },
    __reset: () => {
      data = {};
      changeListeners.length = 0;
    },
  };

  return { area, changeListeners };
}

// Install a brand-new in-memory chrome.storage on the global. Tests run in one shared
// process, and several files replace chrome.storage methods (or global.setTimeout) in
// their own beforeEach without restoring them. Reinstalling a fresh area before every
// test keeps each test isolated regardless of what ran before it.
function installFreshChrome() {
  const { area: localArea, changeListeners } = createInMemoryStorage();
  global.chrome = {
    storage: {
      local: localArea,
      onChanged: {
        addListener: (listener) => changeListeners.push(listener),
        removeListener: (listener) => {
          const index = changeListeners.indexOf(listener);
          if (index !== -1) changeListeners.splice(index, 1);
        },
      },
    },
  };
}

const originalSetTimeout = global.setTimeout;
installFreshChrome();

beforeEach(() => {
  installFreshChrome();
  // blocking.test.js overrides setTimeout to run synchronously and never restores it.
  global.setTimeout = originalSetTimeout;
});

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: () => {},
  error: () => {},
  warn: () => {},
};

// Add custom matchers and utilities
expect.extend({
  toHaveStyle(received, property, value) {
    const element = received;
    const actualValue = element.style[property] || getComputedStyle(element)[property];

    if (actualValue === value) {
      return {
        message: () => `Expected element not to have style ${property}: ${value}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `Expected element to have style ${property}: ${value}, but got: ${actualValue}`,
        pass: false,
      };
    }
  },
});
