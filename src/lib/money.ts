// Money helpers. Amounts are integer minor units (pence); percentages are basis points
// (1% = 100 bps). Floating-point arithmetic is never used for money.

const BPS_PER_UNIT = 10_000;

/** True for a non-negative safe integer — a valid amount of pence. */
export function isPence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function assertPence(value: unknown, label = "amount"): asserts value is number {
  if (!isPence(value)) throw new RangeError(`${label} must be a non-negative integer of pence`);
}

/**
 * numerator / denominator expressed in basis points, rounded half away from zero,
 * using integer arithmetic only. e.g. ratioToBps(1, 3) === 3333, ratioToBps(-1, 8) === -1250.
 */
export function ratioToBps(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError("ratioToBps requires integers");
  }
  if (denominator <= 0) throw new RangeError("ratioToBps requires a positive denominator");
  const sign = numerator < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(numerator));
  const den = BigInt(denominator);
  const rounded = (abs * BigInt(BPS_PER_UNIT) * 2n + den) / (2n * den);
  return Number(sign * rounded);
}

/** Parses a decimal amount such as "12", "12.3" or "1234.56" into pence without floats. */
export function parsePounds(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new RangeError(`Invalid amount: "${text}"`);
  const pounds = Number(match[1]);
  const pence = Number((match[2] ?? "").padEnd(2, "0"));
  const total = pounds * 100 + pence;
  assertPence(total);
  return total;
}

/** Formats pence as a currency string, e.g. 123456 → "£1,234.56". Assumes 2 minor-unit digits. */
export function formatPrice(pence: number, currency = "GBP"): string {
  assertPence(pence);
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
}

/** Formats basis points as a percentage, e.g. 2500 → "25%", 1250 → "12.5%". */
export function formatBps(bps: number, maximumFractionDigits = 1): string {
  if (!Number.isSafeInteger(bps)) throw new RangeError("bps must be an integer");
  return new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits }).format(
    bps / BPS_PER_UNIT,
  );
}
