export const DEFAULT_PAGE_SIZE = 25;

export type PageRequest = { page: number; skip: number; take: number };
export type Page<T> = { items: T[]; total: number; page: number; pageCount: number };

/** Parses a 1-based `?page=` value; anything invalid means page 1. */
export function pageRequest(
  raw: string | string[] | undefined,
  pageSize = DEFAULT_PAGE_SIZE,
): PageRequest {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value && /^\d{1,6}$/.test(value) ? Number(value) : 1;
  const page = Math.max(1, parsed);
  return { page, skip: (page - 1) * pageSize, take: pageSize };
}

export function toPage<T>(items: T[], total: number, request: PageRequest): Page<T> {
  return {
    items,
    total,
    page: request.page,
    pageCount: Math.max(1, Math.ceil(total / request.take)),
  };
}
