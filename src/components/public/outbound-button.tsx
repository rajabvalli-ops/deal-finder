import { OUTBOUND_REL, outboundHref, type Placement } from "@/lib/outbound";

/**
 * The only way the site links to a retailer: through /go/[code], which records the click and
 * redirects. A plain <a>, not next/link, so the link is never prefetched (a prefetch would
 * count as a click).
 */
export function OutboundButton({
  code,
  retailerName,
  placement,
  dealSlug,
  size = "lg",
}: {
  code: string;
  retailerName: string;
  placement: Placement;
  dealSlug?: string;
  size?: "lg" | "sm";
}) {
  const sizing = size === "lg" ? "px-6 py-3 text-lg sm:w-auto" : "relative z-10 px-3 py-2 text-sm"; // above the card's whole-card link
  return (
    <a
      href={outboundHref(code, { placement, dealSlug })}
      rel={OUTBOUND_REL}
      className={`inline-flex w-full items-center justify-center rounded-lg bg-brand-600 font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${sizing}`}
    >
      {size === "lg" ? (
        `Go to ${retailerName}`
      ) : (
        <>
          Get deal<span className="sr-only"> at {retailerName}</span>
        </>
      )}
      <span aria-hidden="true" className="ml-2">
        {size === "lg" ? "→" : "↗"}
      </span>
    </a>
  );
}
