import { logger } from './logger';

/**
 * Generates a normally distributed random number using Box-Muller transform.
 * It's much more human-like than a flat Math.random() distribution.
 */
function randomNormal(min: number, max: number, skew: number = 1): number {
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  
  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  num = num / 10.0 + 0.5; // Translate to 0 -> 1
  
  if (num > 1 || num < 0) {
    num = randomNormal(min, max, skew); // resample between 0 and 1
  }
  
  num = Math.pow(num, skew); // Skew
  num *= max - min; // Stretch to fill range
  num += min; // offset to min
  return num;
}

/**
 * Standard delay with non-linear jitter
 */
export async function humanDelay(minMs: number = 20000, maxMs: number = 120000) {
  const delay = Math.floor(randomNormal(minMs, maxMs, 1.2));
  logger.debug(`[TIMING] Human delay: waiting for ${(delay / 1000).toFixed(1)}s`);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Small delay for micro-interactions (clicks, typing pauses)
 */
export async function microDelay(minMs: number = 500, maxMs: number = 3000) {
  const delay = Math.floor(randomNormal(minMs, maxMs, 0.8));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Occasional long pause to simulate stepping away from the device.
 * 5% chance to trigger a 5 to 15 minute pause.
 */
export async function occasionalLongPause(probability: number = 0.05) {
  if (Math.random() < probability) {
    const pauseMs = Math.floor(randomNormal(5 * 60 * 1000, 15 * 60 * 1000));
    logger.info(`[TIMING] ☕ Occasional long pause triggered. Stepping away for ${(pauseMs / 60000).toFixed(1)} minutes...`);
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    logger.info(`[TIMING] ☕ Back to work.`);
  }
}

/**
 * Returns true with the given probability (0.0 to 1.0)
 */
export function chance(probability: number): boolean {
  return Math.random() < probability;
}
