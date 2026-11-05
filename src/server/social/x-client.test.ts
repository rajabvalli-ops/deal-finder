import { describe, expect, it, vi } from "vitest";
import {
  createXClient,
  oauthHeader,
  oauthSignature,
  percentEncode,
  X_POST_URL,
  XApiError,
} from "./x-client";

const credentials = {
  apiKey: "key",
  apiSecret: "secret",
  accessToken: "token",
  accessTokenSecret: "token-secret",
};

describe("OAuth 1.0a signing", () => {
  it("matches the worked example in X's documentation", () => {
    // developer.x.com — "Creating a signature".
    const signature = oauthSignature(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        include_entities: "true",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        oauth_version: "1.0",
      },
      "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    );
    expect(signature).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("percent-encodes the characters encodeURIComponent leaves alone", () => {
    expect(percentEncode("a b!*'()~")).toBe("a%20b%21%2A%27%28%29~");
  });

  it("doesn't depend on parameter order", () => {
    const a = oauthSignature("GET", "https://x.test", { b: "2", a: "2", c: "1" }, "s", "t");
    const b = oauthSignature("GET", "https://x.test", { c: "1", a: "2", b: "2" }, "s", "t");
    expect(a).toBe(b);
  });

  it("builds the Authorization header with every oauth field", () => {
    const header = oauthHeader("POST", X_POST_URL, credentials, { nonce: "n", timestamp: 1 });
    expect(header).toMatch(/^OAuth oauth_consumer_key="key", oauth_nonce="n", /);
    expect(header).toContain('oauth_timestamp="1"');
    expect(header).toContain('oauth_token="token"');
    expect(header).toMatch(/oauth_signature="[A-Za-z0-9%]+"$/);
    expect(oauthHeader("POST", X_POST_URL, credentials)).toMatch(/oauth_nonce="[0-9a-f]{32}"/);
  });
});

describe("createXClient", () => {
  it("posts JSON text and returns the new post's id", async () => {
    const fake = vi.fn(async () =>
      Response.json({ data: { id: "1855", text: "hi" } }, { status: 201 }),
    );
    const client = createXClient(credentials, { fetch: fake as unknown as typeof fetch });
    expect(await client.post("hi")).toEqual({ id: "1855" });
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(init.body).toBe(JSON.stringify({ text: "hi" }));
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^OAuth /);
  });

  it("reports rejections with X's explanation and rate-limit reset", async () => {
    const fake = async () =>
      Response.json(
        { title: "Too Many Requests", detail: "Too Many Requests" },
        { status: 429, headers: { "x-rate-limit-reset": "1900000000" } },
      );
    const error = await createXClient(credentials, { fetch: fake as typeof fetch })
      .post("hi")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XApiError);
    expect(error).toMatchObject({
      status: 429,
      resetAt: 1900000000,
      message: "X rejected the post (429): Too Many Requests — Too Many Requests",
    });
  });

  it("copes with an empty error body", async () => {
    const fake = async () => new Response("", { status: 503 });
    await expect(
      createXClient(credentials, { fetch: fake as typeof fetch }).post("hi"),
    ).rejects.toMatchObject({ status: 503, resetAt: null, message: "X rejected the post (503)" });
  });

  it("uses the global fetch by default", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ data: { id: "1" } }));
    try {
      expect(await createXClient(credentials).post("x")).toEqual({ id: "1" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
