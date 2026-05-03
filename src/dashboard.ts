import * as http from 'http';
import { prisma } from './db';
import { logger } from './utils/logger';

export function startDashboard(port = 3000) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') {
      try {
        // Busca os últimos 100 leads com suas interações (DMs)
        const leads = await prisma.lead.findMany({
          orderBy: { createdAt: 'desc' },
          include: { interactions: true },
          take: 100
        });

        // HTML com TailwindCSS para um visual harmônico e premium
        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PerfectProspect | Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-gray-50 text-gray-800 p-6">
    <div class="max-w-7xl mx-auto">
        <header class="flex justify-between items-center mb-8 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div>
                <h1 class="text-3xl font-bold text-gray-900 tracking-tight">AI Prospecting Engine</h1>
                <p class="text-sm text-gray-500 mt-1">Visão geral dos últimos leads coletados e analisados.</p>
            </div>
            <div class="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg font-semibold border border-blue-100">
                Total Exibido: ${leads.length}
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            ${leads.map(lead => {
                const isApproved = lead.status === 'APPROVED' || lead.status === 'CONTACTED';
                const statusColor = lead.status === 'CONTACTED' ? 'bg-green-100 text-green-700 border-green-200' :
                                    lead.status === 'APPROVED' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                    lead.status === 'REJECTED' ? 'bg-red-100 text-red-700 border-red-200' :
                                    'bg-gray-100 text-gray-700 border-gray-200';
                
                const interaction = lead.interactions[0];

                return \`
                <div class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col h-full">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <a href="https://instagram.com/\${lead.username}" target="_blank" class="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors">@\${lead.username}</a>
                        </div>
                        <span class="text-xs px-2 py-1 rounded-full border font-medium \${statusColor}">
                            \${lead.status}
                        </span>
                    </div>
                    
                    \${isApproved ? \`
                        <div class="mb-4">
                            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Score da IA</div>
                            <div class="flex items-center">
                                <div class="text-2xl font-bold text-gray-900">\${lead.analysisScore || '-'}</div>
                                <div class="text-gray-400 text-sm ml-1">/ 10</div>
                            </div>
                        </div>
                        <div class="mb-4 flex-grow">
                            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Resumo</div>
                            <p class="text-sm text-gray-600 line-clamp-3">\${lead.analysisSummary || 'Sem resumo'}</p>
                        </div>
                    \` : \`
                        <div class="mb-4 flex-grow">
                            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Motivo do Filtro</div>
                            <p class="text-sm text-gray-600 line-clamp-3">\${lead.filterReason || lead.analysisSummary || 'Sem motivo registrado'}</p>
                        </div>
                    \`}

                    \${interaction ? \`
                        <div class="mt-auto pt-4 border-t border-gray-50">
                            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-2 flex justify-between">
                                <span>Mensagem (DM)</span>
                                <span class="\${interaction.status === 'COMPLETED' ? 'text-green-600' : 'text-orange-500'}">\${interaction.status}</span>
                            </div>
                            <div class="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 italic border border-gray-100">
                                "\${interaction.content}"
                            </div>
                        </div>
                    \` : \`
                        <div class="mt-auto pt-4 border-t border-gray-50">
                            <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-2">Mensagem (DM)</div>
                            <div class="bg-gray-50 p-3 rounded-lg text-sm text-gray-400 border border-gray-100 text-center">
                                Nenhuma mensagem gerada
                            </div>
                        </div>
                    \`}
                </div>
                \`;
            }).join('')}
        </div>
    </div>
</body>
</html>
        `;

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
    logger.info(\`📊 Dashboard rodando na porta \${port}. Acesse no navegador!\`);
  });
}
