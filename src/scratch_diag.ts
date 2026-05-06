import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const totalLeads = await prisma.lead.count();
  const statusCounts = await prisma.lead.groupBy({
    by: ['status'],
    _count: {
      status: true
    }
  });

  const interactions = await prisma.interaction.groupBy({
    by: ['status'],
    _count: {
      status: true
    }
  });

  console.log('--- LEADS STATUS ---');
  console.log(`Total Leads: ${totalLeads}`);
  console.log(JSON.stringify(statusCounts, null, 2));

  console.log('\n--- INTERACTIONS STATUS ---');
  console.log(JSON.stringify(interactions, null, 2));

  // Check last 10 leads and their rejection reason if any
  const lastLeads = await prisma.lead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      username: true,
      status: true,
      filterReason: true,
      analysisSummary: true
    }
  });
  console.log('\n--- LAST 10 LEADS ---');
  console.log(JSON.stringify(lastLeads, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
