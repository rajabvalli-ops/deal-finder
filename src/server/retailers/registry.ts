import { createMockRetailerAdapter } from "./adapters/mock";
import type { AdapterContext, AdapterFactory, RetailerAdapter } from "./types";

// adapterKey (stored on the Retailer row) → factory. Adding a retailer integration means
// adding one line here; nothing else in the application changes.
const FACTORIES: Readonly<Record<string, AdapterFactory>> = {
  mock: createMockRetailerAdapter,
};

export class UnknownAdapterError extends Error {
  constructor(key: string) {
    super(`No retailer adapter registered for key "${key}"`);
    this.name = "UnknownAdapterError";
  }
}

export function registeredAdapterKeys(): string[] {
  return Object.keys(FACTORIES).sort();
}

export function createAdapter(
  retailer: { adapterKey: string; adapterConfig: unknown },
  context: AdapterContext,
): RetailerAdapter {
  const factory = Object.hasOwn(FACTORIES, retailer.adapterKey)
    ? FACTORIES[retailer.adapterKey]
    : undefined;
  if (!factory) throw new UnknownAdapterError(retailer.adapterKey);
  return factory(retailer.adapterConfig ?? {}, context);
}

/** True when `url` is https and its host is one of the adapter's allowed hosts. */
export function isAllowedUrl(adapter: Pick<RetailerAdapter, "allowedHosts">, url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && adapter.allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}
