import { logger } from '../utils/logger';
import { runFilter, FilterInput } from '../filter';
import { searchSimilarMemories, saveMemory } from '../memory';
import { callLLM } from './llm';
import { prisma } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface AnalyzerInput extends FilterInput {
  accountId?: string;
  persona?: 'AGGRESSIVE' | 'FRIENDLY' | 'CONSULTATIVE';
}

export interface AnalyzerResult {
  passed: boolean;
  score?: number;
  message?: string;
  reason?: string;
}

const SYSTEM_PROMPT = `
Você é um prospector de vendas B2B focado em barbearias premium.
Sua tarefa é analisar o perfil do Instagram e decidir se é um bom lead.
Bons leads:
- Parecem ser barbearias estruturadas ou donos de barbearia (não apenas barbeiros autônomos de garagem).
- Focam na experiência do cliente.
- Parecem ter agenda ou buscam crescer a equipe.

Retorne OBRIGATORIAMENTE um JSON com as chaves:
- "decision": boolean (true se deve prospectar, false caso contrário)
- "score": number de 0 a 10 (baseado na qualidade percebida)
- "reason": string explicando brevemente o porquê
- "message": string com uma mensagem curta de DM (máx 2 frases, natural, informal, focada em gerar conexão e NUNCA parecendo um bot ou oferta direta de venda). Deixe vazio se decision for false.

Exemplo de mensagem: "Fala mestre, curti demais o espaço da barbearia! Vocês estão usando algum sistema para agendamento ou é no WhatsApp mesmo?"
`;

export async function runAnalyzer(input: AnalyzerInput): Promise<AnalyzerResult> {
  logger.info(`[ANALYZER] Starting analysis for @${input.username}`);

  // 1. OBRIGATÓRIO: Passar pelo filtro Rápido primeiro (Custo $0)
  const filterResult = await runFilter(input);
  if (!filterResult.passed) {
    logger.info(`[ANALYZER] @${input.username} failed filter. Reason: ${filterResult.reason}`);
    
    // Save rejection in DB
    await prisma.lead.upsert({
      where: { username: input.username },
      create: {
        username: input.username,
        followersCount: input.followersCount,
        bio: input.bio,
        status: 'FILTERED_OUT',
        filterReason: filterResult.reason
      },
      update: { status: 'FILTERED_OUT', filterReason: filterResult.reason }
    });

    return { passed: false, reason: filterResult.reason };
  }

  // 2. Busca Contexto (LLM Wiki - Qdrant)
  const bio = input.bio || '';
  const contextMemories = await searchSimilarMemories(bio, 2);
  let contextStr = '';
  if (contextMemories.length > 0) {
    contextStr = `\nContexto Histórico (Decisões anteriores semelhantes):\n`;
    contextMemories.forEach(m => {
      contextStr += `- Perfil: ${m.bio} -> Resultado: ${m.result || 'UNKNOWN'}. Mensagem usada: ${m.messageSent}\n`;
    });
    contextStr += `Baseie-se nesses casos para ajustar a abordagem. Se a mensagem anterior ignorou, tente outro estilo. Persona: ${input.persona || 'FRIENDLY'}.\n`;
  }

  // 3. Monta Prompt
  const userPrompt = `
    Perfil: @${input.username}
    Nome: ${input.fullName || 'N/A'}
    Seguidores: ${input.followersCount}
    Bio: ${bio}
    ${contextStr}
  `;

  try {
    // 4. Chama a LLM
    const llmResponse = await callLLM(SYSTEM_PROMPT, userPrompt);
    const parsed = JSON.parse(llmResponse);

    // 5. Salva a Decisão no Banco
    const lead = await prisma.lead.upsert({
      where: { username: input.username },
      create: {
        id: uuidv4(),
        username: input.username,
        followersCount: input.followersCount,
        bio: input.bio,
        status: parsed.decision ? 'APPROVED' : 'REJECTED',
        analysisScore: parsed.score,
        analysisSummary: parsed.reason,
      },
      update: {
        status: parsed.decision ? 'APPROVED' : 'REJECTED',
        analysisScore: parsed.score,
        analysisSummary: parsed.reason,
      }
    });

    // 6. Salva na Memória Vetorial (LLM Wiki)
    await saveMemory({
      leadId: lead.id,
      username: lead.username,
      bio: lead.bio || '',
      decision: parsed.decision ? 'APPROVED' : 'REJECTED',
      messageSent: parsed.message
    });

    logger.info(`[ANALYZER] Finished @${input.username}. Decision: ${parsed.decision}, Score: ${parsed.score}`);

    return {
      passed: parsed.decision,
      score: parsed.score,
      reason: parsed.reason,
      message: parsed.message
    };

  } catch (error: any) {
    logger.error(`[ANALYZER] Failed to analyze @${input.username}`, error);
    return { passed: false, reason: 'LLM_ERROR' };
  }
}
