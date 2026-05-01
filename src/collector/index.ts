import { getBrowserSession } from '../config/browser';
import { logger } from '../utils/logger';
import { humanDelay, microDelay, occasionalLongPause } from '../utils/timing';
import { simulateScroll } from '../executor/actions';

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

    let usernames: string[] = [];

    if (options.mode === 'LIKERS') {
      // Find and click the likers count/link
      const likersLink = page.locator('a[href$="liked_by/"]').first();
      if (await likersLink.isVisible()) {
        await likersLink.click();
        await humanDelay(3000, 6000);
        
        // The dialog usually has role="dialog"
        usernames = await extractFromDialog(page, 'div[role="dialog"] div:has(> div > div > a)', maxLeads);
      } else {
        logger.warn(`[COLLECTOR] Likers link not found on ${options.sourceUrl}`);
      }
    } 
    else if (options.mode === 'FOLLOWERS') {
      // Find and click followers link
      const followersLink = page.locator('a[href$="/followers/"]').first();
      if (await followersLink.isVisible()) {
        await followersLink.click();
        await humanDelay(3000, 6000);
        
        usernames = await extractFromDialog(page, 'div[role="dialog"]', maxLeads);
      } else {
        logger.warn(`[COLLECTOR] Followers link not found on ${options.sourceUrl}`);
      }
    }

    logger.info(`[COLLECTOR] Finished. Collected ${usernames.length} leads.`);
    
    // Here we would push them to the Queue for FILTERING -> ANALYZING
    // For now, return them
    return usernames;

  } catch (error: any) {
    logger.error(`[COLLECTOR] Error during collection`, error);
    return [];
  } finally {
    await close();
  }
}
