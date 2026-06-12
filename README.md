# XBlocker - Advanced X.com Content Filtering Extension

A modern Chrome extension for efficiently managing content on X.com (formerly Twitter) with advanced blocking, muting, and whitelist functionality.

## Features

- 🚫 **Smart Blocking**: Block multiple comment users with one click
- 🔇 **Intelligent Muting**: Mute unwanted comments efficiently
- ✅ **Whitelist Management**: Protect trusted users from being blocked/muted
- 🗂️ **Blocked-account store**: Remembers who you've blocked by stable numeric id, so it
  skips re-blocking and shows a real blocked count
- ☁️ **Cloud backup (optional)**: Mirror your blocked list to [Convex](https://convex.dev)
  so it follows you across machines — opt-in, off by default
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

The test suite is TypeScript, run by Bun (`bun test`).

- `test/setup.ts` - Test environment configuration and an in-memory `chrome.storage` mock
- `test/blocked-store.test.ts` - Blocked-account store and dedupe/rollup logic
- `test/reply-action-bar.test.ts` - In-page Reply Action Bar behavior tests
- `test/popup.test.ts` - Extension popup behavior tests
- `test/whitelist.test.ts` - Whitelist functionality tests
- `test/ui.test.ts` - UI components and interactions tests
- `test/blocking.test.ts` - Blocking and muting logic tests
- `test/integration.test.ts` - End-to-end workflow tests

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
- `entrypoints/popup/` - Chrome extension popup for settings, whitelist, and cloud backup
- `entrypoints/lib/blocked-merge.ts` - pure, dependency-free dedupe/rollup logic
- `entrypoints/lib/blocked-store.ts` - blocked-account store over `chrome.storage.local`
- `entrypoints/lib/convex-sync.ts` - optional Convex cloud backup adapter (popup only)
- `convex/` - optional Convex backend (schema + functions) for cloud backup
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
- Blocked / muted accounts (`blockedAccounts`), keyed on the **stable numeric X user id**
  captured from the block response — screen names are kept only for display since they
  are mutable and recyclable. One record per account; repeat blocks/mutes (even from
  different accounts) are appended as history, never duplicated.
- A cloud sync outbox (`blockedOutbox`) of actions waiting to be backed up

The blocked store lives behind a small module interface (`entrypoints/lib/blocked-store.ts`)
over a pure, separately tested merge/dedupe core (`entrypoints/lib/blocked-merge.ts`).

### Cloud backup (optional)

XBlocker can mirror your blocked list to [Convex](https://convex.dev) so it survives
across machines and browser profiles. It is **opt-in** (off by default); the local store
is always the source of truth and the extension works fully offline without it.

- Identity is your Google account (OIDC), so the backup is scoped to you across devices.
- The same dedup invariant holds in the cloud: one row per `(owner, xUserId)`, many
  action events.
- All Convex traffic and the OAuth flow run from the popup, never from the x.com content
  script (`entrypoints/lib/convex-sync.ts` is loaded lazily and only when backup is used).

To enable it, follow [`convex/README.md`](convex/README.md): create a Convex deployment and
a Google OAuth client, set `VITE_CONVEX_URL` + `VITE_GOOGLE_OAUTH_CLIENT_ID` (see
`.env.example`), rebuild, then open the popup → **Cloud backup** → **Sign in**.

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
