import { describe, expect, it } from "vitest";
import {
  createAdapter,
  isAllowedUrl,
  registeredAdapterKeys,
  UnknownAdapterError,
} from "./registry";

const context = { now: () => new Date(0), env: {} };

describe("adapter registry", () => {
  it("lists registered adapters", () => {
    expect(registeredAdapterKeys()).toEqual(["mock"]);
  });

  it("creates an adapter from a retailer row, treating null config as empty", () => {
    const adapter = createAdapter({ adapterKey: "mock", adapterConfig: null }, context);
    expect(adapter.key).toBe("mock");
  });

  it("passes config through to the adapter", () => {
    expect(() =>
      createAdapter({ adapterKey: "mock", adapterConfig: { productCount: -1 } }, context),
    ).toThrow();
  });

  it.each(["unknown", "__proto__", "toString", ""])("rejects the key %j", (key) => {
    expect(() => createAdapter({ adapterKey: key, adapterConfig: {} }, context)).toThrow(
      UnknownAdapterError,
    );
  });
});

describe("isAllowedUrl", () => {
  const adapter = { allowedHosts: ["shop.example"] };

  it.each([
    ["https://shop.example/p/1", true],
    ["https://shop.example:443/p/1?x=1", true],
    ["http://shop.example/p/1", false],
    ["https://evil.example/p/1", false],
    ["https://sub.shop.example/p/1", false],
    ["https://shop.example.evil.example/", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isAllowedUrl(adapter, url)).toBe(expected);
  });
});
