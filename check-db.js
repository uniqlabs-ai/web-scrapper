const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, organizationId: true, role: true }});
  console.log("USERS:", users);

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true }});
  console.log("ORGS:", orgs);

  const invs = await prisma.invoice.findMany({ select: { invoiceNumber: true, organizationId: true, userId: true }});
  console.log("INVOICES:", invs);
}
check().finally(() => prisma.$disconnect());
