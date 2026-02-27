/**
 * Parse a currency string (e.g., "$2,517.79", "2517.79", "-$100.00") into
 * integer cents. Returns 0 for unparseable values.
 */
export function parseAmountCents(raw: string | null | undefined): number {
  if (raw == null || raw === "") return 0;

  // Remove currency symbols, commas, whitespace
  let cleaned = raw.toString().trim();

  // Detect negative: could be "-$100" or "($100)" or "-100"
  let negative = false;
  if (cleaned.startsWith("-") || cleaned.startsWith("(")) {
    negative = true;
  }

  cleaned = cleaned.replace(/[^0-9.]/g, "");

  if (cleaned === "") return 0;

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;

  // Round to avoid floating-point issues: 2517.79 * 100 = 251779
  const cents = Math.round(parsed * 100);
  return negative ? -cents : cents;
}

/**
 * Format cents to a display currency string.
 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const absCents = Math.abs(cents);
  const dollars = Math.floor(absCents / 100);
  const remainder = absCents % 100;
  const formatted = `$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}
