export const site = {
  name: "Deal Broker",
  tagline:
    "Your source for UK deals — price errors and price drops, checked against real price history.",
} as const;

export const primaryNav = [
  { href: "/deals", label: "Deals" },
  { href: "/price-drops", label: "Price drops" },
  { href: "/search", label: "Search" },
  { href: "/alerts", label: "Price alerts" },
] as const;
