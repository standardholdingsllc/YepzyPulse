/**
 * Transaction type mapping.
 * Maps Unit's raw `type` values to human-readable groups.
 */

export interface TransactionTypeRule {
  pattern: string; // Substring match (case-insensitive)
  group: string;
}

export const DEFAULT_TRANSACTION_TYPE_RULES: TransactionTypeRule[] = [
  { pattern: "purchaseTransaction", group: "Card" },
  { pattern: "purchase", group: "Card" },
  { pattern: "cardTransaction", group: "Card" },
  { pattern: "card", group: "Card" },
  { pattern: "atmTransaction", group: "ATM" },
  { pattern: "atm", group: "ATM" },
  { pattern: "feeTransaction", group: "ATM Fee" },
  { pattern: "fee", group: "ATM Fee" },
  { pattern: "bookTransaction", group: "Book/Payment" },
  { pattern: "bookPayment", group: "Book/Payment" },
  { pattern: "book", group: "Book/Payment" },
  { pattern: "wireTransaction", group: "Transfer/Other" },
  { pattern: "wire", group: "Transfer/Other" },
  { pattern: "achTransaction", group: "Transfer/Other" },
  { pattern: "ach", group: "Transfer/Other" },
  { pattern: "returnedAch", group: "Transfer/Other" },
  { pattern: "adjustment", group: "Transfer/Other" },
  { pattern: "disbursement", group: "Transfer/Other" },
  { pattern: "interest", group: "Transfer/Other" },
  { pattern: "release", group: "Transfer/Other" },
  { pattern: "hold", group: "Transfer/Other" },
];

/**
 * Classify a raw Unit transaction type into a human-readable group.
 */
export function classifyTransactionType(
  rawType: string | null | undefined,
  rules: TransactionTypeRule[] = DEFAULT_TRANSACTION_TYPE_RULES
): string {
  if (!rawType) return "Other";

  const lower = rawType.toLowerCase().trim();

  for (const rule of rules) {
    if (lower === rule.pattern.toLowerCase()) {
      return rule.group;
    }
  }

  // Partial match as fallback
  for (const rule of rules) {
    if (lower.includes(rule.pattern.toLowerCase())) {
      return rule.group;
    }
  }

  return `Other:${rawType}`;
}
