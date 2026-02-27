/**
 * Main ingestion pipeline.
 * Parses CSV, enriches transactions, computes aggregates, stores to DB.
 */

import { parseCsvString, type RawTransactionRow } from "@/lib/parsing/csv-parser";
import { parseAmountCents } from "@/lib/parsing/amount";
import { parseTimestamp } from "@/lib/parsing/timestamp";
import { extractLocation, classifyCustomersInUs } from "@/lib/parsing/location";
import {
  classifyTransactionType,
  type TransactionTypeRule,
  DEFAULT_TRANSACTION_TYPE_RULES,
} from "@/lib/classification/transaction-types";
import {
  classifyRemittanceVendorWithEvidence,
  type RemittanceVendorRule,
  type VendorMatchEvidence,
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

export function runIngestionPipeline(options: IngestOptions): IngestResult {
  const {
    csvText,
    employerMappingJson,
    transactionTypeRules = DEFAULT_TRANSACTION_TYPE_RULES,
    remittanceVendorRules = DEFAULT_REMITTANCE_VENDOR_RULES,
  } = options;

  // Step 1: Parse CSV
  console.log("[Ingest] Parsing CSV...");
  const rawRows = parseCsvString(csvText);
  console.log(`[Ingest] Parsed ${rawRows.length} rows`);

  // Step 2: Parse employer mapping
  console.log("[Ingest] Parsing employer mapping...");
  const employerMappings = parseEmployerMapping(employerMappingJson);
  const employerLookup = buildEmployerLookup(employerMappings);
  console.log(`[Ingest] Loaded ${employerMappings.length} employer mappings`);

  // Step 3: Normalize transactions (first pass - without in_us)
  console.log("[Ingest] Normalizing transactions...");
  const preTxns = rawRows.map((row) => normalizeRow(row, employerLookup, transactionTypeRules, remittanceVendorRules));

  // Step 4: Classify customers in US
  console.log("[Ingest] Classifying customer US locations...");
  const customerLocations = classifyCustomersInUs(
    preTxns.map((tx) => ({
      customerId: tx.customerId,
      unitType: tx.unitType,
      summary: tx.summary,
      createdAt: tx.rawCreatedAt,
    }))
  );

  // Step 5: Apply in_us to transactions
  const transactions: NormalizedTransaction[] = preTxns.map((tx) => {
    const loc = customerLocations.get(tx.customerId);
    return {
      ...tx,
      customerInUs: loc?.inUs ?? "unknown",
    };
  });

  // Count stats
  let rowsWithLocations = 0;
  for (const tx of transactions) {
    if (tx.locationCountry) rowsWithLocations++;
  }

  let customersInUsTrue = 0;
  let customersInUsFalse = 0;
  let customersInUsUnknown = 0;
  for (const loc of customerLocations.values()) {
    if (loc.inUs === "true") customersInUsTrue++;
    else if (loc.inUs === "false") customersInUsFalse++;
    else customersInUsUnknown++;
  }

  const unknownEmployerCount = transactions.filter(
    (tx) => tx.employerKey === "UNKNOWN EMPLOYER"
  ).length;

  const remittanceCount = transactions.filter(
    (tx) => tx.remittanceVendor !== "Not remittance"
  ).length;

  const transactionGroupCounts: Record<string, number> = {};
  for (const tx of transactions) {
    transactionGroupCounts[tx.transactionGroup] =
      (transactionGroupCounts[tx.transactionGroup] || 0) + 1;
  }

  const vendorMatchCounts: Record<string, number> = {};
  for (const tx of transactions) {
    vendorMatchCounts[tx.remittanceVendor] =
      (vendorMatchCounts[tx.remittanceVendor] || 0) + 1;
  }

  const uniqueEmployers = new Set(transactions.map((tx) => tx.employerKey));

  const stats: ReportStats = {
    totalRows: transactions.length,
    rowsWithLocations,
    customersInUsTrue,
    customersInUsFalse,
    customersInUsUnknown,
    unknownEmployerCount,
    remittanceMatchRate:
      transactions.length > 0 ? remittanceCount / transactions.length : 0,
    totalCustomers: customerLocations.size,
    totalEmployers: uniqueEmployers.size,
    transactionGroupCounts,
    vendorMatchCounts,
  };

  console.log("[Ingest] Stats:", JSON.stringify(stats, null, 2));

  // Step 6: Compute employer rollups
  console.log("[Ingest] Computing employer rollups...");
  const employerRollups = computeEmployerRollups(transactions, customerLocations);

  // Step 7: Compute vendor rollups
  console.log("[Ingest] Computing vendor rollups...");
  const vendorRollups = computeVendorRollups(transactions);

  console.log("[Ingest] Pipeline complete.");

  return { transactions, employerRollups, vendorRollups, stats };
}

interface NormalizedTransactionWithEvidence extends NormalizedTransaction {
  vendorMatchEvidence: VendorMatchEvidence | null;
}

function normalizeRow(
  row: RawTransactionRow,
  employerLookup: Map<string, { employerName: string; employerKey: string }>,
  typeRules: TransactionTypeRule[],
  vendorRules: RemittanceVendorRule[]
): NormalizedTransactionWithEvidence {
  const customerId = (row.customerId || "").trim();
  const employer = employerLookup.get(customerId) || {
    employerName: "Unknown employer",
    employerKey: "UNKNOWN EMPLOYER",
  };

  const location = extractLocation(row.summary);
  const unitType = (row.type || "").trim();

  // Get vendor classification with evidence
  const vendorResult = classifyRemittanceVendorWithEvidence(
    row.summary,
    row.counterpartyName,
    vendorRules
  );

  return {
    rawCreatedAt: parseTimestamp(row.createdAt),
    unitId: (row.id || "").trim(),
    unitType,
    amountCents: parseAmountCents(row.amount),
    direction: (row.direction || "").trim(),
    balanceCents: parseAmountCents(row.balance),
    summary: (row.summary || "").trim(),
    customerId,
    accountId: (row.accountId || "").trim(),
    counterpartyName: (row.counterpartyName || "").trim(),
    counterpartyCustomer: (row.counterpartyCustomer || "").trim(),
    counterpartyAccount: (row.counterpartyAccount || "").trim(),
    paymentId: (row.paymentId || "").trim(),

    transactionGroup: classifyTransactionType(unitType, typeRules),
    remittanceVendor: vendorResult.vendor,
    vendorMatchEvidence: vendorResult.evidence,
    employerName: employer.employerName,
    employerKey: employer.employerKey,

    locationRaw: location?.raw ?? null,
    locationCity: location?.city ?? null,
    locationState: location?.state ?? null,
    locationCountry: location?.country ?? null,

    customerInUs: "unknown", // Will be set after classification
  };
}

function computeEmployerRollups(
  transactions: NormalizedTransaction[],
  customerLocations: Map<string, { inUs: string }>
): EmployerRollup[] {
  const map = new Map<string, EmployerRollup>();

  // Track unique workers per employer
  const workerSets = new Map<string, Set<string>>();

  for (const tx of transactions) {
    let rollup = map.get(tx.employerKey);
    if (!rollup) {
      rollup = {
        employerName: tx.employerName,
        employerKey: tx.employerKey,
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
      map.set(tx.employerKey, rollup);
      workerSets.set(tx.employerKey, new Set());
    }

    const workers = workerSets.get(tx.employerKey)!;
    workers.add(tx.customerId);

    rollup.transactionCount++;
    const amt = Math.abs(tx.amountCents);

    if (tx.direction?.toLowerCase() === "debit") {
      rollup.totalDebitCents += amt;
    } else if (tx.direction?.toLowerCase() === "credit") {
      rollup.totalCreditCents += amt;
    }

    switch (tx.transactionGroup) {
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

    if (tx.remittanceVendor !== "Not remittance") {
      rollup.remittanceCount++;
      rollup.remittanceAmountCents += amt;

      if (!rollup.vendorBreakdown[tx.remittanceVendor]) {
        rollup.vendorBreakdown[tx.remittanceVendor] = {
          count: 0,
          amountCents: 0,
        };
      }
      rollup.vendorBreakdown[tx.remittanceVendor].count++;
      rollup.vendorBreakdown[tx.remittanceVendor].amountCents += amt;
    }
  }

  // Set worker counts and US status counts
  for (const [key, rollup] of map) {
    const workers = workerSets.get(key)!;
    rollup.workerCount = workers.size;

    for (const wid of workers) {
      const loc = customerLocations.get(wid);
      if (!loc) {
        rollup.workersUnknownUs++;
      } else if (loc.inUs === "true") {
        rollup.workersInUs++;
      } else if (loc.inUs === "false") {
        rollup.workersNotInUs++;
      } else {
        rollup.workersUnknownUs++;
      }
    }
  }

  return Array.from(map.values());
}

function computeVendorRollups(
  transactions: NormalizedTransaction[]
): VendorRollup[] {
  const map = new Map<
    string,
    { count: number; amountCents: number; customers: Set<string> }
  >();

  for (const tx of transactions) {
    const vendor = tx.remittanceVendor;
    let entry = map.get(vendor);
    if (!entry) {
      entry = { count: 0, amountCents: 0, customers: new Set() };
      map.set(vendor, entry);
    }
    entry.count++;
    entry.amountCents += Math.abs(tx.amountCents);
    entry.customers.add(tx.customerId);
  }

  return Array.from(map.entries()).map(([vendorName, data]) => ({
    vendorName,
    transactionCount: data.count,
    totalAmountCents: data.amountCents,
    uniqueCustomers: data.customers.size,
  }));
}
