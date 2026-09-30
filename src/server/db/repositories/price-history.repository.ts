import type { Availability, DbClient, PriceHistory } from "../types";

export type PriceObservationInput = {
  variantId: string;
  /** Pence. */
  price: number;
  currency: string;
  availability: Availability;
  observedAt: Date;
  importRunId?: string | null;
};

export function createPriceHistoryRepository(client: DbClient) {
  return {
    /** Appends an observation. The product ID is taken from the variant so the two can't disagree. */
    async record(input: PriceObservationInput): Promise<PriceHistory> {
      const variant = await client.productVariant.findUniqueOrThrow({
        where: { id: input.variantId },
        select: { productId: true },
      });
      return client.priceHistory.create({ data: { ...input, productId: variant.productId } });
    },

    latestForVariant(variantId: string): Promise<PriceHistory | null> {
      return client.priceHistory.findFirst({
        where: { variantId },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      });
    },

    /** Observations in chronological order, optionally limited to [since, until). */
    listForVariant(
      variantId: string,
      range: { since?: Date; until?: Date } = {},
    ): Promise<PriceHistory[]> {
      return client.priceHistory.findMany({
        where: { variantId, observedAt: { gte: range.since, lt: range.until } },
        orderBy: [{ observedAt: "asc" }, { id: "asc" }],
      });
    },
  };
}

export type PriceHistoryRepository = ReturnType<typeof createPriceHistoryRepository>;
