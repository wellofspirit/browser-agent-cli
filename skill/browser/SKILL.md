---
name: browser
description: Control a persistent browser to browse the web, interact with pages, fill forms, and extract information. Use when a task requires visiting a website, interacting with web UI elements, checking a dashboard, or when WebFetch cannot handle a page (SPAs, React apps, login-required sites).
user-invocable: false
allowed-tools: Bash(browser *) Read
---

# browser

A persistent browser control tool. Unlike WebFetch (which only sees raw HTML) or one-shot Playwright scripts, this tool keeps a browser running and lets you interact with it step by step — navigate, observe, click, type, and repeat.

## Prerequisites

The browser server must be running. If you get "Browser server is not running", tell the user to start it:

```bash
# Start a Chromium-based browser with CDP enabled, then:
browser-server
```

## Commands

### Navigation

```bash
browser navigate "https://example.com"   # Go to a URL
browser back                              # Go back in history
browser forward                           # Go forward
browser reload                            # Reload the page
```

### Observation

```bash
browser screenshot                        # Take a screenshot (~1,100 tokens)
browser screenshot --full-page            # Full page screenshot
browser snapshot                          # Accessibility tree (can be very large)
browser snapshot --depth 3                # Depth-limited tree (recommended)
browser evaluate "document.title"         # Run JS and return result
```

### Interaction (ref-based)

Refs like `e2`, `e6` come from the most recent `snapshot`. They are only valid until the page changes.

```bash
browser click e6                          # Click element by ref
browser click e6 --double                 # Double-click
browser type e7 "search query"            # Type into a field
browser type e7 "query" --submit          # Type and press Enter
browser select e10 "option-value"         # Select dropdown option
browser hover e5                          # Hover over element
browser press Enter                       # Press a keyboard key
browser drag e3 e8                        # Drag and drop
```

### Interaction (coordinate-based)

Use when the accessibility tree is unhelpful (bad markup, `<div>` soup). Get coordinates from a screenshot.

```bash
browser click-xy 450 320                  # Click at x,y
browser mouse-move 450 320                # Move mouse
browser scroll --dy 500                   # Scroll down
browser scroll --dy -500                  # Scroll up
```

### Tabs

```bash
browser tabs                              # List open tabs
browser tab 0                             # Switch to tab by index
browser tab-new "https://example.com"     # Open new tab
browser tab-close 1                       # Close tab by index
```

### Other

```bash
browser status                            # Current page info
browser resize 1280 720                   # Resize viewport
browser upload e12 /path/to/file.pdf      # Upload file
browser wait "Loading complete"           # Wait for text to appear
browser wait --time 2000                  # Wait 2 seconds
```

### Storage (login persistence)

```bash
browser storage-save github.json          # Save cookies + localStorage
browser storage-load github.json          # Restore saved session
browser cookie-list --domain github.com   # List cookies
browser cookie-clear                      # Clear all cookies
```

## Browsing strategy

Follow this approach to minimize token usage and maximize effectiveness:

### Step 1: Screenshot for orientation

Start with a screenshot. It costs ~1,100 tokens regardless of page complexity and gives you a visual understanding of the page layout.

```bash
browser navigate "https://example.com"
browser screenshot
```

Read the screenshot file path that's returned to view the image.

### Step 2: Shallow snapshot for interactive elements

Use a depth-limited snapshot to find buttons, links, and input fields with their ref numbers. Depth 3-4 is usually sufficient.

```bash
browser snapshot --depth 3
```

### Step 3: Interact using refs

Use refs from the snapshot to click, type, etc.

```bash
browser click e6
browser type e7 "my search query" --submit
```

### Step 4: Observe the result

After each interaction, take another screenshot or snapshot to see what changed.

### When to use what

| Method | Tokens | When to use |
|--------|--------|-------------|
| `screenshot` | ~1,100 | Orientation, visual layout, content-heavy pages |
| `snapshot --depth 2-4` | 500-2,000 | Finding interactive elements and their refs |
| `snapshot` (full) | 5,000-15,000+ | Only when you need the complete page text |
| `evaluate` | 50-500 | Targeted text/data extraction (e.g. `document.querySelector('article').innerText`) |

### Fallback to coordinates

If a page has poor accessibility markup (many unlabeled `<div>` elements, no ARIA roles), the snapshot won't be useful for finding elements. In that case:

1. Take a `screenshot`
2. Look at the image to identify element positions
3. Use `click-xy <x> <y>` to interact by coordinates

## Important notes

- Refs are **ephemeral** — they're only valid for the most recent snapshot. After navigation or significant DOM changes, take a new snapshot.
- The browser is **persistent** — it stays open between commands. You don't need to re-navigate.
- Screenshots are saved to temp files — use the Read tool to view them.
- If a page requires login, use `storage-save`/`storage-load` to persist the session for future use.
