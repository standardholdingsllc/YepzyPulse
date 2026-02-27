/**
 * Shared type definitions for the Yepzy Transaction Processor.
 */

import type { VendorMatchEvidence } from "@/lib/classification/remittance-vendors";

export interface NormalizedTransaction {
  rawCreatedAt: Date | null;
  unitId: string;
  unitType: string;
  amountCents: number;
  direction: string;
  balanceCents: number;
  summary: string;
  customerId: string;
  accountId: string;
  counterpartyName: string;
  counterpartyCustomer: string;
  counterpartyAccount: string;
  paymentId: string;

  // Enriched
  transactionGroup: string;
  remittanceVendor: string;
  vendorMatchEvidence?: VendorMatchEvidence | null;
  employerName: string;
  employerKey: string;

  // Location
  locationRaw: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;

  // Customer US status
  customerInUs: "true" | "false" | "unknown";
}

export interface EmployerRollup {
  employerName: string;
  employerKey: string;
  workerCount: number;
  transactionCount: number;
  totalDebitCents: number;
  totalCreditCents: number;
  cardCount: number;
  cardAmountCents: number;
  atmCount: number;
  atmAmountCents: number;
  feeCount: number;
  feeAmountCents: number;
  bookCount: number;
  bookAmountCents: number;
  remittanceCount: number;
  remittanceAmountCents: number;
  workersInUs: number;
  workersNotInUs: number;
  workersUnknownUs: number;
  vendorBreakdown: Record<string, { count: number; amountCents: number }>;
}

export interface VendorRollup {
  vendorName: string;
  transactionCount: number;
  totalAmountCents: number;
  uniqueCustomers: number;
}

export interface ReportStats {
  totalRows: number;
  rowsWithLocations: number;
  customersInUsTrue: number;
  customersInUsFalse: number;
  customersInUsUnknown: number;
  unknownEmployerCount: number;
  remittanceMatchRate: number;
  totalCustomers: number;
  totalEmployers: number;
  transactionGroupCounts: Record<string, number>;
  vendorMatchCounts: Record<string, number>;
}

export interface ReportOverview {
  id: string;
  slug: string;
  createdAt: string;
  expiresAt: string;
  title: string | null;
  status: string;
  errorMessage: string | null;
  inUsFilter: string;
  stats: ReportStats;
  processingStartedAt: string | null;
}

export interface CustomerLocation {
  customerId: string;
  employerName: string | null;
  employerKey: string | null;
  inUs: string;
  latestLocationRaw: string | null;
  latestLocationCity: string | null;
  latestLocationState: string | null;
  latestLocationCountry: string | null;
  latestLocationDate: string | null;
  transactionCount: number;
}

export type InUsFilterMode = "strict" | "lenient" | "all";
