import { describe, expect, it } from "vitest";
import { runSeed } from "../../prisma/seed/run-seed";
import { categories } from "../../prisma/seed/reference-data";
import { createCategoryRepository } from "@/server/db/repositories/category.repository";
import { createRetailerRepository } from "@/server/db/repositories/retailer.repository";
import { checkHealth } from "@/server/services/health.service";
import { testDb } from "./setup";

const expectedCategoryCount = categories.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);

describe("seed", () => {
  it("creates the category tree and the mock retailer, and is idempotent", async () => {
    const first = await runSeed(testDb, { includeDevelopmentData: true });
    const second = await runSeed(testDb, { includeDevelopmentData: true });

    expect(first).toEqual({ categoryCount: expectedCategoryCount, retailerCount: 1 });
    expect(second).toEqual(first);
    expect(await testDb.category.count()).toBe(expectedCategoryCount);
    expect(await testDb.retailer.count()).toBe(1);
    expect(await testDb.product.count()).toBe(0);
  });

  it("never creates the mock retailer without development data", async () => {
    await runSeed(testDb, { includeDevelopmentData: false });
    expect(await testDb.retailer.count()).toBe(0);
  });
});

describe("category and retailer repositories", () => {
  it("reads the seeded tree", async () => {
    await runSeed(testDb, { includeDevelopmentData: true });
    const repo = createCategoryRepository(testDb);

    const electronics = await repo.findBySlug("electronics");
    expect(electronics?.parentId).toBeNull();

    const children = await repo.listChildren(electronics!.id);
    expect(children.map((c) => c.slug)).toEqual([
      "headphones-audio",
      "tvs",
      "laptops-computing",
      "phones-tablets",
      "gaming",
    ]);
    expect((await repo.listChildren(null)).length).toBe(categories.length);
    expect(await repo.listAll()).toHaveLength(expectedCategoryCount);
  });

  it("lists retailers by status", async () => {
    await runSeed(testDb, { includeDevelopmentData: true });
    const repo = createRetailerRepository(testDb);

    const mock = await repo.findBySlug("mock-retailer");
    expect(mock).toMatchObject({ integrationType: "MOCK", status: "ACTIVE" });
    expect(await repo.findById(mock!.id)).toMatchObject({ slug: "mock-retailer" });
    expect(await repo.listByStatus()).toHaveLength(1);
    expect(await repo.listByStatus("PAUSED")).toHaveLength(0);
  });
});

describe("health service", () => {
  it("reports the database as reachable", async () => {
    expect(await checkHealth()).toEqual({ status: "ok", database: "ok" });
  });
});
