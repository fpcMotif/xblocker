// Test setup file for DOM environment
import { Window } from 'happy-dom';

// Setup Happy DOM environment
const window = new Window();
const document = window.document;

// Set globals
global.window = window;
global.document = document;
global.navigator = window.navigator;
global.getComputedStyle = window.getComputedStyle;
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
global.Event = window.Event;
global.KeyboardEvent = window.KeyboardEvent;
global.MouseEvent = window.MouseEvent;
global.location = window.location;

// Mock Chrome extension APIs
global.chrome = {
  storage: {
    local: {
      get: (keys, callback) => {
        // Mock storage with empty whitelist by default
        const mockData = {
          whitelist: []
        };
        callback(mockData);
      },
      set: (data, callback) => {
        // Mock successful save
        if (callback) callback();
      }
    }
  }
};

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: () => {},
  error: () => {},
  warn: () => {}
};

// Add custom matchers and utilities
expect.extend({
  toHaveStyle(received, property, value) {
    const element = received;
    const actualValue = element.style[property] || getComputedStyle(element)[property];
    
    if (actualValue === value) {
      return {
        message: () => `Expected element not to have style ${property}: ${value}`,
        pass: true
      };
    } else {
      return {
        message: () => `Expected element to have style ${property}: ${value}, but got: ${actualValue}`,
        pass: false
      };
    }
  }
});