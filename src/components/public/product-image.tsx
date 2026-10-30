/**
 * Retailer images come from arbitrary retailer hosts, so a plain <img> is used (lazy-loaded,
 * no referrer). Listings without an image get a neutral placeholder instead of stock art.
 */
export function ProductImage({
  src,
  label,
  large = false,
}: {
  src: string | null;
  label: string;
  large?: boolean;
}) {
  const box = `aspect-[4/3] w-full bg-surface-muted ${large ? "rounded-xl" : ""}`;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote retailer hosts aren't known in advance
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={`${box} object-contain`}
      />
    );
  }
  return (
    <div className={`${box} grid place-items-center`} aria-hidden="true">
      <span className="px-4 text-center text-sm font-medium text-ink-muted">{label}</span>
    </div>
  );
}
