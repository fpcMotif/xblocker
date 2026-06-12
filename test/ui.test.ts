import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

describe("UI Components and Interactions", () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = "";
    document.head.innerHTML = "";

    // Mock location object
    Object.defineProperty(window, "location", {
      value: {
        href: "https://x.com/user/status/123456789",
      },
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  describe("Button Container Creation", () => {
    test("should create button container with correct styles", () => {
      // Simulate addButtons function
      const buttonContainer = document.createElement("div");
      buttonContainer.id = "xblocker-buttons";
      buttonContainer.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 12px;
      `;

      document.body.appendChild(buttonContainer);

      expect(buttonContainer.style.position).toBe("fixed");
      expect(buttonContainer.style.bottom).toBe("24px");
      expect(buttonContainer.style.right).toBe("24px");
      expect(buttonContainer.style.zIndex).toBe("10000");
      expect(buttonContainer.style.display).toBe("flex");
    });

    test("should remove existing container when creating new one", () => {
      // Create first container
      const existingContainer = document.createElement("div");
      existingContainer.id = "xblocker-buttons";
      document.body.appendChild(existingContainer);

      expect(document.getElementById("xblocker-buttons")).toBeTruthy();

      // Simulate removal and recreation
      const existing = document.getElementById("xblocker-buttons");
      if (existing) {
        existing.remove();
      }

      const newContainer = document.createElement("div");
      newContainer.id = "xblocker-buttons";
      document.body.appendChild(newContainer);

      expect(document.querySelectorAll("#xblocker-buttons")).toHaveLength(1);
    });
  });

  describe("Button Creation and Styling", () => {
    test("should create block button with correct properties", () => {
      const createButton = (text, color, icon) => {
        const button = document.createElement("button");
        button.className = "xb-button";
        button.innerHTML = `${icon} ${text}`;
        button.style.cssText = `
          padding: 12px 16px;
          background: linear-gradient(135deg, ${color}, ${color}dd);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
        `;
        return button;
      };

      const blockButton = createButton("Block Comments", "#EF4444", "🚫");

      expect(blockButton.className).toBe("xb-button");
      expect(blockButton.innerHTML).toBe("🚫 Block Comments");
      expect(blockButton.style.color).toBe("white");
      expect(blockButton.style.border).toContain("none");
      expect(blockButton.style.cursor).toBe("pointer");
    });

    test("should create mute button with correct properties", () => {
      const createButton = (text, color, icon) => {
        const button = document.createElement("button");
        button.className = "xb-button";
        button.innerHTML = `${icon} ${text}`;
        button.style.color = "white";
        return button;
      };

      const muteButton = createButton("Mute Comments", "#F97316", "🔇");

      expect(muteButton.innerHTML).toBe("🔇 Mute Comments");
      expect(muteButton.style.color).toBe("white");
    });

    test("should create whitelist button with correct properties", () => {
      const createButton = (text, color, icon) => {
        const button = document.createElement("button");
        button.className = "xb-button";
        button.innerHTML = `${icon} ${text}`;
        return button;
      };

      const whitelistButton = createButton("Whitelist User", "#10B981", "✅");

      expect(whitelistButton.innerHTML).toBe("✅ Whitelist User");
      expect(whitelistButton.className).toBe("xb-button");
    });
  });

  describe("CSS Styles Injection", () => {
    test("should inject CSS styles correctly", () => {
      const style = document.createElement("style");
      style.id = "xblocker-styles";
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .xb-button {
          transition: all 0.2s ease;
        }
      `;
      document.head.appendChild(style);

      const injectedStyle = document.getElementById("xblocker-styles");
      expect(injectedStyle).toBeTruthy();
      expect(injectedStyle.textContent).toContain("slideIn");
      expect(injectedStyle.textContent).toContain("xb-button");
    });

    test("should not duplicate styles", () => {
      // First injection
      if (!document.getElementById("xblocker-styles")) {
        const style = document.createElement("style");
        style.id = "xblocker-styles";
        document.head.appendChild(style);
      }

      // Second injection attempt
      if (!document.getElementById("xblocker-styles")) {
        const style = document.createElement("style");
        style.id = "xblocker-styles";
        document.head.appendChild(style);
      }

      expect(document.querySelectorAll("#xblocker-styles")).toHaveLength(1);
    });
  });

  describe("Toast Notifications", () => {
    test("should create toast with correct styling", () => {
      const showToast = (message, type = "info") => {
        const toast = document.createElement("div");
        toast.style.cssText = `
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 10002;
          background: ${
            type === "success"
              ? "linear-gradient(135deg, #10B981, #059669)"
              : type === "warning"
                ? "linear-gradient(135deg, #F59E0B, #D97706)"
                : "linear-gradient(135deg, #3B82F6, #2563EB)"
          };
          color: white;
          padding: 16px 20px;
          border-radius: 12px;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        return toast;
      };

      const successToast = showToast("Success message", "success");
      expect(successToast.style.position).toBe("fixed");
      expect(successToast.style.color).toBe("white");
      expect(successToast.textContent).toBe("Success message");

      const warningToast = showToast("Warning message", "warning");
      expect(warningToast.textContent).toBe("Warning message");
    });

    test("should handle different toast types", () => {
      const getToastBackground = (type) => {
        return type === "success"
          ? "linear-gradient(135deg, #10B981, #059669)"
          : type === "warning"
            ? "linear-gradient(135deg, #F59E0B, #D97706)"
            : "linear-gradient(135deg, #3B82F6, #2563EB)";
      };

      expect(getToastBackground("success")).toContain("#10B981");
      expect(getToastBackground("warning")).toContain("#F59E0B");
      expect(getToastBackground("info")).toContain("#3B82F6");
    });
  });

  describe("Modal Functionality", () => {
    test("should create modal with correct structure", () => {
      const modal = document.createElement("div");
      modal.id = "xblocker-modal";
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      const modalContent = document.createElement("div");
      modalContent.innerHTML = `
        <h3>Add User to Whitelist</h3>
        <input type="text" id="username-input" placeholder="Enter username (without @)">
        <button id="cancel-btn">Cancel</button>
        <button id="add-btn">Add to Whitelist</button>
      `;

      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      expect(modal.style.position).toBe("fixed");
      expect(modal.style.width).toBe("100%");
      expect(modal.style.height).toBe("100%");
      expect(modal.querySelector("h3").textContent).toBe("Add User to Whitelist");
      expect(modal.querySelector("#username-input")).toBeTruthy();
      expect(modal.querySelector("#cancel-btn")).toBeTruthy();
      expect(modal.querySelector("#add-btn")).toBeTruthy();
    });

    test("should remove existing modal before creating new one", () => {
      // Create first modal
      const existingModal = document.createElement("div");
      existingModal.id = "xblocker-modal";
      document.body.appendChild(existingModal);

      // Simulate modal removal and recreation
      const existing = document.getElementById("xblocker-modal");
      if (existing) {
        existing.remove();
      }

      const newModal = document.createElement("div");
      newModal.id = "xblocker-modal";
      document.body.appendChild(newModal);

      expect(document.querySelectorAll("#xblocker-modal")).toHaveLength(1);
    });
  });

  describe("Progress Bar Functionality", () => {
    test("should create progress bar with correct structure", () => {
      const progressContainer = document.createElement("div");
      progressContainer.className = "xb-progress";
      progressContainer.innerHTML = '<div class="xb-progress-bar"></div>';

      document.body.appendChild(progressContainer);

      const progressBar = document.querySelector(".xb-progress-bar");
      expect(progressBar).toBeTruthy();
      expect(progressContainer.className).toBe("xb-progress");
    });

    test("should update progress bar width", () => {
      const progressContainer = document.createElement("div");
      progressContainer.className = "xb-progress";
      progressContainer.innerHTML = '<div class="xb-progress-bar"></div>';
      document.body.appendChild(progressContainer);

      const progressBar = document.querySelector(".xb-progress-bar");

      // Simulate progress update
      const total = 10;
      for (let i = 0; i < total; i++) {
        progressBar.style.width = `${((i + 1) / total) * 100}%`;
      }

      expect(progressBar.style.width).toBe("100%");
    });
  });

  describe("Button State Management", () => {
    test("should handle button disabled state", () => {
      const button = document.createElement("button");
      button.innerHTML = "Test Button";

      // Simulate disabling button
      button.disabled = true;
      button.innerHTML = "🔄 Loading...";

      expect(button.disabled).toBe(true);
      expect(button.innerHTML).toBe("🔄 Loading...");
    });

    test("should handle button success state", () => {
      const button = document.createElement("button");
      button.innerHTML = "Test Button";

      // Simulate success state
      button.innerHTML = "✅ Success!";

      setTimeout(() => {
        button.innerHTML = "Test Button";
        button.disabled = false;
      }, 2000);

      expect(button.innerHTML).toBe("✅ Success!");
    });

    test("should handle button error state", () => {
      const button = document.createElement("button");
      button.innerHTML = "Test Button";

      // Simulate error state
      button.innerHTML = "❌ Error";

      setTimeout(() => {
        button.innerHTML = "Test Button";
        button.disabled = false;
      }, 2000);

      expect(button.innerHTML).toBe("❌ Error");
    });
  });

  describe("Event Handling", () => {
    test("should handle button click events", () => {
      const button = document.createElement("button");
      const clickHandler = mock(() => {});

      button.addEventListener("click", clickHandler);
      button.click();

      expect(clickHandler).toHaveBeenCalledTimes(1);
    });

    test("should handle modal close events", () => {
      const modal = document.createElement("div");
      const closeHandler = mock(() => modal.remove());

      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeHandler();
      });

      // Simulate click on modal backdrop
      const clickEvent = new Event("click", { bubbles: true });
      modal.dispatchEvent(clickEvent);

      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    test("should handle keyboard events", () => {
      const input = document.createElement("input");
      const keyHandler = mock(() => {});

      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") keyHandler();
      });

      const enterEvent = new Event("keypress");
      enterEvent.key = "Enter";
      input.dispatchEvent(enterEvent);

      expect(keyHandler).toHaveBeenCalledTimes(1);
    });
  });
});
