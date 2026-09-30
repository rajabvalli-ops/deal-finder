import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Largest multiple of 62 below 256: bytes at or above it are discarded to avoid bias. */
const UNBIASED_LIMIT = 248;
export const LINK_CODE_LENGTH = 10;
const CODE_PATTERN = /^[A-Za-z0-9]{6,32}$/;

/** A random, opaque code for /go/[code]. `random` is injectable for tests. */
export function generateLinkCode(
  random: (size: number) => Uint8Array = randomBytes,
  length = LINK_CODE_LENGTH,
): string {
  let code = "";
  while (code.length < length) {
    for (const byte of random(length * 2)) {
      if (byte >= UNBIASED_LIMIT) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}

/** Cheap format check before any database lookup. Matches the database CHECK constraint. */
export function isValidLinkCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}
