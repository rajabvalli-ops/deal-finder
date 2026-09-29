// Working brand name — final original branding is still to be decided.
export const site = {
  name: "Deal Finder",
  tagline: "UK deals, checked against real price history.",
} as const;

export const primaryNav = [
  { href: "/deals", label: "Deals" },
  { href: "/search", label: "Search" },
  { href: "/alerts", label: "Price alerts" },
] as const;
