import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { assertSeedAllowed, seedPassword } from "../src/lib/seed-guard";

// Never seed production: this creates login-capable accounts.
assertSeedAllowed();

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // Passwords come from SEED_ADMIN_PASSWORD / SEED_PRODUCER_PASSWORD, or are
  // generated randomly. Existing users are never modified.
  const adminEmail = "bret@bwkdigital.com";
  const producerEmail = "rob@stolenwatermedia.com";
  const generated: string[] = [];

  const adminExists = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  const adminPw = seedPassword("SEED_ADMIN_PASSWORD");
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: "Bret Kramer",
      email: adminEmail,
      hashedPassword: await bcrypt.hash(adminPw.password, 10),
      role: "admin",
      hasDistributionAccess: true,
    },
  });
  if (!adminExists && adminPw.generated) generated.push(`  ${adminEmail}: ${adminPw.password}`);

  // Create a test producer
  const producerExists = await prisma.user.findUnique({ where: { email: producerEmail }, select: { id: true } });
  const producerPw = seedPassword("SEED_PRODUCER_PASSWORD");
  const producer = await prisma.user.upsert({
    where: { email: producerEmail },
    update: {},
    create: {
      name: "Rob (Test Producer)",
      email: producerEmail,
      hashedPassword: await bcrypt.hash(producerPw.password, 10),
      role: "producer",
      hasDistributionAccess: false,
    },
  });
  if (!producerExists && producerPw.generated) generated.push(`  ${producerEmail}: ${producerPw.password}`);

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
  if (generated.length > 0) {
    // Shown once, only for accounts this run created with a random password
    // (local/dev databases only — see assertSeedAllowed).
    console.log("Generated passwords for newly created local accounts (not stored anywhere else):");
    for (const line of generated) console.log(line);
  }
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
