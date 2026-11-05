import "server-only";
import { slugify } from "@/lib/slug";
import { hasRole } from "@/server/auth/roles";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import { createCategoryRepository } from "@/server/db/repositories/category.repository";
import { createRetailerRepository } from "@/server/db/repositories/retailer.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient, Retailer } from "@/server/db/types";
import {
  amazonConfigSchema,
  type AmazonConfig,
  type AmazonSearch,
} from "@/server/retailers/adapters/amazon";
import { fail, ok, type Actor, type AdminResult } from "./result";

type CategoryInput = { name: string; parentId: string | null; sortOrder: number };

export type AmazonTrackingChange =
  | { kind: "asins"; asins: string[] }
  | { kind: "add-search"; search: AmazonSearch }
  | { kind: "remove-search"; index: number };

/** The tracking settings of an Amazon retailer, or null for any other retailer. */
export function amazonConfigOf(retailer: Pick<Retailer, "adapterKey" | "adapterConfig">) {
  if (retailer.adapterKey !== "amazon") return null;
  const parsed = amazonConfigSchema.safeParse(retailer.adapterConfig ?? {});
  return parsed.success ? parsed.data : amazonConfigSchema.parse({});
}

export function createAdminCatalogueService(client: DbClient) {
  /** Walks up from `parentId`; true if `categoryId` is reached (the move would create a cycle). */
  async function wouldCreateCycle(
    tx: DbClient,
    categoryId: string,
    parentId: string,
  ): Promise<boolean> {
    const categories = createCategoryRepository(tx);
    let current: string | null = parentId;
    for (let depth = 0; current && depth < 100; depth++) {
      if (current === categoryId) return true;
      current = (await categories.findById(current))?.parentId ?? null;
    }
    return false;
  }

  return {
    updateRetailer(params: {
      actor: Actor;
      retailerId: string;
      status: "ACTIVE" | "PAUSED" | "DISABLED";
      trustScore: number;
      autoPublish: boolean;
      now: Date;
    }): Promise<AdminResult> {
      const { actor, retailerId, status, trustScore, autoPublish, now } = params;
      if (!hasRole(actor.role, "ADMIN")) return Promise.resolve(fail("FORBIDDEN"));
      return inTransaction(client, async (tx) => {
        const retailers = createRetailerRepository(tx);
        const before = await retailers.findById(retailerId);
        if (!before) return fail("NOT_FOUND");
        await retailers.update(retailerId, { status, trustScore, autoPublish });
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "retailer.update",
          entityType: "Retailer",
          entityId: retailerId,
          diff: {
            status: { from: before.status, to: status },
            trustScore: { from: before.trustScore, to: trustScore },
            autoPublish: { from: before.autoPublish, to: autoPublish },
          },
          createdAt: now,
        });
        return ok(undefined);
      });
    },

    /** Changes which ASINs and searches an Amazon retailer tracks. ADMIN only; audited. */
    updateAmazonTracking(params: {
      actor: Actor;
      retailerId: string;
      change: AmazonTrackingChange;
      now: Date;
    }): Promise<AdminResult> {
      const { actor, retailerId, change, now } = params;
      if (!hasRole(actor.role, "ADMIN")) return Promise.resolve(fail("FORBIDDEN"));
      return inTransaction(client, async (tx) => {
        const retailers = createRetailerRepository(tx);
        const retailer = await retailers.findById(retailerId);
        const before = retailer ? amazonConfigOf(retailer) : null;
        if (!before) return fail("NOT_FOUND");

        const next: AmazonConfig = { ...before };
        if (change.kind === "asins") next.asins = change.asins;
        if (change.kind === "add-search") next.searches = [...before.searches, change.search];
        if (change.kind === "remove-search") {
          if (change.index >= before.searches.length) return fail("NOT_FOUND");
          next.searches = before.searches.filter((_, i) => i !== change.index);
        }
        const valid = amazonConfigSchema.safeParse(next);
        if (!valid.success) return fail("LIMIT_REACHED");

        await retailers.updateAdapterConfig(retailerId, valid.data);
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "retailer.tracking",
          entityType: "Retailer",
          entityId: retailerId,
          diff: {
            asins: { from: before.asins.length, to: valid.data.asins.length },
            searches: {
              from: before.searches.map((s) => s.keywords),
              to: valid.data.searches.map((s) => s.keywords),
            },
          },
          createdAt: now,
        });
        return ok(undefined);
      });
    },

    createCategory(params: {
      actor: Actor;
      input: CategoryInput;
      now: Date;
    }): Promise<AdminResult<{ slug: string }>> {
      const { actor, input, now } = params;
      if (!hasRole(actor.role, "ADMIN")) return Promise.resolve(fail("FORBIDDEN"));
      const slug = slugify(input.name);
      if (!slug) return Promise.resolve(fail("DUPLICATE"));
      return inTransaction(client, async (tx) => {
        const categories = createCategoryRepository(tx);
        if (await categories.findBySlug(slug)) return fail("DUPLICATE");
        if (input.parentId && !(await categories.findById(input.parentId)))
          return fail("INVALID_PARENT");
        const created = await categories.create({ slug, ...input });
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "category.create",
          entityType: "Category",
          entityId: created.id,
          diff: { slug, ...input },
          createdAt: now,
        });
        return ok({ slug });
      });
    },

    /** Renames or moves a category. The slug stays fixed so public URLs don't break. */
    updateCategory(params: {
      actor: Actor;
      categoryId: string;
      input: CategoryInput;
      now: Date;
    }): Promise<AdminResult> {
      const { actor, categoryId, input, now } = params;
      if (!hasRole(actor.role, "ADMIN")) return Promise.resolve(fail("FORBIDDEN"));
      return inTransaction(client, async (tx) => {
        const categories = createCategoryRepository(tx);
        const before = await categories.findById(categoryId);
        if (!before) return fail("NOT_FOUND");
        if (input.parentId) {
          if (!(await categories.findById(input.parentId))) return fail("INVALID_PARENT");
          if (await wouldCreateCycle(tx, categoryId, input.parentId)) return fail("INVALID_PARENT");
        }
        await categories.update(categoryId, input);
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "category.update",
          entityType: "Category",
          entityId: categoryId,
          diff: {
            from: { name: before.name, parentId: before.parentId, sortOrder: before.sortOrder },
            to: input,
          },
          createdAt: now,
        });
        return ok(undefined);
      });
    },
  };
}
