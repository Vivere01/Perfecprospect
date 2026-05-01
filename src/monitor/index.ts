import { getBrowserSession } from '../config/browser';
import { logger } from '../utils/logger';
import { humanDelay, microDelay, occasionalLongPause } from '../utils/timing';
import { prisma } from '../db';
import { classifyResponse } from './classifier';
import { updateMemoryWithResponse } from '../memory';

export interface MonitorOptions {
  accountId?: string;
}

/**
 * Lê a Inbox do Instagram de forma stealth, verifica mensagens não lidas
 * e atualiza o funil de aprendizado contínuo.
 */
export async function runMonitor(options: MonitorOptions = {}) {
  logger.info(`[MONITOR] Iniciando verificação de Inbox...`);
  const { page, close } = await getBrowserSession(options.accountId);

  try {
    // 1. Marca leads antigos (> 48h sem resposta) como IGNORADOS
    await markIgnoredLeads();

    // 2. Acessa a Inbox com delay humano
    await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded' });
    await humanDelay(5000, 10000); // Carregamento da inbox
    await occasionalLongPause(0.05);

    // O Instagram tem um seletor para mensagens não lidas (bolinha azul)
    // Vamos procurar por conversas que tenham indicativo de nova mensagem
    // (A estrutura do DOM muda muito, vamos procurar por role="listitem" e ver se tem indicativo não lido)
    const chatRows = page.locator('div[role="listitem"]');
    const count = await chatRows.count();
    
    if (count === 0) {
      logger.info(`[MONITOR] Nenhuma conversa encontrada na tela inicial.`);
      return;
    }

    let unreadProcessed = 0;

    // Lemos apenas os 5 a 10 primeiros para evitar padrão de robô que varre a lista toda
    const maxToRead = Math.min(count, Math.floor(Math.random() * 5) + 5);

    for (let i = 0; i < maxToRead; i++) {
      const row = chatRows.nth(i);
      
      // Checa se parece não lida (geralmente tem um elemento com um span de notificação)
      // Em uma implementação 100% perfeita, extrairíamos a flag. Vamos assumir que vamos
      // clicar em algumas recentes para checar.
      
      const unreadBadge = row.locator('span[aria-label*="não lida"], span[aria-label*="unread"], div:has(> span[data-visualcompletion="ignore"])').first();
      
      const isUnread = await unreadBadge.isVisible().catch(() => false);
      
      if (isUnread || Math.random() < 0.2) { // 20% de chance de clicar mesmo em lidas para mascarar
        await row.click();
        await humanDelay(3000, 6000); // Tempo para ler a conversa

        // Extrai o username atual do header do chat
        const headerUsernameLocator = page.locator('div[role="button"] span:has-text("")').first(); // Simplificação
        // Idealmente pegar a URL que muda para /direct/t/{id}/ ou o nome
        const currentUrl = page.url();
        
        // Simular leitura das mensagens
        const messages = page.locator('div[dir="auto"][role="none"]'); // Box de mensagens
        const msgCount = await messages.count();
        
        if (msgCount > 0) {
          const lastMessage = await messages.nth(msgCount - 1).textContent();
          
          // Precisamos do username real para mapear no DB. No DOM do IG é complexo.
          // Vamos extrair do título da página ou cabeçalho do chat:
          const chatTitle = await page.title();
          const usernameMatch = chatTitle.replace(' • Instagram', '').replace(/ \(@.+?\)/, '').trim(); 
          // (Ex: "Barbearia Vivere (@barbearia_vivere) • Instagram" ou "Barbearia Vivere • Instagram")
          // Na prática, buscaríamos no DOM do header do chat o href="/username/".
          const profileLink = page.locator('a[href^="/"][role="link"]').nth(1); // Usually header link
          const href = await profileLink.getAttribute('href').catch(() => null);
          const username = href ? href.replace(/\//g, '') : null;

          if (username && lastMessage) {
            await processLeadResponse(username, lastMessage);
            unreadProcessed++;
          }
        }

        // Pressionar Esc para fechar o chat ou voltar
        await microDelay(1000, 2000);
      }
      
      // Limite de segurança: nunca processar mais de 3 novas DMs por ciclo de monitor
      if (unreadProcessed >= 3) break;
    }

    logger.info(`[MONITOR] Inbox verificada. ${unreadProcessed} respostas novas processadas.`);

  } catch (error) {
    logger.error(`[MONITOR] Erro ao ler Inbox`, error);
  } finally {
    await close();
  }
}

/**
 * Processa a resposta usando IA e atualiza o DB e a Memória
 */
async function processLeadResponse(username: string, receivedMessage: string) {
  logger.info(`[MONITOR] Processando resposta de @${username}`);

  const lead = await prisma.lead.findUnique({
    where: { username },
    include: { interactions: true }
  });

  if (!lead || lead.status === 'RESPONDED') return; // Já foi tratado antes

  // Pega a última mensagem enviada por nós para ter contexto
  const lastInteraction = lead.interactions.filter(i => i.type === 'DIRECT_MESSAGE').pop();
  const sentMessage = lastInteraction?.content || '';

  // Classifica a Resposta via DeepSeek V4
  const classification = await classifyResponse(sentMessage, receivedMessage);

  if (classification) {
    // 1. Atualiza DB relacional
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: 'RESPONDED',
        responseType: classification.responseType,
        temperature: classification.temperature,
        respondedAt: new Date()
      }
    });

    // 2. Atualiza Vector DB (Aprendizado Contínuo da Memória)
    await updateMemoryWithResponse({
      leadId: lead.id,
      username: lead.username,
      bio: lead.bio || '',
      decision: 'APPROVED',
      result: 'RESPONDED',
      messageSent: sentMessage,
      responseReceived: receivedMessage,
      responseType: classification.responseType
    });

    logger.info(`[MONITOR] Classificação para @${username}: ${classification.temperature} / ${classification.responseType}`);
  }
}

/**
 * Limpa o pipeline marcando quem ignorou a gente há mais de 48h
 */
async function markIgnoredLeads() {
  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
  
  const ignoredLeads = await prisma.lead.findMany({
    where: {
      status: 'CONTACTED',
      updatedAt: { lte: threshold },
      isIgnored: false
    }
  });

  for (const lead of ignoredLeads) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { isIgnored: true }
    });

    // Atualiza a memória para ensinar a IA que aquela abordagem para aquele perfil FALHOU
    await updateMemoryWithResponse({
      leadId: lead.id,
      username: lead.username,
      bio: lead.bio || '',
      decision: 'APPROVED',
      result: 'IGNORED',
      messageSent: 'Mensagem enviada (Não salva na íntegra no momento)',
      responseReceived: 'NENHUMA (Ignorado)',
      responseType: 'REJECTED' // Tratamos silêncio como rejeição para o peso do Vector DB
    });
  }

  if (ignoredLeads.length > 0) {
    logger.info(`[MONITOR] ${ignoredLeads.length} leads marcados como IGNORADOS (>48h sem resposta). Memória atualizada para aprender com o erro.`);
  }
}
