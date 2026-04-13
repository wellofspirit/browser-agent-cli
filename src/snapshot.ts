import type { Page } from "playwright";

/**
 * Capture the accessibility tree of the current page using Playwright's
 * ariaSnapshot API in "ai" mode. This produces a YAML tree with ref
 * attributes like [ref=e2] that can be used for subsequent interaction
 * via page.locator('aria-ref=e2').
 */
export async function captureSnapshot(
  page: Page,
  opts: { depth?: number } = {}
): Promise<string> {
  const snapshotOpts: { mode: "ai"; depth?: number } = { mode: "ai" };
  if (opts.depth !== undefined) snapshotOpts.depth = opts.depth;

  const snapshot = await page.ariaSnapshot(snapshotOpts);
  return snapshot;
}
