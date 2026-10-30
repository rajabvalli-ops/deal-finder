import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/** A Prisma client or an interactive-transaction client; repositories accept either. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export {
  Availability,
  DealStatus,
  IntegrationType,
  RetailerStatus,
  Role,
} from "@/generated/prisma/enums";
export type {
  Category,
  PriceHistory,
  Product,
  ProductVariant,
  Retailer,
} from "@/generated/prisma/client";
