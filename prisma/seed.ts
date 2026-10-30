import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runSeed } from "./seed/run-seed";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const includeDevelopmentData = process.env.NODE_ENV !== "production";

try {
  const result = await runSeed(prisma, { includeDevelopmentData });
  console.log(
    `Seeded ${result.categoryCount} categories and ${result.retailerCount} development retailer(s).`,
  );
} finally {
  await prisma.$disconnect();
}
