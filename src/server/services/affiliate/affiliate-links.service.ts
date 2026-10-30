import "server-only";
import { generateLinkCode } from "@/server/affiliate";
import { createAffiliateRepository } from "@/server/db/repositories/affiliate.repository";
import type { DbClient } from "@/server/db/types";
import { isAllowedUrl, type RetailerAdapter } from "@/server/retailers";

const MAX_CODE_ATTEMPTS = 5;

export class AffiliateLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AffiliateLinkError";
  }
}

export type LinkSyncResult = { code: string; change: "created" | "updated" | "unchanged" };

/**
 * Keeps each product's outbound link in step with its retailer page. This is the only code
 * that writes AffiliateLink rows (docs/ARCHITECTURE.md §10).
 */
export function createAffiliateLinkService(
  client: DbClient,
  options: { generateCode?: () => string } = {},
) {
  const generateCode = options.generateCode ?? (() => generateLinkCode());
  const repo = createAffiliateRepository(client);

  return {
    /**
     * Builds the outbound URL with the retailer's adapter, checks it against the adapter's
     * allowed hosts, then creates or updates the product's link. The code never changes, so
     * links already on pages keep working.
     */
    async syncProductLink(params: {
      retailerId: string;
      productId: string;
      productUrl: string;
      adapter: Pick<RetailerAdapter, "key" | "allowedHosts" | "buildAffiliateUrl">;
    }): Promise<LinkSyncResult> {
      const { adapter } = params;
      const destinationUrl = adapter.buildAffiliateUrl(params.productUrl);
      if (!isAllowedUrl(adapter, destinationUrl)) {
        throw new AffiliateLinkError(`Affiliate URL host is not allowed: ${destinationUrl}`);
      }
      const wanted = { destinationUrl, network: adapter.key, isActive: true };

      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const existing = await repo.findProductLink(params.productId);
        if (existing) {
          const same =
            existing.destinationUrl === wanted.destinationUrl &&
            existing.network === wanted.network &&
            existing.isActive;
          if (same) return { code: existing.code, change: "unchanged" };
          await repo.updateLink(existing.id, wanted);
          return { code: existing.code, change: "updated" };
        }
        const code = generateCode();
        const inserted = await repo.insertProductLink({
          code,
          retailerId: params.retailerId,
          productId: params.productId,
          destinationUrl,
          network: adapter.key,
        });
        if (inserted) return { code, change: "created" };
        // The code was taken, or another run created this product's link: look again.
      }
      throw new AffiliateLinkError("Could not allocate a unique link code");
    },
  };
}

export type AffiliateLinkService = ReturnType<typeof createAffiliateLinkService>;
