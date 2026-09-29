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

    findById(id: string): Promise<Category | null> {
      return client.category.findUnique({ where: { id } });
    },

    create(data: {
      slug: string;
      name: string;
      parentId: string | null;
      sortOrder: number;
    }): Promise<Category> {
      return client.category.create({ data });
    },

    update(
      id: string,
      data: { name: string; parentId: string | null; sortOrder: number },
    ): Promise<Category> {
      return client.category.update({ where: { id }, data });
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
