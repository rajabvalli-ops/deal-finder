import type { AmazonItem } from "./normalise";

// An in-memory stand-in for the Creators API, shaped like Amazon's published models. Tests
// use it instead of the network; it records every request so tests can check what was sent.

export const TEST_ENV = {
  AMAZON_CREATORS_CREDENTIAL_ID: "test-credential-id",
  AMAZON_CREATORS_CREDENTIAL_SECRET: "test-credential-secret",
  AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
  AMAZON_ASSOCIATE_TAG: "dealfinder-21",
};

export const asinFor = (n: number) => `B0TEST${String(n).padStart(4, "0")}`;

/** A deterministic item; `n` varies the price and fields. */
export function fakeItem(n: number, overrides: Partial<AmazonItem> = {}): AmazonItem {
  return {
    asin: asinFor(n),
    detailPageURL: `https://www.amazon.co.uk/dp/${asinFor(n)}?tag=dealfinder-21&linkCode=ogi`,
    itemInfo: {
      title: { displayValue: `Test Kettle ${n}` },
      byLineInfo: { brand: { displayValue: "Testbrand" } },
      manufactureInfo: { model: { displayValue: `TK-${n}` } },
      externalIds: { eans: { displayValues: [String(5012345678900 + n)] } },
      features: { displayValues: ["1.7 litre", "Rapid boil"] },
    },
    images: { primary: { large: { url: `https://m.media-amazon.com/images/I/test-${n}.jpg` } } },
    browseNodeInfo: { browseNodes: [{ displayName: "Kettles" }] },
    customerReviews: { count: 100 + n, starRating: { value: 4.5 } },
    offersV2: {
      listings: [
        {
          price: { money: { amount: 19.99 + n, currency: "GBP", displayAmount: `£${19.99 + n}` } },
          availability: { type: "IN_STOCK" },
          condition: { value: "New" },
          isBuyBoxWinner: true,
        },
      ],
    },
    ...overrides,
  } as AmazonItem;
}

export type RecordedRequest = { url: string; headers: Record<string, string>; body: unknown };

type Responder = (request: RecordedRequest) => Response | undefined;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

export function createFakeCreatorsApi(options: {
  items: AmazonItem[];
  /** Search results by keywords. */
  searches?: Record<string, AmazonItem[]>;
  /** Overrides any request; return undefined to fall through to the default behaviour. */
  respond?: Responder;
}) {
  const requests: RecordedRequest[] = [];
  const byAsin = new Map(options.items.map((i) => [i.asin as string, i]));
  let tokens = 0;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = headers["content-type"]?.startsWith("application/json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
    const request = { url, headers, body };
    requests.push(request);

    const override = options.respond?.(request);
    if (override) return override;

    if (url.endsWith("/auth/o2/token") || url.endsWith("/oauth2/token")) {
      tokens += 1;
      return json(200, { access_token: `token-${tokens}`, token_type: "bearer", expires_in: 3600 });
    }
    const b = body as Record<string, unknown>;
    if (url === "https://creatorsapi.amazon/catalog/v1/getItems") {
      const items = (b.itemIds as string[]).flatMap((id) => byAsin.get(id) ?? []);
      return items.length > 0
        ? json(200, { itemsResult: { items } })
        : json(404, { reason: "ItemsNotFound", message: "No items found" });
    }
    if (url === "https://creatorsapi.amazon/catalog/v1/searchItems") {
      const all = options.searches?.[b.keywords as string] ?? [];
      const count = (b.itemCount as number) ?? 10;
      const page = (b.itemPage as number) ?? 1;
      const items = all.slice((page - 1) * count, page * count);
      return items.length > 0
        ? json(200, { searchResult: { items, totalResultCount: all.length } })
        : json(404, { reason: "NoResults" });
    }
    return json(500, { message: `Unexpected request to ${url}` });
  };

  return { fetch: fakeFetch, requests, json };
}
