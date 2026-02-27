import Papa from "papaparse";

export interface RawTransactionRow {
  createdAt?: string;
  id?: string;
  type?: string;
  amount?: string;
  direction?: string;
  balance?: string;
  summary?: string;
  customerId?: string;
  accountId?: string;
  counterpartyName?: string;
  counterpartyCustomer?: string;
  counterpartyAccount?: string;
  paymentId?: string;
  [key: string]: string | undefined;
}

/**
 * Parse a CSV string into an array of raw transaction rows.
 * Uses PapaParse for robust handling of quoted fields, etc.
 * Defensive: normalizes column headers to camelCase-like keys.
 */
export function parseCsvString(csvText: string): RawTransactionRow[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => {
      // Normalize: trim, remove BOM, convert common patterns
      let h = header.trim().replace(/^\uFEFF/, "");
      // Convert snake_case or space-separated to camelCase
      h = h.replace(/[_\s]+(.)/g, (_, c) => c.toUpperCase());
      // Ensure first char is lowercase
      h = h.charAt(0).toLowerCase() + h.slice(1);
      return h;
    },
  });

  return result.data as RawTransactionRow[];
}

/**
 * Parse CSV from a File/Blob (streaming-friendly, but buffered for Vercel).
 * For large files, this processes in a single pass.
 */
export async function parseCsvFile(file: File | Blob): Promise<RawTransactionRow[]> {
  const text = await file.text();
  return parseCsvString(text);
}
