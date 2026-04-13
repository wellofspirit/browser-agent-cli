#!/usr/bin/env node

import http from "node:http";
import { DEFAULT_PORT, type CommandRequest, type CommandResponse } from "./types.js";

const USAGE = `Usage: browser <command> [args...]

Navigation:
  navigate <url>            Navigate to a URL
  back                      Go back in history
  forward                   Go forward in history
  reload                    Reload the page

Observation:
  snapshot [--depth N]      Capture accessibility tree
  screenshot [--full-page]  Take a screenshot
    [--ref N]               Screenshot a specific element

Interaction (ref-based — refs come from the most recent snapshot):
  click <ref>               Click an element
  click-xy <x> <y>         Click at coordinates
  type <ref> <text>         Type into an element (--submit to press Enter)
  fill <json>              Fill multiple fields: [{"ref":"1","value":"text"},...]
  select <ref> <value>     Select a dropdown option
  hover <ref>              Hover over an element
  drag <from-ref> <to-ref> Drag and drop
  press <key>              Press a key (Enter, Escape, Tab, etc.)
  scroll [--dx N] [--dy N] Scroll the page

Wait:
  wait <text>              Wait for text to appear
  wait --gone <text>       Wait for text to disappear
  wait --time <ms>         Wait for a duration

JavaScript:
  evaluate <expression>    Run JS on the page

Tabs:
  tabs                     List open tabs
  tab <index>              Switch to a tab
  tab-new [url]            Open a new tab
  tab-close [index]        Close a tab

Viewport:
  resize <width> <height>  Resize the viewport

Files:
  upload <ref> <path...>   Upload files to a file input

Storage:
  storage-save <file>      Save cookies + localStorage
  storage-load <file>      Restore saved storage state
  cookie-list [--domain d] List cookies
  cookie-set <name> <val>  Set a cookie
  cookie-clear             Clear all cookies
  localstorage-get <key>   Get a localStorage value
  localstorage-set <k> <v> Set a localStorage value
  localstorage-list        List all localStorage items

Server:
  server start             Start the browser server
  server stop              Stop the server
  server status            Check server status
  status                   Current page info
`;

function parseArgs(argv: string[]): CommandRequest {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  // Server lifecycle commands
  if (command === "server") {
    const sub = rest[0];
    if (sub === "status") return { command: "status", args: {} };
    if (sub === "start" || sub === "stop") {
      // These are handled outside the server (by the wrapper script)
      console.error(`Use 'npm run server' to start, or Ctrl+C / kill to stop.`);
      process.exit(1);
    }
    console.error(`Unknown server command: ${sub}`);
    process.exit(1);
  }

  const args: Record<string, unknown> = {};

  switch (command) {
    case "navigate":
      args.url = rest[0];
      break;
    case "back":
    case "forward":
    case "reload":
    case "tabs":
    case "cookie-clear":
    case "localstorage-list":
    case "status":
      break;
    case "snapshot": {
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--depth") args.depth = Number(rest[++i]);
        if (rest[i] === "--ref") args.ref = rest[++i];
      }
      break;
    }
    case "screenshot": {
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--full-page") args.fullPage = true;
        if (rest[i] === "--ref") args.ref = rest[++i];
      }
      break;
    }
    case "click":
      args.ref = rest[0];
      if (rest.includes("--double")) args.doubleClick = true;
      break;
    case "click-xy":
      args.x = Number(rest[0]);
      args.y = Number(rest[1]);
      break;
    case "type":
      args.ref = rest[0];
      args.text = rest[1];
      if (rest.includes("--submit")) args.submit = true;
      break;
    case "fill":
      args.fields = JSON.parse(rest[0]);
      break;
    case "select":
      args.ref = rest[0];
      args.value = rest[1];
      break;
    case "hover":
      args.ref = rest[0];
      break;
    case "drag":
      args.fromRef = rest[0];
      args.toRef = rest[1];
      break;
    case "press":
      args.key = rest[0];
      break;
    case "scroll": {
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--dx") args.deltaX = Number(rest[++i]);
        if (rest[i] === "--dy") args.deltaY = Number(rest[++i]);
      }
      break;
    }
    case "wait": {
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--gone") {
          args.text = rest[++i];
          args.gone = true;
        } else if (rest[i] === "--time") {
          args.time = Number(rest[++i]);
        } else if (!rest[i].startsWith("--")) {
          args.text = rest[i];
        }
      }
      break;
    }
    case "evaluate":
      args.expression = rest.join(" ");
      break;
    case "tab":
      args.index = Number(rest[0]);
      break;
    case "tab-new":
      if (rest[0]) args.url = rest[0];
      break;
    case "tab-close":
      if (rest[0]) args.index = Number(rest[0]);
      break;
    case "resize":
      args.width = Number(rest[0]);
      args.height = Number(rest[1]);
      break;
    case "upload":
      args.ref = rest[0];
      args.paths = rest.slice(1);
      break;
    case "storage-save":
      args.file = rest[0];
      break;
    case "storage-load":
      args.file = rest[0];
      break;
    case "cookie-list":
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--domain") args.domain = rest[++i];
      }
      break;
    case "cookie-set":
      args.name = rest[0];
      args.value = rest[1];
      break;
    case "localstorage-get":
      args.key = rest[0];
      break;
    case "localstorage-set":
      args.key = rest[0];
      args.value = rest[1];
      break;
    case "mouse-move":
      args.x = Number(rest[0]);
      args.y = Number(rest[1]);
      break;
    default:
      console.error(`Unknown command: ${command}\nRun 'browser --help' for usage.`);
      process.exit(1);
  }

  return { command, args };
}

async function sendCommand(req: CommandRequest): Promise<CommandResponse> {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const body = JSON.stringify(req);

  return new Promise((resolve, reject) => {
    const httpReq = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/command",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response: ${data}`));
          }
        });
      }
    );

    httpReq.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new Error(
          "Browser server is not running. Start it with: node dist/server.js"
        ));
      } else {
        reject(err);
      }
    });

    httpReq.write(body);
    httpReq.end();
  });
}

function formatOutput(response: CommandResponse): string {
  if (!response.ok) {
    return `Error: ${response.error}`;
  }

  const result = response.result as Record<string, unknown>;

  // Special formatting for snapshots — print the tree directly
  if (result.tree !== undefined) {
    let output = `Page: ${result.title} (${result.url})\n\n`;
    output += result.tree;
    return output;
  }

  // Special formatting for screenshots — show the file path so Claude can read it
  if (result.file !== undefined && result.size !== undefined) {
    return `Screenshot saved to ${result.file} (${result.size} bytes)`;
  }

  // Special formatting for tab list (from "tabs" command — returns {tabs: Array})
  if (Array.isArray(result.tabs)) {
    const tabs = result.tabs as Array<{ index: number; url: string; title: string; active: boolean }>;
    return tabs
      .map((t) => `${t.active ? "→" : " "} [${t.index}] ${t.title} — ${t.url}`)
      .join("\n");
  }

  // Default: compact JSON
  return JSON.stringify(result, null, 2);
}

async function main(): Promise<void> {
  const req = parseArgs(process.argv.slice(2));
  const response = await sendCommand(req);
  const output = formatOutput(response);
  if (response.ok) {
    console.log(output);
  } else {
    console.error(output);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
