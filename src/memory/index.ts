import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getEmbedding } from '../analyzer/llm';

// Qdrant Client configuration
export const qdrant = new QdrantClient({
  url: env.QDRANT_URL,
  apiKey: env.QDRANT_API_KEY,
});

const COLLECTION_NAME = 'prospecting_memory';

export interface MemoryRecord {
  leadId: string;
  username: string;
  bio: string;
  decision: 'APPROVED' | 'REJECTED';
  result?: 'RESPONDED' | 'IGNORED' | 'CONVERTED';
  messageSent?: string;
  responseReceived?: string;
  responseType?: string;
}

/**
 * Módulo MEMORY: Inicializa a coleção no Vector DB caso não exista.
 */
export async function initMemory() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
    
    if (!exists) {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 1536, // embedding dimension
          distance: 'Cosine'
        }
      });
      logger.info(`[MEMORY] Created Qdrant collection: ${COLLECTION_NAME}`);
    }
  } catch (err) {
    logger.error(`[MEMORY] Failed to initialize Qdrant`, err);
  }
}

/**
 * Salva uma nova memória (perfil + decisão + resultado)
 */
export async function saveMemory(record: MemoryRecord) {
  try {
    const textToEmbed = `Profile: @${record.username}. Bio: ${record.bio}. Message: ${record.messageSent || 'None'}`;
    const vector = await getEmbedding(textToEmbed);

    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: record.leadId,
          vector,
          payload: { ...record }
        }
      ]
    });
    logger.debug(`[MEMORY] Saved memory for @${record.username}`);
  } catch (err) {
    logger.error(`[MEMORY] Error saving memory for @${record.username}`, err);
  }
}

/**
 * Atualiza o VectorDB com a resposta do lead, para fechar o loop de aprendizado
 */
export async function updateMemoryWithResponse(record: MemoryRecord) {
  try {
    // Recriar o vetor semântico agora incluindo o que recebemos e se deu certo
    const textToEmbed = `Profile: @${record.username}. Bio: ${record.bio}. Sent: ${record.messageSent}. Received: ${record.responseReceived}. Outcome: ${record.responseType}`;
    const vector = await getEmbedding(textToEmbed);

    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: record.leadId, // Usa o mesmo UUID para sobrescrever/atualizar o ponto
          vector,
          payload: { ...record }
        }
      ]
    });
    logger.info(`[MEMORY] Updated memory loop for @${record.username} with outcome: ${record.responseType}`);
  } catch (err) {
    logger.error(`[MEMORY] Error updating memory with response`, err);
  }
}

/**
 * Busca perfis similares para servir de contexto
 */
export async function searchSimilarMemories(bio: string, limit: number = 3): Promise<MemoryRecord[]> {
  try {
    const vector = await getEmbedding(`Profile Bio: ${bio}`);
    
    const searchResult = await qdrant.search(COLLECTION_NAME, {
      vector,
      limit,
      filter: {
        must: [
          {
            key: "decision",
            match: { value: "APPROVED" }
          }
        ]
      }
    });

    return searchResult.map(p => p.payload as unknown as MemoryRecord);
  } catch (err) {
    logger.error(`[MEMORY] Error searching memories`, err);
    return [];
  }
}
