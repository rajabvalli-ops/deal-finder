import type { Category, DbClient } from "../types";

export function createCategoryRepository(client: DbClient) {
  return {
    findBySlug(slug: string): Promise<Category | null> {
      return client.category.findUnique({ where: { slug } });
    },

    /** All categories in display order; callers build the tree from `parentId`. */
    listAll(): Promise<Category[]> {
      return client.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    },

    listChildren(parentId: string | null): Promise<Category[]> {
      return client.category.findMany({
        where: { parentId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
    },
  };
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;
