import { describe, expect, it, vi } from "vitest";
import { describeAdapterContract } from "../../contract.test-kit";
import { normalisedProductSchema } from "../../schemas";
import type { AdapterContext } from "../../types";
import { AmazonApiError, createCreatorsApiClient, REQUEST_INTERVAL_MS } from "./client";
import { asinFor, createFakeCreatorsApi, fakeItem, TEST_ENV } from "./fake-api.test-kit";
import { AmazonNotConfiguredError, createAmazonAdapter } from "./index";
import { offerOf, toNormalisedProduct, type AmazonItem } from "./normalise";

const NOW = new Date(Date.UTC(2026, 9, 1, 12));
const ITEMS = Array.from({ length: 25 }, (_, i) => fakeItem(i + 1));
const CONFIG = {
  asins: ITEMS.slice(0, 15).map((i) => i.asin as string),
  searches: [{ keywords: "kettle", pages: 2 }],
};
const SEARCHES = { kettle: ITEMS.slice(15) };
const noSleep = async () => undefined;

function setup(
  options: {
    config?: unknown;
    env?: Record<string, string>;
    respond?: Parameters<typeof createFakeCreatorsApi>[0]["respond"];
  } = {},
) {
  const api = createFakeCreatorsApi({ items: ITEMS, searches: SEARCHES, respond: options.respond });
  const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
  const context: AdapterContext = {
    now: () => NOW,
    env: options.env ?? TEST_ENV,
    fetch: api.fetch,
    sleep,
  };
  const adapter = createAmazonAdapter(options.config ?? CONFIG, context);
  return { adapter, api, sleep };
}

describeAdapterContract(
  "amazon (fake Creators API)",
  (context) => {
    const api = createFakeCreatorsApi({ items: ITEMS, searches: SEARCHES });
    return createAmazonAdapter(CONFIG, {
      ...context,
      env: TEST_ENV,
      fetch: api.fetch,
      sleep: noSleep,
    });
  },
  { now: NOW },
);

describe("amazon adapter: catalogue", () => {
  it("reads tracked ASINs in batches of ten, then each search page", async () => {
    const { adapter, api } = setup();
    const cursors: (string | null)[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await adapter.fetchCatalogue({ cursor, limit: 100 });
      seen.push(...page.items.map((i) => i.externalId));
      cursor = page.nextCursor;
      cursors.push(cursor);
    } while (cursor);
    expect(cursors).toEqual(["a:10", "s:0:1", null]);
    expect(seen).toEqual(ITEMS.map((i) => i.asin));

    const calls = api.requests.filter((r) => r.url.startsWith("https://creatorsapi.amazon"));
    expect(calls.map((c) => c.url.replace("https://creatorsapi.amazon", ""))).toEqual([
      "/catalog/v1/getItems",
      "/catalog/v1/getItems",
      "/catalog/v1/searchItems",
    ]);
    expect(calls[0]!.headers).toMatchObject({
      authorization: "Bearer token-1",
      "x-marketplace": "www.amazon.co.uk",
      "content-type": "application/json",
    });
    expect(calls[0]!.body).toMatchObject({
      partnerTag: "dealfinder-21",
      condition: "New",
      itemIds: CONFIG.asins.slice(0, 10),
      resources: expect.arrayContaining(["itemInfo.title", "offersV2.listings.price"]),
    });
    expect(calls[2]!.body).toMatchObject({ keywords: "kettle", itemCount: 10, itemPage: 1 });
  });

  it("normalises items: canonical link, pence, GTIN, features and category", async () => {
    const { adapter } = setup();
    const [first] = (await adapter.fetchCatalogue({ cursor: null, limit: 1 })).items;
    expect(first).toEqual({
      externalId: asinFor(1),
      title: "Test Kettle 1",
      brand: "Testbrand",
      model: "TK-1",
      gtin: "5012345678901",
      description: "1.7 litre\nRapid boil",
      imageUrl: "https://m.media-amazon.com/images/I/test-1.jpg",
      productUrl: `https://www.amazon.co.uk/dp/${asinFor(1)}`,
      categoryHint: "Kettles",
      currency: "GBP",
      availability: "IN_STOCK",
      rating: 4.5,
      reviewCount: 101,
      variants: [
        {
          externalId: asinFor(1),
          name: "Default",
          isDefault: true,
          price: 2099,
          availability: "IN_STOCK",
        },
      ],
    });
  });

  it("passes search options and stops when a search runs out of results", async () => {
    const { adapter, api } = setup({
      config: {
        searches: [
          { keywords: "kettle", searchIndex: "HomeAndKitchen", minSavingPercent: 40, pages: 5 },
          { keywords: "nothing here" },
        ],
      },
    });
    const first = await adapter.fetchCatalogue({ cursor: null, limit: 10 });
    expect(first).toEqual({ items: [], nextCursor: "s:0:1" });
    const page1 = await adapter.fetchCatalogue({ cursor: "s:0:1", limit: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.nextCursor).toBe("s:1:1");
    const empty = await adapter.fetchCatalogue({ cursor: "s:1:1", limit: 10 });
    expect(empty).toEqual({ items: [], nextCursor: null });
    expect(api.requests.at(-2)!.body).toMatchObject({
      searchIndex: "HomeAndKitchen",
      minSavingPercent: 40,
    });
  });

  it("leaves out items it can't use", async () => {
    const { adapter } = setup({
      respond: (r) =>
        r.url.endsWith("getItems")
          ? Response.json({ itemsResult: { items: [fakeItem(1), { asin: asinFor(2) }] } })
          : undefined,
    });
    const page = await adapter.fetchCatalogue({ cursor: null, limit: 10 });
    expect(page.items.map((i) => i.externalId)).toEqual([asinFor(1)]);
  });

  it.each(["x", "a:-1", "s:0:0", "s:9:1"])("rejects the cursor %j", async (cursor) => {
    await expect(setup().adapter.fetchCatalogue({ cursor, limit: 5 })).rejects.toThrow(
      "Invalid cursor",
    );
  });

  it.each([
    { asins: ["not-an-asin"] },
    { marketplace: "www.amazon.com" },
    { searches: [{ keywords: "x" }] },
    { searches: [{ keywords: "kettle", pages: 11 }] },
  ])("rejects invalid config %j", (config) => {
    expect(() => setup({ config })).toThrow();
  });
});

describe("amazon adapter: prices", () => {
  it("looks up prices ten at a time, skipping unknown and invalid IDs", async () => {
    const { adapter, api, sleep } = setup();
    const ids = [...ITEMS.slice(0, 12).map((i) => i.asin as string), "B0NOPE0000", "nope"];
    const updates = await adapter.fetchPrices([...ids, asinFor(1)]);
    expect(updates).toHaveLength(12);
    expect(updates[0]).toEqual({
      productExternalId: asinFor(1),
      currency: "GBP",
      variants: [{ externalId: asinFor(1), price: 2099, availability: "IN_STOCK" }],
    });
    const calls = api.requests.filter((r) => r.url.endsWith("getItems"));
    expect(calls.map((c) => (c.body as { itemIds: string[] }).itemIds.length)).toEqual([10, 3]);
    expect(calls[0]!.body).toMatchObject({
      resources: expect.not.arrayContaining(["itemInfo.title"]),
    });
    // One request a second: a pause before every call after the first.
    expect(sleep).toHaveBeenCalledWith(REQUEST_INTERVAL_MS);
  });

  it("treats a response with only errors as no items", async () => {
    const { adapter } = setup({
      respond: (r) =>
        r.url.endsWith("getItems")
          ? Response.json({ errors: [{ code: "ItemNotAccessible", message: "x" }] })
          : undefined,
    });
    expect(await adapter.fetchPrices([asinFor(1)])).toEqual([]);
  });

  it("ignores items Amazon returns that weren't asked for", async () => {
    const { adapter } = setup({
      respond: (r) =>
        r.url.endsWith("getItems")
          ? Response.json({ itemsResult: { items: [fakeItem(99), { asin: 42 }] } })
          : undefined,
    });
    expect(await adapter.fetchPrices([asinFor(1)])).toEqual([]);
  });
});

describe("amazon adapter: affiliate links", () => {
  const { adapter } = setup();

  it("adds the Associates tag to the canonical product page", () => {
    expect(adapter.buildAffiliateUrl(`https://www.amazon.co.uk/dp/${asinFor(1)}`)).toBe(
      `https://www.amazon.co.uk/dp/${asinFor(1)}?tag=dealfinder-21`,
    );
    expect(
      adapter.buildAffiliateUrl(
        `https://www.amazon.co.uk/Some-Name/dp/${asinFor(2)}/ref=x?tag=someone-else-21#top`,
      ),
    ).toBe(`https://www.amazon.co.uk/dp/${asinFor(2)}?tag=dealfinder-21`);
    expect(adapter.buildAffiliateUrl("https://www.amazon.co.uk/deals?x=1")).toBe(
      "https://www.amazon.co.uk/deals?tag=dealfinder-21",
    );
  });

  it("refuses to build untagged links", () => {
    const { adapter: untagged } = setup({ env: { ...TEST_ENV, AMAZON_ASSOCIATE_TAG: "" } });
    expect(() => untagged.buildAffiliateUrl(`https://www.amazon.co.uk/dp/${asinFor(1)}`)).toThrow(
      AmazonNotConfiguredError,
    );
    const { adapter: badTag } = setup({ env: { ...TEST_ENV, AMAZON_ASSOCIATE_TAG: "bad tag!" } });
    expect(() => badTag.buildAffiliateUrl(`https://www.amazon.co.uk/dp/${asinFor(1)}`)).toThrow(
      "AMAZON_ASSOCIATE_TAG (letters, digits and hyphens)",
    );
  });
});

describe("amazon adapter: configuration and health", () => {
  it("reports missing credentials without calling Amazon", async () => {
    const { adapter, api } = setup({ env: {} });
    expect(await adapter.healthCheck()).toEqual({
      ok: false,
      detail:
        "Amazon is not configured: set AMAZON_CREATORS_CREDENTIAL_ID, AMAZON_CREATORS_CREDENTIAL_SECRET, AMAZON_CREATORS_CREDENTIAL_VERSION, AMAZON_ASSOCIATE_TAG",
    });
    await expect(adapter.fetchPrices([asinFor(1)])).rejects.toThrow(AmazonNotConfiguredError);
    expect(api.requests).toEqual([]);
  });

  it("is healthy once it can sign in", async () => {
    expect(await setup().adapter.healthCheck()).toEqual({
      ok: true,
      detail: "Signed in; tracking 15 ASINs and 1 searches",
    });
  });

  it("reports a failed sign-in", async () => {
    const failing = setup({
      respond: (r) => (r.url.includes("/auth/") ? new Response("no", { status: 401 }) : undefined),
    });
    expect(await failing.adapter.healthCheck()).toEqual({
      ok: false,
      detail: "Amazon token request failed (401)",
    });
    const broken = setup({
      respond: (r) => {
        if (r.url.includes("/auth/")) throw new TypeError("network down");
        return undefined;
      },
    });
    expect(await broken.adapter.healthCheck()).toEqual({
      ok: false,
      detail: "Amazon sign-in failed",
    });
  });

  it("does nothing for an empty batch", async () => {
    const { adapter, api } = setup({ config: {} });
    expect(await adapter.fetchCatalogue({ cursor: null, limit: 10 })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(api.requests).toEqual([]);
  });
});

describe("creators API client", () => {
  const base = {
    marketplace: "www.amazon.co.uk",
    sleep: noSleep,
    clock: () => 0,
  };
  const credentials = (version: string) => ({
    credentialId: "id",
    credentialSecret: "secret",
    version,
  });

  it("signs in with Login with Amazon (3.x) as JSON", async () => {
    const api = createFakeCreatorsApi({ items: [] });
    const client = createCreatorsApiClient({
      ...base,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    expect(await client.accessToken()).toBe("token-1");
    expect(api.requests[0]).toEqual({
      url: "https://api.amazon.co.uk/auth/o2/token",
      headers: { "content-type": "application/json" },
      body: {
        grant_type: "client_credentials",
        client_id: "id",
        client_secret: "secret",
        scope: "creatorsapi::default",
      },
    });
  });

  it("signs in with Cognito (2.x) as a form and sends the version with the token", async () => {
    const api = createFakeCreatorsApi({ items: [fakeItem(1)] });
    const client = createCreatorsApiClient({
      ...base,
      credentials: credentials("2.2"),
      fetch: api.fetch,
    });
    await client.call("/catalog/v1/getItems", { itemIds: [asinFor(1)] });
    expect(api.requests[0]).toMatchObject({
      url: "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: { scope: "creatorsapi/default", grant_type: "client_credentials" },
    });
    expect(api.requests[1]!.headers.authorization).toBe("Bearer token-1, Version 2.2");
  });

  it("rejects unknown credential versions", () => {
    expect(() =>
      createCreatorsApiClient({ ...base, credentials: credentials("9.9"), fetch: fetch }),
    ).toThrow('Unsupported Creators API credential version "9.9"');
  });

  it("reuses a token until shortly before it expires", async () => {
    let now = 0;
    const api = createFakeCreatorsApi({
      items: [fakeItem(1)],
      respond: (r) =>
        r.url.includes("/auth/") ? Response.json({ access_token: `t${now}` }) : undefined,
    });
    const client = createCreatorsApiClient({
      ...base,
      clock: () => now,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    expect(await client.accessToken()).toBe("t0");
    now = 3_000_000; // default lifetime is an hour, refreshed a minute early
    expect(await client.accessToken()).toBe("t0");
    now = 3_540_001;
    expect(await client.accessToken()).toBe("t3540001");
  });

  it("rejects a token response without a token", async () => {
    const api = createFakeCreatorsApi({
      items: [],
      respond: () => Response.json({ token_type: "bearer" }),
    });
    const client = createCreatorsApiClient({
      ...base,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    await expect(client.accessToken()).rejects.toThrow("Amazon token response had no access token");
  });

  it("gets a new token once after a 401", async () => {
    let rejected = 0;
    const api = createFakeCreatorsApi({
      items: [fakeItem(1)],
      respond: (r) =>
        r.url.endsWith("getItems") && rejected++ === 0
          ? new Response("", { status: 401 })
          : undefined,
    });
    const client = createCreatorsApiClient({
      ...base,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    const result = await client.call<{ itemsResult: { items: AmazonItem[] } }>(
      "/catalog/v1/getItems",
      {
        itemIds: [asinFor(1)],
      },
    );
    expect(result?.itemsResult.items).toHaveLength(1);
    expect(api.requests.filter((r) => r.url.includes("/auth/"))).toHaveLength(2);
  });

  it("backs off on throttling, honouring Retry-After, then gives up", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
    const api = createFakeCreatorsApi({
      items: [],
      respond: (r) =>
        r.url.endsWith("getItems")
          ? Response.json(
              { errors: [{ code: "TooManyRequests", message: "Slow down" }] },
              { status: 429, headers: { "Retry-After": "3" } },
            )
          : undefined,
    });
    const client = createCreatorsApiClient({
      ...base,
      sleep,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    const error = await client.call("/catalog/v1/getItems", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmazonApiError);
    expect(error).toMatchObject({
      status: 429,
      message: "Amazon /catalog/v1/getItems failed (429): TooManyRequests — Slow down",
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      3000,
      REQUEST_INTERVAL_MS,
      3000,
      REQUEST_INTERVAL_MS,
    ]);
  });

  it("retries server errors with growing waits and recovers", async () => {
    let failures = 0;
    const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
    const api = createFakeCreatorsApi({
      items: [fakeItem(1)],
      respond: (r) =>
        r.url.endsWith("getItems") && failures++ < 2
          ? new Response("oops", { status: 503 })
          : undefined,
    });
    const client = createCreatorsApiClient({
      ...base,
      sleep,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    expect(await client.call("/catalog/v1/getItems", { itemIds: [asinFor(1)] })).not.toBeNull();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      2000,
      REQUEST_INTERVAL_MS,
      4000,
      REQUEST_INTERVAL_MS,
    ]);
  });

  it.each([
    [{ reason: "InvalidAssociate", message: "Bad tag" }, "InvalidAssociate — Bad tag"],
    [{}, "no details"],
    ["not json", "no details"],
  ])("explains a rejected request (%j)", async (body, detail) => {
    const api = createFakeCreatorsApi({
      items: [],
      respond: (r) =>
        r.url.endsWith("getItems")
          ? new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 400 })
          : undefined,
    });
    const client = createCreatorsApiClient({
      ...base,
      credentials: credentials("3.2"),
      fetch: api.fetch,
    });
    await expect(client.call("/catalog/v1/getItems", {})).rejects.toThrow(
      `Amazon /catalog/v1/getItems failed (400): ${detail}`,
    );
  });
});

describe("normalising items", () => {
  const options = { host: "www.amazon.co.uk", currency: "GBP" };

  it("skips items without an ASIN or title", () => {
    expect(toNormalisedProduct({ asin: "short" }, options)).toBeNull();
    expect(
      toNormalisedProduct(
        { asin: asinFor(1), itemInfo: { title: { displayValue: " " } } },
        options,
      ),
    ).toBeNull();
  });

  it("copes with a bare item", () => {
    const product = toNormalisedProduct(
      { asin: asinFor(1), itemInfo: { title: { displayValue: "Bare" } } },
      options,
    );
    expect(product).toMatchObject({
      brand: null,
      model: null,
      gtin: null,
      description: null,
      imageUrl: null,
      categoryHint: null,
      rating: null,
      reviewCount: null,
      availability: "OUT_OF_STOCK",
      variants: [{ price: null, availability: "OUT_OF_STOCK" }],
    });
    expect(normalisedProductSchema.safeParse(product).success).toBe(true);
  });

  it("drops unusable optional values", () => {
    const product = toNormalisedProduct(
      fakeItem(1, {
        images: { primary: { large: { url: "http://insecure.example/x.jpg" } } },
        itemInfo: {
          title: { displayValue: "Kettle" },
          externalIds: { eans: { displayValues: ["123", 5] } },
          features: { displayValues: "not a list" },
        },
        customerReviews: { count: -1, starRating: { value: 7 } },
        browseNodeInfo: { browseNodes: [{ displayName: "  " }] },
      }),
      options,
    );
    expect(product).toMatchObject({
      imageUrl: null,
      gtin: null,
      description: null,
      rating: null,
      reviewCount: null,
      categoryHint: null,
    });
  });

  const listing = (extra: Record<string, unknown>) =>
    ({ price: { money: { amount: 10, currency: "GBP" } }, ...extra }) as never;

  it.each([
    ["IN_STOCK", "IN_STOCK"],
    ["InStock", "IN_STOCK"],
    ["IN_STOCK_SCARCE", "LOW_STOCK"],
    ["OutOfStock", "OUT_OF_STOCK"],
    ["UNAVAILABLE", "OUT_OF_STOCK"],
    ["PREORDER", "PREORDER"],
    ["AVAILABLE_DATE", "PREORDER"],
    ["LEADTIME", "UNKNOWN"],
    [undefined, "IN_STOCK"],
  ])("maps availability %j to %s", (type, expected) => {
    const item = { offersV2: { listings: [listing({ availability: { type } })] } };
    expect(offerOf(item, "GBP")).toEqual({ price: 1000, availability: expected });
  });

  it("prefers a new-condition Buy Box offer", () => {
    const item: AmazonItem = {
      offersV2: {
        listings: [
          { price: { money: { amount: 5 } }, condition: { value: "Used" }, isBuyBoxWinner: true },
          { price: { money: { amount: 12 } }, condition: { value: "New" } },
          { price: { money: { amount: 11 } }, condition: { value: "New" }, isBuyBoxWinner: true },
        ],
      },
    };
    expect(offerOf(item, "GBP").price).toBe(1100);
    expect(offerOf({ offersV2: { listings: [item.offersV2!.listings![1]!] } }, "GBP").price).toBe(
      1200,
    );
  });

  it.each([
    { amount: "10" },
    { amount: Number.NaN },
    { amount: -1 },
    { amount: 10, currency: "EUR" },
  ])("treats an unusable price %j as no offer", (money) => {
    expect(offerOf({ offersV2: { listings: [{ price: { money } }] } }, "GBP")).toEqual({
      price: null,
      availability: "OUT_OF_STOCK",
    });
  });
});

describe("amazon adapter: runtime defaults", () => {
  it("uses the global fetch and a real timer when none are injected", async () => {
    const api = createFakeCreatorsApi({ items: ITEMS });
    vi.stubGlobal("fetch", api.fetch);
    vi.useFakeTimers();
    try {
      const adapter = createAmazonAdapter(CONFIG, { now: () => NOW, env: TEST_ENV });
      const pending = adapter.fetchPrices(ITEMS.slice(0, 11).map((i) => i.asin as string));
      await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
      expect(await pending).toHaveLength(11);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
