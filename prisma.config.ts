import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env itself. Local development reads .env (see .env.example).
// Migrations use the direct (unpooled) connection when one is provided.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  },
});
