/**
 * Location extraction from Unit transaction summary fields.
 *
 * Examples:
 *   "Purchase from WAL-MART #1541 | Address: WEST PALM BEA, FL, US | **7402"
 *   "Withdraw at CHASE BANK | Address: DOVER, FL, US | **1234"
 *   "Purchase from STORE | Address: MEXICO CI, DF, MX | **5555"
 */

export interface ParsedLocation {
  raw: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

// Pre-compiled regex for better performance
const ADDRESS_REGEX = /Address:\s*([^|]*)/i;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

/**
 * Extract location from a summary string.
 * Returns null if no address pattern is found.
 */
export function extractLocation(
  summary: string | null | undefined
): ParsedLocation | null {
  if (!summary) return null;

  const addressMatch = summary.match(ADDRESS_REGEX);
  if (!addressMatch) return null;

  const rawAddress = addressMatch[1].trim();
  if (!rawAddress) return null;

  // Split by comma and trim parts
  const parts = rawAddress.split(",").map((p) => p.trim()).filter(Boolean);

  let city: string | null = null;
  let state: string | null = null;
  let country: string | null = null;

  if (parts.length >= 3) {
    city = parts[0] || null;
    state = parts[1] || null;
    country = parts[2] || null;
  } else if (parts.length === 2) {
    if (parts[1].length === 2 && COUNTRY_CODE_REGEX.test(parts[1])) {
      state = parts[0];
      country = parts[1];
    } else {
      city = parts[0];
      state = parts[1];
    }
  } else if (parts.length === 1) {
    if (parts[0].length === 2 && COUNTRY_CODE_REGEX.test(parts[0])) {
      country = parts[0];
    } else {
      city = parts[0];
    }
  }

  if (country) country = country.toUpperCase().trim();
  if (state) state = state.toUpperCase().trim();

  return { raw: rawAddress, city, state, country };
}

/**
 * Fast location extraction - optimized for hot path.
 * Uses indexOf instead of regex where possible.
 */
export function extractLocationFast(summary: string): ParsedLocation | null {
  // Fast check: does it contain "Address:" at all?
  const addrIdx = summary.indexOf("Address:");
  if (addrIdx === -1) {
    // Try lowercase
    const addrIdxLower = summary.toLowerCase().indexOf("address:");
    if (addrIdxLower === -1) return null;
  }
  
  // Fall back to regex for actual parsing (still needed for capture)
  const addressMatch = summary.match(ADDRESS_REGEX);
  if (!addressMatch) return null;

  const rawAddress = addressMatch[1].trim();
  if (!rawAddress) return null;

  // Fast path: check for common US pattern "CITY, ST, US"
  const pipeIdx = rawAddress.indexOf("|");
  const cleanAddr = pipeIdx > 0 ? rawAddress.substring(0, pipeIdx).trim() : rawAddress;
  
  // Split by comma
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i <= cleanAddr.length; i++) {
    if (i === cleanAddr.length || cleanAddr[i] === ",") {
      const part = cleanAddr.substring(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }

  let city: string | null = null;
  let state: string | null = null;
  let country: string | null = null;

  if (parts.length >= 3) {
    city = parts[0];
    state = parts[1].toUpperCase();
    country = parts[2].toUpperCase();
  } else if (parts.length === 2) {
    const p1Upper = parts[1].toUpperCase();
    if (parts[1].length === 2 && /^[A-Z]{2}$/.test(p1Upper)) {
      state = parts[0].toUpperCase();
      country = p1Upper;
    } else {
      city = parts[0];
      state = p1Upper;
    }
  } else if (parts.length === 1) {
    const p0Upper = parts[0].toUpperCase();
    if (parts[0].length === 2 && /^[A-Z]{2}$/.test(p0Upper)) {
      country = p0Upper;
    } else {
      city = parts[0];
    }
  }

  return { raw: rawAddress, city, state, country };
}

/**
 * Determine if a transaction type is "location-bearing" (card purchase or ATM).
 */
export function isLocationBearingType(unitType: string | null | undefined): boolean {
  if (!unitType) return false;
  const t = unitType.toLowerCase();
  return (
    t.includes("purchase") ||
    t.includes("atm") ||
    t === "purchasetransaction" ||
    t === "atmtransaction" ||
    t === "cardtransaction"
  );
}

export interface CustomerLocationResult {
  customerId: string;
  inUs: "true" | "false" | "unknown";
  latestLocationRaw: string | null;
  latestLocationCity: string | null;
  latestLocationState: string | null;
  latestLocationCountry: string | null;
  latestLocationDate: Date | null;
}

/**
 * Classify each customer's US presence based on their most recent
 * location-bearing transaction.
 */
export function classifyCustomersInUs(
  transactions: Array<{
    customerId: string;
    unitType: string;
    summary: string | null;
    createdAt: Date | null;
  }>
): Map<string, CustomerLocationResult> {
  const customerMap = new Map<
    string,
    {
      latestDate: Date | null;
      location: ParsedLocation | null;
    }
  >();

  for (const tx of transactions) {
    if (!tx.customerId) continue;
    if (!isLocationBearingType(tx.unitType)) continue;

    const loc = extractLocation(tx.summary);
    if (!loc || !loc.country) continue;

    const existing = customerMap.get(tx.customerId);
    const txDate = tx.createdAt;

    if (
      !existing ||
      !existing.latestDate ||
      (txDate && txDate > existing.latestDate)
    ) {
      customerMap.set(tx.customerId, {
        latestDate: txDate,
        location: loc,
      });
    }
  }

  // Build result for all unique customer IDs
  const allCustomerIds = new Set(
    transactions.map((tx) => tx.customerId).filter(Boolean)
  );

  const results = new Map<string, CustomerLocationResult>();

  for (const cid of allCustomerIds) {
    const data = customerMap.get(cid);

    if (!data || !data.location) {
      results.set(cid, {
        customerId: cid,
        inUs: "unknown",
        latestLocationRaw: null,
        latestLocationCity: null,
        latestLocationState: null,
        latestLocationCountry: null,
        latestLocationDate: null,
      });
    } else {
      const inUs =
        data.location.country === "US" ? "true" : "false";
      results.set(cid, {
        customerId: cid,
        inUs,
        latestLocationRaw: data.location.raw,
        latestLocationCity: data.location.city,
        latestLocationState: data.location.state,
        latestLocationCountry: data.location.country,
        latestLocationDate: data.latestDate,
      });
    }
  }

  return results;
}
