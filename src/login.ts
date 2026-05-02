import { getBrowserSession } from './config/browser';
import { logger } from './utils/logger';
import { humanDelay } from './utils/timing';

process.env.BROWSER_HEADLESS = 'false';

async function runLogin() {
  logger.info('🚀 Iniciando login manual para autenticação (2FA)...');
  
  // Abre o navegador em modo HEADED (com janela)
  const { page, close } = await getBrowserSession('default');

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
    
    logger.info('⚠️  POR FAVOR, FAÇA O LOGIN MANUALMENTE NA JANELA QUE ABRIU.');
    logger.info('⚠️  INSIRA O CÓDIGO DE 2FA SE SOLICITADO.');
    logger.info('⚠️  QUANDO ESTIVER NO FEED DO INSTAGRAM, VOLTE AQUI E PRESSIONE ENTER NO TERMINAL.');

    // Espera o usuário dar Enter no terminal
    await new Promise((resolve) => process.stdin.once('data', resolve));

    logger.info('✅ Login detectado. Salvando sessão...');
    
  } catch (error) {
    logger.error('❌ Erro durante o login:', error);
  } finally {
    await close();
    logger.info('💾 Sessão salva com sucesso em ./sessions/default.json');
    process.exit(0);
  }
}

runLogin();
