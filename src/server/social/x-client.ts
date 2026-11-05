import { createHmac, randomBytes } from "node:crypto";

// Posts to X (Twitter) as the brand account: `POST https://api.x.com/2/tweets`, signed with
// OAuth 1.0a user context (the account's own access token). Keys come from the X developer
// portal; see docs/ARCHITECTURE.md §5 (social posting).

export const X_POST_URL = "https://api.x.com/2/tweets";

export type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export class XApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds since the epoch when X will accept posts again (rate limits). */
    readonly resetAt: number | null = null,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (stricter than encodeURIComponent). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The OAuth 1.0a HMAC-SHA1 signature. `params` are the oauth_* values plus any query or
 * form parameters (a JSON body is not signed).
 */
export function oauthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const normalised = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    // Keys are unique (a Record), so sorting by key alone is the full OAuth ordering.
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(normalised)].join("&");
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", key).update(base).digest("base64");
}

export function oauthHeader(
  method: string,
  url: string,
  credentials: XCredentials,
  options: { nonce?: string; timestamp?: number } = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: options.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  oauth.oauth_signature = oauthSignature(
    method,
    url,
    oauth,
    credentials.apiSecret,
    credentials.accessTokenSecret,
  );
  return `OAuth ${Object.entries(oauth)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ")}`;
}

export function createXClient(credentials: XCredentials, options: { fetch?: typeof fetch } = {}) {
  const http = options.fetch ?? fetch;

  return {
    /** Posts `text`; returns X's id for the new post. */
    async post(text: string): Promise<{ id: string }> {
      const response = await http(X_POST_URL, {
        method: "POST",
        headers: {
          Authorization: oauthHeader("POST", X_POST_URL, credentials),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json().catch(() => null)) as {
        data?: { id?: unknown };
        title?: unknown;
        detail?: unknown;
      } | null;
      if (response.ok && typeof data?.data?.id === "string") return { id: data.data.id };
      const reset = Number(response.headers.get("x-rate-limit-reset"));
      const detail = [data?.title, data?.detail]
        .filter((p): p is string => typeof p === "string")
        .join(" — ")
        .slice(0, 300);
      throw new XApiError(
        `X rejected the post (${response.status})${detail ? `: ${detail}` : ""}`,
        response.status,
        Number.isFinite(reset) && reset > 0 ? reset : null,
      );
    },
  };
}

export type XClient = ReturnType<typeof createXClient>;
