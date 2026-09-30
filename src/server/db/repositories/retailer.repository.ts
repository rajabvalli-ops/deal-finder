import { RetailerStatus, type DbClient, type Retailer } from "../types";

export function createRetailerRepository(client: DbClient) {
  return {
    findById(id: string): Promise<Retailer | null> {
      return client.retailer.findUnique({ where: { id } });
    },

    findBySlug(slug: string): Promise<Retailer | null> {
      return client.retailer.findUnique({ where: { slug } });
    },

    update(id: string, data: { status: RetailerStatus; trustScore: number }): Promise<Retailer> {
      return client.retailer.update({ where: { id }, data });
    },

    listByStatus(status: RetailerStatus = RetailerStatus.ACTIVE): Promise<Retailer[]> {
      return client.retailer.findMany({ where: { status }, orderBy: { name: "asc" } });
    },
  };
}

export type RetailerRepository = ReturnType<typeof createRetailerRepository>;
