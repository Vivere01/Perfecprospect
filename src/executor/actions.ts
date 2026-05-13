import { Page } from 'playwright';
import { logger } from '../utils/logger';
import { humanDelay, microDelay, occasionalLongPause } from '../utils/timing';

/**
 * Common human-like actions for Instagram automation
 */

export async function openProfile(page: Page, username: string): Promise<boolean> {
  logger.info(`[EXECUTOR] Navigating to profile: @${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  await humanDelay(3000, 6000);

  // Check if profile is valid and not private
  const isPrivate = await page.locator('h2:has-text("Esta conta é privada"), h2:has-text("This Account is Private")').isVisible().catch(() => false);
  const notFound = await page.locator('h2:has-text("Página não encontrada"), h2:has-text("Page not found")').isVisible().catch(() => false);

  if (notFound) {
    logger.warn(`[EXECUTOR] Profile @${username} not found.`);
    return false;
  }

  if (isPrivate) {
    logger.warn(`[EXECUTOR] Profile @${username} is private.`);
    // Still "exists", but we might want to skip interaction depending on strategy
    // For now we return true to allow DM attempt if followed, or false to skip
    return false; 
  }

  return true;
}

export async function viewStories(page: Page) {
  logger.info(`[EXECUTOR] Checking for stories...`);
  // Profile picture with a story ring usually has aria-label or specific canvas
  const storyRing = page.locator('header canvas').first();
  
  if (await storyRing.isVisible({ timeout: 3000 }).catch(() => false)) {
    logger.info(`[EXECUTOR] Story found. Viewing...`);
    await storyRing.click();
    
    // View 2-3 stories
    const storyCount = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < storyCount; i++) {
      await humanDelay(3000, 6000);
      // Click right side to skip
      await page.mouse.click(800, 500); 
    }
    
    // Close story
    await page.keyboard.press('Escape');
    await humanDelay(2000, 4000);
  } else {
    logger.info(`[EXECUTOR] No stories to view.`);
  }
}

export async function viewAndMaybeLikePost(page: Page, likeProbability: number = 0.5) {
  logger.info(`[EXECUTOR] Interacting with posts...`);
  
  const posts = page.locator('article a[href^="/p/"]');
  const count = await posts.count();
  
  if (count > 0) {
    const index = Math.floor(Math.random() * Math.min(count, 6));
    const targetPost = posts.nth(index);
    
    await targetPost.scrollIntoViewIfNeeded();
    await microDelay();
    await targetPost.click();
    await humanDelay(4000, 8000); // Simulate reading/viewing

    if (Math.random() < likeProbability) {
      const likeButton = page.locator('article svg[aria-label="Curtir"], article svg[aria-label="Like"]').first();
      if (await likeButton.isVisible()) {
        logger.info(`[EXECUTOR] Liking post...`);
        await likeButton.click();
        await humanDelay(1000, 3000);
      }
    }

    await page.keyboard.press('Escape'); // Close post
    await humanDelay(2000, 4000);
  }
}

export async function followUser(page: Page) {
  logger.info(`[EXECUTOR] Attempting to follow...`);
  const followButton = page.locator('header button:has-text("Seguir"), header button:has-text("Follow")').first();
  
  if (await followButton.isVisible()) {
    const text = await followButton.innerText();
    if (text.includes('Seguir') || text.includes('Follow')) {
      await followButton.click();
      logger.info(`[EXECUTOR] Followed user.`);
      await humanDelay(2000, 5000);
    } else {
      logger.info(`[EXECUTOR] Already following user.`);
    }
  }
}

export async function sendDM(page: Page, username: string, message: string) {
  logger.info(`[EXECUTOR] Preparing to send DM to @${username}`);
  
  const messageButton = page.locator('header button:has-text("Enviar mensagem"), header button:has-text("Message")').first();
  
  if (await messageButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await messageButton.click();
    await humanDelay(5000, 8000); // Wait for chat to load
    
    const textBox = page.locator('div[role="textbox"][aria-label*="Mensagem"], div[role="textbox"][aria-label*="Message"]').first();
    if (await textBox.isVisible()) {
      await textBox.click();
      await page.keyboard.type(message, { delay: 100 });
      await humanDelay(1000, 3000);
      await page.keyboard.press('Enter');
      logger.info(`[EXECUTOR] DM sent successfully.`);
      await humanDelay(3000, 6000);
      return true;
    }
  }
  
  logger.error(`[EXECUTOR] Could not find message box for @${username}`);
  return false;
}

export async function simulateScroll(page: Page) {
  await page.evaluate(() => {
    window.scrollBy(0, Math.floor(Math.random() * 500) + 200);
  });
  await microDelay();
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
    await page.evaluate(() => window.scrollBy(0, 300));
    await humanDelay(2000, 4000);
  }

  const usernames = await page.evaluate(() => {
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
