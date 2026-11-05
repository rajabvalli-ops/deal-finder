// Minimal client for the Amazon Creators API (the successor to Product Advertising API 5.0).
// OAuth 2.0 client-credentials tokens, JSON over HTTPS, one request at a time with a pause
// between requests. Request and response shapes follow Amazon's published API models; see
// docs/ARCHITECTURE.md §6 (Amazon) for what has and hasn't been verified against the live API.

export const API_HOST = "https://creatorsapi.amazon";

/** Token endpoint for each credential version Amazon issues (2.x Cognito, 3.x Login with Amazon). */
export const TOKEN_ENDPOINTS: Readonly<Record<string, string>> = {
  "2.1": "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token",
  "2.2": "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token",
  "2.3": "https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token",
  "3.1": "https://api.amazon.com/auth/o2/token",
  "3.2": "https://api.amazon.co.uk/auth/o2/token",
  "3.3": "https://api.amazon.co.jp/auth/o2/token",
};

export type AmazonCredentials = {
  credentialId: string;
  credentialSecret: string;
  version: string;
};

export class AmazonApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AmazonApiError";
  }
}

/** Pause between API calls. Amazon's starting allowance is about one request per second. */
export const REQUEST_INTERVAL_MS = 1100;
const MAX_ATTEMPTS = 3;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 3600;

type ClientOptions = {
  credentials: AmazonCredentials;
  marketplace: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds clock for token expiry. */
  clock: () => number;
};

const isLwa = (version: string) => version.startsWith("3.");

export function createCreatorsApiClient(options: ClientOptions) {
  const { credentials, marketplace, fetch: http, sleep, clock } = options;
  const tokenEndpoint = TOKEN_ENDPOINTS[credentials.version];
  if (!tokenEndpoint) {
    throw new AmazonApiError(
      `Unsupported Creators API credential version "${credentials.version}"`,
      null,
    );
  }
  let token: { value: string; expiresAt: number } | null = null;
  let calls = 0;

  async function fetchToken(): Promise<string> {
    const fields = {
      grant_type: "client_credentials",
      client_id: credentials.credentialId,
      client_secret: credentials.credentialSecret,
      scope: isLwa(credentials.version) ? "creatorsapi::default" : "creatorsapi/default",
    };
    const response = await http(tokenEndpoint!, {
      method: "POST",
      headers: isLwa(credentials.version)
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "application/x-www-form-urlencoded" },
      body: isLwa(credentials.version)
        ? JSON.stringify(fields)
        : new URLSearchParams(fields).toString(),
    });
    if (!response.ok) {
      throw new AmazonApiError(`Amazon token request failed (${response.status})`, response.status);
    }
    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string" || data.access_token === "") {
      throw new AmazonApiError("Amazon token response had no access token", response.status);
    }
    const lifetime =
      typeof data.expires_in === "number" ? data.expires_in : DEFAULT_TOKEN_LIFETIME_S;
    token = {
      value: data.access_token,
      expiresAt: clock() + lifetime * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return token.value;
  }

  async function accessToken(): Promise<string> {
    return token && token.expiresAt > clock() ? token.value : fetchToken();
  }

  function authorization(value: string): string {
    return isLwa(credentials.version)
      ? `Bearer ${value}`
      : `Bearer ${value}, Version ${credentials.version}`;
  }

  /**
   * POSTs to an API operation. Returns null for 404 (Amazon's "no results"). Retries once
   * with a fresh token after 401, and backs off on 429 and 5xx.
   */
  async function call<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      if (calls++ > 0) await sleep(REQUEST_INTERVAL_MS);
      const response = await http(`${API_HOST}${path}`, {
        method: "POST",
        headers: {
          Authorization: authorization(await accessToken()),
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-marketplace": marketplace,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) return (await response.json()) as T;
      if (response.status === 404) return null;
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = null;
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt,
        );
        continue;
      }
      throw new AmazonApiError(
        `Amazon ${path} failed (${response.status}): ${await errorDetail(response)}`,
        response.status,
      );
    }
  }

  return { call, accessToken };
}

/** Amazon's error code/message, without echoing a whole response body into logs. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      reason?: unknown;
      message?: unknown;
      errors?: { code?: unknown; message?: unknown }[];
    };
    const first = data.errors?.[0];
    const parts = [data.reason, data.message, first?.code, first?.message].filter(
      (p): p is string => typeof p === "string" && p !== "",
    );
    return parts.join(" — ").slice(0, 300) || "no details";
  } catch {
    return "no details";
  }
}

export type CreatorsApiClient = ReturnType<typeof createCreatorsApiClient>;
