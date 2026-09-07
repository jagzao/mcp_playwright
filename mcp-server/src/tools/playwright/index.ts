import { Browser, Page, BrowserContext } from "playwright";
import { logger } from "../../../../lib/observability/logger.js";
import { sanitizer } from "../../../../lib/security/input-sanitizer.js";
import { retry } from "../../../../lib/resilience/retry.js";
import { launchWithFallback } from "../../../../lib/browser-gateway/infrastructure/engines/playwright/launch-with-fallback.js";
import { NetworkPolicy } from "../../../../lib/browser-gateway/application/network-policy.js";
import { attachRequestGuard } from "../../../../lib/browser-gateway/infrastructure/engines/playwright/request-guard.js";
import { createGateway } from "../../../../lib/browser-gateway/infrastructure/gateway-factory.js";
import { setCurrentPage as setVisionPage } from "../vision/index.js";
import { setCurrentPage as setSessionPage } from "../session/index.js";

let browser: Browser | null = null;

/**
 * Per-session browser contexts (AC18 / BLOCKER-1).
 *
 * Each sessionId gets its own isolated context + page so session A can never
 * observe session B's cookies/storage/tabs. The legacy MCP tools use the
 * `default` session; the Browser Gateway engine passes `task.sessionId` so
 * every gateway session is isolated.
 */
const sessions = new Map<string, { context: BrowserContext; page: Page }>();

const DEFAULT_SESSION = "default";

async function ensureBrowser(sessionId: string = DEFAULT_SESSION) {
  if (!browser) {
    const headlessMode = process.env.HEADLESS !== "false";
    logger.info("Launching browser", {
      headless: headlessMode,
      headlessEnv: process.env.HEADLESS,
    });

    browser = await launchWithFallback({
      headless: headlessMode,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    logger.info("Browser launched successfully", {
      browserType: "chromium",
      headless: headlessMode,
    });
  }

  let session = sessions.get(sessionId);
  if (!session) {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "es-MX",
    });

    const page = await context.newPage();
    // HIGH-4: enforce the network policy on every request (redirects +
    // subresources), not just the initial navigate URL.
    attachRequestGuard(page);

    session = { context, page };
    sessions.set(sessionId, session);

    logger.info("New page created", {
      sessionId,
      viewport: { width: 1280, height: 720 },
      locale: "es-MX",
    });

    // Share the default page with vision and session tools (legacy single-user
    // surface). Gateway sessions are NOT shared.
    if (sessionId === DEFAULT_SESSION) {
      setVisionPage(page);
      setSessionPage(page);
    }
  }
  return { browser, context: session.context, page: session.page };
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    sessions.clear();
  }
}

/**
 * Close ONLY the given session's context and remove just that entry from the
 * `sessions` map (AC18 / BLOCKER-1). Other sessions' contexts/pages are left
 * untouched so closing one gateway session never destroys another session's
 * isolation. If this was the last session, the shared browser is also closed
 * as an optimization.
 */
async function closeSession(sessionId: string = DEFAULT_SESSION) {
  const session = sessions.get(sessionId);
  if (session) {
    await session.context.close();
    sessions.delete(sessionId);
  }
  if (sessions.size === 0 && browser) {
    await browser.close();
    browser = null;
  }
}

// --- Reusable runner functions ---------------------------------------------
// These back both the MCP tools and the Browser Gateway Playwright engine so
// the shared browser/page lifecycle is preserved and no business logic is
// duplicated. Input sanitization is always applied regardless of caller.
// Each runner accepts an optional `sessionId` so the gateway can isolate
// sessions (AC18). The network/SSRF policy is applied on navigate regardless
// of caller (HIGH-3).

export async function runNavigate(url: string, waitUntil: string = "load", sessionId: string = DEFAULT_SESSION) {
  if (!sanitizer.validateURL(url)) {
    throw new Error("Invalid URL");
  }
  // HIGH-3: apply the same NetworkPolicy the gateway facade uses, so the
  // legacy path is protected against private/loopback (SSRF) too.
  const verdict = new NetworkPolicy().assess(url);
  if (!verdict.ok) {
    throw new Error(`navigation denied: ${verdict.reason}`);
  }
  const { page } = await ensureBrowser(sessionId);
  await retry.executeWithRetry(async () => {
    await page.goto(url, { waitUntil: waitUntil as any, timeout: 30000 });
  });
  return {
    success: true,
    url: page.url(),
    title: await page.title(),
  };
}

export async function runClick(selector: string, timeout: number = 30000, sessionId: string = DEFAULT_SESSION) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser(sessionId);
  await retry.executeWithRetry(async () => {
    await page.click(selector, { timeout });
  });
  return { success: true, selector };
}

/**
 * Follow a link by navigating to its resolved href directly (page.goto), NOT by
 * clicking the element. This is the trusted, reversible way to follow a link
 * without firing the element's onclick JS (HIGH-D). The URL is validated by the
 * sanitizer + NetworkPolicy (SSRF) before navigation.
 */
export async function runFollowLink(href: string, sessionId: string = DEFAULT_SESSION) {
  if (!sanitizer.validateURL(href)) {
    throw new Error("Invalid URL");
  }
  // HIGH-3: apply the same NetworkPolicy the gateway facade uses, so the
  // follow_link path is protected against private/loopback (SSRF) too.
  const verdict = new NetworkPolicy().assess(href);
  if (!verdict.ok) {
    throw new Error(`navigation denied: ${verdict.reason}`);
  }
  const { page } = await ensureBrowser(sessionId);
  await retry.executeWithRetry(async () => {
    await page.goto(href, { waitUntil: "load", timeout: 30000 });
  });
  return {
    success: true,
    url: page.url(),
    title: await page.title(),
  };
}

export async function runFill(
  selector: string,
  value: string,
  timeout: number = 30000,
  sessionId: string = DEFAULT_SESSION
) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser(sessionId);
  await retry.executeWithRetry(async () => {
    await page.fill(selector, value, { timeout });
  });
  // Never return or log the raw filled value: it may contain credentials
  // or form secrets. Only report that the fill succeeded.
  return { success: true, selector, filled: true };
}

export async function runScreenshot(path?: string, fullPage: boolean = false, sessionId: string = DEFAULT_SESSION) {
  const { page } = await ensureBrowser(sessionId);
  const screenshotPath = path || `screenshots/screenshot-${Date.now()}.png`;
  const screenshot = await page.screenshot({
    path: screenshotPath,
    fullPage,
  });
  return {
    success: true,
    path: screenshotPath,
    size: screenshot.length,
  };
}

export async function runGetText(selector: string, sessionId: string = DEFAULT_SESSION) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser(sessionId);
  const text = await page.textContent(selector);
  return { success: true, selector, text };
}

export async function runWaitFor(
  selector: string,
  timeout: number = 30000,
  state: string = "visible",
  sessionId: string = DEFAULT_SESSION
) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser(sessionId);
  await page.waitForSelector(selector, { timeout, state: state as any });
  return { success: true, selector, state };
}

export async function runSnapshot(sessionId: string = DEFAULT_SESSION) {
  const { page } = await ensureBrowser(sessionId);
  const title = await page.title();
  const url = page.url();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? ''))
    .slice(0, 4000);
  return { success: true, title, url, bodyText };
}

export async function runExtract(selector?: string, sessionId: string = DEFAULT_SESSION) {
  const { page } = await ensureBrowser(sessionId);
  if (selector) {
    if (!sanitizer.validateSelector(selector)) {
      throw new Error("Invalid selector");
    }
    const text = await page.textContent(selector);
    return { success: true, text };
  }
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  return { success: true, text };
}

export async function runClose() {
  await closeBrowser();
  return { success: true };
}

/**
 * Per-session close: closes ONLY the given session's context and removes just
 * that entry from the `sessions` map. Other sessions remain isolated (AC18).
 * Used by the Browser Gateway engine's `closeSession(sessionId)`.
 */
export async function runCloseSession(sessionId: string = DEFAULT_SESSION) {
  await closeSession(sessionId);
  return { success: true };
}

// --- MCP tool definitions (backward compatible) -----------------------------

export const playwrightTools = [
  {
    name: "playwright_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        waitUntil: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          description: "When to consider navigation complete",
        },
      },
      required: ["url"],
    },
    execute(args: any) {
      return runNavigate(args.url, args.waitUntil);
    },
  },

  {
    name: "playwright_click",
    description: "Click an element. Routed through the gateway safety/approval gate: a raw click is approval-required unless a one-time approval token is supplied (HIGH-D/BLOCKER-E).",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of element to click",
        },
        timeout: { type: "number", description: "Timeout in milliseconds" },
        approval: {
          type: "object",
          description: "Optional one-time approval token { approvalId, signature } for a side-effect/raw click",
        },
      },
      required: ["selector"],
    },
    async execute(args: any) {
      // Route through the gateway so the safety/approval gate applies. A raw
      // click is ALWAYS approval-required (HIGH-D); the caller must supply a
      // one-time token issued by the operator CLI (BLOCKER-E). This closes the
      // bypass where a legacy MCP caller could click any side-effect control
      // without approval.
      const gateway = createGateway();
      const result = await gateway.executeTask({
        taskId: `legacy-click-${Date.now()}`,
        sessionId: "default",
        action: { type: "click", target: args.selector },
        approval: args.approval
          ? { approved: true, approvalId: args.approval.approvalId, signature: args.approval.signature }
          : undefined,
      });
      if (result.status === "blocked") {
        return {
          success: false,
          category: result.category,
          reason: result.reason,
          pendingId: (result as any).pendingId,
        };
      }
      if (result.status !== "success") {
        return { success: false, reason: result.reason };
      }
      return { success: true, selector: args.selector };
    },
  },

  {
    name: "playwright_fill",
    description: "Fill a form field",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of input field",
        },
        value: { type: "string", description: "Value to fill" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["selector", "value"],
    },
    execute(args: any) {
      return runFill(args.selector, args.value, args.timeout);
    },
  },

  {
    name: "playwright_screenshot",
    description: "Take a screenshot",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to save screenshot" },
        fullPage: { type: "boolean", description: "Capture full page" },
      },
    },
    execute(args: any) {
      return runScreenshot(args.path, args.fullPage);
    },
  },

  {
    name: "playwright_get_text",
    description: "Get text content from element",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
      },
      required: ["selector"],
    },
    execute(args: any) {
      return runGetText(args.selector);
    },
  },

  {
    name: "playwright_wait_for",
    description: "Wait for an element to appear",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to wait for" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
        state: {
          type: "string",
          enum: ["attached", "detached", "visible", "hidden"],
          description: "Element state to wait for",
        },
      },
      required: ["selector"],
    },
    execute(args: any) {
      return runWaitFor(args.selector, args.timeout, args.state);
    },
  },

  {
    name: "playwright_close",
    description: "Close the browser",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute() {
      return runClose();
    },
  },
];
