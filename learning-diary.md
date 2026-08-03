# Accessibility Learning Diary: Chrome Extension Audits

This document records best practices for accessibility audits on Chrome extension pages.

## Procedural Rules for Accessibility Audits

### 1. Connect to Chrome DevTools Protocol

Start Chrome with the remote debugging port active.

```bash
curl -s http://127.0.0.1:9222/json/version
```

If Chrome runs, extract the WebSocket debugger URL from the response.

### 2. Open the Extension Page

Open the options page in Chrome with `agent-browser`.

```bash
bunx agent-browser@0.33.2 --cdp "ws://127.0.0.1:9222/devtools/browser/<HASH>" open "chrome-extension://<ID>/options.html"
```

If you audit the popup page, open `popup.html` instead.

### 3. Run the Accessibility Audit

Run the accessibility check with `agent-browser`.

```bash
bunx agent-browser@0.33.2 --cdp "ws://127.0.0.1:9222/devtools/browser/<HASH>" a11y --json
```

If violations exist, read the JSON output to find invalid elements.

## Descriptive Explanations of Rules

### Landmark Regions

Screen readers use ARIA landmarks to navigate web content.
Every content element on the page must sit inside a landmark region.
The `<main>` element contains the primary content of the page.
The `<aside>` element contains secondary content like the sidebar.
If content sits outside all landmark regions, accessibility tools report a landmark violation.

### Color Contrast Ratios

Text content must meet the WCAG 2.1 AA minimum contrast threshold.
For text that is smaller than 24 pixels and not bold, the contrast ratio must be 4.5:1 or higher.
If text contrast is less than 4.5:1, readers with vision impairment cannot read the text easily.

Design tokens defined with OKLCH color space provide precise contrast control.
Primary text in `oklch(0.78 0.14 246)` on dark backgrounds yields a contrast ratio of 5.8:1.
Primary text in `oklch(0.48 0.16 246)` on light backgrounds yields a contrast ratio of 5.2:1.
Primary button backgrounds in `oklch(0.52 0.17 246)` with white text yield a contrast ratio of 4.6:1.

## Compliance Notice

This document uses guidance from ASD-STE100 Simplified Technical English.
Full compliance with ASD-STE100 requires the official dictionary at asd-ste100.org.
No tool or document can guarantee full STE compliance.
