import { chromium, BrowserContext, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { env } from './env';

const SESSIONS_DIR = path.resolve(process.cwd(), 'sessions');

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * Initializes Playwright with persistent session storage.
 * Maps storage files per accountId to allow multiple accounts.
 */
export async function getBrowserSession(accountId: string = 'default'): Promise<BrowserSession> {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const storageStatePath = path.join(SESSIONS_DIR, `${accountId}.json`);
  
  // Launch browser with stealth-like arguments
  const browser = await chromium.launch({
    headless: true, // Forçado true para garantir funcionamento na VPS
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
  });

  const contextOptions: any = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  };

  // If we have a saved session, use it
  if (fs.existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
    logger.debug(`[BROWSER] Loaded session for account: ${accountId}`);
  } else {
    logger.debug(`[BROWSER] Creating new session for account: ${accountId}`);
  }

  const context = await browser.newContext(contextOptions);

  // Evasion tactics for context
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  const close = async () => {
    // Save state before closing
    await context.storageState({ path: storageStatePath });
    logger.debug(`[BROWSER] Saved session for account: ${accountId}`);
    await browser.close();
  };

  return { context, page, close };
}
