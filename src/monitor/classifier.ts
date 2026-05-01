import { callLLM } from '../analyzer/llm';
import { logger } from '../utils/logger';

export interface ClassificationResult {
  responseType: 'INTERESTED' | 'NEUTRAL' | 'REJECTED';
  temperature: 'HOT' | 'WARM' | 'COLD';
  summary: string;
}

const CLASSIFIER_PROMPT = `
Você é um especialista em qualificação de leads B2B (SDR).
Seu objetivo é analisar a resposta de um prospect (barbearia) à nossa mensagem de prospecção e classificá-la.

Retorne OBRIGATORIAMENTE um JSON com as seguintes chaves exatas:
- "responseType": "INTERESTED" (se quer saber mais, fez perguntas), "NEUTRAL" (resposta curta, "ok", "valeu"), ou "REJECTED" (não tem interesse, "não queremos", "já temos").
- "temperature": "HOT" (muito engajado, quer reunião), "WARM" (aberto a conversar, mas sem urgência), "COLD" (respondeu por educação ou sem dar continuidade).
- "summary": string (um resumo de 1 linha do que o lead disse).
`;

export async function classifyResponse(sentMessage: string, receivedMessage: string): Promise<ClassificationResult | null> {
  logger.info(`[CLASSIFIER] Classificando resposta usando LLM...`);
  
  const userPrompt = `
    Nossa Mensagem: "${sentMessage}"
    Resposta do Lead: "${receivedMessage}"
    
    Classifique esta interação.
  `;

  try {
    const responseStr = await callLLM(CLASSIFIER_PROMPT, userPrompt);
    const parsed = JSON.parse(responseStr);
    
    return {
      responseType: parsed.responseType,
      temperature: parsed.temperature,
      summary: parsed.summary
    };
  } catch (error) {
    logger.error(`[CLASSIFIER] Falha na classificação via LLM`, error);
    return null;
  }
}
