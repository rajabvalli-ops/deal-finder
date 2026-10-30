import { describe, expect, it } from "vitest";
import { isAllowedUrl } from "./registry";
import {
  normalisedPriceUpdateSchema,
  normalisedProductSchema,
  type NormalisedProduct,
} from "./schemas";
import type { AdapterContext, RetailerAdapter } from "./types";

/**
 * Behaviour every RetailerAdapter must satisfy. Each adapter's test file calls this with a
 * factory that returns an adapter backed by recorded fixtures — never the live network.
 */
export function describeAdapterContract(
  name: string,
  makeAdapter: (context: AdapterContext) => RetailerAdapter,
  options: { now: Date; pageSize?: number },
) {
  const context: AdapterContext = { now: () => options.now, env: {} };
  const pageSize = options.pageSize ?? 5;

  async function fetchAll(adapter: RetailerAdapter): Promise<NormalisedProduct[]> {
    const items: NormalisedProduct[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const result = await adapter.fetchCatalogue({ cursor, limit: pageSize });
      expect(result.items.length).toBeLessThanOrEqual(pageSize);
      items.push(...result.items);
      if (result.nextCursor === null) return items;
      cursor = result.nextCursor;
    }
    throw new Error("Catalogue pagination did not terminate");
  }

  describe(`${name} adapter contract`, () => {
    it("declares at least one allowed host", () => {
      expect(makeAdapter(context).allowedHosts.length).toBeGreaterThan(0);
    });

    it("pages through the catalogue without duplicates", async () => {
      const items = await fetchAll(makeAdapter(context));
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map((i) => i.externalId)).size).toBe(items.length);
    });

    it("returns only products that pass the normalised schema", async () => {
      for (const item of await fetchAll(makeAdapter(context))) {
        const result = normalisedProductSchema.safeParse(item);
        expect(result.error?.issues ?? [], item.externalId).toEqual([]);
      }
    });

    it("links only to allowed hosts, including affiliate URLs", async () => {
      const adapter = makeAdapter(context);
      for (const item of await fetchAll(adapter)) {
        expect(isAllowedUrl(adapter, item.productUrl), item.productUrl).toBe(true);
        const affiliate = adapter.buildAffiliateUrl(item.productUrl);
        expect(isAllowedUrl(adapter, affiliate), affiliate).toBe(true);
      }
    });

    it("returns prices for known products, matching the catalogue, and omits unknown IDs", async () => {
      const adapter = makeAdapter(context);
      const items = await fetchAll(adapter);
      const ids = items.slice(0, 3).map((i) => i.externalId);
      const updates = await adapter.fetchPrices([...ids, "definitely-not-a-real-id"]);

      expect(updates.map((u) => u.productExternalId).sort()).toEqual([...ids].sort());
      for (const update of updates) {
        expect(normalisedPriceUpdateSchema.safeParse(update).success).toBe(true);
        const product = items.find((i) => i.externalId === update.productExternalId)!;
        expect(update.variants.map((v) => v.externalId).sort()).toEqual(
          product.variants.map((v) => v.externalId).sort(),
        );
      }
    });

    it("is deterministic for a fixed clock", async () => {
      expect(await fetchAll(makeAdapter(context))).toEqual(await fetchAll(makeAdapter(context)));
    });

    it("passes its health check", async () => {
      expect((await makeAdapter(context).healthCheck()).ok).toBe(true);
    });
  });
}
