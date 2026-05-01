import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Retorna os embeddings para o Vector DB (Qdrant).
 * Nota: DeepSeek foca em Chat. Mantemos a OpenAI para embeddings ou 
 * você pode usar um modelo open-source local via HuggingFace/Ollama se preferir.
 * Se o DeepSeek lançar endpoint de embeddings, basta trocar a URL e o modelo.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (!env.OPENAI_API_KEY) {
    logger.warn('[LLM] OPENAI_API_KEY ausente. Embeddings podem falhar se não houver fallback configurado.');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Chama a API do DeepSeek V4 (usando a interface compatível com OpenAI)
 */
export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  // A API do DeepSeek é totalmente compatível com o formato da OpenAI
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat', // ou 'deepseek-reasoner' para V4 com Chain of Thought profundo
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
