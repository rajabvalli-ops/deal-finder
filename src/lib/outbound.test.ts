import { describe, expect, it } from "vitest";
import { outboundHref, parsePlacement } from "./outbound";

describe("parsePlacement", () => {
  it("accepts known placements only", () => {
    expect(parsePlacement("deal-page")).toBe("deal-page");
    expect(parsePlacement("header")).toBeNull();
    expect(parsePlacement(null)).toBeNull();
    expect(parsePlacement(undefined)).toBeNull();
  });
});

describe("outboundHref", () => {
  it("links to /go with the placement and deal", () => {
    expect(outboundHref("Ab12Cd34Ef", { placement: "deal-page", dealSlug: "kettle-deal" })).toBe(
      "/go/Ab12Cd34Ef?p=deal-page&deal=kettle-deal",
    );
  });

  it("omits the deal when there is none and encodes the code", () => {
    expect(outboundHref("a/b", { placement: "deal-page" })).toBe("/go/a%2Fb?p=deal-page");
  });
});
