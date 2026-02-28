/**
 * Main ingestion pipeline - MEMORY-OPTIMIZED for Vercel serverless.
 *
 * Key optimizations:
 * - PapaParse `step` mode: never builds the full parsed-row array (~400MB saved)
 * - No intermediate NormalizedTransaction array (~400MB saved)
 * - Compact transactions built inline during parse
 * - Two-pass streaming: Pass 1 builds customerInUs, Pass 2 does full processing
 * - Peak memory: ~300MB for a 118MB / 500k-row CSV (vs 1.2GB+ before)
 */

import Papa from "papaparse";
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
  EmployerRollup,
  VendorRollup,
  ReportStats,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Compact transaction – the only per-row object we keep in memory    */
/* ------------------------------------------------------------------ */
export interface CompactTransaction {
  i: number;          // row index (id)
  d: string | null;   // date (ISO)
  t: string;          // unit type
  a: number;          // amount cents
  dr: string;         // direction
  s: string;          // summary
  c: string;          // customer id
  cp: string;         // counterparty name
  g: string;          // transaction group
  v: string;          // remittance vendor
  e: string;          // employer name
  ek: string;         // employer key
  lr: string | null;  // location raw
  lc: string | null;  // location country
  u: string;          // customer in US
}

/* ------------------------------------------------------------------ */
/*  Customer location row – for DB insert                              */
/* ------------------------------------------------------------------ */
export interface CustomerLocationRow {
  customerId: string;
  employerName: string;
  employerKey: string;
  inUs: string;
  latestLocationRaw: string | null;
  latestLocationCity: string | null;
  latestLocationState: string | null;
  latestLocationCountry: string | null;
  latestLocationDate: string | null;
  transactionCount: number;
}

/* ------------------------------------------------------------------ */
/*  Pipeline options & result                                          */
/* ------------------------------------------------------------------ */
export interface IngestOptions {
  csvText: string;
  employerMappingJson: unknown;
  transactionTypeRules?: TransactionTypeRule[];
  remittanceVendorRules?: RemittanceVendorRule[];
  /** Only consider locations from the last N days when determining "in US".
   *  0 or undefined = use all time. */
  locationRecencyDays?: number;
}

export interface IngestResult {
  compactTransactions: CompactTransaction[];
  employerRollups: EmployerRollup[];
  vendorRollups: VendorRollup[];
  customerLocationRows: CustomerLocationRow[];
  stats: ReportStats;
}

/* ------------------------------------------------------------------ */
/*  Header normaliser (shared by both passes)                          */
/* ------------------------------------------------------------------ */
function normalizeHeader(header: string): string {
  let h = header.trim().replace(/^\uFEFF/, "");
  h = h.replace(/[_\s]+(.)/g, (_, c: string) => c.toUpperCase());
  h = h.charAt(0).toLowerCase() + h.slice(1);
  return h;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */
export function runIngestionPipeline(options: IngestOptions): IngestResult {
  const {
    csvText,
    employerMappingJson,
    transactionTypeRules = DEFAULT_TRANSACTION_TYPE_RULES,
    remittanceVendorRules = DEFAULT_REMITTANCE_VENDOR_RULES,
    locationRecencyDays = 0,
  } = options;

  const startTime = Date.now();

  // Build employer lookup (fast – a simple Map)
  const employerMappings = parseEmployerMapping(employerMappingJson);
  const employerLookup = buildEmployerLookup(employerMappings);
  console.log(`[Ingest] Loaded ${employerMappings.length} employer mappings`);

  /* ================================================================
   * PASS 1 – Lightweight scan to build customer-in-US map
   * Only extracts: customerId, type, summary, createdAt
   * Memory: customerLatestLocation map (~5MB for 20k customers)
   * ================================================================ */
  console.log("[Ingest] Pass 1: Building customer location map...");

  const customerLatestLocation = new Map<string, {
    latestDate: number;
    country: string;
    raw: string;
    city: string | null;
    state: string | null;
  }>();
  const allCustomerIds = new Set<string>();
  let maxTransactionDate = 0; // Track latest date in dataset for recency window

  Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    step(result) {
      const row = result.data;
      const customerId = row.customerId?.trim() || "";
      if (customerId) allCustomerIds.add(customerId);

      const unitType = row.type?.trim() || "";
      const createdAt = parseTimestamp(row.createdAt);
      const ts = createdAt?.getTime() || 0;
      if (ts > maxTransactionDate) maxTransactionDate = ts;

      if (!isLocationBearingType(unitType)) return;

      const summary = row.summary?.trim() || "";
      if (!summary) return;

      const loc = extractLocationFast(summary);
      if (!loc || !loc.country) return;

      const existing = customerLatestLocation.get(customerId);
      if (!existing || ts > existing.latestDate) {
        customerLatestLocation.set(customerId, {
          latestDate: ts,
          country: loc.country,
          raw: loc.raw,
          city: loc.city,
          state: loc.state,
        });
      }
    },
  });

  // Build customerInUsMap from locations, applying recency window
  const locationCutoffDate = (locationRecencyDays > 0 && maxTransactionDate > 0)
    ? maxTransactionDate - (locationRecencyDays * 24 * 60 * 60 * 1000)
    : 0; // 0 = no cutoff, use all time

  if (locationCutoffDate > 0) {
    console.log(`[Ingest] Location recency: ${locationRecencyDays} days, cutoff: ${new Date(locationCutoffDate).toISOString()}, max date: ${new Date(maxTransactionDate).toISOString()}`);
  }

  const customerInUsMap = new Map<string, "true" | "false" | "unknown">();
  let customersInUsTrue = 0;
  let customersInUsFalse = 0;
  let customersInUsUnknown = 0;

  for (const cid of allCustomerIds) {
    const loc = customerLatestLocation.get(cid);
    // If no location, or location is outside the recency window → unknown
    if (!loc || (locationCutoffDate > 0 && loc.latestDate < locationCutoffDate)) {
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

  console.log(`[Ingest] Pass 1 complete in ${Date.now() - startTime}ms — ${allCustomerIds.size} customers`);

  /* ================================================================
   * PASS 2 – Full processing: rollups + compact transactions
   * PapaParse step mode ⇒ no rawRows array in memory
   * ================================================================ */
  console.log("[Ingest] Pass 2: Processing transactions...");
  const pass2Start = Date.now();

  // Compact transaction output array (the ONLY per-row array we keep)
  const compactTransactions: CompactTransaction[] = [];

  // ── Stats counters ──
  let totalRows = 0;
  let rowsWithLocations = 0;
  let unknownEmployerCount = 0;
  let remittanceCount = 0;
  let globalDebitCents = 0;
  let globalCreditCents = 0;
  let globalBookAmountCents = 0;
  let globalRemittanceAmountCents = 0;
  const transactionGroupCounts: Record<string, number> = {};
  const transactionGroupAmounts: Record<string, number> = {};
  const vendorMatchCounts: Record<string, number> = {};

  // ── Employer rollup accumulators ──
  const employerRollupMap = new Map<string, EmployerRollup>();
  const employerWorkerSets = new Map<string, Set<string>>();

  // ── Vendor rollup accumulators ──
  const vendorRollupMap = new Map<string, {
    count: number;
    amountCents: number;
    customers: Set<string>;
  }>();

  // ── Customer-level tracking (for customer_locations DB rows) ──
  const customerTxCount = new Map<string, number>();
  const customerEmployer = new Map<string, { name: string; key: string }>();

  Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    step(result) {
      const row = result.data;
      const idx = totalRows++;

      // ── Basic field extraction ──
      const customerId = row.customerId?.trim() || "";
      const unitType = row.type?.trim() || "";
      const summary = row.summary?.trim() || "";
      const counterpartyName = row.counterpartyName?.trim() || "";
      const direction = row.direction?.trim() || "";

      // ── Customer tracking ──
      if (customerId) {
        customerTxCount.set(customerId, (customerTxCount.get(customerId) || 0) + 1);
        if (!customerEmployer.has(customerId)) {
          const emp = employerLookup.get(customerId);
          if (emp) {
            customerEmployer.set(customerId, { name: emp.employerName, key: emp.employerKey });
          }
        }
      }

      // ── Employer lookup ──
      const employer = employerLookup.get(customerId) || {
        employerName: "Unknown employer",
        employerKey: "UNKNOWN EMPLOYER",
      };
      if (employer.employerKey === "UNKNOWN EMPLOYER") unknownEmployerCount++;

      // ── Transaction type ──
      const transactionGroup = classifyTransactionType(unitType, transactionTypeRules);
      transactionGroupCounts[transactionGroup] = (transactionGroupCounts[transactionGroup] || 0) + 1;
      // Amount per group will be accumulated after amt is calculated (below)

      // ── Remittance vendor ──
      const remittanceVendor = classifyRemittanceVendorFast(summary, counterpartyName, remittanceVendorRules);
      vendorMatchCounts[remittanceVendor] = (vendorMatchCounts[remittanceVendor] || 0) + 1;
      if (remittanceVendor !== "Not remittance") remittanceCount++;

      // ── Amounts & dates ──
      const amountCents = parseAmountCents(row.amount);
      const rawCreatedAt = parseTimestamp(row.createdAt);

      // ── Location (only for location-bearing types) ──
      let locationRaw: string | null = null;
      let locationCountry: string | null = null;

      if (isLocationBearingType(unitType) && summary) {
        const loc = extractLocationFast(summary);
        if (loc) {
          locationRaw = loc.raw;
          locationCountry = loc.country;
          if (locationCountry) rowsWithLocations++;
        }
      }

      // ── customerInUs (from pass 1) ──
      const customerInUs = customerInUsMap.get(customerId) || "unknown";

      // ── Build compact transaction (direct, no intermediate object) ──
      compactTransactions.push({
        i: idx,
        d: rawCreatedAt?.toISOString() || null,
        t: unitType,
        a: amountCents,
        dr: direction,
        s: summary,
        c: customerId,
        cp: counterpartyName,
        g: transactionGroup,
        v: remittanceVendor,
        e: employer.employerName,
        ek: employer.employerKey,
        lr: locationRaw,
        lc: locationCountry,
        u: customerInUs,
      });

      // ── Accumulate employer rollup ──
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

      employerWorkerSets.get(employer.employerKey)!.add(customerId);
      rollup.transactionCount++;
      const amt = Math.abs(amountCents);

      // Per-group amount tracking
      transactionGroupAmounts[transactionGroup] = (transactionGroupAmounts[transactionGroup] || 0) + amt;

      // Global volume tracking
      if (direction.toLowerCase() === "debit") {
        rollup.totalDebitCents += amt;
        globalDebitCents += amt;
      } else if (direction.toLowerCase() === "credit") {
        rollup.totalCreditCents += amt;
        globalCreditCents += amt;
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
        case "ATM Fee":
          rollup.feeCount++;
          rollup.feeAmountCents += amt;
          break;
        case "Book/Payment":
          rollup.bookCount++;
          rollup.bookAmountCents += amt;
          globalBookAmountCents += amt;
          break;
      }

      if (remittanceVendor !== "Not remittance") {
        rollup.remittanceCount++;
        rollup.remittanceAmountCents += amt;
        globalRemittanceAmountCents += amt;
        if (!rollup.vendorBreakdown[remittanceVendor]) {
          rollup.vendorBreakdown[remittanceVendor] = { count: 0, amountCents: 0 };
        }
        rollup.vendorBreakdown[remittanceVendor].count++;
        rollup.vendorBreakdown[remittanceVendor].amountCents += amt;
      }

      // ── Accumulate vendor rollup ──
      let vendorEntry = vendorRollupMap.get(remittanceVendor);
      if (!vendorEntry) {
        vendorEntry = { count: 0, amountCents: 0, customers: new Set() };
        vendorRollupMap.set(remittanceVendor, vendorEntry);
      }
      vendorEntry.count++;
      vendorEntry.amountCents += amt;
      vendorEntry.customers.add(customerId);
    },
  });

  console.log(`[Ingest] Pass 2 complete in ${Date.now() - pass2Start}ms — ${totalRows} rows`);

  /* ================================================================
   * Finalize rollups
   * ================================================================ */

  // Employer rollups: set worker counts and US status
  for (const [key, rollup] of employerRollupMap) {
    const workers = employerWorkerSets.get(key)!;
    rollup.workerCount = workers.size;
    for (const wid of workers) {
      const inUs = customerInUsMap.get(wid);
      if (inUs === "true") rollup.workersInUs++;
      else if (inUs === "false") rollup.workersNotInUs++;
      else rollup.workersUnknownUs++;
    }
  }
  // Free worker sets (no longer needed)
  employerWorkerSets.clear();

  const employerRollups = Array.from(employerRollupMap.values());

  const vendorRollups: VendorRollup[] = Array.from(vendorRollupMap.entries()).map(
    ([vendorName, data]) => ({
      vendorName,
      transactionCount: data.count,
      totalAmountCents: data.amountCents,
      uniqueCustomers: data.customers.size,
    })
  );

  // Build customer location rows (for DB insert)
  const customerLocationRows: CustomerLocationRow[] = [];
  for (const cid of allCustomerIds) {
    const loc = customerLatestLocation.get(cid);
    const emp = customerEmployer.get(cid);
    const inUs = customerInUsMap.get(cid) || "unknown";

    customerLocationRows.push({
      customerId: cid,
      employerName: emp?.name || "Unknown employer",
      employerKey: emp?.key || "UNKNOWN EMPLOYER",
      inUs,
      latestLocationRaw: loc?.raw || null,
      latestLocationCity: loc?.city || null,
      latestLocationState: loc?.state || null,
      latestLocationCountry: loc?.country || null,
      latestLocationDate: loc ? new Date(loc.latestDate).toISOString() : null,
      transactionCount: customerTxCount.get(cid) || 0,
    });
  }

  const stats: ReportStats = {
    totalRows,
    rowsWithLocations,
    customersInUsTrue,
    customersInUsFalse,
    customersInUsUnknown,
    unknownEmployerCount,
    // Remittance rate = % of DEBIT VOLUME (dollar-based, not count-based)
    remittanceMatchRate: globalDebitCents > 0 ? globalRemittanceAmountCents / globalDebitCents : 0,
    totalCustomers: allCustomerIds.size,
    totalEmployers: employerRollupMap.size,
    transactionGroupCounts,
    transactionGroupAmounts,
    vendorMatchCounts,
    totalDebitCents: globalDebitCents,
    totalCreditCents: globalCreditCents,
    totalBookAmountCents: globalBookAmountCents,
    totalRemittanceAmountCents: globalRemittanceAmountCents,
    locationRecencyDays,
  };

  const totalTime = Date.now() - startTime;
  console.log(`[Ingest] Pipeline complete in ${totalTime}ms`);
  console.log(`[Ingest] Stats: ${totalRows} txns, ${allCustomerIds.size} customers, ${employerRollups.length} employers`);

  return { compactTransactions, employerRollups, vendorRollups, customerLocationRows, stats };
}
