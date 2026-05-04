import { getBrowserSession } from '../config/browser';
import { logger } from '../utils/logger';
import { humanDelay } from '../utils/timing';

export async function fetchProfileInfo(username: string, accountId?: string) {
  logger.info(`[FETCHER] Fetching profile info for @${username}`);
  const { page, close } = await getBrowserSession(accountId);

  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await humanDelay(3000, 6000);

    const header = page.locator('header');
    if (!await header.isVisible({ timeout: 10000 })) {
      return null;
    }

    // Extrair dados
    const bio = await page.locator('header section div:nth-child(3) span').first().innerText().catch(() => '');
    const fullName = await page.locator('header section div:nth-child(3) h1, header section div:nth-child(3) span').first().innerText().catch(() => '');
    
    // Seguidores (ajustar seletor se necessário)
    const stats = await page.locator('header section ul li').evaluateAll(els => {
      return els.map(el => (el as HTMLElement).innerText.toLowerCase());
    });

    let followersCount = 0;
    const followersText = stats.find(s => s.includes('seguidor') || s.includes('follower'));
    if (followersText) {
      const match = followersText.match(/([\d.,KMB]+)/);
      if (match) {
        let val = match[1].replace(/[.,]/g, '');
        if (val.includes('k')) val = (parseFloat(val) * 1000).toString();
        if (val.includes('m')) val = (parseFloat(val) * 1000000).toString();
        followersCount = parseInt(val) || 0;
      }
    }

    const profileUrl = `https://www.instagram.com/${username}/`;

    return {
      username,
      fullName,
      bio,
      followersCount,
      profileUrl,
      isPrivate: await page.locator('text="Esta conta é privada"').isVisible() || await page.locator('text="This account is private"').isVisible()
    };

  } catch (error) {
    logger.error(`[FETCHER] Error fetching @${username}:`, error);
    return null;
  } finally {
    await close();
  }
}
