# XBlocker - Advanced X.com Content Filtering Extension

A modern Chrome extension for efficiently managing content on X.com (formerly Twitter) with advanced blocking, muting, and whitelist functionality.

## Features

- 🚫 **Smart Blocking**: Block multiple comment users with one click
- 🔇 **Intelligent Muting**: Mute unwanted comments efficiently  
- ✅ **Whitelist Management**: Protect trusted users from being blocked/muted
- 🎨 **Modern UI**: Beautiful glassmorphism design with smooth animations
- 📊 **Progress Tracking**: Real-time progress bars during operations
- 🔔 **Toast Notifications**: Elegant feedback system
- ⚡ **Fast Performance**: Optimized for large comment threads

## Installation

1. Clone this repository
2. Install dependencies: `bun install`
3. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project folder

## Development

### Prerequisites
- [Bun](https://bun.sh) (recommended) or Node.js
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

# Lint code
bun run lint

# Auto-fix linting issues
bun run lint:fix
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
2. The floating control panel appears in the bottom-right corner
3. Use the buttons to:
   - **Block Comments**: Block the first 20-50 comment authors
   - **Mute Comments**: Mute the first 50 comment authors  
   - **Whitelist User**: Add users to protection list

### Whitelist Management

- Click "Whitelist User" to open the modal
- Enter username (without @) 
- Users on whitelist are protected from blocking/muting
- Whitelist data persists across browser sessions

## Architecture

### Core Components

- `content.js` - Main content script with all functionality
- `manifest.json` - Extension configuration
- `test/` - Comprehensive test suite

### Key Functions

- `addButtons()` - Creates and styles the UI interface
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

- Use modern JavaScript (ES2020+)
- Follow existing naming conventions
- Add JSDoc comments for functions
- Maintain test coverage above 80%

## Performance

- Minimal memory footprint
- Non-blocking async operations
- Efficient DOM querying
- Optimized for large comment threads
- Smart cleanup and resource management

## Security

- No external API calls
- Minimal permissions required
- Local data storage only
- Content script isolation
- No sensitive data collection

## License

MIT License - see LICENSE file for details

## Support

- Report issues on GitHub
- Check existing issues before creating new ones
- Include browser version and extension version in bug reports

