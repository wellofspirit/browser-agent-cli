# browser

A CLI tool that gives AI agents (Claude, etc.) persistent, interactive control over a web browser — enabling them to browse the internet, interact with web pages, and complete tasks that require real browser interaction.

## Why this exists

### The problem

AI coding agents have several ways to interact with the web, but none work well for real browsing:

1. **WebFetch / URL fetching** can retrieve page content, but many modern sites are React/Vue SPAs — the raw HTML is an empty shell. It can't see what actually renders, and it can't interact with anything.

2. **One-shot Playwright scripts** can launch a browser, do something, and close it. But they treat browser interaction as a single atomic operation. Real browsing is iterative — you look at the page, decide what to do, click something, look again, adjust. The "launch → script → close" pattern can't support this agent loop.

3. **Playwright MCP** (`@playwright/mcp`) is excellent, but some environments restrict MCP servers to an approved list. A CLI tool works everywhere — no MCP infrastructure needed, just a regular Bash tool call.

### What we actually need

A **persistent, agent-controlled browser** that an AI agent can interact with step by step, the same way a person would:

1. Take a snapshot of the page (accessibility tree or screenshot)
2. Reason about what to do next
3. Perform an action (click, type, navigate)
4. Observe the result
5. Repeat

This tool bridges that gap. It keeps a browser running and exposes a set of CLI commands to observe and interact with it iteratively.

## Architecture

```
┌─────────────────────────────────────────────┐
│  AI Agent (Claude Code, etc.)               │
│                                             │
│  calls: browser snapshot                    │
│         browser click e6                    │
│         browser screenshot                  │
│         browser type e7 "hello"             │
└──────────────┬──────────────────────────────┘
               │  thin CLI client (fast, no startup cost)
               │
┌──────────────▼──────────────────────────────┐
│  browser-server (long-running Node process) │
│                                             │
│  - Holds persistent Playwright connection   │
│  - Connects to browser via CDP              │
│  - Manages page state, tabs, sessions       │
└──────────────┬──────────────────────────────┘
               │  Chrome DevTools Protocol
               │
┌──────────────▼──────────────────────────────┐
│  Chromium / Chrome / Edge                   │
│  (running with --remote-debugging-port)     │
└─────────────────────────────────────────────┘
```

### Why a client-server split?

This tool gets called in rapid succession during an agent loop (snapshot → click → snapshot → type → ...). If every invocation had to start a Node process, import Playwright, and connect to the browser, each call would take seconds. Instead:

- **browser-server** starts once, stays running, holds the Playwright connection warm.
- **browser** (the CLI) is a thin client that sends a command to the server and prints the response. Each call completes in milliseconds.

## Quick start

### Prerequisites

- Node.js 22+
- A Chromium-based browser (Chrome, Edge, Chromium)

### Install

```bash
git clone https://github.com/anthropics/browser-agent-cli.git
cd browser-agent-cli
npm install
npm run build
```

### Start the browser with CDP

```bash
# Chrome
google-chrome --remote-debugging-port=9222 --remote-allow-origins=*

# Edge (Windows)
msedge.exe --remote-debugging-port=9222 --remote-allow-origins=*

# Chromium
chromium --remote-debugging-port=9222 --remote-allow-origins=*
```

### Start the server

```bash
npm run server
# or: node dist/server.js
```

### Use the CLI

```bash
node dist/cli.js navigate "https://example.com"
node dist/cli.js snapshot
node dist/cli.js click e6
node dist/cli.js screenshot
```

## How the agent sees the page

This is the critical design question for a browser agent tool. There are three approaches, and this tool supports all of them:

### 1. Screenshot (cheapest for orientation)

A viewport screenshot costs ~1,100 tokens regardless of page complexity (Claude's vision pricing is per image tile, not per pixel or content). This makes it the most token-efficient way to understand what's on the page — especially for content-heavy sites where the accessibility tree can explode.

For pages with poor accessibility markup (`<div>` soup, no ARIA labels), screenshots may be the only useful view. Interaction uses **coordinate-based clicking** (x, y positions) when ref-based clicking isn't available.

### 2. Accessibility tree (best for interaction)

The browser's accessibility tree (`snapshot`) provides a structured, text-based representation of the page. Each element gets a **ref number** (e.g. `ref=e2`) that can be used for precise interaction. The tree includes readable text content, not just ARIA labels — paragraphs, headings, link text, table data all appear inline.

```
- heading "Example Domain" [level=1] [ref=e3]
- paragraph [ref=e4]: This domain is for use in documentation examples.
- paragraph [ref=e5]:
  - link "Learn more" [ref=e6] [cursor=pointer]:
    - /url: https://iana.org/domains/example
```

The agent reads this, picks ref `e4` to read content, ref `e6` to click. Structured and precise — but **expensive on content-heavy pages**. A Wikipedia article produces ~15,000 tokens (975 lines) for the full tree vs ~1,100 tokens for a screenshot.

Use `--depth N` to limit the tree depth and keep costs down. Depth 2-4 is usually enough to find interactive elements without dumping the full page text.

### 3. JavaScript evaluation (escape hatch)

For cases where neither approach works well, `evaluate` lets the agent run arbitrary JS on the page — extract specific data, query the DOM directly, or manipulate page state. Particularly useful for extracting text content without the overhead of the full accessibility tree (e.g. `document.querySelector('article').innerText`).

### Token cost comparison

Measured on a Wikipedia article page:

| Method | Tokens | Best for |
|--------|--------|----------|
| Screenshot (JPEG) | ~1,100 | Orientation, visual layout, content-heavy pages |
| Snapshot `--depth 2` | ~500 | Quick structural overview |
| Snapshot `--depth 4` | ~2,000 | Finding interactive elements |
| Full snapshot | ~15,000 | Complete page structure (use sparingly) |
| `evaluate` (targeted) | ~50-500 | Extracting specific text or data |

### Recommended browsing strategy

1. Start with `screenshot` for orientation — cheap, always works, gives visual context
2. Use `snapshot --depth 3-4` to find interactive elements (buttons, links, inputs) and get their ref numbers
3. Interact using refs from the snapshot (`click e6`, `type e7 "query"`)
4. Use `evaluate` for targeted text extraction when you need specific content without dumping the full tree
5. Fall back to full `snapshot` (no depth limit) only when you need the complete page text and structure

## CLI commands

Modeled after [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) tools, adapted for CLI usage.

### Navigation

| Command | Description |
|---------|-------------|
| `navigate <url>` | Navigate to a URL |
| `back` | Go back in history |
| `forward` | Go forward in history |
| `reload` | Reload the page |

### Observation

| Command | Description |
|---------|-------------|
| `snapshot [--depth N]` | Capture accessibility tree. Use `--depth` to limit depth |
| `screenshot [--full-page] [--ref N]` | Take a screenshot, optionally of a specific element |
| `evaluate <js>` | Run JavaScript on the page and return the result |

### Interaction (ref-based)

Refs come from the most recent `snapshot` and are only valid until the page changes.

| Command | Description |
|---------|-------------|
| `click <ref> [--double]` | Click an element by ref |
| `type <ref> <text> [--submit]` | Type text into an element. `--submit` presses Enter |
| `fill <json>` | Fill multiple form fields: `[{"ref":"e1","value":"text"},...]` |
| `select <ref> <value>` | Select a dropdown option |
| `hover <ref>` | Hover over an element |
| `drag <from-ref> <to-ref>` | Drag and drop between elements |
| `press <key>` | Press a keyboard key (Enter, Escape, Tab, etc.) |

### Interaction (coordinate-based)

Use when the accessibility tree is unhelpful. Get coordinates from a screenshot.

| Command | Description |
|---------|-------------|
| `click-xy <x> <y>` | Click at coordinates |
| `mouse-move <x> <y>` | Move mouse to position |
| `scroll [--dx N] [--dy N]` | Scroll the page |

### Tabs

| Command | Description |
|---------|-------------|
| `tabs` | List open tabs |
| `tab <index>` | Switch to a tab |
| `tab-new [url]` | Open a new tab |
| `tab-close [index]` | Close a tab |

### Wait

| Command | Description |
|---------|-------------|
| `wait <text>` | Wait for text to appear |
| `wait --gone <text>` | Wait for text to disappear |
| `wait --time <ms>` | Wait for a duration |

### Storage (login persistence)

| Command | Description |
|---------|-------------|
| `storage-save <file>` | Save cookies + localStorage to a file |
| `storage-load <file>` | Restore saved storage state |
| `cookie-list [--domain d]` | List cookies |
| `cookie-set <name> <value>` | Set a cookie |
| `cookie-clear` | Clear all cookies |
| `localstorage-get <key>` | Get a localStorage value |
| `localstorage-set <key> <value>` | Set a localStorage value |
| `localstorage-list` | List all localStorage items |

### Other

| Command | Description |
|---------|-------------|
| `status` | Current page info |
| `resize <width> <height>` | Resize the viewport |
| `upload <ref> <paths...>` | Upload files to a file input |

## Claude Code skill

A ready-to-use [Claude Code skill](https://code.claude.com/docs/en/skills) is included in the `skill/` directory. Copy it to your project or personal skills folder:

```bash
# Personal skill (available in all projects)
cp -r skill/browser ~/.claude/skills/browser

# Project skill (available in this project only)
cp -r skill/browser .claude/skills/browser
```

The skill teaches Claude the browsing strategy, all commands, and token-efficient patterns. See `skill/browser/SKILL.md` for details.

## Configuration

The server can be configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_URL` | `http://localhost:9222` | Chrome DevTools Protocol URL |
| `PORT` | `9421` | Server port |

## Technology choices

### TypeScript + Playwright

- **Playwright is JS/TS-native** — Microsoft built it in TypeScript. The Python bindings are a wrapper that shells out to the Node.js driver underneath. Going direct avoids that extra layer.
- **Persistent server suits Node well** — Node excels at long-running async processes with many I/O operations, which is exactly what this server does.

### Why not a compiled language (Go, Rust)?

The performance bottleneck is never the CLI tool itself — it's browser operations (page loads, rendering, network), screenshot encoding, and the agent's thinking time. The CLI client just sends a message to the server and prints the response. Saving 30ms of startup time is invisible next to a 2-second page load. The real performance wins come from the architectural choice to keep the server persistent.

## License

MIT
