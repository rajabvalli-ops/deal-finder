// Fictional catalogue for development and tests. Every product is obviously fake:
// the "Mockline" brand, `.invalid` URLs (RFC 2606) and no images. Prices follow a
// deterministic schedule derived from the product ID and the date — no randomness —
// so the same date always produces the same prices.

import type { NormalisedAvailability, NormalisedProduct } from "../../schemas";

export const MOCK_HOST = "mock-retailer.invalid";
const DAY_MS = 86_400_000;

type Template = {
  name: string;
  categoryHint: string;
  /** Pence. */
  basePrice: number;
  /** Extra variants as [suffix, price uplift in pence]. */
  options?: readonly (readonly [string, number])[];
};

const TEMPLATES: readonly Template[] = [
  {
    name: "Wireless Over-Ear Headphones",
    categoryHint: "headphones-audio",
    basePrice: 14999,
    options: [
      ["Black", 0],
      ["Silver", 0],
    ],
  },
  { name: "True Wireless Earbuds", categoryHint: "headphones-audio", basePrice: 7999 },
  { name: "Portable Bluetooth Speaker", categoryHint: "headphones-audio", basePrice: 4999 },
  { name: "55-inch 4K Smart TV", categoryHint: "tvs", basePrice: 49999 },
  { name: "Soundbar with Subwoofer", categoryHint: "tvs", basePrice: 19999 },
  {
    name: "14-inch Laptop",
    categoryHint: "laptops-computing",
    basePrice: 69999,
    options: [
      ["256GB", 0],
      ["512GB", 10000],
    ],
  },
  { name: "Mechanical Keyboard", categoryHint: "laptops-computing", basePrice: 8999 },
  {
    name: "Smartphone",
    categoryHint: "phones-tablets",
    basePrice: 39999,
    options: [
      ["128GB", 0],
      ["256GB", 5000],
    ],
  },
  { name: "10-inch Tablet", categoryHint: "phones-tablets", basePrice: 22999 },
  { name: "Games Controller", categoryHint: "gaming", basePrice: 5499 },
  { name: "Air Fryer 5L", categoryHint: "kitchen-appliances", basePrice: 8999 },
  { name: "Bean-to-Cup Coffee Machine", categoryHint: "kitchen-appliances", basePrice: 29999 },
  { name: "Cordless Drill Driver", categoryHint: "diy-tools", basePrice: 7999 },
  { name: "Electric Toothbrush", categoryHint: "health-beauty", basePrice: 5999 },
  { name: "Building Blocks Set", categoryHint: "toys-kids", basePrice: 3999 },
  {
    name: "Running Shoes",
    categoryHint: "sports-outdoors",
    basePrice: 8999,
    options: [
      ["UK 8", 0],
      ["UK 10", 0],
    ],
  },
];

/** FNV-1a 32-bit hash: a stable number per string. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Rounds pence to the nearest pound, minus a penny: 12345 → 12299. */
function toPsychologicalPrice(pence: number): number {
  return Math.max(99, Math.round(pence / 100) * 100 - 1);
}

export type MockPricePoint = { price: number; availability: NormalisedAvailability };

/**
 * The mock price of a product on a given date. Each product cycles through a period of
 * 20–34 days containing a 2–5 day sale of 10–25%, and is out of stock one day in 45.
 */
export function mockPriceAt(productId: string, basePrice: number, date: Date): MockPricePoint {
  const h = stableHash(productId);
  const day = Math.floor(date.getTime() / DAY_MS);
  const period = 20 + (h % 15);
  const saleLength = 2 + (h % 4);
  const saleBps = 1000 + ((h >>> 4) % 4) * 500;
  const onSale = (day + h) % period < saleLength;
  const outOfStock = (day + (h >>> 8)) % 45 === 0;
  const price = onSale
    ? toPsychologicalPrice((basePrice * (10_000 - saleBps)) / 10_000)
    : basePrice;
  return { price, availability: outOfStock ? "OUT_OF_STOCK" : "IN_STOCK" };
}

export type MockProductSpec = Template & { id: string; model: string };

/** `count` products cycling through the templates, with stable IDs MOCK-0001, MOCK-0002… */
export function mockProductSpecs(count: number): MockProductSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const template = TEMPLATES[i % TEMPLATES.length]!;
    const series = Math.floor(i / TEMPLATES.length) + 1;
    const id = `MOCK-${String(i + 1).padStart(4, "0")}`;
    return {
      ...template,
      id,
      model: `ML-${series}${String((i % TEMPLATES.length) + 1).padStart(2, "0")}`,
    };
  });
}

export function toNormalisedProduct(spec: MockProductSpec, date: Date): NormalisedProduct {
  const point = mockPriceAt(spec.id, spec.basePrice, date);
  const options = spec.options ?? [["Standard", 0] as const];
  const h = stableHash(spec.id);
  return {
    externalId: spec.id,
    title: `Mockline ${spec.name} ${spec.model}`,
    brand: "Mockline",
    model: spec.model,
    gtin: null,
    description: `Fictional product generated for development. Not a real item.`,
    imageUrl: null,
    productUrl: `https://${MOCK_HOST}/p/${spec.id.toLowerCase()}`,
    categoryHint: spec.categoryHint,
    currency: "GBP",
    availability: point.availability,
    rating: (35 + (h % 16)) / 10, // 3.5–5.0
    reviewCount: h % 400,
    variants: options.map(([suffix, uplift], index) => ({
      externalId: `${spec.id}-${index + 1}`,
      name: suffix,
      attributes: spec.options ? { option: suffix } : undefined,
      isDefault: index === 0,
      price: point.price + uplift,
      availability: point.availability,
    })),
  };
}
