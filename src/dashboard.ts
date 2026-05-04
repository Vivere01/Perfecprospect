import * as http from 'http';
import { prisma } from './db';
import { logger } from './utils/logger';

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

    if (req.url === '/') {
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

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    </style>
</head>
<body>
    <header class="header">
        <div>
            <h1 class="header-title">PerfectProspect</h1>
            <p class="header-subtitle">AI Lead Generation & DM Automation</p>
        </div>
        <div class="stat-badge">
            Total Leads: ${leads.length}
        </div>
    </header>

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
