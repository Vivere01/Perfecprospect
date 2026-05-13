import { Page } from 'playwright';
import { logger } from '../utils/logger';
import { humanDelay } from '../utils/humanDelay';

/**
 * Common browser actions used by workers
 */

export async function visitProfile(page: Page, username: string) {
  logger.info(`[EXECUTOR] Visiting profile: @${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  await humanDelay(3000, 6000);
}

export async function openDirectMessage(page: Page) {
  logger.info(`[EXECUTOR] Opening Direct Message...`);
  
  // Try to find the "Message" button
  const messageButton = page.locator('header button:has-text("Enviar mensagem"), header button:has-text("Message")').first();
  
  if (await messageButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await messageButton.click();
    await humanDelay(4000, 7000);
    return true;
  }
  
  logger.warn(`[EXECUTOR] Message button not found on profile.`);
  return false;
}

export async function sendMessage(page: Page, message: string) {
  logger.info(`[EXECUTOR] Typing message...`);
  
  // Wait for the message input to appear
  const inputSelector = 'div[aria-label*="Mensagem"], div[aria-label*="Message"], div[role="textbox"]';
  const input = page.locator(inputSelector).first();
  
  if (await input.isVisible({ timeout: 10000 }).catch(() => false)) {
    await input.click();
    await page.keyboard.type(message, { delay: 100 });
    await humanDelay(1000, 2000);
    await page.keyboard.press('Enter');
    logger.info(`[EXECUTOR] Message sent.`);
    await humanDelay(2000, 4000);
    return true;
  }
  
  logger.error(`[EXECUTOR] Message input not found.`);
  return false;
}

export async function likeRecentPosts(page: Page, count: number = 2) {
  logger.info(`[EXECUTOR] Liking ${count} recent posts...`);
  
  // Find post links
  const postLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/p/"]'));
    return links.slice(0, 5).map(a => a.getAttribute('href'));
  });

  let liked = 0;
  for (const href of postLinks) {
    if (liked >= count) break;
    
    try {
      await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded' });
      await humanDelay(2000, 4000);
      
      const likeButton = page.locator('section span svg[aria-label="Curtir"], section span svg[aria-label="Like"]').first();
      if (await likeButton.isVisible()) {
        await likeButton.click();
        liked++;
        await humanDelay(2000, 4000);
      }
    } catch (err) {
      logger.error(`[EXECUTOR] Error liking post ${href}:`, err);
    }
  }
}

export async function followUser(page: Page) {
  logger.info(`[EXECUTOR] Decided to FOLLOW user.`);
  const followButton = page.locator('button:has-text("Seguir"), button:has-text("Follow")').first();
  if (await followButton.isVisible()) {
    await followButton.click();
    await humanDelay(2000, 5000);
  }
}

/**
 * Finds similar accounts recommended by Instagram on a profile page.
 */
export async function discoverSimilarAccounts(page: Page): Promise<string[]> {
  logger.info(`[EXECUTOR] Looking for similar accounts suggestions...`);
  
  // Try to find the "Similar Accounts" arrow button
  const similarArrow = page.locator('header svg[aria-label*="Sugestões"], header svg[aria-label*="Suggested"], header svg[aria-label*="Similar"]').first();
  
  if (await similarArrow.isVisible({ timeout: 5000 }).catch(() => false)) {
    logger.info(`[EXECUTOR] Clicking suggestions arrow...`);
    await similarArrow.click();
  } else {
    logger.info(`[EXECUTOR] Suggestions arrow not found. Trying to find "Suggested for you" section...`);
    // Sometimes suggestions are already visible if we scroll a bit or if it's a specific UI version
    await page.evaluate(() => window.scrollBy(0, 300));
    await humanDelay(2000, 4000);
  }

  // The suggestions appear in a list. We look for profile links within that context.
  const usernames = await page.evaluate(() => {
    // Look for links within containers that typicaly hold suggestions
    const suggestionContainers = Array.from(document.querySelectorAll('div')).filter(el => 
      el.innerText.includes('Sugerido para você') || 
      el.innerText.includes('Suggested for you') ||
      el.innerText.includes('Ver tudo')
    );

    const foundUsernames = new Set<string>();
    const targetElements = suggestionContainers.length > 0 ? suggestionContainers : [document.body];

    targetElements.forEach(container => {
      const links = Array.from(container.querySelectorAll('a[href^="/"]'));
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          const parts = href.split('/').filter(p => p.length > 0);
          if (parts.length === 1 && !['explore', 'reels', 'direct', 'accounts', 'emails'].includes(parts[0])) {
            foundUsernames.add(parts[0]);
          }
        }
      });
    });

    return Array.from(foundUsernames);
  });

  logger.info(`[EXECUTOR] Found ${usernames.length} candidate usernames for references.`);
  return usernames;
}
