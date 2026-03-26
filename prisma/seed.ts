import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // Create admin user
  const adminPassword = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "bret@bwkdigital.com" },
    update: {},
    create: {
      name: "Bret Kramer",
      email: "bret@bwkdigital.com",
      hashedPassword: adminPassword,
      role: "admin",
      hasDistributionAccess: true,
    },
  });

  // Create a test producer
  const producerPassword = await bcrypt.hash("producer123", 10);
  const producer = await prisma.user.upsert({
    where: { email: "rob@stolenwatermedia.com" },
    update: {},
    create: {
      name: "Rob (Test Producer)",
      email: "rob@stolenwatermedia.com",
      hashedPassword: producerPassword,
      role: "producer",
      hasDistributionAccess: false,
    },
  });

  // Give admin access to all content types
  const allTypes = [
    "review",
    "trailer",
    "appearance",
    "episode",
    "case_document",
    "show",
  ];
  for (const ct of allTypes) {
    await prisma.userContentTypeAccess.upsert({
      where: {
        userId_contentType: { userId: admin.id, contentType: ct },
      },
      update: {},
      create: { userId: admin.id, contentType: ct },
    });
  }

  // Give the producer access to some content types
  const producerTypes = ["review", "trailer", "appearance"];
  for (const ct of producerTypes) {
    await prisma.userContentTypeAccess.upsert({
      where: {
        userId_contentType: { userId: producer.id, contentType: ct },
      },
      update: {},
      create: { userId: producer.id, contentType: ct },
    });
  }

  // Give both users access to a test show (WP show ID 1 as placeholder)
  for (const user of [admin, producer]) {
    await prisma.userShowAccess.upsert({
      where: {
        userId_wpShowId: { userId: user.id, wpShowId: 1 },
      },
      update: {},
      create: { userId: user.id, wpShowId: 1 },
    });
  }

  console.log("Seed complete:");
  console.log(`  Admin: ${admin.email}`);
  console.log(`  Producer: ${producer.email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
