export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** First value of a query parameter, trimmed and length-limited; undefined if empty. */
export function param(
  params: Record<string, string | string[] | undefined>,
  key: string,
  max = 100,
) {
  const raw = params[key];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, max);
  return value ? value : undefined;
}
