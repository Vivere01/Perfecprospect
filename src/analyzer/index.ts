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
Sua tarefa é analisar o perfil do Instagram e decidir se é um TOMADOR DE DECISÃO (Dono, Fundador, CEO, Sócio ou Mentor de Barbeiros).

Bons leads (Decision: true):
- A bio diz "Fundador de @nomedabarbearia", "Dono da @...", "Proprietário", "CEO", "Mentor de Barbeiros".
- O perfil parece ser de um EMPRESÁRIO do ramo e não apenas um barbeiro operacional.
- Menciona um endereço físico ou link de agendamento de uma empresa.
- Mentores de barbeiros são EXCELENTES leads.

Leads ruins (Decision: false):
- Apenas barbeiros autônomos sem indicação de sociedade/propriedade.
- Perfis de "Estudante de barbearia", "Iniciante", ou focados apenas em postar fotos de cortes sem cunho empresarial.
- Clientes finais (pessoas procurando corte).

Retorne OBRIGATORIAMENTE um JSON com as chaves:
- "decision": boolean (true se for dono/mentor, false caso contrário)
- "score": number de 0 a 10
- "reason": string explicando brevemente (ex: "Fundador da barbearia X")
- "message": string com uma mensagem curta e informal para gerar conexão.
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

    // 5. Busca Script Customizado (Novo!)
    const config = await prisma.systemConfig.findUnique({ where: { id: 'default' } });
    let finalMessage = parsed.message;
    
    if (config && config.dmScript) {
      finalMessage = config.dmScript.replace(/@\{username\}/g, `@${input.username}`);
      logger.info(`[ANALYZER] Using custom script for @${input.username}`);
    }

    // 6. Salva a Decisão no Banco
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

    // 7. Salva na Memória Vetorial (LLM Wiki)
    await saveMemory({
      leadId: lead.id,
      username: lead.username,
      bio: lead.bio || '',
      decision: parsed.decision ? 'APPROVED' : 'REJECTED',
      messageSent: finalMessage
    });

    logger.info(`[ANALYZER] Finished @${input.username}. Decision: ${parsed.decision}, Score: ${parsed.score}`);

    return {
      passed: parsed.decision,
      score: parsed.score,
      reason: parsed.reason,
      message: finalMessage
    };

  } catch (error: any) {
    logger.error(`[ANALYZER] Failed to analyze @${input.username}`, error);
    return { passed: false, reason: 'LLM_ERROR' };
  }
}
