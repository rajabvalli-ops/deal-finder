import { z } from "zod";
import type { NormalisedPriceUpdate, NormalisedProduct } from "../../schemas";
import type { AdapterContext, RetailerAdapter } from "../../types";
import { AmazonApiError, createCreatorsApiClient, type CreatorsApiClient } from "./client";
import {
  ASIN,
  CATALOGUE_RESOURCES,
  PRICE_RESOURCES,
  offerOf,
  productUrl,
  toNormalisedProduct,
  type AmazonItem,
} from "./normalise";

// Amazon UK through the Creators API. Amazon has no "whole catalogue" feed for Associates,
// so the catalogue is what the admin chooses to track: a list of ASINs plus keyword searches.

export const AMAZON_UK_HOST = "www.amazon.co.uk";
/** Items per getItems request and per searchItems page (Amazon's maximum is 10). */
export const AMAZON_BATCH_SIZE = 10;
const MAX_SEARCH_PAGES = 10;

export const amazonSearchSchema = z.object({
  keywords: z.string().trim().min(2).max(200),
  /** Amazon search index (category), e.g. "Electronics". Omitted = all departments. */
  searchIndex: z
    .string()
    .regex(/^[A-Za-z]+$/)
    .max(50)
    .optional(),
  /** Only items Amazon reports as at least this % off. */
  minSavingPercent: z.int().min(1).max(99).optional(),
  /** Result pages to read (10 items each). */
  pages: z.int().min(1).max(MAX_SEARCH_PAGES).default(1),
});

export const amazonConfigSchema = z.object({
  marketplace: z.literal(AMAZON_UK_HOST).default(AMAZON_UK_HOST),
  asins: z.array(z.string().regex(ASIN)).max(5000).default([]),
  searches: z.array(amazonSearchSchema).max(50).default([]),
});

export type AmazonConfig = z.infer<typeof amazonConfigSchema>;
export type AmazonSearch = z.infer<typeof amazonSearchSchema>;

/** Environment variables holding the Creators API credentials and the Associates tag. */
export const AMAZON_ENV = {
  credentialId: "AMAZON_CREATORS_CREDENTIAL_ID",
  credentialSecret: "AMAZON_CREATORS_CREDENTIAL_SECRET",
  version: "AMAZON_CREATORS_CREDENTIAL_VERSION",
  partnerTag: "AMAZON_ASSOCIATE_TAG",
} as const;

/** Associates tracking IDs look like "yourname-21" (UK store IDs end in -21). */
const PARTNER_TAG = /^[A-Za-z0-9-]{2,64}$/;

export class AmazonNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Amazon is not configured: set ${missing.join(", ")}`);
    this.name = "AmazonNotConfiguredError";
  }
}

function readSettings(env: AdapterContext["env"]) {
  const value = (key: string) => env[key]?.trim() || undefined;
  const settings = {
    credentialId: value(AMAZON_ENV.credentialId),
    credentialSecret: value(AMAZON_ENV.credentialSecret),
    version: value(AMAZON_ENV.version),
    partnerTag: value(AMAZON_ENV.partnerTag),
  };
  const missing: string[] = (Object.keys(settings) as (keyof typeof settings)[])
    .filter((key) => !settings[key])
    .map((key) => AMAZON_ENV[key]);
  if (settings.partnerTag && !PARTNER_TAG.test(settings.partnerTag)) {
    missing.push(`${AMAZON_ENV.partnerTag} (letters, digits and hyphens)`);
  }
  return { settings, missing };
}

/** Where to continue the catalogue: an offset into the ASIN list, or a search and page. */
type Cursor = { kind: "asins"; offset: number } | { kind: "search"; index: number; page: number };

function parseCursor(cursor: string | null): Cursor {
  if (cursor === null) return { kind: "asins", offset: 0 };
  const asins = /^a:(\d{1,6})$/.exec(cursor);
  if (asins) return { kind: "asins", offset: Number(asins[1]) };
  const search = /^s:(\d{1,3}):(\d{1,2})$/.exec(cursor);
  if (search && Number(search[2]) >= 1) {
    return { kind: "search", index: Number(search[1]), page: Number(search[2]) };
  }
  throw new Error(`Invalid cursor: ${cursor}`);
}

function firstSearchCursor(config: AmazonConfig, index: number): string | null {
  return index < config.searches.length ? `s:${index}:1` : null;
}

type ItemsResponse = { itemsResult?: { items?: AmazonItem[] } };
type SearchResponse = { searchResult?: { items?: AmazonItem[]; totalResultCount?: unknown } };

export function createAmazonAdapter(rawConfig: unknown, context: AdapterContext): RetailerAdapter {
  const config = amazonConfigSchema.parse(rawConfig);
  const host = config.marketplace;
  const currency = "GBP";
  const { settings, missing } = readSettings(context.env);
  let client: CreatorsApiClient | null = null;

  function api(): CreatorsApiClient {
    if (missing.length > 0) throw new AmazonNotConfiguredError(missing);
    client ??= createCreatorsApiClient({
      credentials: {
        credentialId: settings.credentialId!,
        credentialSecret: settings.credentialSecret!,
        version: settings.version!,
      },
      marketplace: host,
      fetch: context.fetch ?? fetch,
      sleep: context.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      clock: () => Date.now(),
    });
    return client;
  }

  async function getItems(asins: string[], resources: readonly string[]): Promise<AmazonItem[]> {
    if (asins.length === 0) return [];
    const data = await api().call<ItemsResponse>("/catalog/v1/getItems", {
      partnerTag: settings.partnerTag,
      itemIds: asins,
      condition: "New",
      resources,
    });
    return data?.itemsResult?.items ?? [];
  }

  const normalise = (items: AmazonItem[]): NormalisedProduct[] =>
    items.flatMap((item) => toNormalisedProduct(item, { host, currency }) ?? []);

  return {
    key: "amazon",
    allowedHosts: [host],
    capabilities: { catalogue: true, priceLookup: true },

    async fetchCatalogue({ cursor, limit }) {
      const position = parseCursor(cursor);
      const size = Math.max(1, Math.min(limit, AMAZON_BATCH_SIZE));

      if (position.kind === "asins") {
        const batch = config.asins.slice(position.offset, position.offset + size);
        const items = normalise(await getItems(batch, CATALOGUE_RESOURCES));
        const next = position.offset + size;
        return {
          items,
          nextCursor: next < config.asins.length ? `a:${next}` : firstSearchCursor(config, 0),
        };
      }

      const search = config.searches[position.index];
      if (!search) throw new Error(`Invalid cursor: ${cursor}`);
      const data = await api().call<SearchResponse>("/catalog/v1/searchItems", {
        partnerTag: settings.partnerTag,
        keywords: search.keywords,
        ...(search.searchIndex ? { searchIndex: search.searchIndex } : {}),
        ...(search.minSavingPercent ? { minSavingPercent: search.minSavingPercent } : {}),
        itemCount: size,
        itemPage: position.page,
        resources: CATALOGUE_RESOURCES,
      });
      const found = data?.searchResult?.items ?? [];
      const items = normalise(found).slice(0, size);
      const total = data?.searchResult?.totalResultCount;
      const morePages =
        found.length >= size &&
        position.page < search.pages &&
        (typeof total !== "number" || position.page * size < total);
      return {
        items,
        nextCursor: morePages
          ? `s:${position.index}:${position.page + 1}`
          : firstSearchCursor(config, position.index + 1),
      };
    },

    async fetchPrices(productExternalIds) {
      const asins = [...new Set(productExternalIds)].filter((id) => ASIN.test(id));
      const updates: NormalisedPriceUpdate[] = [];
      for (let i = 0; i < asins.length; i += AMAZON_BATCH_SIZE) {
        for (const item of await getItems(asins.slice(i, i + AMAZON_BATCH_SIZE), PRICE_RESOURCES)) {
          if (typeof item.asin !== "string" || !asins.includes(item.asin)) continue;
          const { price, availability } = offerOf(item, currency);
          updates.push({
            productExternalId: item.asin,
            currency,
            variants: [{ externalId: item.asin, price, availability }],
          });
        }
      }
      return updates;
    },

    /** The product page with the Associates tag — the only link Amazon credits. */
    buildAffiliateUrl(url) {
      const tagProblem = missing.find((m) => m.startsWith(AMAZON_ENV.partnerTag));
      if (tagProblem) throw new AmazonNotConfiguredError([tagProblem]);
      const parsed = new URL(url);
      const asin = /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/.exec(parsed.pathname)?.[1];
      const target = new URL(asin ? productUrl(host, asin) : url);
      target.search = "";
      target.hash = "";
      target.searchParams.set("tag", settings.partnerTag!);
      return target.toString();
    },

    async healthCheck() {
      if (missing.length > 0)
        return { ok: false, detail: new AmazonNotConfiguredError(missing).message };
      try {
        await api().accessToken();
        return {
          ok: true,
          detail: `Signed in; tracking ${config.asins.length} ASINs and ${config.searches.length} searches`,
        };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof AmazonApiError ? error.message : "Amazon sign-in failed",
        };
      }
    },
  };
}
