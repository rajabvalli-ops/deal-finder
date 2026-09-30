export {
  createAdapter,
  isAllowedUrl,
  registeredAdapterKeys,
  UnknownAdapterError,
} from "./registry";
export {
  normalisedPriceUpdateSchema,
  normalisedProductSchema,
  type NormalisedPriceUpdate,
  type NormalisedProduct,
} from "./schemas";
export type { AdapterContext, CataloguePage, RetailerAdapter } from "./types";
