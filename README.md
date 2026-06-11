# XBlocker - Advanced X.com Content Filtering Extension

A modern Chrome extension for efficiently managing content on X.com (formerly Twitter) with advanced blocking, muting, and whitelist functionality.

## Features

- 🚫 **Smart Blocking**: Block multiple comment users with one click
- 🔇 **Intelligent Muting**: Mute unwanted comments efficiently
- ✅ **Whitelist Management**: Protect trusted users from being blocked/muted
- 🎛️ **Reply Action Bar**: Clear in-page actions without burying core controls in a menu
- ⚙️ **Popup Settings**: Manage whitelist and behavior preferences from the Chrome popup
- 📊 **Progress Tracking**: Real-time progress bars during operations
- 🔔 **Toast Notifications**: Elegant feedback system
- ⚡ **Fast Performance**: Optimized for large comment threads

## Installation

1. Clone this repository
2. Install dependencies: `bun install`
3. Build the extension: `bun run build`
4. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select `.output/chrome-mv3`

## Development

### Prerequisites

- [Bun](https://bun.sh)
- Chrome/Chromium browser

### Setup

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage

# Type-check with TypeScript native preview / tsgo
bun run typecheck

# Lint code
bun run lint

# Auto-fix linting issues
bun run lint:fix

# Format code
bun run format

# Build the Chrome MV3 extension
bun run build

# Run every project gate
bun run check
```

### Testing

We use Bun's built-in test runner with Happy DOM for fast, lightweight DOM testing:

```bash
# Run all tests
bun test

# Run specific test file
bun test test/whitelist.test.js

# Run tests with verbose output
bun test --verbose

# Run tests with coverage report
bun test --coverage
```

#### Test Structure

- `test/setup.js` - Test environment configuration and mocks
- `test/reply-action-bar.test.js` - In-page Reply Action Bar behavior tests
- `test/popup.test.js` - Extension popup behavior tests
- `test/whitelist.test.js` - Whitelist functionality tests
- `test/ui.test.js` - UI components and interactions tests
- `test/blocking.test.js` - Blocking and muting logic tests
- `test/integration.test.js` - End-to-end workflow tests

#### Mocking

The test environment includes mocks for:

- Chrome Extension APIs (`chrome.storage.local`)
- DOM environment (Happy DOM)
- Console methods (to reduce test noise)
- Timing functions (`setTimeout`, `clearTimeout`)

## Usage

1. Navigate to any X.com tweet page
2. The Reply Action Bar appears in the bottom-right corner
3. Use the visible actions directly:
   - **Block replies**: Block reply authors directly through X's session-authenticated API
   - **Mute replies**: Mute reply authors through X's menu flow
   - **Whitelist**: Add trusted users to the protection list
4. Open the Chrome extension popup to manage whitelist entries and behavior settings

### Whitelist Management

- Use the extension popup to add or remove usernames
- Use the in-page "Whitelist" action for quick additions while browsing
- Users on whitelist are protected from blocking/muting
- Whitelist data persists across browser sessions

## Architecture

### Core Components

- `entrypoints/content.ts` - WXT TypeScript content script with all extension behavior
- `entrypoints/popup/` - Chrome extension popup for settings and whitelist management
- `wxt.config.ts` - Manifest V3 metadata, permissions, and host permissions
- `bts.jsonc` - Better-T-Stack stack record for the WXT vanilla TypeScript addon
- `.oxlintrc.json` / `.oxfmtrc.json` - OXC lint and format configuration
- `test/` - Comprehensive test suite

### Key Functions

- `addButtons()` - Creates the in-page Reply Action Bar
- `blockFirst20CommentTweets()` - Handles comment blocking workflow
- `muteFirst50CommentTweets()` - Handles comment muting workflow
- `addToWhitelist()` - Manages whitelist operations
- `showToast()` - Displays user notifications
- `showWhitelistModal()` - Handles whitelist input modal

### Storage

Uses Chrome's `chrome.storage.local` API to persist:

- User whitelist data
- Extension preferences

## Browser Compatibility

- Chrome 88+
- Chromium-based browsers
- Manifest V3 compatible

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass: `bun test`
5. Submit a pull request

### Code Style

- Use modern TypeScript with strict `tsgo --noEmit` checks
- Use Bun for package management and script execution
- Use OXC tooling: `oxlint` for linting and `oxfmt` for formatting
- Follow existing naming conventions
- Maintain test coverage above 80%

## Performance

- Minimal memory footprint
- Non-blocking async operations
- Efficient DOM querying
- Optimized for large comment threads
- Smart cleanup and resource management

## Security

- Minimal permissions required for the X.com content script and direct X block API request
- Local data storage only
- Content script isolation
- No sensitive data collection

## License

MIT License - see LICENSE file for details

## Support

- Report issues on GitHub
- Check existing issues before creating new ones
- Include browser version and extension version in bug reports
