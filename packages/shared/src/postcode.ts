const POSTCODE_RE = /^(\d{3})\s?(\d{2})$/;

/** Returns the 5-digit postcode, or null if the input is not a valid Swedish postcode. */
export function normalizePostcode(input: string): string | null {
  const m = POSTCODE_RE.exec(input.trim());
  return m ? `${m[1]}${m[2]}` : null;
}

/** "41250" -> "412 50" */
export const formatPostcode = (normalized: string): string =>
  `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
