import { startWorker } from "./queue/workers";
import { runMonitor } from "./monitor";
import { prospectingQueue } from "./queue";
import { initMemory } from "./memory";
import { logger } from "./utils/logger";
import { startDashboard } from "./dashboard";

async function start() {
  logger.info("🚀 Iniciando sistema AI Prospecting Engine...");

  // 1. Inicializa dependências críticas
  await initMemory(); // Garante que o Qdrant Vector DB exista
  
  // 2. Inicia os Workers
  startWorker();
  logger.info("✅ Workers ativos e escutando a fila");

  // 3. Inicia o Dashboard Web
  startDashboard(3000);

  // 4. Dispara coleta inicial
  await seedCollection();

  // 5. Monitor com intervalo randômico
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

async function seedCollection() {
  logger.info("🌱 Semeando jobs de extração (Modo: CURTIDAS em posts de barbearias)...");
  
  // Posts de barbearias/barbeiros relevantes - curtidores são leads mais engajados
  const targetPosts = [
    "https://www.instagram.com/p/DXrUCKLjoM4/",
    // Adicione mais URLs de posts de barbearias aqui
  ];

  for (const postUrl of targetPosts) {
    await prospectingQueue.add("COLLECT_PROFILE", {
      source: "likes",
      postUrl,
    });
  }
}

start().catch(err => {
  logger.error("❌ Falha fatal ao iniciar o sistema", err);
  process.exit(1);
});
