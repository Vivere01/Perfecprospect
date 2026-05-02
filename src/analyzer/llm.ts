import { env } from '../config/env';
import { logger } from '../utils/logger';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * Gera embeddings usando hash simples (não depende de API externa).
 * Isso evita a necessidade de OpenAI para embeddings.
 * Para produção com muitos leads, considere usar um modelo de embedding dedicado.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  // Simple hash-based embedding (deterministic, fast, no API call needed)
  const vector = new Array(1536).fill(0);
  
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const idx = (charCode * (i + 1) * 31) % 1536;
    vector[idx] += (charCode / 255) * 0.1;
    // Spread influence to nearby dimensions
    vector[(idx + 1) % 1536] += (charCode / 255) * 0.05;
    vector[(idx + 2) % 1536] += (charCode / 255) * 0.02;
  }

  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum: number, val: number) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

/**
 * Chama a API do DeepSeek (usando a interface compatível com OpenAI)
 */
export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = env.DEEPSEEK_API_KEY;
  
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY não configurada');
  }

  logger.debug(`[LLM] Calling DeepSeek API...`);

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    logger.error(`[LLM] DeepSeek API error ${response.status}: ${errorBody}`);
    throw new Error(`DeepSeek API failed: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

