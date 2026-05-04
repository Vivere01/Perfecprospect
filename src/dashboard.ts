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
        <header class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 gap-4">
            <div>
                <h1 class="text-3xl font-bold text-gray-900 tracking-tight text-blue-600">PerfectProspect AI</h1>
                <p class="text-sm text-gray-500 mt-1">Gerenciamento de Leads e Automação de Prospecção.</p>
            </div>
            <div class="flex gap-4">
                <div class="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg font-semibold border border-blue-100">
                    Leads: \${leads.length}
                </div>
            </div>
        </header>

        <!-- Configuração de Script -->
        <section class="mb-10 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span class="p-2 bg-blue-100 rounded-lg text-blue-600">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                        <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                    </svg>
                </span>
                Configuração do Script (DM)
            </h2>
            <form action="/save-script" method="POST" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Template da Mensagem</label>
                    <textarea name="dmScript" rows="3" class="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-700 font-medium" placeholder="Ex: Fala @{username}, tudo bem?">\${config.dmScript}</textarea>
                    <p class="text-xs text-gray-400 mt-2">Use <code class="bg-gray-100 px-1 rounded">@{username}</code> para inserir o @ do lead automaticamente.</p>
                </div>
                <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-sm transition-all transform active:scale-95">
                    Salvar Script
                </button>
            </form>
        </section>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            \${leads.map(lead => {
                const isApproved = lead.status === 'APPROVED' || lead.status === 'CONTACTED' || lead.status === 'RESPONDED';
                const statusColor = lead.status === 'CONTACTED' || lead.status === 'RESPONDED' ? 'bg-green-100 text-green-700 border-green-200' :
                                    lead.status === 'APPROVED' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                    lead.status === 'REJECTED' ? 'bg-red-100 text-red-700 border-red-200' :
                                    'bg-gray-100 text-gray-700 border-gray-200';
                
                const interaction = lead.interactions[0];
                const profileUrl = lead.profileUrl || \`https://instagram.com/\${lead.username}\`;

                return \`
                <div class="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col h-full relative overflow-hidden">
                    <div class="flex justify-between items-start mb-4">
                        <div class="z-10">
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">\\\${lead.fullName || 'Lead'}</h3>
                            <a href="\\\${profileUrl}" target="_blank" class="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors flex items-center gap-1">
                                @\\\${lead.username}
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                            </a>
                        </div>
                        <span class="text-[10px] px-2 py-1 rounded-full border font-bold uppercase tracking-tighter \\\${statusColor} z-10">
                            \\\${lead.status}
                        </span>
                    </div>
                    
                    \\\${isApproved ? \\\`
                        <div class="mb-4">
                            <div class="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Score da IA</div>
                            <div class="flex items-center">
                                <div class="text-2xl font-black text-gray-900">\\\${lead.analysisScore || '-'}</div>
                                <div class="text-gray-400 text-xs ml-1">/ 10</div>
                            </div>
                        </div>
                        <div class="mb-4 flex-grow">
                            <div class="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Análise</div>
                            <p class="text-sm text-gray-600 leading-relaxed line-clamp-4">\\\${lead.analysisSummary || 'Aprovado pelo sistema.'}</p>
                        </div>
                    \\\` : \\\`
                        <div class="mb-4 flex-grow">
                            <div class="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Motivo do Filtro</div>
                            <p class="text-sm text-gray-500 italic">\\\${lead.filterReason || lead.analysisSummary || 'Não atende aos critérios.'}</p>
                        </div>
                    \\\`}

                    \\\${interaction ? \\\`
                        <div class="mt-auto pt-4 border-t border-gray-50">
                            <div class="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2 flex justify-between">
                                <span>Mensagem Enviada</span>
                                <span class="\\\${interaction.status === 'COMPLETED' ? 'text-green-600' : interaction.status === 'FAILED' ? 'text-red-500' : 'text-orange-500'} font-black">\\\${interaction.status}</span>
                            </div>
                            <div class="bg-gray-50 p-3 rounded-xl text-xs text-gray-700 italic border border-gray-100">
                                "\\\${interaction.content}"
                            </div>
                            \\\${interaction.errorMessage ? \\\`<p class="text-[10px] text-red-400 mt-1">Error: \\\${interaction.errorMessage}</p>\\\` : ''}
                        </div>
                    \\\` : \\\`
                        <div class="mt-auto pt-4 border-t border-gray-50 text-center">
                            <span class="text-[10px] text-gray-300 font-bold uppercase">Aguardando Execução</span>
                        </div>
                    \\\`}
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
