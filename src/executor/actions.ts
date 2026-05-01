import { Page } from '@playwright/test';
import { logger } from '../utils/logger';
import { humanDelay, microDelay, chance } from '../utils/timing';

/**
 * Simulates human scrolling down and optionally up.
 */
export async function simulateScroll(page: Page, scrolls: number = 3) {
  logger.debug(`[EXECUTOR] Starting simulated scroll (${scrolls} times)`);
  for (let i = 0; i < scrolls; i++) {
    const scrollAmount = Math.floor(Math.random() * 500) + 300;
    
    // Simulate mouse wheel down
    await page.mouse.wheel(0, scrollAmount);
    
    // Pause to "read"
    await microDelay(1500, 4000);
    
    // Occasionally scroll slightly up like reading again
    if (chance(0.3)) {
      await page.mouse.wheel(0, -(Math.floor(Math.random() * 200) + 100));
      await microDelay(800, 2000);
    }
  }
}

/**
 * Opens a profile and acts like a human analyzing it
 */
export async function openProfile(page: Page, username: string) {
  logger.info(`[EXECUTOR] Navigating to profile: @${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  
  await humanDelay(3000, 8000); // Initial load pause
  
  // Wait to see if it's private or not found
  try {
    await page.waitForSelector('header', { timeout: 10000 });
  } catch (e) {
    logger.warn(`[EXECUTOR] Profile @${username} header not found or took too long.`);
    return false;
  }

  // Look at bio
  logger.debug(`[EXECUTOR] "Reading" bio...`);
  await microDelay(2000, 6000);
  
  // Scroll through feed to mimic reading
  await simulateScroll(page, Math.floor(Math.random() * 3) + 2);

  return true;
}

/**
 * Clicks the story ring if available and watches it.
 */
export async function viewStories(page: Page) {
  logger.info(`[EXECUTOR] Checking for stories...`);
  const storyRing = page.locator('canvas').first(); // Instagram uses canvas for story rings
  
  if (await storyRing.isVisible()) {
    logger.info(`[EXECUTOR] Stories found, clicking...`);
    await storyRing.click();
    
    // Watch stories (wait some time)
    await humanDelay(5000, 15000);
    
    // Click next a few times or exit
    for(let i=0; i<2; i++) {
      if (chance(0.5)) {
        // Press right arrow to go to next story
        await page.keyboard.press('ArrowRight');
        await humanDelay(2000, 5000);
      }
    }
    
    // Exit stories (click close or press escape)
    await page.keyboard.press('Escape');
    await microDelay();
  } else {
    logger.debug(`[EXECUTOR] No stories available.`);
  }
}

/**
 * Opens a recent post, simulates reading, and occasionally likes.
 */
export async function viewAndMaybeLikePost(page: Page, likeProbability: number = 0.7) {
  logger.info(`[EXECUTOR] Inspecting recent posts...`);
  const posts = page.locator('article a[href*="/p/"]');
  
  const count = await posts.count();
  if (count === 0) return;

  // Open first or second post
  const targetIndex = chance(0.7) ? 0 : 1; 
  if (targetIndex >= count) return;

  await posts.nth(targetIndex).click();
  await humanDelay(3000, 7000); // Wait for post to open

  // "Read" the caption
  await simulateScroll(page, 1);

  if (chance(likeProbability)) {
    logger.info(`[EXECUTOR] Decided to LIKE the post.`);
    // Try to find the like button. Instagram svg has 'aria-label="Curtir"' or 'Like'
    const likeButton = page.locator('svg[aria-label="Curtir"], svg[aria-label="Like"]').first();
    if (await likeButton.isVisible()) {
      await microDelay(1000, 3000); // Hover hesitation
      await likeButton.click();
      await humanDelay(2000, 5000);
    }
  } else {
    logger.info(`[EXECUTOR] Decided NOT to like the post.`);
  }

  // Close post overlay
  await page.keyboard.press('Escape');
  await microDelay();
}

/**
 * Simulates typing a DM character by character like a human
 */
export async function sendDM(page: Page, username: string, message: string) {
  logger.info(`[EXECUTOR] Initiating DM to @${username}`);
  
  // Go to direct message URL for safety and directness, though clicking "Message" is more human.
  // But Instagram direct URLs are standard: /direct/t/
  // Alternatively, click the 'Message' button on profile. Let's try clicking the button.
  
  const messageButton = page.locator('div[role="button"]:has-text("Mensagem"), div[role="button"]:has-text("Message")').first();
  if (await messageButton.isVisible()) {
    await messageButton.click();
  } else {
    // Fallback to URL
    await page.goto(`https://www.instagram.com/direct/new/`);
    await humanDelay(4000, 8000);
    
    // Type username in search
    const searchInput = page.locator('input[name="queryBox"]');
    await searchInput.fill(username);
    await humanDelay(2000, 4000);
    
    // Click the user in list
    const userRow = page.locator(`span:has-text("${username}")`).first();
    await userRow.click();
    await microDelay();
    
    // Click 'Next' or 'Chat'
    const nextButton = page.locator('div[role="button"]:has-text("Avançar"), div[role="button"]:has-text("Next")');
    await nextButton.click();
  }

  await humanDelay(4000, 9000); // Wait for chat to load

  const chatInput = page.locator('div[role="textbox"][aria-label="Mensagem"], div[role="textbox"][aria-label="Message"]');
  await chatInput.click();
  await microDelay(500, 1500);

  // Type like a human
  logger.debug(`[EXECUTOR] Typing message...`);
  for (const char of message.split('')) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 150) + 50 }); // 50-200ms per keystroke
    
    // Simulate thinking or typo correction rarely
    if (chance(0.02)) {
      await microDelay(500, 2000);
    }
  }

  await microDelay(1000, 3000); // Hesitation before sending
  
  // Press Enter to send
  logger.info(`[EXECUTOR] Message typed. Sending.`);
  await page.keyboard.press('Enter');
  
  // Wait after sending
  await humanDelay(3000, 6000);
}

export async function followUser(page: Page) {
  logger.info(`[EXECUTOR] Decided to FOLLOW user.`);
  const followButton = page.locator('button:has-text("Seguir"), button:has-text("Follow")').first();
  if (await followButton.isVisible()) {
    await followButton.click();
    await humanDelay(2000, 5000);
  }
}
