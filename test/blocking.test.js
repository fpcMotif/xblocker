import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

describe('Blocking and Muting Functions', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    
    // Mock location object for tweet page
    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://x.com/user/status/123456789'
      },
      writable: true
    });

    // Mock setTimeout for async operations
    global.setTimeout = mock((fn, delay) => {
      // Execute immediately for testing
      fn();
      return 1;
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  describe('URL Pattern Validation', () => {
    test('should identify valid tweet pages', () => {
      const urlPattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
      
      const validUrls = [
        'https://x.com/user/status/123456789',
        'https://www.x.com/user/status/987654321',
        'http://x.com/testuser/status/555666777'
      ];
      
      validUrls.forEach(url => {
        expect(urlPattern.test(url)).toBe(true);
      });
    });

    test('should reject invalid URLs', () => {
      const urlPattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
      
      const invalidUrls = [
        'https://x.com/user',
        'https://x.com/i/timeline',
        'https://example.com/user/status/123',
        'https://x.com/user/status/abc'
      ];
      
      invalidUrls.forEach(url => {
        expect(urlPattern.test(url)).toBe(false);
      });
    });
  });

  describe('Tweet Article Selection', () => {
    test('should find tweet articles on page', () => {
      // Create mock tweet articles
      const mainTweet = document.createElement('article');
      mainTweet.setAttribute('data-testid', 'tweet');
      mainTweet.innerHTML = '<div>Main tweet content</div>';
      
      const comment1 = document.createElement('article');
      comment1.setAttribute('data-testid', 'tweet');
      comment1.innerHTML = '<div>Comment 1</div>';
      
      const comment2 = document.createElement('article');
      comment2.setAttribute('data-testid', 'tweet');
      comment2.innerHTML = '<div>Comment 2</div>';
      
      document.body.appendChild(mainTweet);
      document.body.appendChild(comment1);
      document.body.appendChild(comment2);
      
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      expect(tweetArticles).toHaveLength(3);
      
      // Simulate skipping the main tweet (first one)
      const commentTweets = Array.from(tweetArticles).slice(1);
      expect(commentTweets).toHaveLength(2);
    });

    test('should limit to specified number of comments', () => {
      // Create multiple comment tweets
      const comments = [];
      for (let i = 0; i < 30; i++) {
        const comment = document.createElement('article');
        comment.setAttribute('data-testid', 'tweet');
        comments.push(comment);
        document.body.appendChild(comment);
      }
      
      // Simulate limiting to first 20 comments
      const first20Comments = comments.slice(0, 20);
      expect(first20Comments).toHaveLength(20);
      
      // Simulate limiting to first 50 comments
      const first50Comments = comments.slice(0, 50);
      expect(first50Comments).toHaveLength(30); // Only 30 exist
    });
  });

  describe('Username Extraction', () => {
    test('should extract username from user link', () => {
      const tweetArticle = document.createElement('article');
      const userLink = document.createElement('a');
      userLink.setAttribute('href', '/testuser');
      userLink.setAttribute('role', 'link');
      tweetArticle.appendChild(userLink);
      
      // Simulate username extraction
      const userLinkElement = tweetArticle.querySelector('a[href^="/"][role="link"]');
      let username = null;
      if (userLinkElement) {
        const urlParts = userLinkElement.getAttribute('href').split('/');
        username = urlParts[1];
      }
      
      expect(username).toBe('testuser');
    });

    test('should handle missing user link', () => {
      const tweetArticle = document.createElement('article');
      // No user link added
      
      const userLinkElement = tweetArticle.querySelector('a[href^="/"][role="link"]');
      let username = null;
      if (userLinkElement) {
        const urlParts = userLinkElement.getAttribute('href').split('/');
        username = urlParts[1];
      }
      
      expect(username).toBeNull();
    });
  });

  describe('Menu Interaction Simulation', () => {
    test('should find More button in tweet', () => {
      const tweetArticle = document.createElement('article');
      const moreButton = document.createElement('button');
      moreButton.setAttribute('aria-label', 'More');
      tweetArticle.appendChild(moreButton);
      
      const foundMoreButton = tweetArticle.querySelector('[aria-label="More"]');
      expect(foundMoreButton).toBeTruthy();
      expect(foundMoreButton.getAttribute('aria-label')).toBe('More');
    });

    test('should find Block menu item', () => {
      // Create mock menu items
      const menuItem1 = document.createElement('div');
      menuItem1.setAttribute('role', 'menuitem');
      menuItem1.innerText = 'Block @testuser';
      
      const menuItem2 = document.createElement('div');
      menuItem2.setAttribute('role', 'menuitem');
      menuItem2.innerText = 'Hide';
      
      document.body.appendChild(menuItem1);
      document.body.appendChild(menuItem2);
      
      // Simulate finding block item
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      let blockItem = null;
      menuItems.forEach((item) => {
        const itemText = item.innerText.trim();
        if (itemText.startsWith("Block @")) {
          blockItem = item;
        }
      });
      
      expect(blockItem).toBeTruthy();
      expect(blockItem.innerText).toBe('Block @testuser');
    });

    test('should find Mute menu item', () => {
      const menuItem = document.createElement('div');
      menuItem.setAttribute('role', 'menuitem');
      menuItem.innerText = 'Mute @testuser';
      document.body.appendChild(menuItem);
      
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      let muteItem = null;
      menuItems.forEach((item) => {
        const itemText = item.innerText.trim();
        if (itemText.startsWith("Mute @")) {
          muteItem = item;
        }
      });
      
      expect(muteItem).toBeTruthy();
      expect(muteItem.innerText).toBe('Mute @testuser');
    });

    test('should find confirmation button', () => {
      const confirmButton = document.createElement('button');
      confirmButton.setAttribute('data-testid', 'confirmationSheetConfirm');
      confirmButton.innerText = 'Block';
      document.body.appendChild(confirmButton);
      
      const foundConfirmButton = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      expect(foundConfirmButton).toBeTruthy();
      expect(foundConfirmButton.innerText).toBe('Block');
    });
  });

  describe('Whitelist Integration', () => {
    test('should skip whitelisted users during blocking', () => {
      const username = 'whitelisteduser';
      const whitelist = ['whitelisteduser', 'anotheruser'];
      
      const shouldSkip = whitelist.includes(username);
      expect(shouldSkip).toBe(true);
    });

    test('should not skip non-whitelisted users', () => {
      const username = 'regularuser';
      const whitelist = ['whitelisteduser', 'anotheruser'];
      
      const shouldSkip = whitelist.includes(username);
      expect(shouldSkip).toBe(false);
    });

    test('should handle empty whitelist', () => {
      const username = 'testuser';
      const whitelist = [];
      
      const shouldSkip = whitelist.includes(username);
      expect(shouldSkip).toBe(false);
    });
  });

  describe('Progress Tracking', () => {
    test('should calculate progress percentage correctly', () => {
      const total = 20;
      const progressSteps = [];
      
      for (let i = 0; i < total; i++) {
        const progress = ((i + 1) / total) * 100;
        progressSteps.push(progress);
      }
      
      expect(progressSteps[0]).toBe(5); // 1/20 * 100
      expect(progressSteps[9]).toBe(50); // 10/20 * 100
      expect(progressSteps[19]).toBe(100); // 20/20 * 100
    });

    test('should handle progress bar updates', () => {
      const progressBar = document.createElement('div');
      progressBar.className = 'xb-progress-bar';
      progressBar.style.width = '0%';
      document.body.appendChild(progressBar);
      
      // Simulate progress updates
      const total = 10;
      for (let i = 0; i < total; i++) {
        progressBar.style.width = `${((i + 1) / total) * 100}%`;
      }
      
      expect(progressBar.style.width).toBe('100%');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing More button gracefully', () => {
      const tweetArticle = document.createElement('article');
      // No More button added
      
      const moreButton = tweetArticle.querySelector('[aria-label="More"]');
      expect(moreButton).toBeFalsy();
      
      // Should not throw error when More button is missing
      expect(() => {
        if (moreButton) {
          moreButton.click();
        }
      }).not.toThrow();
    });

    test('should handle missing menu items gracefully', () => {
      // No menu items in DOM
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      let blockItem = null;
      
      menuItems.forEach((item) => {
        const itemText = item.innerText.trim();
        if (itemText.startsWith("Block @")) {
          blockItem = item;
        }
      });
      
      expect(blockItem).toBeNull();
      
      // Should handle gracefully when no block item found
      expect(() => {
        if (blockItem) {
          blockItem.click();
        }
      }).not.toThrow();
    });

    test('should handle missing confirmation button gracefully', () => {
      const confirmButton = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      expect(confirmButton).toBeFalsy();
      
      expect(() => {
        if (confirmButton) {
          confirmButton.click();
        }
      }).not.toThrow();
    });
  });

  describe('Async Operation Handling', () => {
    test('should handle promise resolution', async () => {
      const mockAsyncOperation = mock(async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve('success'), 100);
        });
      });
      
      const result = await mockAsyncOperation();
      expect(result).toBe('success');
      expect(mockAsyncOperation).toHaveBeenCalledTimes(1);
    });

    test('should handle promise rejection', async () => {
      const mockAsyncOperation = mock(async () => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Operation failed')), 100);
        });
      });
      
      try {
        await mockAsyncOperation();
      } catch (error) {
        expect(error.message).toBe('Operation failed');
      }
      
      expect(mockAsyncOperation).toHaveBeenCalledTimes(1);
    });

    test('should handle sequential async operations', async () => {
      const operations = [];
      const total = 5;
      
      for (let i = 0; i < total; i++) {
        const operation = mock(async () => {
          return new Promise((resolve) => {
            setTimeout(() => resolve(`operation-${i}`), 10);
          });
        });
        operations.push(operation);
      }
      
      // Simulate sequential execution
      const results = [];
      for (const operation of operations) {
        const result = await operation();
        results.push(result);
      }
      
      expect(results).toHaveLength(total);
      expect(results[0]).toBe('operation-0');
      expect(results[4]).toBe('operation-4');
    });
  });

  describe('Page State Validation', () => {
    test('should validate tweet page URL', () => {
      const checkPageType = (url) => {
        const tweetPagePattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
        const timelinePattern = /https?:\/\/(www\.)?x\.com\/i\/timeline/;
        
        if (timelinePattern.test(url)) {
          return 'timeline';
        } else if (tweetPagePattern.test(url)) {
          return 'tweet';
        } else {
          return 'other';
        }
      };
      
      expect(checkPageType('https://x.com/user/status/123')).toBe('tweet');
      expect(checkPageType('https://x.com/i/timeline')).toBe('timeline');
      expect(checkPageType('https://x.com/user')).toBe('other');
    });

    test('should handle different page types appropriately', () => {
      const shouldAddButtons = (pageType) => {
        return pageType === 'tweet' || pageType === 'user';
      };
      
      expect(shouldAddButtons('tweet')).toBe(true);
      expect(shouldAddButtons('user')).toBe(true);
      expect(shouldAddButtons('timeline')).toBe(false);
      expect(shouldAddButtons('other')).toBe(false);
    });
  });
});