import { describe, expect, it } from "vitest";
import { runSeed } from "../../prisma/seed/run-seed";
import { GET } from "@/app/api/cron/[job]/route";
import { createJobLockRepository } from "@/server/db/repositories/job-lock.repository";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { ACTIVE_DEAL_STATUSES } from "@/server/deals/workflow";
import { DEFAULT_JOB_SETTINGS, runJob, type JobReport } from "@/server/jobs/jobs";
import { withJobLock } from "@/server/jobs/lock";
import { testDb } from "./setup";

const MINUTE = 60_000;
const DAY = 86_400_000;
const T0 = new Date(Date.UTC(2026, 3, 1, 4, 17));
const day = (n: number) => new Date(T0.getTime() + n * DAY);
const ctx = (now: Date) => ({ client: testDb, now, env: {} });

async function mockRetailer(productCount = 24) {
  await runSeed(testDb, { includeDevelopmentData: true });
  return testDb.retailer.update({
    where: { slug: "mock-retailer" },
    data: { adapterConfig: { productCount } },
  });
}

function completed(report: JobReport) {
  if (report.status !== "completed") throw new Error(`Job was skipped: ${report.reason}`);
  return report;
}

describe("job locks", () => {
  const locks = createJobLockRepository(testDb);

  it("admits one holder at a time and allows takeover after the lease", async () => {
    expect(await locks.acquire("job", "a", T0, 10 * MINUTE)).toBe(true);
    expect(await locks.acquire("job", "b", new Date(T0.getTime() + 5 * MINUTE), 10 * MINUTE)).toBe(
      false,
    );
    expect(await locks.acquire("job", "b", new Date(T0.getTime() + 10 * MINUTE), 10 * MINUTE)).toBe(
      true,
    );
    expect((await locks.find("job"))?.owner).toBe("b");
  });

  it("only lets the owner release", async () => {
    await locks.acquire("job", "a", T0, 10 * MINUTE);
    await locks.release("job", "b");
    expect(await locks.find("job")).not.toBeNull();
    await locks.release("job", "a");
    expect(await locks.find("job")).toBeNull();
  });

  it("lets exactly one of many concurrent callers in", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => locks.acquire("race", `owner-${i}`, T0, MINUTE)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("skips a job while another run holds its lock, and releases after errors", async () => {
    await locks.acquire("busy", "other", T0, 10 * MINUTE);
    expect(await withJobLock(testDb, "busy", T0, MINUTE, async () => 1)).toEqual({
      status: "skipped",
      reason: 'Job "busy" is already running',
    });

    await expect(
      withJobLock(testDb, "free", T0, MINUTE, async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await locks.find("free")).toBeNull();
  });

  it("reports a job as skipped when it is already running", async () => {
    await locks.acquire("detect-deals", "someone-else", T0, 10 * MINUTE);
    expect(await runJob("detect-deals", ctx(T0))).toEqual({
      job: "detect-deals",
      status: "skipped",
      reason: 'Job "detect-deals" is already running',
    });
  });
});

describe("import-catalogue", () => {
  it("resumes a paged import across runs", async () => {
    await mockRetailer(24);
    const settings = { ...DEFAULT_JOB_SETTINGS, cataloguePageSize: 10, cataloguePagesPerRun: 1 };
    const cursors: (string | null | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const report = completed(
        await runJob("import-catalogue", ctx(new Date(T0.getTime() + i * MINUTE)), settings),
      );
      cursors.push(report.retailers?.[0]?.import?.nextCursor);
    }
    expect(cursors).toEqual(["10", "20", null, "10"]); // the fourth run starts a new pass
    expect(await testDb.product.count()).toBe(24);
  });

  it("marks listings inactive once a complete pass no longer returns them", async () => {
    const retailer = await mockRetailer(24);
    completed(await runJob("import-catalogue", ctx(T0)));
    await testDb.retailer.update({
      where: { id: retailer.id },
      data: { adapterConfig: { productCount: 20 } },
    });

    const soon = completed(await runJob("import-catalogue", ctx(day(1))));
    expect(soon.retailers?.[0]?.delisted).toBe(0); // missing for only a day

    const later = completed(await runJob("import-catalogue", ctx(day(4))));
    expect(later.retailers?.[0]?.delisted).toBe(4);
    expect(await testDb.product.count({ where: { isActive: false } })).toBe(4);
  });

  it("detects and expires deals as mock sales start and end", async () => {
    await mockRetailer(8);
    let created = 0;
    let expired = 0;
    for (let d = 0; d < 60; d++) {
      // The import's own detection pass expires deals whose sale ended; expire-deals re-checks the rest.
      const imported = completed(await runJob("import-catalogue", ctx(day(d)))).deals;
      const verified = completed(
        await runJob("expire-deals", ctx(new Date(day(d).getTime() + MINUTE))),
      ).deals;
      created += imported?.created ?? 0;
      expired += (imported?.expired ?? 0) + (verified?.expired ?? 0);
    }
    expect(created).toBeGreaterThan(0);
    expect(expired).toBeGreaterThan(0);
    expect(await testDb.deal.count()).toBe(created);
    // Every deal is either still pending review or was expired by a job.
    const statuses = await testDb.deal.findMany({ select: { status: true } });
    expect(statuses.every((d) => d.status === "PENDING_REVIEW" || d.status === "EXPIRED")).toBe(
      true,
    );
  });

  it("records a broken integration without stopping other retailers", async () => {
    await mockRetailer(4);
    await testDb.retailer.create({
      data: {
        slug: "broken",
        name: "Broken",
        websiteUrl: "https://broken.invalid",
        adapterKey: "missing",
        integrationType: "MANUAL",
      },
    });
    const report = completed(await runJob("import-catalogue", ctx(T0)));
    expect(report.retailers).toEqual([
      { retailer: "broken", error: 'No retailer adapter registered for key "missing"' },
      expect.objectContaining({
        retailer: "mock-retailer",
        import: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    ]);
  });
});

describe("refresh-prices", () => {
  it("re-prices listings, deals first", async () => {
    const retailer = await mockRetailer(6);
    for (let d = 0; d < 45; d++) completed(await runJob("import-catalogue", ctx(day(d))));
    const dealProductIds = (
      await testDb.deal.findMany({
        where: { status: { in: [...ACTIVE_DEAL_STATUSES] } },
        select: { productId: true },
      })
    ).map((d) => d.productId);
    expect(dealProductIds.length).toBeGreaterThan(0);

    const order = await createProductRepository(testDb).listForPriceRefresh(
      retailer.id,
      ACTIVE_DEAL_STATUSES,
      6,
    );
    expect(new Set(order.slice(0, dealProductIds.length).map((p) => p.id))).toEqual(
      new Set(dealProductIds),
    );
    expect(order).toHaveLength(6);

    const report = completed(
      await runJob("refresh-prices", ctx(new Date(day(44).getTime() + 3 * 3_600_000))),
    );
    expect(report.retailers?.[0]?.import).toMatchObject({ status: "SUCCEEDED", itemsUpserted: 6 });
    expect(report.deals).toBeDefined();
  });
});

describe("cron route", () => {
  const secret = "integration-test-cron-secret-0123456789";
  const call = (job: string, authorization?: string) =>
    GET(
      new Request(`http://localhost/api/cron/${job}`, {
        headers: authorization ? { authorization } : {},
      }),
      {
        params: Promise.resolve({ job }),
      },
    );

  it.each([undefined, "Bearer wrong", secret])(
    "rejects authorization %j",
    async (authorization) => {
      const response = await call("detect-deals", authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("does not reveal unknown jobs to unauthenticated callers", async () => {
    expect((await call("nope")).status).toBe(401);
  });

  it("returns 404 for an unknown job", async () => {
    expect((await call("nope", `Bearer ${secret}`)).status).toBe(404);
  });

  it("runs a job and returns its report", async () => {
    const response = await call("expire-deals", `Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: "expire-deals", status: "completed" });
  });
});
