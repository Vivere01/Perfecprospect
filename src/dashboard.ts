import * as http from 'http';
import { prisma } from './db';
import { logger } from './utils/logger';
import { flushPendingDMs, triggerCollection } from './index';

// Seed inicial da blacklist com clientes/conhecidos já cadastrados
export async function seedBlacklist() {
  const initialBlacklist = [
    { username: 'rogertinoco_', reason: 'Já é cliente/conhecido', addedBy: 'MANUAL' },
    { username: 'saviovogt', reason: 'Já é cliente/conhecido', addedBy: 'MANUAL' },
    { username: 'luizliberdade', reason: 'Já é cliente/conhecido', addedBy: 'MANUAL' },
  ];
  for (const entry of initialBlacklist) {
    await prisma.blacklist.upsert({
      where: { username: entry.username },
      update: {},
      create: entry,
    });
  }
  logger.info(`[BLACKLIST] Seed inicial aplicado (${initialBlacklist.length} entradas).`);
}

export function startDashboard(port = 3000) {
  const server = http.createServer(async (req, res) => {
    // Rota para salvar o script
    if (req.url === '/save-script' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body);
          const dmScript = params.get('dmScript');
          if (dmScript) {
            await prisma.systemConfig.upsert({
              where: { id: 'default' },
              update: { dmScript },
              create: { id: 'default', dmScript }
            });
          }
          res.writeHead(302, { 'Location': '/' });
          res.end();
        } catch (error) {
          logger.error('Error saving script:', error);
          res.writeHead(500);
          res.end('Erro ao salvar script');
        }
      });
      return;
    }

    // Rota para adicionar à blacklist
    if (req.url === '/add-blacklist' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body);
          const rawUsername = params.get('username') || '';
          const reason = params.get('reason') || 'Adicionado manualmente';
          const username = rawUsername.replace('@', '').replace('https://www.instagram.com/', '').replace('/', '').trim();
          if (username) {
            await prisma.blacklist.upsert({
              where: { username },
              update: { reason },
              create: { username, reason, addedBy: 'MANUAL' },
            });
            // Remove esse lead do pipeline caso já exista
            await prisma.lead.deleteMany({ where: { username } });
          }
          res.writeHead(302, { 'Location': '/' });
          res.end();
        } catch (error) {
          logger.error('Error adding to blacklist:', error);
          res.writeHead(500);
          res.end('Erro ao adicionar à lista');
        }
      });
      return;
    }

    // Rota para remover da blacklist
    if (req.url?.startsWith('/remove-blacklist/') && req.method === 'POST') {
      const username = decodeURIComponent(req.url.replace('/remove-blacklist/', ''));
      try {
        await prisma.blacklist.delete({ where: { username } });
      } catch { /* Ignora se não existir */ }
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }

    // Rota para adicionar perfil de referência
    if (req.url === '/add-reference' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body);
          const rawUrl = params.get('url') || '';
          if (rawUrl) {
            const url = rawUrl.trim().replace(/\/$/, '') + '/';
            const username = url.split("instagram.com/")[1]?.replace("/", "") || `ref_${Date.now()}`;
            await prisma.referenceProfile.upsert({
              where: { username },
              update: { url },
              create: { username, url, type: 'COMPETITOR' },
            });
          }
          res.writeHead(302, { 'Location': '/' });
          res.end();
        } catch (error) {
          logger.error('Error adding reference:', error);
          res.writeHead(500);
          res.end('Erro ao adicionar perfil de referência');
        }
      });
      return;
    }

    // Rota para remover perfil de referência
    if (req.url?.startsWith('/remove-reference/') && req.method === 'POST') {
      const id = req.url.replace('/remove-reference/', '');
      try {
        await prisma.referenceProfile.delete({ where: { id } });
      } catch { /* Ignora */ }
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }

    // ─ Rota para forçar flush de DMs imediatamente ──────────────────────────
    if (req.url === '/trigger-dm-flush' && req.method === 'POST') {
      try {
        flushPendingDMs().catch(e => logger.error('[DASHBOARD] Erro no flush de DMs:', e));
        res.writeHead(302, { 'Location': '/?flush=1' });
        res.end();
      } catch (error) {
        res.writeHead(500);
        res.end('Erro ao iniciar flush de DMs');
      }
      return;
    }

    // ─ Rota para forçar coleta imediatamente ────────────────────────────────
    if (req.url === '/trigger-collect' && req.method === 'POST') {
      try {
        triggerCollection().catch(e => logger.error('[DASHBOARD] Erro na coleta manual:', e));
        res.writeHead(302, { 'Location': '/?collect=1' });
        res.end();
      } catch (error) {
        res.writeHead(500);
        res.end('Erro ao iniciar coleta manual');
      }
      return;
    }

    // ─ Rota para forçar análise de leads parados ─────────────────────────────
    if (req.url === '/trigger-analyze' && req.method === 'POST') {
      try {
        const pendingLeads = await prisma.lead.findMany({ where: { status: 'COLLECTED' }, take: 50 });
        for (const lead of pendingLeads) {
          await prospectingQueue.add('ANALYZE_PROFILE', { username: lead.username });
        }
        res.writeHead(302, { 'Location': '/?analyze=1' });
        res.end();
      } catch (error) {
        res.writeHead(500);
        res.end('Erro ao iniciar análise manual');
      }
      return;
    }

    if (req.url === '/' || req.url?.startsWith('/?')) {
      const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const flushTriggered = urlParams.get('flush') === '1';
      const collectTriggered = urlParams.get('collect') === '1';

      try {
        // Busca configurações
        const config = await prisma.systemConfig.findUnique({
          where: { id: 'default' }
        }) || { dmScript: 'Fala @{username}, tudo bem? Curti demais seu perfil! Vocês estão usando algum sistema para agendamento na barbearia?' };

        // Busca os últimos 100 leads
        const leads = await prisma.lead.findMany({
          orderBy: { createdAt: 'desc' },
          include: { interactions: true },
          take: 100
        });

        // ─ Estatísticas de Automação ──────────────────────────────────────────────────────────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dmsEnviadasHoje = await prisma.interaction.count({
          where: {
            type: 'DIRECT_MESSAGE',
            status: 'COMPLETED',
            executedAt: { gte: today }
          }
        });
        const dmsPendentes = await prisma.interaction.count({
          where: { type: 'DIRECT_MESSAGE', status: 'PENDING' }
        });
        const dmsEmAndamento = await prisma.interaction.count({
          where: { type: 'DIRECT_MESSAGE', status: 'PROCESSING' }
        });
        const dmsFalhas = await prisma.interaction.count({
          where: { type: 'DIRECT_MESSAGE', status: 'FAILED', executedAt: { gte: today } }
        });
        const leadsAprovadosSemDM = await prisma.lead.count({
          where: { status: 'APPROVED', interactions: { none: {} } }
        });
        const leadsColetados = await prisma.lead.count({
          where: { status: 'COLLECTED' }
        });
        const leadsRejeitados = await prisma.lead.count({
          where: { status: { in: ['REJECTED', 'FILTERED_OUT'] } }
        });

        // Ó próximo CRON é 08:00 BRT (11:00 UTC)
        const now = new Date();
        const nextCron = new Date();
        nextCron.setUTCHours(11, 0, 0, 0);
        if (nextCron <= now) nextCron.setUTCDate(nextCron.getUTCDate() + 1);
        const horasParaCron = Math.floor((nextCron.getTime() - now.getTime()) / 3600000);
        const minutosParaCron = Math.floor(((nextCron.getTime() - now.getTime()) % 3600000) / 60000);
        const countdownCron = `${horasParaCron}h ${minutosParaCron}min`;
        // ──────────────────────────────────────────────────────────────────────────────────────────────────────────

        // Busca a lista de exclusão
        const blacklist = await prisma.blacklist.findMany({
          orderBy: { createdAt: 'desc' }
        });

        // Busca perfis de referência
        const referenceProfiles = await prisma.referenceProfile.findMany({
          orderBy: { createdAt: 'desc' }
        });

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="30"> <!-- Atualização em tempo real a cada 30s -->
    <title>PerfectProspect | Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #050505;
            --surface-color: rgba(255, 255, 255, 0.03);
            --surface-border: rgba(255, 255, 255, 0.08);
            --primary: #4F46E5;
            --primary-glow: rgba(79, 70, 229, 0.4);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --success: #10b981;
            --success-bg: rgba(16, 185, 129, 0.1);
            --warning: #f59e0b;
            --warning-bg: rgba(245, 158, 11, 0.1);
            --danger: #ef4444;
            --danger-bg: rgba(239, 68, 68, 0.1);
            --glass-blur: blur(12px);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            background-image: 
                radial-gradient(circle at 15% 50%, rgba(79, 70, 229, 0.15), transparent 25%),
                radial-gradient(circle at 85% 30%, rgba(16, 185, 129, 0.1), transparent 25%);
            background-attachment: fixed;
            padding: 2rem;
            display: flex;
            flex-direction: column;
            gap: 2rem;
        }

        h1, h2, h3, h4 {
            font-family: 'Outfit', sans-serif;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem 2rem;
            background: var(--surface-color);
            border: 1px solid var(--surface-border);
            border-radius: 20px;
            backdrop-filter: var(--glass-blur);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
            animation: fadeInDown 0.8s ease-out;
        }

        .header-title {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }

        .header-subtitle {
            font-size: 0.9rem;
            color: var(--text-muted);
            margin-top: 0.25rem;
        }

        .stat-badge {
            background: rgba(79, 70, 229, 0.15);
            border: 1px solid rgba(79, 70, 229, 0.3);
            color: #a5b4fc;
            padding: 0.5rem 1.25rem;
            border-radius: 9999px;
            font-weight: 600;
            font-size: 0.95rem;
            box-shadow: 0 0 15px var(--primary-glow);
        }

        .config-card {
            background: var(--surface-color);
            border: 1px solid var(--surface-border);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: var(--glass-blur);
            animation: fadeIn 1s ease-out;
        }

        .config-card h2 {
            font-size: 1.4rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-weight: 600;
        }

        .config-card h2 svg {
            width: 24px;
            height: 24px;
            color: var(--primary);
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            margin-bottom: 1.5rem;
        }

        .form-group label {
            font-size: 0.9rem;
            font-weight: 500;
            color: var(--text-muted);
        }

        textarea {
            width: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--surface-border);
            border-radius: 12px;
            padding: 1rem;
            color: var(--text-main);
            font-family: 'Inter', sans-serif;
            font-size: 0.95rem;
            resize: vertical;
            transition: all 0.3s ease;
            outline: none;
        }

        textarea:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.15);
        }

        .hint {
            font-size: 0.8rem;
            color: var(--text-muted);
        }

        code {
            background: rgba(255, 255, 255, 0.1);
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: monospace;
            color: #a5b4fc;
        }

        button {
            background: linear-gradient(135deg, var(--primary) 0%, #4338ca 100%);
            color: white;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 12px;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: all 0.3s ease;
            font-family: 'Inter', sans-serif;
            box-shadow: 0 4px 15px var(--primary-glow);
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(79, 70, 229, 0.6);
        }

        button:active {
            transform: translateY(0);
        }

        .data-grid-container {
            background: var(--surface-color);
            border: 1px solid var(--surface-border);
            border-radius: 20px;
            backdrop-filter: var(--glass-blur);
            overflow: hidden;
            animation: slideUp 0.8s ease-out;
            display: flex;
            flex-direction: column;
        }

        .grid-header {
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--surface-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .grid-title {
            font-size: 1.25rem;
            font-weight: 600;
        }

        .table-wrapper {
            overflow-x: auto;
            width: 100%;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            white-space: nowrap;
        }

        th, td {
            padding: 1.25rem 1.5rem;
            border-bottom: 1px solid var(--surface-border);
        }

        th {
            background: rgba(0, 0, 0, 0.2);
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
            position: sticky;
            top: 0;
            z-index: 10;
        }

        tbody tr {
            transition: all 0.2s ease;
        }

        tbody tr:hover {
            background: rgba(255, 255, 255, 0.02);
        }

        .cell-user {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .user-name {
            font-weight: 600;
            font-size: 0.95rem;
            color: var(--text-main);
        }

        .user-link {
            font-size: 0.85rem;
            color: #818cf8;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            transition: color 0.2s;
        }

        .user-link:hover {
            color: #a5b4fc;
            text-decoration: underline;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.35rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .status-approved { background: var(--success-bg); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }
        .status-contacted { background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); }
        .status-responded { background: rgba(167, 139, 250, 0.1); color: #a78bfa; border: 1px solid rgba(167, 139, 250, 0.2); }
        .status-rejected { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); }
        .status-default { background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); }

        .score-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.05);
            font-weight: 700;
            font-size: 0.9rem;
            border: 1px solid var(--surface-border);
        }

        .cell-text {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        .interaction-text {
            max-width: 250px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.85rem;
            color: var(--text-main);
            font-style: italic;
        }

        .int-status-completed { color: var(--success); font-weight: 600; font-size: 0.8rem; }
        .int-status-failed { color: var(--danger); font-weight: 600; font-size: 0.8rem; }
        .int-status-pending { color: var(--warning); font-weight: 600; font-size: 0.8rem; }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Scrollbar custom */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        ::-webkit-scrollbar-track {
            background: var(--bg-color);
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .blacklist-section {
            background: var(--surface-color);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: var(--glass-blur);
            animation: fadeIn 1s ease-out;
        }

        .blacklist-section h2 {
            font-size: 1.4rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-weight: 600;
            color: #fca5a5;
        }

        .blacklist-add-form {
            display: flex;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
        }

        .blacklist-add-form input {
            flex: 1;
            min-width: 200px;
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(239, 68, 68, 0.25);
            border-radius: 10px;
            padding: 0.65rem 1rem;
            color: var(--text-main);
            font-family: 'Inter', sans-serif;
            font-size: 0.9rem;
            outline: none;
            transition: all 0.3s ease;
        }

        .blacklist-add-form input:focus {
            border-color: var(--danger);
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
        }

        .btn-danger {
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
            box-shadow: 0 4px 15px rgba(239, 68, 68, 0.3);
        }
        .btn-danger:hover {
            box-shadow: 0 6px 20px rgba(239, 68, 68, 0.5);
        }

        .blacklist-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 0.75rem;
        }

        .blacklist-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(239, 68, 68, 0.06);
            border: 1px solid rgba(239, 68, 68, 0.15);
            border-radius: 12px;
            padding: 0.85rem 1rem;
            gap: 0.75rem;
            transition: all 0.2s ease;
        }
        .blacklist-card:hover {
            background: rgba(239, 68, 68, 0.1);
        }

        .blacklist-user {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
            overflow: hidden;
        }
        .blacklist-username {
            font-weight: 600;
            font-size: 0.9rem;
            color: #fca5a5;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .blacklist-reason {
            font-size: 0.75rem;
            color: var(--text-muted);
        }
        .blacklist-remove-btn {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #fca5a5;
            padding: 0.3rem 0.6rem;
            border-radius: 8px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: none;
            flex-shrink: 0;
            transition: all 0.2s ease;
        }
        .blacklist-remove-btn:hover {
            background: rgba(239, 68, 68, 0.3);
            transform: translateY(-1px);
            box-shadow: none;
        }

        .blacklist-empty {
            color: var(--text-muted);
            font-size: 0.9rem;
            font-style: italic;
        }

        /* ─── Painel de Automação ──────────────────────────────────────────── */
        .automation-panel {
            background: var(--surface-color);
            border: 1px solid rgba(79, 70, 229, 0.25);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: var(--glass-blur);
            animation: fadeIn 1s ease-out;
        }
        .automation-panel h2 {
            font-size: 1.4rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-weight: 600;
            color: #a5b4fc;
        }
        .automation-stats {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .stat-card {
            background: rgba(0,0,0,0.2);
            border: 1px solid var(--surface-border);
            border-radius: 14px;
            padding: 1.25rem 1rem;
            text-align: center;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }
        .stat-card .stat-value {
            font-size: 2rem;
            font-weight: 700;
            font-family: 'Outfit', sans-serif;
            line-height: 1;
        }
        .stat-card .stat-label {
            font-size: 0.75rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .stat-green { color: var(--success); }
        .stat-yellow { color: var(--warning); }
        .stat-red { color: var(--danger); }
        .stat-blue { color: #60a5fa; }
        .stat-purple { color: #a78bfa; }

        .cron-info {
            background: rgba(79, 70, 229, 0.08);
            border: 1px solid rgba(79, 70, 229, 0.2);
            border-radius: 12px;
            padding: 1rem 1.25rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1.25rem;
            flex-wrap: wrap;
        }
        .cron-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--success);
            box-shadow: 0 0 8px var(--success);
            flex-shrink: 0;
            animation: pulse-dot 2s infinite;
        }
        @keyframes pulse-dot {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        .cron-text { flex: 1; font-size: 0.9rem; color: var(--text-main); }
        .cron-countdown { color: #a5b4fc; font-weight: 600; font-size: 0.9rem; }
        .automation-actions {
            display: flex;
            gap: 0.75rem;
            flex-wrap: wrap;
        }
        .btn-action {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            padding: 0.6rem 1.25rem;
        }
        .btn-collect { background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%); box-shadow: 0 4px 12px rgba(8,145,178,0.3); }
        .btn-collect:hover { box-shadow: 0 6px 18px rgba(8,145,178,0.5); }
        .btn-dm { background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); box-shadow: 0 4px 12px rgba(124,58,237,0.3); }
        .btn-dm:hover { box-shadow: 0 6px 18px rgba(124,58,237,0.5); }

        .alert-banner {
            padding: 0.75rem 1.25rem;
            border-radius: 10px;
            font-size: 0.875rem;
            font-weight: 500;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .alert-success { background: var(--success-bg); border: 1px solid rgba(16,185,129,0.3); color: var(--success); }
    </style>
</head>
<body>
    <header class="header">
        <div>
            <h1 class="header-title">PerfectProspect</h1>
            <p class="header-subtitle">AI Lead Generation &amp; DM Automation</p>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;">
            <div style="text-align:right;">
                <div class="stat-badge">Total Leads: ${leads.length}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.35rem">✅ ${dmsEnviadasHoje} DMs enviadas hoje &nbsp;|&nbsp; ⏳ ${dmsPendentes} na fila</div>
            </div>
        </div>
    </header>

    ${flushTriggered ? '<div class="alert-banner alert-success">✅ Flush de DMs iniciado! As mensagens serão enviadas nos próximos minutos.</div>' : ''}
    ${collectTriggered ? '<div class="alert-banner alert-success">✅ Coleta manual iniciada! Novos leads serão coletados em breve.</div>' : ''}
    ${urlParams.get('analyze') === '1' ? '<div class="alert-banner alert-success">✅ Análise de leads pendentes iniciada!</div>' : ''}

    <!-- PAINEL DE AUTOMAÇÃO -->
    <section class="automation-panel">
        <h2>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Status da Automação
        </h2>

        <div class="cron-info">
            <span class="cron-dot"></span>
            <span class="cron-text">📅 CRON diário ativo &mdash; coleta novos leads todo dia às <strong>08:00 BRT</strong> e envia DMs às <strong>08:30 BRT</strong></span>
            <span class="cron-countdown">⏳ Próxima execução em ${countdownCron}</span>
        </div>

        <div class="automation-stats">
            <div class="stat-card">
                <span class="stat-value stat-green">${dmsEnviadasHoje}</span>
                <span class="stat-label">DMs Enviadas Hoje</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-yellow">${dmsPendentes}</span>
                <span class="stat-label">DMs na Fila</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-blue">${dmsEmAndamento}</span>
                <span class="stat-label">Em Andamento</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-red">${dmsFalhas}</span>
                <span class="stat-label">Falhas Hoje</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-purple">${leadsAprovadosSemDM}</span>
                <span class="stat-label">Aprovados s/ DM</span>
            </div>
            <div class="stat-card">
                <span class="stat-value stat-red">${leadsRejeitados}</span>
                <span class="stat-label">Filtrados/Rejeitados</span>
            </div>
            <div class="stat-card">
                <span class="stat-value" style="color:var(--text-muted)">${leadsColetados}</span>
                <span class="stat-label">Aguardando IA</span>
            </div>
            <div class="stat-card">
                <span class="stat-value" style="color:var(--text-main)">${leads.length}</span>
                <span class="stat-label">Leads Recentes</span>
            </div>
        </div>

        <div class="automation-actions">
            <form action="/trigger-collect" method="POST" style="display:inline">
                <button type="submit" class="btn-action btn-collect">
                    🔍 Coletar Leads Agora
                </button>
            </form>
            <form action="/trigger-analyze" method="POST" style="display:inline">
                <button type="submit" class="btn-action" style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
                    🤖 Analisar Pendentes (${leadsColetados})
                </button>
            </form>
            <form action="/trigger-dm-flush" method="POST" style="display:inline">
                <button type="submit" class="btn-action btn-dm">
                    📤 Enviar DMs (${leadsAprovadosSemDM})
                </button>
            </form>
        </div>
    </section>

    <section class="config-card">
        <h2>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Configuração do Script de Abordagem (IA)
        </h2>
        <form action="/save-script" method="POST">
            <div class="form-group">
                <label>Template da Mensagem Direct</label>
                <textarea name="dmScript" rows="3" placeholder="Ex: Fala @{username}, tudo bem?">${config.dmScript}</textarea>
                <p class="hint">Use <code>@{username}</code> para que a IA personalize a mensagem com o @ do lead do Instagram automaticamente. O sistema envia 40 DMs por dia limitadas para evitar bloqueios.</p>
            </div>
            <button type="submit">Salvar Script e Ativar IA</button>
        </form>
    </section>

    <section class="config-card" style="border-color: rgba(16, 185, 129, 0.25);">
        <h2>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="color:var(--success)">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-2.533-4.656 9.333 9.333 0 00-4.213-.997 9.333 9.333 0 00-4.212.997 4.125 4.125 0 00-2.533 4.656 9.337 9.337 0 004.121.952 9.38 9.38 0 002.625-.372zm3.9-16.108a4.875 4.875 0 11-1.5 9.493 4.875 4.875 0 011.5-9.493zM3.75 20.25a.75.75 0 01.75-.75h2.625a.75.75 0 010 1.5H4.5a.75.75 0 01-.75-.75zm0-3.75a.75.75 0 01.75-.75h1.125a.75.75 0 010 1.5H4.5a.75.75 0 01-.75-.75zm0-3.75a.75.75 0 01.75-.75h1.125a.75.75 0 010 1.5H4.5a.75.75 0 01-.75-.75z" />
            </svg>
            Perfis de Referência (Onde a IA busca leads)
        </h2>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1.25rem">A IA visita esses perfis, analisa os posts recentes e coleta pessoas que interagiram e que se encaixam no seu ICP.</p>

        <form class="blacklist-add-form" action="/add-reference" method="POST">
            <input type="text" name="url" placeholder="https://www.instagram.com/usuario/" required style="border-color: rgba(16, 185, 129, 0.25);" />
            <button type="submit" style="background: linear-gradient(135deg, var(--success) 0%, #059669 100%); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);">+ Adicionar Referência</button>
        </form>

        <div class="blacklist-grid">
            ${referenceProfiles.length === 0
              ? '<p class="blacklist-empty">Nenhum perfil de referência cadastrado.</p>'
              : referenceProfiles.map(ref => `
                <div class="blacklist-card" style="background: rgba(16, 185, 129, 0.06); border-color: rgba(16, 185, 129, 0.15);">
                  <div class="blacklist-user">
                    <a href="${ref.url}" target="_blank" class="blacklist-username" style="color:#6ee7b7">@${ref.username}</a>
                    <span class="blacklist-reason">Última coleta: ${ref.lastCollectedAt ? new Date(ref.lastCollectedAt).toLocaleDateString() : 'Nunca'}</span>
                  </div>
                  <form action="/remove-reference/${ref.id}" method="POST" style="display:inline">
                    <button type="submit" class="blacklist-remove-btn" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.3); color: #6ee7b7;">Remover</button>
                  </form>
                </div>
              `).join('')
            }
        </div>
    </section>

    <section class="blacklist-section">
        <h2>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:24px;height:24px;color:#ef4444">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            Perfis Excluídos (Não Contactar)
        </h2>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1.25rem">Clientes existentes, amigos, ou qualquer perfil que a IA <strong style="color:#fca5a5">nunca deve abordar</strong>. Cole o @ ou a URL do Instagram.</p>

        <form class="blacklist-add-form" action="/add-blacklist" method="POST">
            <input type="text" name="username" placeholder="@usuario ou https://www.instagram.com/usuario/" required />
            <input type="text" name="reason" placeholder="Motivo (ex: Já é cliente)" style="max-width:280px" />
            <button type="submit" class="btn-danger">+ Adicionar à Lista</button>
        </form>

        <div class="blacklist-grid">
            ${blacklist.length === 0
              ? '<p class="blacklist-empty">Nenhum perfil excluído ainda.</p>'
              : blacklist.map(entry => `
                <div class="blacklist-card">
                  <div class="blacklist-user">
                    <a href="https://www.instagram.com/${entry.username}/" target="_blank" class="blacklist-username">@${entry.username}</a>
                    <span class="blacklist-reason">${entry.reason}</span>
                  </div>
                  <form action="/remove-blacklist/${encodeURIComponent(entry.username)}" method="POST" style="display:inline">
                    <button type="submit" class="blacklist-remove-btn">Remover</button>
                  </form>
                </div>
              `).join('')
            }
        </div>
    </section>

    <section class="data-grid-container">
        <div class="grid-header">
            <h2 class="grid-title">Leads Prospectados</h2>
        </div>
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Lead</th>
                        <th>Score IA</th>
                        <th>Resumo da Análise</th>
                        <th>Última Ação (DM)</th>
                        <th>Data</th>
                    </tr>
                </thead>
                <tbody>
                    ${leads.map(lead => {
                        const statusColorClass = 
                            lead.status === 'APPROVED' ? 'status-approved' : 
                            lead.status === 'CONTACTED' ? 'status-contacted' : 
                            lead.status === 'RESPONDED' ? 'status-responded' : 
                            lead.status === 'REJECTED' || lead.status === 'FILTERED_OUT' ? 'status-rejected' : 'status-default';
                        
                        const interaction = lead.interactions[0];
                        const profileUrl = lead.profileUrl || `https://instagram.com/${lead.username}`;
                        const dateStr = new Date(lead.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                        
                        let intStatusClass = 'int-status-pending';
                        if(interaction?.status === 'COMPLETED') intStatusClass = 'int-status-completed';
                        if(interaction?.status === 'FAILED') intStatusClass = 'int-status-failed';

                        return `
                        <tr>
                            <td><span class="status-badge ${statusColorClass}">${lead.status}</span></td>
                            <td>
                                <div class="cell-user">
                                    <span class="user-name">${lead.fullName || 'Desconhecido'}</span>
                                    <a href="${profileUrl}" target="_blank" class="user-link">
                                        @${lead.username}
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                    </a>
                                </div>
                            </td>
                            <td>
                                ${lead.analysisScore != null ? `<div class="score-pill">${lead.analysisScore}</div>` : '<span class="text-muted">-</span>'}
                            </td>
                            <td>
                                <div class="cell-text" title="${lead.analysisSummary || lead.filterReason || ''}">
                                    ${lead.analysisSummary || lead.filterReason || 'Sem análise'}
                                </div>
                            </td>
                            <td>
                                ${interaction ? `
                                    <div class="cell-user">
                                        <span class="${intStatusClass}">${interaction.status}</span>
                                        <span class="interaction-text" title="${interaction.content}">"${interaction.content}"</span>
                                    </div>
                                ` : '<span class="int-status-pending">Aguardando IA</span>'}
                            </td>
                            <td style="color: var(--text-muted); font-size: 0.85rem;">${dateStr}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </section>
</body>
</html>`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        logger.error('Dashboard Error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Erro interno ao carregar o dashboard.');
      }
    } else {
      res.writeHead(404);
      res.end('Página não encontrada');
    }
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`📊 Dashboard rodando na porta ${port}. Acesse no navegador!`);
  });
}
