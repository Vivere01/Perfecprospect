import { getBrowserSession } from '../config/browser';
import { logger } from '../utils/logger';
import { chance, occasionalLongPause, humanDelay } from '../utils/timing';
import { openProfile, viewStories, viewAndMaybeLikePost, sendDM, followUser } from './actions';

export interface ExecutorOptions {
  username: string;
  message: string;
  accountId?: string;
}

/**
 * Main entry point for the Executor module.
 * Executes a completely randomized, human-like workflow on a target profile.
 */
export async function executeInteractionWorkflow(options: ExecutorOptions) {
  logger.info(`[EXECUTOR] Starting workflow for target: @${options.username}`);
  
  // 1. Get persistent session
  const { page, close } = await getBrowserSession(options.accountId);

  try {
    // 2. Open Profile and Simulate Reading
    const profileExists = await openProfile(page, options.username);
    if (!profileExists) {
      logger.warn(`[EXECUTOR] Aborting workflow: Profile @${options.username} invalid or private.`);
      return { success: false, reason: 'PROFILE_INVALID' };
    }

    // 3. Occasional Long Pause (simulate distraction)
    await occasionalLongPause(0.05);

    // 4. View Stories (80% chance if they exist, handled in action)
    if (chance(0.8)) {
      await viewStories(page);
    }

    // 5. View Posts and Maybe Like (60% chance to open a post, 70% inside to like)
    if (chance(0.6)) {
      await viewAndMaybeLikePost(page, 0.7);
    }

    // 6. Maybe Follow (40% chance)
    if (chance(0.4)) {
      await followUser(page);
    }

    // 7. Send DM (The core objective)
    // Add extra pause before DM to simulate "deciding" to message
    await humanDelay(10000, 25000); 
    await sendDM(page, options.username, options.message);

    logger.info(`[EXECUTOR] Workflow completed successfully for @${options.username}`);
    return { success: true };
    
  } catch (error: any) {
    logger.error(`[EXECUTOR] Workflow failed for @${options.username}`, error);
    return { success: false, reason: error.message };
  } finally {
    // 8. Always close and save session state
    await close();
    logger.info(`[EXECUTOR] Session closed safely.`);
  }
}
