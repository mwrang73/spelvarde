// Seed: skapar Mikael som enda användare (ADMIN, godkänd), hans
// inställningar och riktoddsmodellen v1 (specen 7.3). Kan köras flera gånger.
//
//   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… [SEED_ADMIN_NAME=…] npm run db:seed
//
// Finns användaren redan ändras inte lösenordet, om inte --reset-password
// anges. Lösenordet skrivs aldrig ut.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = String(process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = String(process.env.SEED_ADMIN_PASSWORD ?? "");
const name = String(process.env.SEED_ADMIN_NAME ?? "Mikael").trim() || "Mikael";
const resetPassword = process.argv.includes("--reset-password");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("SEED_ADMIN_EMAIL saknas eller är ingen e-postadress.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("SEED_ADMIN_PASSWORD saknas eller är kortare än 10 tecken.");
  process.exit(1);
}

let dbHost = "okänd";
try {
  const u = new URL(process.env.DATABASE_URL ?? "");
  dbHost = `${u.hostname}:${u.port || 5432}${u.pathname} (schema ${u.searchParams.get("schema") ?? "public"})`;
  if (u.searchParams.get("schema") !== "spelvarde") {
    console.error("DATABASE_URL måste sluta på ?schema=spelvarde. Avbryter.");
    process.exit(1);
  }
} catch {
  console.error("DATABASE_URL saknas eller är ogiltig.");
  process.exit(1);
}
console.log(`Seed mot ${dbHost}`);

// Standardvikter v1 (7.3) och parametrar (7.1, 7.2).
const V1_WEIGHTS = { plats: 1.0, vinst: 0.5, form: 0.6, spar: 0.4, kusk: 0.3, tranare: 0.2, galopp: -0.4, streck: 0 };
const V1_PARAMS = { beta: 1.0, marginal: 0, kPlats: 6, kVinst: 6, kKusk: 20, kTranare: 20 };

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  let user;
  if (!existing) {
    user = await prisma.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN", status: "APPROVED" },
    });
    console.log(`Skapade ${email} (ADMIN).`);
  } else {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "ADMIN",
        status: "APPROVED",
        ...(resetPassword ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
    });
    console.log(`${email} fanns redan: roll ADMIN, status APPROVED${resetPassword ? ", nytt lösenord" : ""}.`);
  }

  await prisma.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });

  const v1 = await prisma.modelVersion.findUnique({ where: { key: "v1" } });
  if (!v1) {
    const anyActive = await prisma.modelVersion.findFirst({ where: { active: true } });
    await prisma.modelVersion.create({
      data: { key: "v1", weights: V1_WEIGHTS, params: V1_PARAMS, active: !anyActive, createdById: user.id },
    });
    console.log("Skapade riktoddsmodellen v1.");
  }
} finally {
  await prisma.$disconnect();
}
