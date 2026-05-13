import { startWorker } from "./queue/workers";
import { runMonitor } from "./monitor";
import { prospectingQueue, interactionQueue } from "./queue";
import { initMemory } from "./memory";
import { logger } from "./utils/logger";
import { startDashboard, seedBlacklist } from "./dashboard";
import { discoverRecentPosts } from "./collector";
import { prisma } from "./db";

// ─── Competidores a monitorar (agora vindos do banco, estes são apenas fallbacks) ─────────────
const TARGET_COMPETITORS = [
  "https://www.instagram.com/barbeariacorleone/",
  "https://www.instagram.com/seuelias/",
];

// ─── Horário do CRON diário (formato cron: "minuto hora * * *") ────────────
// Padrão: todo dia às 08:00 (horário UTC-3 = 11:00 UTC)
const DAILY_CRON = "0 */4 * * *"; // A cada 4 horas

async function start() {
  logger.info("🚀 Iniciando sistema AI Prospecting Engine...");

  // 1. Inicializa dependências críticas
  await initMemory();

  // 2. Blacklist inicial e Perfis de Referência
  await seedBlacklist();
  await seedReferenceProfiles();

  // 3. Registra o CRON diário de coleta (persistido no Redis — sobrevive a reinicializações)
  await registerDailyCronJobs();

  // 4. Inicia os Workers
  startWorker();
  logger.info("✅ Workers ativos e escutando a fila");

  // 5. Dashboard Web
  startDashboard(3000);

  // 6. Dispara coleta imediatamente na primeira inicialização
  logger.info("🌱 Disparo inicial de coleta...");
  await triggerCollection();

  // 7. Monitor de conversas (a cada 2~3h)
  startMonitorLoop();

  // 8. Health check log
  setInterval(() => {
    logger.debug(`🧠 Sistema ativo: ${new Date().toISOString()}`);
  }, 60000);
}

async function seedReferenceProfiles() {
  for (const url of TARGET_COMPETITORS) {
    const username = url.split("instagram.com/")[1].replace("/", "");
    await prisma.referenceProfile.upsert({
      where: { username },
      update: {},
      create: { username, url, type: "COMPETITOR" }
    });
  }
  logger.info(`[SEED] Perfis de referência iniciais garantidos.`);
}

/**
 * Registra dois jobs repetíveis no BullMQ (CRON baseado em Redis):
 * - DAILY_SEED: coleta leads dos competidores todo dia no horário fixo
 * - DAILY_DM_FLUSH: reprocessa leads APPROVED que ainda não receberam DM
 * 
 * O BullMQ persiste esses jobs no Redis, então eles sobrevivem a
 * reinicializações do container sem perder o agendamento.
 */
async function registerDailyCronJobs() {
  // Remove schedules antigas para evitar duplicatas ao reiniciar
  const existingRepeatable = await prospectingQueue.getRepeatableJobs();
  for (const job of existingRepeatable) {
    await prospectingQueue.removeRepeatableByKey(job.key);
    logger.info(`[CRON] Job repetível removido: ${job.key}`);
  }

  // CRON 1: Coleta diária de novos leads
  await prospectingQueue.add(
    "DAILY_SEED",
    { competitors: TARGET_COMPETITORS },
    {
      repeat: { pattern: DAILY_CRON },
      jobId: "daily-seed-cron",
    }
  );
  logger.info(`[CRON] ✅ Coleta diária agendada: ${DAILY_CRON} (08:00 BRT)`);

  // CRON 2: Flush de DMs para leads APPROVED sem interação (todo dia 30min depois da coleta)
  await prospectingQueue.add(
    "DAILY_DM_FLUSH",
    {},
    {
      repeat: { pattern: "30 11 * * *" }, // 08:30 BRT
      jobId: "daily-dm-flush-cron",
    }
  );
  logger.info(`[CRON] ✅ Flush de DMs agendado: 08:30 BRT`);
}

/**
 * Executa a coleta real: visita os perfis competidores,
 * extrai posts recentes e enfileira os likers para análise.
 */
export async function triggerCollection(customCompetitors?: string[]) {
  let competitors: string[] = [];

  if (customCompetitors && customCompetitors.length > 0) {
    competitors = customCompetitors;
  } else {
    const dbProfiles = await prisma.referenceProfile.findMany();
    competitors = dbProfiles.map(p => p.url);
  }

  if (competitors.length === 0) {
    logger.warn(`[SEED] Nenhum perfil de referência encontrado. Usando fallbacks.`);
    competitors = TARGET_COMPETITORS;
  }

  logger.info(`[SEED] Iniciando coleta de ${competitors.length} perfis competidores...`);
  let totalPosts = 0;

  for (const profileUrl of competitors) {
    try {
      const recentPosts = await discoverRecentPosts(profileUrl, 5);
      logger.info(`[SEED] ${profileUrl} → ${recentPosts.length} posts encontrados`);

      for (const postUrl of recentPosts) {
        await prospectingQueue.add("COLLECT_PROFILE", {
          source: "likes",
          postUrl,
        });
        totalPosts++;
      }

      // NOVO: IA vasculha perfis semelhantes para expandir a rede de referências
      await prospectingQueue.add("DISCOVER_REFERENCES", {
        profileUrl,
      });

      // Atualiza timestamp de coleta no BD
      const username = profileUrl.split("instagram.com/")[1].replace("/", "");
      await prisma.referenceProfile.update({
        where: { username },
        data: { lastCollectedAt: new Date() }
      });

    } catch (err) {
      logger.error(`[SEED] Erro ao processar competidor ${profileUrl}:`, err);
    }
  }

  logger.info(`[SEED] ✅ ${totalPosts} posts enfileirados para coleta de likers.`);
}

/**
 * Reprocessa leads que foram aprovados pela IA mas não receberam DM ainda.
 * Isso resolve o bug de condição de corrida onde o lead foi aprovado
 * mas a interação não foi criada.
 */
export async function flushPendingDMs() {
  logger.info(`[DM_FLUSH] Verificando leads APPROVED sem DM enviada...`);

  const config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
  if (!config?.dmScript) {
    logger.warn(`[DM_FLUSH] ⚠️ Nenhum script de DM configurado no dashboard. Configure antes de enviar.`);
    return;
  }

  // Busca leads aprovados que nunca tiveram interação
  const pendingLeads = await prisma.lead.findMany({
    where: {
      status: "APPROVED",
      interactions: { none: {} },
    },
    take: 30, // Limite diário
  });

  logger.info(`[DM_FLUSH] ${pendingLeads.length} leads aprovados sem DM encontrados.`);

  for (const lead of pendingLeads) {
    const message = config.dmScript.replace(/@\{username\}/g, `@${lead.username}`);

    // Cria interação PENDING no banco
    const interaction = await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: "DIRECT_MESSAGE",
        content: message,
        status: "PENDING",
      },
    });

    // Enfileira na fila de interações com delay aleatório (humaniza)
    await interactionQueue.add(
      "EXECUTE_INTERACTION",
      {
        interactionId: interaction.id,
        leadId: lead.id,
        username: lead.username,
        message,
      },
      {
        delay: Math.floor(Math.random() * 120000), // spread de 2 min (mais rápido para teste manual)
      }
    );

    logger.info(`[DM_FLUSH] 📤 DM enfileirada para @${lead.username}`);
  }

  logger.info(`[DM_FLUSH] ✅ ${pendingLeads.length} DMs enfileiradas com sucesso.`);
}

function startMonitorLoop() {
  async function loop() {
    const delay = Math.random() * (3 - 2) + 2; // 2h a 3h
    logger.info(`⏳ Próximo monitor em ${delay.toFixed(2)} horas`);
    setTimeout(async () => {
      await runMonitor();
      loop();
    }, delay * 60 * 60 * 1000);
  }

  setTimeout(async () => {
    await runMonitor();
    loop();
  }, 5000);
}

start().catch(err => {
  logger.error("❌ Falha fatal ao iniciar o sistema", err);
  process.exit(1);
});
