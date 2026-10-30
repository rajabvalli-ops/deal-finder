import { describe, expect, it } from "vitest";
import {
  alertCondition,
  alertHrefForSearch,
  alertNotificationContent,
  alertWatching,
  DEAL_LEVEL_LABELS,
} from "./alerts";
import { parseSearchParams } from "./validation/search";

const none = { keyword: null, productTitle: null, categoryName: null, retailerName: null };

describe("alertWatching", () => {
  it.each([
    [{ keyword: "kettle" }, "“kettle”"],
    [{ keyword: "kettle", categoryName: "Kitchen" }, "“kettle” in Kitchen"],
    [{ categoryName: "Kitchen", retailerName: "Shop" }, "Kitchen at Shop"],
    [{ productTitle: "Glass Kettle", keyword: "ignored" }, "Glass Kettle"],
    [{ keyword: "kettle", retailerName: "Shop" }, "“kettle” at Shop"],
  ])("%j → %s", (fields, expected) => {
    expect(alertWatching({ ...none, ...fields })).toBe(expected);
  });
});

describe("alertCondition", () => {
  it("describes price and discount limits", () => {
    expect(alertCondition({ maxPrice: null, minDiscountBps: null })).toBe("Any new deal");
    expect(alertCondition({ maxPrice: 5000, minDiscountBps: null })).toBe("£50.00 or less");
    expect(alertCondition({ maxPrice: 5000, minDiscountBps: 2000 })).toBe(
      "£50.00 or less, 20% off or more",
    );
  });
});

describe("alertNotificationContent", () => {
  it("states the engine's price, retailer and discount", () => {
    const deal = {
      title: "Glass Kettle",
      dealPrice: 2999,
      discountBps: 2500,
      retailerName: "Example Shop",
      level: "NORMAL" as const,
    };
    expect(alertNotificationContent({ ...deal, referenceType: "PREVIOUS" })).toEqual({
      subject: "Price alert: Glass Kettle",
      body: "Glass Kettle is £29.99 at Example Shop, 25% below its previous price.",
    });
    expect(alertNotificationContent({ ...deal, referenceType: "AVG_30" }).body).toContain(
      "below its recent average price",
    );
  });
});

describe("levels", () => {
  const deal = {
    title: "Glass Kettle",
    dealPrice: 999,
    discountBps: 7500,
    retailerName: "Example Shop",
    referenceType: "AVG_30" as const,
  };

  it("headlines big drops and possible price errors, with a warning for errors", () => {
    expect(alertNotificationContent({ ...deal, level: "BIG_DROP" }).subject).toBe(
      "Big price drop: Glass Kettle",
    );
    const error = alertNotificationContent({ ...deal, level: "PRICE_ERROR" });
    expect(error.subject).toBe("Possible price error: Glass Kettle");
    expect(error.body).toMatch(
      /75% below its recent average price\. This may be a pricing mistake/,
    );
  });

  it("describes level-only alerts", () => {
    expect(alertWatching(none)).toBe("Everything");
    expect(alertCondition({ maxPrice: null, minDiscountBps: null, minLevel: "PRICE_ERROR" })).toBe(
      "Possible price errors only",
    );
    expect(alertCondition({ maxPrice: 2000, minDiscountBps: null, minLevel: "BIG_DROP" })).toBe(
      "Big drops and price errors only, £20.00 or less",
    );
    expect(DEAL_LEVEL_LABELS).toEqual({
      NORMAL: null,
      BIG_DROP: "Big drop",
      PRICE_ERROR: "Possible price error",
    });
  });
});

describe("alertHrefForSearch", () => {
  it("keeps the alert criteria from a search and drops the rest", () => {
    const filters = parseSearchParams({
      q: "air fryer",
      category: "kitchen",
      retailer: "shop",
      max: "60",
      min: "10",
      discount: "20",
      stock: "1",
      sort: "price-asc",
      page: "3",
    });
    expect(alertHrefForSearch(filters)).toBe(
      "/alerts?q=air+fryer&category=kitchen&retailer=shop&max=60&discount=20",
    );
    expect(alertHrefForSearch(parseSearchParams({}))).toBe("/alerts");
  });
});
