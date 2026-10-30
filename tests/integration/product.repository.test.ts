import { describe, expect, it } from "vitest";
import { createProductRepository, productSlug } from "@/server/db/repositories/product.repository";
import { createRetailer, listingInput } from "./factories";
import { testDb } from "./setup";

const products = createProductRepository(testDb);

describe("product repository", () => {
  it("creates a listing with its default variant and a stable slug", async () => {
    const retailer = await createRetailer();
    const product = await products.upsertListing(listingInput(retailer.id));

    expect(product.slug).toBe(productSlug("Example Wireless Headphones", retailer.id, "SKU-1"));
    expect(product.slug).toMatch(/^example-wireless-headphones-[0-9a-f]{8}$/);
    expect(product.retailer.id).toBe(retailer.id);
    expect(product.lastSeenAt).toEqual(new Date("2026-01-01T10:00:00Z"));
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({ isDefault: true, currentPrice: 9999 });
  });

  it("is idempotent and keeps the slug when the title changes", async () => {
    const retailer = await createRetailer();
    const first = await products.upsertListing(listingInput(retailer.id));
    const second = await products.upsertListing(
      listingInput(retailer.id, {
        title: "Renamed Headphones",
        seenAt: new Date("2026-01-02T00:00:00Z"),
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.slug).toBe(first.slug);
    expect(second.title).toBe("Renamed Headphones");
    expect(second.lastSeenAt).toEqual(new Date("2026-01-02T00:00:00Z"));
    expect(await testDb.product.count()).toBe(1);
    expect(await testDb.productVariant.count()).toBe(1);
  });

  it("treats the same external ID at different retailers as separate listings", async () => {
    const a = await createRetailer();
    const b = await createRetailer();
    const pa = await products.upsertListing(listingInput(a.id));
    const pb = await products.upsertListing(listingInput(b.id));

    expect(pa.id).not.toBe(pb.id);
    expect(pa.slug).not.toBe(pb.slug);
  });

  it("moves the default flag between variants", async () => {
    const retailer = await createRetailer();
    const variant = (externalId: string, isDefault: boolean) => ({
      externalId,
      name: externalId,
      isDefault,
      currentPrice: 1000,
      availability: "IN_STOCK" as const,
    });
    await products.upsertListing(
      listingInput(retailer.id, { variants: [variant("BLACK", true), variant("WHITE", false)] }),
    );
    const updated = await products.upsertListing(
      listingInput(retailer.id, { variants: [variant("BLACK", false), variant("WHITE", true)] }),
    );

    expect(updated.variants.map((v) => [v.externalId, v.isDefault])).toEqual([
      ["WHITE", true],
      ["BLACK", false],
    ]);
  });

  it("keeps variants that disappear from the feed", async () => {
    const retailer = await createRetailer();
    const base = { name: "v", currentPrice: 500, availability: "IN_STOCK" as const };
    await products.upsertListing(
      listingInput(retailer.id, {
        variants: [
          { ...base, externalId: "A", isDefault: true },
          { ...base, externalId: "B", isDefault: false },
        ],
      }),
    );
    const updated = await products.upsertListing(
      listingInput(retailer.id, { variants: [{ ...base, externalId: "A", isDefault: true }] }),
    );
    expect(updated.variants).toHaveLength(2);
  });

  it.each([
    ["no default variant", false, false],
    ["two default variants", true, true],
  ])("rejects %s", async (_label, firstDefault, secondDefault) => {
    const retailer = await createRetailer();
    const base = { name: "v", currentPrice: 500, availability: "IN_STOCK" as const };
    await expect(
      products.upsertListing(
        listingInput(retailer.id, {
          variants: [
            { ...base, externalId: "A", isDefault: firstDefault },
            { ...base, externalId: "B", isDefault: secondDefault },
          ],
        }),
      ),
    ).rejects.toThrow("exactly one default variant");
    expect(await testDb.product.count()).toBe(0);
  });

  it("rejects duplicate variant external IDs", async () => {
    const retailer = await createRetailer();
    const base = { name: "v", currentPrice: 500, availability: "IN_STOCK" as const };
    await expect(
      products.upsertListing(
        listingInput(retailer.id, {
          variants: [
            { ...base, externalId: "A", isDefault: true },
            { ...base, externalId: "A", isDefault: false },
          ],
        }),
      ),
    ).rejects.toThrow("must be unique");
  });

  it("finds listings by slug and by external ID", async () => {
    const retailer = await createRetailer();
    const created = await products.upsertListing(listingInput(retailer.id));

    expect((await products.findBySlug(created.slug))?.id).toBe(created.id);
    expect((await products.findByExternalId(retailer.id, "SKU-1"))?.id).toBe(created.id);
    expect(await products.findBySlug("missing")).toBeNull();
  });

  it("rolls back the whole listing when a variant write fails", async () => {
    const retailer = await createRetailer();
    await expect(
      products.upsertListing(
        listingInput(retailer.id, {
          variants: [
            {
              externalId: "A",
              name: "v",
              isDefault: true,
              currentPrice: -1,
              availability: "IN_STOCK",
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(await testDb.product.count()).toBe(0);
  });
});
