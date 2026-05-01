import { prisma } from '../db';
import { logger } from '../utils/logger';

export interface FilterInput {
  username: string;
  fullName?: string;
  bio?: string;
  followersCount: number;
}

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

const POSITIVE_KEYWORDS = ['barber', 'barbearia', 'corte', 'fade', 'barbeiro'];
const NEGATIVE_KEYWORDS = ['curso', 'mentor', 'iniciante', 'aula', 'workshop'];

/**
 * Módulo FILTER: Pré-filtro rápido sem custo de IA.
 * Elimina leads ruins antes de chamar a OpenAI.
 */
export async function runFilter(lead: FilterInput): Promise<FilterResult> {
  logger.debug(`[FILTER] Analyzing @${lead.username}`);

  // 1. Check if already processed (exists in Lead table and status not COLLECTED)
  const existingLead = await prisma.lead.findUnique({
    where: { username: lead.username }
  });

  if (existingLead && existingLead.status !== 'COLLECTED') {
    return { passed: false, reason: 'ALREADY_PROCESSED' };
  }

  // 2. Check Blacklist
  const isBlacklisted = await prisma.blacklist.findUnique({
    where: { username: lead.username }
  });

  if (isBlacklisted) {
    return { passed: false, reason: 'BLACKLISTED' };
  }

  // 3. Minimum Followers (Must have some social proof to be a structured business)
  if (lead.followersCount < 500) {
    return { passed: false, reason: 'LOW_FOLLOWERS' };
  }

  const bioLower = (lead.bio || '').toLowerCase();
  const nameLower = (lead.fullName || '').toLowerCase();
  const combinedText = `${bioLower} ${nameLower}`;

  // 4. Negative Keywords (Ex: "Curso de barbeiro")
  const hasNegative = NEGATIVE_KEYWORDS.some(word => combinedText.includes(word));
  if (hasNegative) {
    return { passed: false, reason: 'NEGATIVE_KEYWORD' };
  }

  // 5. Positive Keywords (Must be a barbershop, not just a random person)
  const hasPositive = POSITIVE_KEYWORDS.some(word => combinedText.includes(word));
  if (!hasPositive) {
    return { passed: false, reason: 'NO_POSITIVE_KEYWORD' };
  }

  logger.info(`[FILTER] @${lead.username} passed all filters.`);
  return { passed: true };
}
