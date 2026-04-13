import http from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { DEFAULT_PORT, DEFAULT_CDP_URL, type CommandRequest, type CommandResponse } from "./types.js";
import { handleCommand } from "./commands.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let activePage: Page | null = null;

export function getContext(): BrowserContext | null {
  return context;
}

export function getActivePage(): Page | null {
  // If the active page was closed, fall back to any live page
  if (activePage?.isClosed()) {
    const pages = context?.pages() ?? [];
    activePage = pages.length > 0 ? pages[pages.length - 1] : null;
  }
  return activePage;
}

export function setActivePage(page: Page): void {
  activePage = page;
}

async function connectBrowser(cdpUrl: string): Promise<void> {
  console.log(`Connecting to browser at ${cdpUrl}...`);
  browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    context = contexts[0];
  } else {
    context = await browser.newContext();
  }
  const pages = context.pages();
  activePage = pages.length > 0 ? pages[0] : await context.newPage();
  console.log(`Connected. Active page: ${activePage.url()}`);

  // Track new pages (e.g. popups, target=_blank)
  context.on("page", (page) => {
    console.log(`New page opened: ${page.url()}`);
    activePage = page;
  });
}

function startServer(port: number): void {
  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, page: activePage?.url() ?? null }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/command") {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let response: CommandResponse;
      try {
        const request: CommandRequest = JSON.parse(body);
        response = await handleCommand(request);
      } catch (err) {
        response = { ok: false, error: String(err) };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Browser server listening on http://127.0.0.1:${port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    server.close();
    if (browser) {
      // Disconnect without closing the browser itself
      await browser.close().catch(() => {});
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const cdpUrl = process.env.CDP_URL ?? DEFAULT_CDP_URL;
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

  await connectBrowser(cdpUrl);
  startServer(port);
}

main().catch((err) => {
  console.error("Failed to start browser server:", err);
  process.exit(1);
});
