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
  
  // Try multiple selectors to find the dialog
  const dialogSelectors = [
    dialogSelector,
    'div[role="dialog"]',
    '[role="dialog"]',
  ];

  let dialog = null;
  for (const sel of dialogSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 10000 });
      dialog = page.locator(sel);
      logger.info(`[COLLECTOR] Dialog found with selector: ${sel}`);
      break;
    } catch {
      logger.debug(`[COLLECTOR] Dialog selector failed: ${sel}`);
    }
  }

  if (!dialog) {
    logger.error(`[COLLECTOR] No dialog found. Taking screenshot...`);
    const screenshotPath = path.join(process.cwd(), 'sessions', `debug-no-dialog-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return [];
  }

  // Multiple strategies to find user links inside the dialog
  const linkSelectors = [
    'a[role="link"]:has(img)',
    'a[role="link"]',
    'a:has(img[alt])',
    'a[href^="/"]',
  ];

  let noNewItemsCount = 0;

  while (collected.size < maxItems && noNewItemsCount < 3) {
    let addedInThisPass = 0;

    // Try each link selector strategy
    for (const linkSel of linkSelectors) {
      const elements = dialog.locator(linkSel);
      const count = await elements.count();
      
      if (count === 0) continue;
      
      for (let i = 0; i < count; i++) {
        const href = await elements.nth(i).getAttribute('href');
        if (href && href.startsWith('/') && !href.includes('/p/') && !href.includes('/explore/')) {
          const username = href.replace(/\//g, '');
          if (!collected.has(username) && username !== '' && username.length > 1) {
            collected.add(username);
            addedInThisPass++;
            if (collected.size >= maxItems) break;
          }
        }
      }
      
      if (addedInThisPass > 0) break; // Found working selector, no need to try others
    }

    if (addedInThisPass === 0) {
      noNewItemsCount++;
      if (noNewItemsCount === 1) {
        // Debug: log what's inside the dialog on first failure
        const dialogHtml = await dialog.innerHTML().catch(() => 'unable to get innerHTML');
        logger.debug(`[COLLECTOR] Dialog inner HTML (first 500 chars): ${dialogHtml.substring(0, 500)}`);
      }
    } else {
      noNewItemsCount = 0;
      logger.debug(`[COLLECTOR] Collected ${collected.size}/${maxItems} leads...`);
    }

    if (collected.size >= maxItems) break;

    // Simulate human scroll inside the dialog
    logger.debug(`[COLLECTOR] Scrolling down to load more...`);
    await dialog.hover();
    await page.mouse.wheel(0, Math.floor(Math.random() * 800) + 400);
    
    await humanDelay(2000, 5000);
    await occasionalLongPause(0.02);
  }

  logger.info(`[COLLECTOR] Extraction complete. Total collected: ${collected.size}`);
  return Array.from(collected);
}

/**
 * Extracts usernames directly from a page (no dialog).
 * Used when Instagram navigates to a /liked_by/ page instead of opening a dialog.
 */
async function extractFromPage(page: any, maxItems: number) {
  logger.info(`[COLLECTOR] Extracting from page directly. Target: ${maxItems}`);
  const collected = new Set<string>();

  // Log page content for debugging
  const allLinks = await page.locator('a').evaluateAll((els: any[]) => 
    els.slice(0, 40).map((e: any) => ({ href: e.href, text: e.textContent?.trim().substring(0, 60) }))
  );
  logger.info(`[COLLECTOR] Found ${allLinks.length} links on page`);
  logger.debug(`[COLLECTOR] Page links: ${JSON.stringify(allLinks.slice(0, 15))}`);

  let noNewItemsCount = 0;

  while (collected.size < maxItems && noNewItemsCount < 4) {
    let addedInThisPass = 0;

    // Look for profile links on the page
    const profileLinks = page.locator('a[href^="/"]');
    const count = await profileLinks.count();

    for (let i = 0; i < count; i++) {
      const href = await profileLinks.nth(i).getAttribute('href');
      if (href) {
        // Filter: only username links (single path segment, no special pages)
        const cleanHref = href.replace(/^\/|\/$/g, '');
        const isUsername = cleanHref.length > 1 
          && !cleanHref.includes('/') 
          && !cleanHref.startsWith('p')
          && !['explore', 'accounts', 'direct', 'stories', 'reels', 'reel'].includes(cleanHref);
        
        if (isUsername && !collected.has(cleanHref)) {
          collected.add(cleanHref);
          addedInThisPass++;
          if (collected.size >= maxItems) break;
        }
      }
    }

    if (addedInThisPass === 0) {
      noNewItemsCount++;
    } else {
      noNewItemsCount = 0;
      logger.debug(`[COLLECTOR] Page extraction: ${collected.size}/${maxItems} leads...`);
    }

    if (collected.size >= maxItems) break;

    // Scroll down to load more
    await page.mouse.wheel(0, Math.floor(Math.random() * 800) + 400);
    await humanDelay(2000, 4000);
  }

  logger.info(`[COLLECTOR] Page extraction complete. Total: ${collected.size}`);
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
      // Strategy 1: Navigate directly to the liked_by page
      const likedByUrl = options.sourceUrl.replace(/\/$/, '') + '/liked_by/';
      logger.info(`[COLLECTOR] Navigating directly to likers page: ${likedByUrl}`);
      await page.goto(likedByUrl, { waitUntil: 'domcontentloaded' });
      await humanDelay(3000, 6000);

      const afterUrl = page.url();
      const afterTitle = await page.title();
      logger.info(`[COLLECTOR] Likers page loaded. URL: ${afterUrl} | Title: ${afterTitle}`);

      // Take a diagnostic screenshot to see what we're working with
      const screenshotPath = path.join(process.cwd(), 'sessions', `debug-likers-page-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info(`[COLLECTOR] Likers page screenshot saved: ${screenshotPath}`);

      // Try to extract from dialog first (some Instagram versions still use dialog)
      const hasDialog = await page.locator('div[role="dialog"]').isVisible({ timeout: 3000 }).catch(() => false);
      
      if (hasDialog) {
        logger.info(`[COLLECTOR] Dialog detected, extracting from dialog...`);
        usernames = await extractFromDialog(page, 'div[role="dialog"]', maxLeads);
      } else {
        // Extract directly from the page (no dialog)
        logger.info(`[COLLECTOR] No dialog, extracting from page directly...`);
        usernames = await extractFromPage(page, maxLeads);
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
