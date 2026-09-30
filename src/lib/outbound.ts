// Outbound retailer links. Pages only ever link to /go/[code]; the destination URL stays on
// the server (see docs/ARCHITECTURE.md §10).

/** Where on the site an outbound link was clicked. Anything else is recorded as null. */
export const PLACEMENTS = ["deal-page"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export function parsePlacement(value: string | null | undefined): Placement | null {
  return (PLACEMENTS as readonly string[]).includes(value ?? "") ? (value as Placement) : null;
}

/** `rel` for every outbound link: paid link, not endorsed for search engines, no window.opener. */
export const OUTBOUND_REL = "sponsored nofollow noopener";

export function outboundHref(
  code: string,
  context: { placement: Placement; dealSlug?: string },
): string {
  const params = new URLSearchParams({ p: context.placement });
  if (context.dealSlug) params.set("deal", context.dealSlug);
  return `/go/${encodeURIComponent(code)}?${params.toString()}`;
}
