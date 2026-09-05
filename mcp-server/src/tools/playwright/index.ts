import { Browser, Page, BrowserContext } from "playwright";
import { logger } from "../../../../lib/observability/logger.js";
import { sanitizer } from "../../../../lib/security/input-sanitizer.js";
import { retry } from "../../../../lib/resilience/retry.js";
import { launchWithFallback } from "../../../../lib/browser-gateway/infrastructure/engines/playwright/launch-with-fallback.js";
import { setCurrentPage as setVisionPage } from "../vision/index.js";
import { setCurrentPage as setSessionPage } from "../session/index.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

async function ensureBrowser() {
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

    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "es-MX",
    });

    page = await context.newPage();
    logger.info("New page created", {
      viewport: { width: 1280, height: 720 },
      locale: "es-MX",
    });

    // Share page with vision and session tools
    setVisionPage(page);
    setSessionPage(page);
  }
  return { browser, context, page: page! };
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

// --- Reusable runner functions ---------------------------------------------
// These back both the MCP tools and the Browser Gateway Playwright engine so
// the shared browser/page lifecycle is preserved and no business logic is
// duplicated. Input sanitization is always applied regardless of caller.

export async function runNavigate(url: string, waitUntil: string = "load") {
  if (!sanitizer.validateURL(url)) {
    throw new Error("Invalid URL");
  }
  const { page } = await ensureBrowser();
  await retry.executeWithRetry(async () => {
    await page.goto(url, { waitUntil: waitUntil as any, timeout: 30000 });
  });
  return {
    success: true,
    url: page.url(),
    title: await page.title(),
  };
}

export async function runClick(selector: string, timeout: number = 30000) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser();
  await retry.executeWithRetry(async () => {
    await page.click(selector, { timeout });
  });
  return { success: true, selector };
}

export async function runFill(
  selector: string,
  value: string,
  timeout: number = 30000
) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser();
  await retry.executeWithRetry(async () => {
    await page.fill(selector, value, { timeout });
  });
  // Never return or log the raw filled value: it may contain credentials
  // or form secrets. Only report that the fill succeeded.
  return { success: true, selector, filled: true };
}

export async function runScreenshot(path?: string, fullPage: boolean = false) {
  const { page } = await ensureBrowser();
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

export async function runGetText(selector: string) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser();
  const text = await page.textContent(selector);
  return { success: true, selector, text };
}

export async function runWaitFor(
  selector: string,
  timeout: number = 30000,
  state: string = "visible"
) {
  if (!sanitizer.validateSelector(selector)) {
    throw new Error("Invalid selector");
  }
  const { page } = await ensureBrowser();
  await page.waitForSelector(selector, { timeout, state: state as any });
  return { success: true, selector, state };
}

export async function runSnapshot() {
  const { page } = await ensureBrowser();
  const title = await page.title();
  const url = page.url();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? ''))
    .slice(0, 4000);
  return { success: true, title, url, bodyText };
}

export async function runExtract(selector?: string) {
  const { page } = await ensureBrowser();
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
    description: "Click an element",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of element to click",
        },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["selector"],
    },
    execute(args: any) {
      return runClick(args.selector, args.timeout);
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
