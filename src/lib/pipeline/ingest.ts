/**
 * Main ingestion pipeline - OPTIMIZED for large files.
 * 
 * Key optimizations:
 * - Single pass over data where possible
 * - No duplicate array iterations
 * - Inline aggregation during normalization
 * - Minimal object allocations
 */

import { parseCsvString, type RawTransactionRow } from "@/lib/parsing/csv-parser";
import { parseAmountCents } from "@/lib/parsing/amount";
import { parseTimestamp } from "@/lib/parsing/timestamp";
import { extractLocationFast, isLocationBearingType } from "@/lib/parsing/location";
import {
  classifyTransactionType,
  type TransactionTypeRule,
  DEFAULT_TRANSACTION_TYPE_RULES,
} from "@/lib/classification/transaction-types";
import {
  classifyRemittanceVendorFast,
  type RemittanceVendorRule,
  DEFAULT_REMITTANCE_VENDOR_RULES,
} from "@/lib/classification/remittance-vendors";
import {
  parseEmployerMapping,
  buildEmployerLookup,
} from "@/lib/classification/employer-mapping";
import type {
  NormalizedTransaction,
  EmployerRollup,
  VendorRollup,
  ReportStats,
} from "@/lib/types";

export interface IngestOptions {
  csvText: string;
  employerMappingJson: unknown;
  transactionTypeRules?: TransactionTypeRule[];
  remittanceVendorRules?: RemittanceVendorRule[];
}

export interface IngestResult {
  transactions: NormalizedTransaction[];
  employerRollups: EmployerRollup[];
  vendorRollups: VendorRollup[];
  stats: ReportStats;
}

/**
 * Optimized single-pass ingestion pipeline.
 * Processes all data in one iteration, computing aggregates inline.
 */
export function runIngestionPipeline(options: IngestOptions): IngestResult {
  const {
    csvText,
    employerMappingJson,
    transactionTypeRules = DEFAULT_TRANSACTION_TYPE_RULES,
    remittanceVendorRules = DEFAULT_REMITTANCE_VENDOR_RULES,
  } = options;

  const startTime = Date.now();

  // Step 1: Parse CSV
  console.log("[Ingest] Parsing CSV...");
  const rawRows = parseCsvString(csvText);
  console.log(`[Ingest] Parsed ${rawRows.length} rows in ${Date.now() - startTime}ms`);

  // Step 2: Parse employer mapping (this is fast, just a Map build)
  const employerMappings = parseEmployerMapping(employerMappingJson);
  const employerLookup = buildEmployerLookup(employerMappings);
  console.log(`[Ingest] Loaded ${employerMappings.length} employer mappings`);

  // Step 3: Single-pass processing
  // We'll compute everything in one loop: transactions, stats, customer locations, rollups
  console.log("[Ingest] Processing transactions (single pass)...");
  
  const transactions: NormalizedTransaction[] = new Array(rawRows.length);
  
  // Stats counters
  let rowsWithLocations = 0;
  let unknownEmployerCount = 0;
  let remittanceCount = 0;
  const transactionGroupCounts: Record<string, number> = {};
  const vendorMatchCounts: Record<string, number> = {};
  
  // Customer location tracking (for in_us classification)
  // Map: customerId -> { latestDate, country, locationData }
  const customerLatestLocation = new Map<string, {
    latestDate: number; // timestamp for fast comparison
    country: string;
    raw: string;
    city: string | null;
    state: string | null;
  }>();
  
  // Employer rollup accumulators
  const employerRollupMap = new Map<string, EmployerRollup>();
  const employerWorkerSets = new Map<string, Set<string>>();
  
  // Vendor rollup accumulators
  const vendorRollupMap = new Map<string, {
    count: number;
    amountCents: number;
    customers: Set<string>;
  }>();
  
  // Unique customers set
  const allCustomerIds = new Set<string>();

  // SINGLE PASS over all rows
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    
    // Basic field extraction (avoid repeated .trim() by doing it once)
    const customerId = row.customerId?.trim() || "";
    const unitType = row.type?.trim() || "";
    const summary = row.summary?.trim() || "";
    const counterpartyName = row.counterpartyName?.trim() || "";
    const direction = row.direction?.trim() || "";
    
    // Track unique customers
    if (customerId) allCustomerIds.add(customerId);
    
    // Employer lookup
    const employer = employerLookup.get(customerId) || {
      employerName: "Unknown employer",
      employerKey: "UNKNOWN EMPLOYER",
    };
    if (employer.employerKey === "UNKNOWN EMPLOYER") unknownEmployerCount++;
    
    // Transaction type classification
    const transactionGroup = classifyTransactionType(unitType, transactionTypeRules);
    transactionGroupCounts[transactionGroup] = (transactionGroupCounts[transactionGroup] || 0) + 1;
    
    // Remittance vendor classification (fast version without evidence object)
    const remittanceVendor = classifyRemittanceVendorFast(summary, counterpartyName, remittanceVendorRules);
    vendorMatchCounts[remittanceVendor] = (vendorMatchCounts[remittanceVendor] || 0) + 1;
    if (remittanceVendor !== "Not remittance") remittanceCount++;
    
    // Parse amounts once
    const amountCents = parseAmountCents(row.amount);
    const balanceCents = parseAmountCents(row.balance);
    const rawCreatedAt = parseTimestamp(row.createdAt);
    const createdAtTs = rawCreatedAt?.getTime() || 0;
    
    // Location extraction - only for location-bearing transaction types
    let locationRaw: string | null = null;
    let locationCity: string | null = null;
    let locationState: string | null = null;
    let locationCountry: string | null = null;
    
    if (isLocationBearingType(unitType) && summary) {
      const loc = extractLocationFast(summary);
      if (loc) {
        locationRaw = loc.raw;
        locationCity = loc.city;
        locationState = loc.state;
        locationCountry = loc.country;
        if (locationCountry) rowsWithLocations++;
        
        // Update customer's latest location if this is newer
        if (customerId && locationCountry) {
          const existing = customerLatestLocation.get(customerId);
          if (!existing || createdAtTs > existing.latestDate) {
            customerLatestLocation.set(customerId, {
              latestDate: createdAtTs,
              country: locationCountry,
              raw: loc.raw,
              city: loc.city,
              state: loc.state,
            });
          }
        }
      }
    }
    
    // Build transaction object (direct assignment, no spread)
    const tx: NormalizedTransaction = {
      rawCreatedAt,
      unitId: row.id?.trim() || "",
      unitType,
      amountCents,
      direction,
      balanceCents,
      summary,
      customerId,
      accountId: row.accountId?.trim() || "",
      counterpartyName,
      counterpartyCustomer: row.counterpartyCustomer?.trim() || "",
      counterpartyAccount: row.counterpartyAccount?.trim() || "",
      paymentId: row.paymentId?.trim() || "",
      transactionGroup,
      remittanceVendor,
      employerName: employer.employerName,
      employerKey: employer.employerKey,
      locationRaw,
      locationCity,
      locationState,
      locationCountry,
      customerInUs: "unknown", // Will be set in second mini-pass
    };
    
    transactions[i] = tx;
    
    // Accumulate employer rollup
    let rollup = employerRollupMap.get(employer.employerKey);
    if (!rollup) {
      rollup = {
        employerName: employer.employerName,
        employerKey: employer.employerKey,
        workerCount: 0,
        transactionCount: 0,
        totalDebitCents: 0,
        totalCreditCents: 0,
        cardCount: 0,
        cardAmountCents: 0,
        atmCount: 0,
        atmAmountCents: 0,
        feeCount: 0,
        feeAmountCents: 0,
        bookCount: 0,
        bookAmountCents: 0,
        remittanceCount: 0,
        remittanceAmountCents: 0,
        workersInUs: 0,
        workersNotInUs: 0,
        workersUnknownUs: 0,
        vendorBreakdown: {},
      };
      employerRollupMap.set(employer.employerKey, rollup);
      employerWorkerSets.set(employer.employerKey, new Set());
    }
    
    // Track worker
    employerWorkerSets.get(employer.employerKey)!.add(customerId);
    
    // Update rollup counts
    rollup.transactionCount++;
    const amt = Math.abs(amountCents);
    
    if (direction.toLowerCase() === "debit") {
      rollup.totalDebitCents += amt;
    } else if (direction.toLowerCase() === "credit") {
      rollup.totalCreditCents += amt;
    }
    
    switch (transactionGroup) {
      case "Card":
        rollup.cardCount++;
        rollup.cardAmountCents += amt;
        break;
      case "ATM":
        rollup.atmCount++;
        rollup.atmAmountCents += amt;
        break;
      case "Fee":
        rollup.feeCount++;
        rollup.feeAmountCents += amt;
        break;
      case "Book/Payment":
        rollup.bookCount++;
        rollup.bookAmountCents += amt;
        break;
    }
    
    if (remittanceVendor !== "Not remittance") {
      rollup.remittanceCount++;
      rollup.remittanceAmountCents += amt;
      
      if (!rollup.vendorBreakdown[remittanceVendor]) {
        rollup.vendorBreakdown[remittanceVendor] = { count: 0, amountCents: 0 };
      }
      rollup.vendorBreakdown[remittanceVendor].count++;
      rollup.vendorBreakdown[remittanceVendor].amountCents += amt;
    }
    
    // Accumulate vendor rollup
    let vendorEntry = vendorRollupMap.get(remittanceVendor);
    if (!vendorEntry) {
      vendorEntry = { count: 0, amountCents: 0, customers: new Set() };
      vendorRollupMap.set(remittanceVendor, vendorEntry);
    }
    vendorEntry.count++;
    vendorEntry.amountCents += amt;
    vendorEntry.customers.add(customerId);
  }
  
  console.log(`[Ingest] First pass complete in ${Date.now() - startTime}ms`);
  
  // Step 4: Quick second pass to set customerInUs based on latest location
  // This is O(n) but very fast since we're just doing map lookups
  let customersInUsTrue = 0;
  let customersInUsFalse = 0;
  let customersInUsUnknown = 0;
  
  // Build customer inUs map
  const customerInUsMap = new Map<string, "true" | "false" | "unknown">();
  for (const cid of allCustomerIds) {
    const loc = customerLatestLocation.get(cid);
    if (!loc) {
      customerInUsMap.set(cid, "unknown");
      customersInUsUnknown++;
    } else if (loc.country === "US") {
      customerInUsMap.set(cid, "true");
      customersInUsTrue++;
    } else {
      customerInUsMap.set(cid, "false");
      customersInUsFalse++;
    }
  }
  
  // Apply to transactions
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    tx.customerInUs = customerInUsMap.get(tx.customerId) || "unknown";
  }
  
  // Step 5: Finalize employer rollups (worker counts and US status)
  for (const [key, rollup] of employerRollupMap) {
    const workers = employerWorkerSets.get(key)!;
    rollup.workerCount = workers.size;
    
    for (const wid of workers) {
      const inUs = customerInUsMap.get(wid);
      if (inUs === "true") {
        rollup.workersInUs++;
      } else if (inUs === "false") {
        rollup.workersNotInUs++;
      } else {
        rollup.workersUnknownUs++;
      }
    }
  }
  
  // Step 6: Build final results
  const stats: ReportStats = {
    totalRows: transactions.length,
    rowsWithLocations,
    customersInUsTrue,
    customersInUsFalse,
    customersInUsUnknown,
    unknownEmployerCount,
    remittanceMatchRate: transactions.length > 0 ? remittanceCount / transactions.length : 0,
    totalCustomers: allCustomerIds.size,
    totalEmployers: employerRollupMap.size,
    transactionGroupCounts,
    vendorMatchCounts,
  };
  
  const employerRollups = Array.from(employerRollupMap.values());
  
  const vendorRollups: VendorRollup[] = Array.from(vendorRollupMap.entries()).map(
    ([vendorName, data]) => ({
      vendorName,
      transactionCount: data.count,
      totalAmountCents: data.amountCents,
      uniqueCustomers: data.customers.size,
    })
  );
  
  console.log(`[Ingest] Pipeline complete in ${Date.now() - startTime}ms`);
  console.log(`[Ingest] Stats: ${transactions.length} txns, ${allCustomerIds.size} customers, ${employerRollups.length} employers`);

  return { transactions, employerRollups, vendorRollups, stats };
}

// Export customer location data for the process-report route
export interface CustomerLocationData {
  customerId: string;
  inUs: "true" | "false" | "unknown";
  latestLocationRaw: string | null;
  latestLocationCity: string | null;
  latestLocationState: string | null;
  latestLocationCountry: string | null;
  latestLocationDate: Date | null;
}

/**
 * Extract customer location data from transactions.
 * This is used by process-report to insert customer_locations rows.
 */
export function extractCustomerLocations(
  transactions: NormalizedTransaction[]
): Map<string, CustomerLocationData> {
  const customerLatest = new Map<string, {
    latestDate: number;
    country: string;
    raw: string;
    city: string | null;
    state: string | null;
    createdAt: Date | null;
  }>();
  
  const allCustomerIds = new Set<string>();
  
  for (const tx of transactions) {
    if (!tx.customerId) continue;
    allCustomerIds.add(tx.customerId);
    
    if (!isLocationBearingType(tx.unitType)) continue;
    if (!tx.locationCountry) continue;
    
    const txTs = tx.rawCreatedAt?.getTime() || 0;
    const existing = customerLatest.get(tx.customerId);
    
    if (!existing || txTs > existing.latestDate) {
      customerLatest.set(tx.customerId, {
        latestDate: txTs,
        country: tx.locationCountry,
        raw: tx.locationRaw || "",
        city: tx.locationCity,
        state: tx.locationState,
        createdAt: tx.rawCreatedAt,
      });
    }
  }
  
  const results = new Map<string, CustomerLocationData>();
  
  for (const cid of allCustomerIds) {
    const loc = customerLatest.get(cid);
    if (!loc) {
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
      results.set(cid, {
        customerId: cid,
        inUs: loc.country === "US" ? "true" : "false",
        latestLocationRaw: loc.raw,
        latestLocationCity: loc.city,
        latestLocationState: loc.state,
        latestLocationCountry: loc.country,
        latestLocationDate: loc.createdAt,
      });
    }
  }
  
  return results;
}
