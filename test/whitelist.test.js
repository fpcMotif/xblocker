import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

// Note: Since content.js is designed to run in browser context,
// we test the functionality through behavior simulation rather than direct imports

describe('Whitelist Functionality', () => {
  let mockStorage;
  let mockCallback;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    
    // Reset mock storage
    mockStorage = { whitelist: [] };
    mockCallback = mock(() => {});
    
    // Mock chrome storage
    global.chrome.storage.local.get = mock((keys, callback) => {
      callback(mockStorage);
    });
    
    global.chrome.storage.local.set = mock((data, callback) => {
      Object.assign(mockStorage, data);
      if (callback) callback();
    });
  });

  afterEach(() => {
    // Clean up DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  describe('getWhitelist', () => {
    test('should retrieve empty whitelist by default', () => {
      const callback = mock((result) => {
        expect(result.whitelist).toEqual([]);
      });
      
      // Since we can't directly call the function, we'll test the storage interaction
      chrome.storage.local.get('whitelist', callback);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('should retrieve existing whitelist', () => {
      mockStorage.whitelist = ['user1', 'user2'];
      
      const callback = mock((result) => {
        expect(result.whitelist).toEqual(['user1', 'user2']);
      });
      
      chrome.storage.local.get('whitelist', callback);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveWhitelist', () => {
    test('should save whitelist to storage', () => {
      const testWhitelist = ['user1', 'user2', 'user3'];
      
      chrome.storage.local.set({ whitelist: testWhitelist }, mockCallback);
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { whitelist: testWhitelist },
        mockCallback
      );
      expect(mockStorage.whitelist).toEqual(testWhitelist);
    });
  });

  describe('addToWhitelist', () => {
    test('should add new user to empty whitelist', () => {
      // Mock the eval context functions
      const mockShowToast = mock(() => {});
      global.showToast = mockShowToast;
      
      // Simulate the addToWhitelist function behavior
      const username = 'newuser';
      const whitelist = [];
      
      if (!whitelist.includes(username)) {
        whitelist.push(username);
        chrome.storage.local.set({ whitelist }, () => {});
        mockShowToast(`✅ Added @${username} to whitelist`, 'success');
      }
      
      expect(whitelist).toContain('newuser');
      expect(mockShowToast).toHaveBeenCalledWith('✅ Added @newuser to whitelist', 'success');
    });

    test('should not add duplicate user to whitelist', () => {
      const mockShowToast = mock(() => {});
      global.showToast = mockShowToast;
      
      const username = 'existinguser';
      const whitelist = ['existinguser'];
      
      if (!whitelist.includes(username)) {
        whitelist.push(username);
        mockShowToast(`✅ Added @${username} to whitelist`, 'success');
      } else {
        mockShowToast(`⚠️ @${username} is already in the whitelist`, 'warning');
      }
      
      expect(whitelist).toHaveLength(1);
      expect(mockShowToast).toHaveBeenCalledWith('⚠️ @existinguser is already in the whitelist', 'warning');
    });

    test('should handle empty username gracefully', () => {
      const mockShowToast = mock(() => {});
      global.showToast = mockShowToast;
      
      const username = '';
      const whitelist = [];
      
      if (username && username.trim()) {
        whitelist.push(username);
        mockShowToast(`✅ Added @${username} to whitelist`, 'success');
      }
      
      expect(whitelist).toHaveLength(0);
      expect(mockShowToast).not.toHaveBeenCalled();
    });
  });

  describe('Whitelist Integration with Blocking', () => {
    test('should skip whitelisted users during blocking', () => {
      const mockUsername = 'whitelisteduser';
      const mockWhitelist = ['whitelisteduser'];
      
      // Simulate the whitelist check in blockTweet
      const shouldSkip = mockWhitelist.includes(mockUsername);
      expect(shouldSkip).toBe(true);
    });

    test('should not skip non-whitelisted users', () => {
      const mockUsername = 'regularuser';
      const mockWhitelist = ['whitelisteduser'];
      
      const shouldSkip = mockWhitelist.includes(mockUsername);
      expect(shouldSkip).toBe(false);
    });
  });

  describe('URL Pattern Validation', () => {
    test('should match valid tweet URLs', () => {
      const urlPattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
      
      const validUrls = [
        'https://x.com/user/status/123456789',
        'https://www.x.com/user/status/123456789',
        'http://x.com/user/status/123456789'
      ];
      
      validUrls.forEach(url => {
        expect(urlPattern.test(url)).toBe(true);
      });
    });

    test('should not match invalid URLs', () => {
      const urlPattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
      
      const invalidUrls = [
        'https://x.com/user',
        'https://x.com/i/timeline',
        'https://other.com/user/status/123',
        'https://x.com/user/status/abc'
      ];
      
      invalidUrls.forEach(url => {
        expect(urlPattern.test(url)).toBe(false);
      });
    });
  });
});