// Reference data only — no products, prices or deals.

export type CategorySeed = { slug: string; name: string; children?: CategorySeed[] };

export const categories: CategorySeed[] = [
  {
    slug: "electronics",
    name: "Electronics",
    children: [
      { slug: "headphones-audio", name: "Headphones & Audio" },
      { slug: "tvs", name: "TVs" },
      { slug: "laptops-computing", name: "Laptops & Computing" },
      { slug: "phones-tablets", name: "Phones & Tablets" },
      { slug: "gaming", name: "Gaming" },
    ],
  },
  {
    slug: "home-kitchen",
    name: "Home & Kitchen",
    children: [
      { slug: "kitchen-appliances", name: "Kitchen Appliances" },
      { slug: "diy-tools", name: "DIY & Tools" },
    ],
  },
  { slug: "health-beauty", name: "Health & Beauty" },
  { slug: "toys-kids", name: "Toys & Kids" },
  { slug: "sports-outdoors", name: "Sports & Outdoors" },
  { slug: "fashion", name: "Fashion" },
  { slug: "food-drink", name: "Food & Drink" },
];

/** Development-only retailer backing the MockRetailerAdapter (Stage 6). Never seeded in production. */
export const mockRetailer = {
  slug: "mock-retailer",
  name: "Mock Retailer",
  // `.invalid` is a reserved TLD (RFC 2606), so this can never resolve to a real shop.
  websiteUrl: "https://mock-retailer.invalid",
  description: "Development-only retailer used to exercise the import pipeline. Not a real shop.",
  adapterKey: "mock",
  integrationType: "MOCK",
} as const;

/**
 * Amazon UK through the Creators API (Stage 14). Seeded paused and tracking nothing: an admin
 * adds products and searches, and it only runs once the credentials are set (see README).
 * Re-seeding never changes its status, trust score or tracking list.
 */
export const amazonRetailer = {
  slug: "amazon-uk",
  name: "Amazon UK",
  websiteUrl: "https://www.amazon.co.uk",
  description: "Amazon.co.uk, through the Amazon Associates Creators API.",
  adapterKey: "amazon",
  integrationType: "RETAILER_API",
} as const;
