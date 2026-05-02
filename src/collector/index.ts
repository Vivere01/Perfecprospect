import { getBrowserSession } from '../config/browser';
import { logger } from '../utils/logger';
import { humanDelay, microDelay, occasionalLongPause } from '../utils/timing';
import { simulateScroll } from '../executor/actions';
import path from 'path';

export interface CollectorOptions {
  sourceUrl: string; // URL of a post or a profile
  mode: 'LIKERS' | 'FOLLOWERS';
  maxLeads?: number;
  accountId?: string;
}

/**
 * Progressively extracts usernames from a dialog list (like followers or likers).
 */
async function extractFromDialog(page: any, dialogSelector: string, maxItems: number) {
  logger.info(`[COLLECTOR] Starting progressive extraction. Target: ${maxItems}`);
  const collected = new Set<string>();
  
  await page.waitForSelector(dialogSelector);
  const scrollableDiv = page.locator(dialogSelector);

  let noNewItemsCount = 0;

  while (collected.size < maxItems && noNewItemsCount < 3) {
    // Extract current visible items
    const elements = scrollableDiv.locator('a[role="link"]:has(img)'); // usually user links have img
    const count = await elements.count();
    
    let addedInThisPass = 0;
    
    for (let i = 0; i < count; i++) {
      const href = await elements.nth(i).getAttribute('href');
      if (href) {
        const username = href.replace(/\//g, '');
        if (!collected.has(username) && username !== '') {
          collected.add(username);
          addedInThisPass++;
          if (collected.size >= maxItems) break;
        }
      }
    }

    if (addedInThisPass === 0) {
      noNewItemsCount++;
    } else {
      noNewItemsCount = 0;
      logger.debug(`[COLLECTOR] Collected ${collected.size}/${maxItems} leads...`);
    }

    if (collected.size >= maxItems) break;

    // Simulate human scroll inside the dialog
    logger.debug(`[COLLECTOR] Scrolling down to load more...`);
    // Playwright mouse wheel might not target the inner div perfectly if not hovered
    await scrollableDiv.hover();
    await page.mouse.wheel(0, Math.floor(Math.random() * 800) + 400);
    
    // Crucial: Wait for network/items to load like a human waiting
    await humanDelay(2000, 5000);
    
    // Occasional long pause
    await occasionalLongPause(0.02);
  }

  return Array.from(collected);
}

/**
 * Main Collector Entrypoint. 
 * Navigates to a source and extracts profiles incrementally.
 */
export async function runCollector(options: CollectorOptions) {
  logger.info(`[COLLECTOR] Starting collection on ${options.sourceUrl} (Mode: ${options.mode})`);
  
  const { page, close } = await getBrowserSession(options.accountId);
  const maxLeads = options.maxLeads || 50;

  try {
    await page.goto(options.sourceUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(4000, 8000);

    // Diagnostic: Log current URL and page title to detect redirects (e.g. login page)
    const currentUrl = page.url();
    const pageTitle = await page.title();
    logger.info(`[COLLECTOR] Page loaded. URL: ${currentUrl} | Title: ${pageTitle}`);

    let usernames: string[] = [];

    if (options.mode === 'LIKERS') {
      // Strategy: Try multiple selectors to find the likers link
      const likersSelectors = [
        'a[href$="liked_by/"]',
        'a[href*="liked_by"]',
        'section a:has-text("curtida")',
        'section a:has-text("like")',
      ];
      
      let likersLink = null;
      for (const selector of likersSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          likersLink = el;
          logger.info(`[COLLECTOR] Found likers link with selector: ${selector}`);
          break;
        }
      }

      if (likersLink) {
        await likersLink.click();
        await humanDelay(3000, 6000);
        
        // The dialog usually has role="dialog"
        usernames = await extractFromDialog(page, 'div[role="dialog"] div:has(> div > div > a)', maxLeads);
      } else {
        logger.warn(`[COLLECTOR] Likers link not found on ${options.sourceUrl}`);
        const screenshotPath = path.join(process.cwd(), 'sessions', `debug-likers-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`[COLLECTOR] Diagnostic screenshot saved: ${screenshotPath}`);
      }
    } 
    else if (options.mode === 'FOLLOWERS') {
      // Strategy: Try multiple selectors to find the followers link
      const followersSelectors = [
        'a[href$="/followers/"]',
        'a[href*="/followers"]',
        'a:has-text("seguidores")',
        'a:has-text("followers")',
        'header a:has-text("seguidores")',
        'ul li a:has-text("seguidores")',
      ];
      
      let followersLink = null;
      for (const selector of followersSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          followersLink = el;
          logger.info(`[COLLECTOR] Found followers link with selector: ${selector}`);
          break;
        }
      }

      if (followersLink) {
        await followersLink.click();
        await humanDelay(3000, 6000);
        
        usernames = await extractFromDialog(page, 'div[role="dialog"]', maxLeads);
      } else {
        logger.warn(`[COLLECTOR] Followers link not found on ${options.sourceUrl}`);
        // Log all links on page for debugging
        const allLinks = await page.locator('a').evaluateAll((els: any[]) => 
          els.slice(0, 30).map((e: any) => ({ href: e.href, text: e.textContent?.trim().substring(0, 50) }))
        );
        logger.info(`[COLLECTOR] Page links for debug: ${JSON.stringify(allLinks)}`);
        const screenshotPath = path.join(process.cwd(), 'sessions', `debug-followers-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`[COLLECTOR] Diagnostic screenshot saved: ${screenshotPath}`);
      }
    }

    logger.info(`[COLLECTOR] Finished. Collected ${usernames.length} leads.`);
    
    // Here we would push them to the Queue for FILTERING -> ANALYZING
    // For now, return them
    return usernames;

  } catch (error: any) {
    logger.error(`[COLLECTOR] Error during collection`, error);
    // Save error screenshot
    try {
      const screenshotPath = path.join(process.cwd(), 'sessions', `debug-error-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info(`[COLLECTOR] Error screenshot saved: ${screenshotPath}`);
    } catch (_) {}
    return [];
  } finally {
    await close();
  }
}
