import { afterEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "../../prisma/seed/run-seed";
import { runJob } from "@/server/jobs/jobs";
import {
  asinFor,
  createFakeCreatorsApi,
  fakeItem,
  TEST_ENV,
} from "@/server/retailers/adapters/amazon/fake-api.test-kit";
import { getAmazonTracking } from "@/server/services/admin";
import { createAdminCatalogueService } from "@/server/services/admin/admin-catalogue.service";
import { createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 9, 1, 12));
const catalogue = createAdminCatalogueService(testDb);

async function amazon() {
  await runSeed(testDb, { includeDevelopmentData: false });
  return testDb.retailer.findUniqueOrThrow({ where: { slug: "amazon-uk" } });
}

async function admin() {
  const user = await createUser(`admin-${Math.random()}@example.test`, "ADMIN");
  return { id: user.id, role: user.role };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Amazon UK retailer", () => {
  it("is seeded paused with nothing to track, and re-seeding keeps admin changes", async () => {
    const retailer = await amazon();
    expect(retailer).toMatchObject({
      name: "Amazon UK",
      adapterKey: "amazon",
      status: "PAUSED",
      trustScore: 80,
      adapterConfig: { marketplace: "www.amazon.co.uk", asins: [], searches: [] },
    });
    await testDb.retailer.update({
      where: { id: retailer.id },
      data: { status: "ACTIVE", adapterConfig: { asins: [asinFor(1)] } },
    });
    await runSeed(testDb, { includeDevelopmentData: false });
    expect(await testDb.retailer.findUniqueOrThrow({ where: { id: retailer.id } })).toMatchObject({
      status: "ACTIVE",
      adapterConfig: { asins: [asinFor(1)] },
    });
  });

  it("reports which credentials are missing, by name only", async () => {
    const retailer = await amazon();
    vi.stubEnv("AMAZON_ASSOCIATE_TAG", "dealfinder-21");
    vi.stubEnv("AMAZON_CREATORS_CREDENTIAL_ID", "");
    const tracking = await getAmazonTracking(retailer.id);
    expect(tracking?.missingEnv).toContain("AMAZON_CREATORS_CREDENTIAL_ID");
    expect(tracking?.missingEnv).not.toContain("AMAZON_ASSOCIATE_TAG");
    const mock = await createUser("not-a-retailer@example.test");
    expect(await getAmazonTracking(mock.id)).toBeNull();
  });
});

describe("tracking settings", () => {
  it("saves ASINs and searches, audited, for admins only", async () => {
    const retailer = await amazon();
    const actor = await admin();
    const update = (change: Parameters<typeof catalogue.updateAmazonTracking>[0]["change"]) =>
      catalogue.updateAmazonTracking({ actor, retailerId: retailer.id, change, now: NOW });

    expect(await update({ kind: "asins", asins: [asinFor(1), asinFor(2)] })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await update({ kind: "add-search", search: { keywords: "air fryer", pages: 2 } }),
    ).toMatchObject({ ok: true });
    expect(
      await update({
        kind: "add-search",
        search: {
          keywords: "kettle",
          searchIndex: "HomeAndKitchen",
          minSavingPercent: 30,
          pages: 1,
        },
      }),
    ).toMatchObject({ ok: true });
    expect(await update({ kind: "remove-search", index: 0 })).toMatchObject({ ok: true });
    expect(await update({ kind: "remove-search", index: 5 })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });

    expect((await getAmazonTracking(retailer.id))?.config).toEqual({
      marketplace: "www.amazon.co.uk",
      asins: [asinFor(1), asinFor(2)],
      searches: [
        { keywords: "kettle", searchIndex: "HomeAndKitchen", minSavingPercent: 30, pages: 1 },
      ],
    });
    expect(
      await testDb.auditLog.count({
        where: { action: "retailer.tracking", entityId: retailer.id },
      }),
    ).toBe(4);

    const editor = await createUser("editor@example.test", "EDITOR");
    expect(
      await catalogue.updateAmazonTracking({
        actor: { id: editor.id, role: editor.role },
        retailerId: retailer.id,
        change: { kind: "asins", asins: [] },
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("refuses other retailers and more than the limit", async () => {
    const retailer = await amazon();
    const actor = await admin();
    await runSeed(testDb, { includeDevelopmentData: true });
    const mock = await testDb.retailer.findUniqueOrThrow({ where: { slug: "mock-retailer" } });
    expect(
      await catalogue.updateAmazonTracking({
        actor,
        retailerId: mock.id,
        change: { kind: "asins", asins: [] },
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    const tooMany = Array.from({ length: 5001 }, (_, i) => `B${String(i).padStart(9, "0")}`);
    expect(
      await catalogue.updateAmazonTracking({
        actor,
        retailerId: retailer.id,
        change: { kind: "asins", asins: tooMany },
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "LIMIT_REACHED" });
  });
});

describe("importing from Amazon (fake Creators API)", () => {
  it("imports tracked products with tagged outbound links, then refreshes prices", async () => {
    const retailer = await amazon();
    await testDb.retailer.update({
      where: { id: retailer.id },
      data: { status: "ACTIVE", adapterConfig: { asins: [asinFor(1), asinFor(2), asinFor(3)] } },
    });
    const api = createFakeCreatorsApi({ items: [fakeItem(1), fakeItem(2), fakeItem(3)] });
    vi.stubGlobal("fetch", api.fetch);

    const report = await runJob("import-catalogue", { client: testDb, now: NOW, env: TEST_ENV });
    expect(report).toMatchObject({
      status: "completed",
      retailers: [{ retailer: "amazon-uk", import: { status: "SUCCEEDED", itemsUpserted: 3 } }],
    });
    const product = await testDb.product.findFirstOrThrow({
      where: { externalId: asinFor(1) },
      include: { variants: true, affiliateLinks: true },
    });
    expect(product).toMatchObject({
      title: "Test Kettle 1",
      productUrl: `https://www.amazon.co.uk/dp/${asinFor(1)}`,
      variants: [{ currentPrice: 2099 }],
      affiliateLinks: [
        { destinationUrl: `https://www.amazon.co.uk/dp/${asinFor(1)}?tag=dealfinder-21` },
      ],
    });

    const refresh = await runJob("refresh-prices", {
      client: testDb,
      now: new Date(NOW.getTime() + 3_600_000),
      env: TEST_ENV,
    });
    expect(refresh).toMatchObject({
      status: "completed",
      retailers: [{ retailer: "amazon-uk", import: { status: "SUCCEEDED" } }],
    });
  });

  it("reports a missing configuration without stopping other retailers", async () => {
    const retailer = await amazon();
    await testDb.retailer.update({
      where: { id: retailer.id },
      data: { status: "ACTIVE", adapterConfig: { asins: [asinFor(1)] } },
    });
    const report = await runJob("import-catalogue", { client: testDb, now: NOW, env: {} });
    expect(report).toMatchObject({
      status: "completed",
      retailers: [
        {
          retailer: "amazon-uk",
          import: { status: "FAILED" },
        },
      ],
    });
  });
});
