import { chromium, Browser, Page, BrowserContext } from "playwright";
import { logger } from "../../../../lib/observability/logger.js";
import { sanitizer } from "../../../../lib/security/input-sanitizer.js";
import { retry } from "../../../../lib/resilience/retry.js";
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

    browser = await chromium.launch({
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
    async execute(args: any) {
      const { url, waitUntil = "load" } = args;

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
    async execute(args: any) {
      const { selector, timeout = 30000 } = args;

      if (!sanitizer.validateSelector(selector)) {
        throw new Error("Invalid selector");
      }

      const { page } = await ensureBrowser();

      await retry.executeWithRetry(async () => {
        await page.click(selector, { timeout });
      });

      return { success: true, selector };
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
    async execute(args: any) {
      const { selector, value, timeout = 30000 } = args;

      if (!sanitizer.validateSelector(selector)) {
        throw new Error("Invalid selector");
      }

      // Replace environment variables in fill values
      let fillValue = value;
      let usedCredentials = false;

      if (fillValue && fillValue.includes("${LINKEDIN_EMAIL}")) {
        fillValue = fillValue.replace(
          "${LINKEDIN_EMAIL}",
          process.env.LINKEDIN_EMAIL || ""
        );
        usedCredentials = true;
        logger.info("Using LinkedIn email from environment variables", {
          email: process.env.LINKEDIN_EMAIL
            ? "***" + process.env.LINKEDIN_EMAIL.slice(-4)
            : "NOT_SET",
        });
      }
      if (fillValue && fillValue.includes("${LINKEDIN_PASSWORD}")) {
        fillValue = fillValue.replace(
          "${LINKEDIN_PASSWORD}",
          process.env.LINKEDIN_PASSWORD || ""
        );
        usedCredentials = true;
        logger.info("Using LinkedIn password from environment variables", {
          password: process.env.LINKEDIN_PASSWORD ? "***SET***" : "NOT_SET",
        });
      }

      const { page } = await ensureBrowser();

      await retry.executeWithRetry(async () => {
        await page.fill(selector, fillValue, { timeout });
      });

      return { success: true, selector, value: fillValue, usedCredentials };
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
    async execute(args: any) {
      const { path, fullPage = false } = args;
      const { page } = await ensureBrowser();

      // Generate default path if not provided
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
    async execute(args: any) {
      const { selector } = args;

      if (!sanitizer.validateSelector(selector)) {
        throw new Error("Invalid selector");
      }

      const { page } = await ensureBrowser();

      const text = await page.textContent(selector);

      return { success: true, selector, text };
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
    async execute(args: any) {
      const { selector, timeout = 30000, state = "visible" } = args;

      if (!sanitizer.validateSelector(selector)) {
        throw new Error("Invalid selector");
      }

      const { page } = await ensureBrowser();

      await page.waitForSelector(selector, { timeout, state: state as any });

      return { success: true, selector, state };
    },
  },

  {
    name: "playwright_close",
    description: "Close the browser",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute() {
      await closeBrowser();
      return { success: true };
    },
  },
];
