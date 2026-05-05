import { startWorker } from "./queue/workers";
import { runMonitor } from "./monitor";
import { prospectingQueue } from "./queue";
import { initMemory } from "./memory";
import { logger } from "./utils/logger";
import { startDashboard, seedBlacklist } from "./dashboard";

async function start() {
  logger.info("🚀 Iniciando sistema AI Prospecting Engine...");

  // 1. Inicializa dependências críticas
  await initMemory(); // Garante que o Qdrant Vector DB exista

  // 2. Popula a lista de exclusão com perfis conhecidos/clientes
  await seedBlacklist();
  
  // 3. Inicia os Workers
  startWorker();
  logger.info("✅ Workers ativos e escutando a fila");

  // 4. Inicia o Dashboard Web
  startDashboard(3000);

  // 5. Dispara coleta inicial
  await seedCollection();

  // 6. Monitor com intervalo randômico
  startMonitorLoop();

  // 6. Health check
  setInterval(() => {
    logger.debug(`🧠 Sistema ativo: ${new Date().toISOString()}`);
  }, 60000);
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

  // Já dispara uma primeira vez (sem delay longo) para limpar o backlog inicial
  setTimeout(async () => {
    await runMonitor();
    loop();
  }, 5000); 
}

import { discoverRecentPosts } from "./collector";

async function seedCollection() {
  logger.info("🌱 Iniciando rotina automática de Semeação de concorrentes...");
  
  // Aqui você define os @ dos concorrentes de sucesso que deseja monitorar.
  // A IA vai visitar o perfil deles automaticamente, extrair os 3 posts mais recentes
  // e coletar os likers desses posts!
  const targetCompetitors = [
    "https://www.instagram.com/barbeariacorleone/",
    "https://www.instagram.com/seuelias/",
    // Adicione mais URLs de perfis de barbearias grandes aqui
  ];

  for (const profileUrl of targetCompetitors) {
    // 1. Descobre os 3 posts mais recentes do concorrente
    const recentPosts = await discoverRecentPosts(profileUrl, 3);
    
    // 2. Coloca os posts na fila para extrair os likers
    for (const postUrl of recentPosts) {
      await prospectingQueue.add("COLLECT_PROFILE", {
        source: "likes",
        postUrl,
      });
    }
  }

  // Agenda para rodar novamente daqui a 24 horas para coletar NOVOS likers desses mesmos posts (ou novos que você adicionar)
  setTimeout(() => {
    seedCollection();
  }, 24 * 60 * 60 * 1000); // 24 horas
}

start().catch(err => {
  logger.error("❌ Falha fatal ao iniciar o sistema", err);
  process.exit(1);
});
