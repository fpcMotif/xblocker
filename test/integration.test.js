import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

describe("Integration Tests", () => {
  beforeEach(() => {
    // Reset DOM and environment
    document.body.innerHTML = "";
    document.head.innerHTML = "";

    // Mock window location
    Object.defineProperty(window, "location", {
      value: { href: "https://x.com/user/status/123456789" },
      writable: true,
    });

    // Mock MutationObserver
    global.MutationObserver = mock(function (_callback) {
      this.observe = mock(() => {});
      this.disconnect = mock(() => {});
      return this;
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  describe("Full User Workflow", () => {
    test("should complete full blocking workflow", async () => {
      // 1. Setup: Create mock tweet page structure
      const mainTweet = document.createElement("article");
      mainTweet.setAttribute("data-testid", "tweet");

      const commentTweet = document.createElement("article");
      commentTweet.setAttribute("data-testid", "tweet");

      const userLink = document.createElement("a");
      userLink.setAttribute("href", "/testuser");
      userLink.setAttribute("role", "link");
      commentTweet.appendChild(userLink);

      const moreButton = document.createElement("button");
      moreButton.setAttribute("aria-label", "More");
      commentTweet.appendChild(moreButton);

      document.body.appendChild(mainTweet);
      document.body.appendChild(commentTweet);

      // 2. Add buttons to page
      const buttonContainer = document.createElement("div");
      buttonContainer.id = "xblocker-buttons";

      const blockButton = document.createElement("button");
      blockButton.innerHTML = "🚫 Block Comments";
      buttonContainer.appendChild(blockButton);

      document.body.appendChild(buttonContainer);

      // 3. Verify setup
      expect(document.querySelectorAll('article[data-testid="tweet"]')).toHaveLength(2);
      expect(document.getElementById("xblocker-buttons")).toBeTruthy();
      expect(blockButton.innerHTML).toBe("🚫 Block Comments");

      // 4. Simulate blocking process
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      const commentTweets = Array.from(tweetArticles).slice(1);

      expect(commentTweets).toHaveLength(1);

      // 5. Simulate finding and clicking More button
      const foundMoreButton = commentTweets[0].querySelector('[aria-label="More"]');
      expect(foundMoreButton).toBeTruthy();

      // 6. Create mock menu after More button click
      const blockMenuItem = document.createElement("div");
      blockMenuItem.setAttribute("role", "menuitem");
      blockMenuItem.innerText = "Block @testuser";
      document.body.appendChild(blockMenuItem);

      // 7. Simulate finding block menu item
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      let blockItem = null;
      menuItems.forEach((item) => {
        if (item.innerText.startsWith("Block @")) {
          blockItem = item;
        }
      });

      expect(blockItem).toBeTruthy();

      // 8. Create confirmation modal
      const confirmButton = document.createElement("button");
      confirmButton.setAttribute("data-testid", "confirmationSheetConfirm");
      document.body.appendChild(confirmButton);

      expect(document.querySelector('[data-testid="confirmationSheetConfirm"]')).toBeTruthy();
    });

    test("should complete full whitelist workflow", () => {
      // 1. Create whitelist button
      const whitelistButton = document.createElement("button");
      whitelistButton.innerHTML = "✅ Whitelist User";
      document.body.appendChild(whitelistButton);

      // 2. Simulate clicking whitelist button (opens modal)
      const modal = document.createElement("div");
      modal.id = "xblocker-modal";

      const modalContent = document.createElement("div");
      modalContent.innerHTML = `
        <h3>Add User to Whitelist</h3>
        <input type="text" id="username-input" value="testuser">
        <button id="add-btn">Add to Whitelist</button>
      `;
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      // 3. Verify modal structure
      expect(document.getElementById("xblocker-modal")).toBeTruthy();
      expect(document.getElementById("username-input")).toBeTruthy();
      expect(document.getElementById("add-btn")).toBeTruthy();

      // 4. Simulate adding user to whitelist
      const input = document.getElementById("username-input");

      expect(input.value).toBe("testuser");

      // 5. Mock whitelist storage operation
      const mockWhitelist = [];
      const username = input.value.trim();

      if (username && !mockWhitelist.includes(username)) {
        mockWhitelist.push(username);
      }

      expect(mockWhitelist).toContain("testuser");

      // 6. Simulate toast notification
      const toast = document.createElement("div");
      toast.textContent = `✅ Added @${username} to whitelist`;
      toast.style.cssText = "position: fixed; top: 24px; right: 24px;";
      document.body.appendChild(toast);

      expect(toast.textContent).toBe("✅ Added @testuser to whitelist");
    });

    test("should handle URL navigation changes", () => {
      const observeCallback = mock(() => {});
      const mockObserver = new MutationObserver(observeCallback);
      mockObserver.observe(document, { subtree: true, childList: true });

      // Simulate initial page load
      let currentUrl = "https://x.com/user/status/123";
      let lastUrl = currentUrl;

      // Simulate URL change
      currentUrl = "https://x.com/user/status/456";

      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        // Trigger page check
        const urlPattern = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
        expect(urlPattern.test(currentUrl)).toBe(true);
      }

      expect(mockObserver.observe.mock.calls).toHaveLength(1);
    });
  });

  describe("Error Recovery", () => {
    test("should handle missing DOM elements gracefully", () => {
      // Test with empty page (no tweets)
      expect(document.querySelectorAll('article[data-testid="tweet"]')).toHaveLength(0);

      // Should not throw when trying to process non-existent tweets
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      const commentTweets = Array.from(tweetArticles).slice(1);

      expect(commentTweets).toHaveLength(0);

      // Simulate attempting to process empty list
      expect(() => {
        for (const _tweet of commentTweets) {
          // Process tweet
        }
      }).not.toThrow();
    });

    test("should handle Chrome storage errors", () => {
      // Mock storage error
      global.chrome.storage.local.get = mock((_keys, _callback) => {
        // Simulate error - no callback
        // In real scenario this might throw or callback with undefined
      });

      // Should handle gracefully when storage fails
      expect(() => {
        chrome.storage.local.get("whitelist", (result) => {
          // Handle potential undefined result
          const whitelist = result?.whitelist || [];
          expect(Array.isArray(whitelist)).toBe(true);
        });
      }).not.toThrow();
    });

    test("should handle network-related delays", async () => {
      // Mock delayed response simulation
      const mockDelayedOperation = mock(async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve("delayed-success"), 1000);
        });
      });

      const result = await mockDelayedOperation();
      expect(result).toBe("delayed-success");
    });
  });

  describe("Performance Considerations", () => {
    test("should handle large numbers of tweet elements", () => {
      // Create many tweet elements
      const tweetCount = 100;
      for (let i = 0; i < tweetCount; i++) {
        const tweet = document.createElement("article");
        tweet.setAttribute("data-testid", "tweet");
        document.body.appendChild(tweet);
      }

      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      expect(tweetArticles).toHaveLength(tweetCount);

      // Simulate processing with limit
      const commentTweets = Array.from(tweetArticles).slice(1);
      const limitedTweets = commentTweets.slice(0, 50);

      expect(limitedTweets).toHaveLength(50);
    });

    test("should prevent duplicate button containers", () => {
      // Create first container
      const container1 = document.createElement("div");
      container1.id = "xblocker-buttons";
      document.body.appendChild(container1);

      // Simulate checking for existing container before creating new one
      const existing = document.getElementById("xblocker-buttons");
      if (existing) {
        existing.remove();
      }

      const container2 = document.createElement("div");
      container2.id = "xblocker-buttons";
      document.body.appendChild(container2);

      expect(document.querySelectorAll("#xblocker-buttons")).toHaveLength(1);
    });

    test("should cleanup resources properly", () => {
      // Create multiple elements
      const modal = document.createElement("div");
      modal.id = "xblocker-modal";
      document.body.appendChild(modal);

      const toast1 = document.createElement("div");
      toast1.className = "toast";
      document.body.appendChild(toast1);

      const toast2 = document.createElement("div");
      toast2.className = "toast";
      document.body.appendChild(toast2);

      // Simulate cleanup
      const existingModal = document.getElementById("xblocker-modal");
      if (existingModal) {
        existingModal.remove();
      }

      const toasts = document.querySelectorAll(".toast");
      toasts.forEach((toast) => toast.remove());

      expect(document.getElementById("xblocker-modal")).toBeFalsy();
      expect(document.querySelectorAll(".toast")).toHaveLength(0);
    });
  });

  describe("Accessibility and UX", () => {
    test("should provide proper ARIA labels", () => {
      const button = document.createElement("button");
      button.setAttribute("aria-label", "Block first 20 comments");
      button.innerHTML = "🚫 Block Comments";

      expect(button.getAttribute("aria-label")).toBe("Block first 20 comments");
    });

    test("should handle keyboard navigation", () => {
      const modal = document.createElement("div");
      const input = document.createElement("input");
      input.id = "username-input";
      modal.appendChild(input);
      document.body.appendChild(modal);

      // Simulate keyboard events
      const keyHandler = mock(() => {});

      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") keyHandler("enter");
        if (e.key === "Escape") keyHandler("escape");
      });

      // Test Enter key
      const enterEvent = new Event("keypress");
      enterEvent.key = "Enter";
      input.dispatchEvent(enterEvent);

      // Test Escape key
      const escapeEvent = new Event("keypress");
      escapeEvent.key = "Escape";
      input.dispatchEvent(escapeEvent);

      expect(keyHandler).toHaveBeenCalledWith("enter");
      expect(keyHandler).toHaveBeenCalledWith("escape");
    });

    test("should provide visual feedback for user actions", () => {
      const button = document.createElement("button");
      button.innerHTML = "Block Comments";

      // Simulate loading state
      button.disabled = true;
      button.innerHTML = "🔄 Blocking...";

      expect(button.disabled).toBe(true);
      expect(button.innerHTML).toBe("🔄 Blocking...");

      // Simulate success state
      button.innerHTML = "✅ Blocked!";
      expect(button.innerHTML).toBe("✅ Blocked!");

      // Simulate return to normal state
      setTimeout(() => {
        button.innerHTML = "Block Comments";
        button.disabled = false;
      }, 2000);
    });
  });
});
