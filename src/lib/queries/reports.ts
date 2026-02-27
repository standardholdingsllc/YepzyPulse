/**
 * Server-side data fetching for reports.
 */

import { createServiceClient } from "@/lib/supabase";
import type {
  ReportOverview,
  EmployerRollup,
  VendorRollup,
  CustomerLocation,
} from "@/lib/types";

export async function getReportBySlug(
  slug: string
): Promise<ReportOverview | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    slug: data.slug,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    title: data.title,
    status: data.status,
    errorMessage: data.error_message,
    inUsFilter: data.in_us_filter,
    stats: data.stats,
    processingStartedAt: data.processing_started_at,
  };
}

export async function getEmployerRollups(
  reportId: string,
  options?: {
    search?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    hasRemittance?: boolean;
  }
): Promise<EmployerRollup[]> {
  const supabase = createServiceClient();

  let query = supabase
    .from("report_employer_rollups")
    .select("*")
    .eq("report_id", reportId);

  if (options?.search) {
    query = query.ilike("employer_name", `%${options.search}%`);
  }

  if (options?.hasRemittance === true) {
    query = query.gt("remittance_count", 0);
  } else if (options?.hasRemittance === false) {
    query = query.eq("remittance_count", 0);
  }

  const sortField = mapSortField(options?.sortBy || "transaction_count");
  const ascending = (options?.sortDir || "desc") === "asc";
  query = query.order(sortField, { ascending });

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching employer rollups:", error);
    return [];
  }

  return (data || []).map(mapEmployerRow);
}

export async function getVendorRollups(
  reportId: string
): Promise<VendorRollup[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("report_vendor_rollups")
    .select("*")
    .eq("report_id", reportId)
    .order("total_amount_cents", { ascending: false });

  if (error) {
    console.error("Error fetching vendor rollups:", error);
    return [];
  }

  return (data || []).map((row) => ({
    vendorName: row.vendor_name,
    transactionCount: row.transaction_count,
    totalAmountCents: row.total_amount_cents,
    uniqueCustomers: row.unique_customers,
  }));
}

export async function getCustomerLocations(
  reportId: string,
  employerKey?: string
): Promise<CustomerLocation[]> {
  const supabase = createServiceClient();

  let query = supabase
    .from("report_customer_locations")
    .select("*")
    .eq("report_id", reportId);

  if (employerKey) {
    query = query.eq("employer_key", employerKey);
  }

  query = query.order("transaction_count", { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching customer locations:", error);
    return [];
  }

  return (data || []).map((row) => ({
    customerId: row.customer_id,
    employerName: row.employer_name,
    employerKey: row.employer_key,
    inUs: row.in_us,
    latestLocationRaw: row.latest_location_raw,
    latestLocationCity: row.latest_location_city,
    latestLocationState: row.latest_location_state,
    latestLocationCountry: row.latest_location_country,
    latestLocationDate: row.latest_location_date,
    transactionCount: row.transaction_count,
  }));
}

export interface TransactionQueryOptions {
  reportId: string;
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  transactionGroup?: string;
  remittanceVendor?: string;
  employerKey?: string;
  inUs?: string;
  customerId?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export async function getTransactions(options: TransactionQueryOptions) {
  const supabase = createServiceClient();
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("report_transactions")
    .select("*", { count: "exact" })
    .eq("report_id", options.reportId);

  if (options.dateFrom) {
    query = query.gte("raw_created_at", options.dateFrom);
  }
  if (options.dateTo) {
    query = query.lte("raw_created_at", options.dateTo);
  }
  if (options.transactionGroup) {
    query = query.eq("transaction_group", options.transactionGroup);
  }
  if (options.remittanceVendor) {
    query = query.eq("remittance_vendor", options.remittanceVendor);
  }
  if (options.employerKey) {
    query = query.eq("employer_key", options.employerKey);
  }
  if (options.inUs) {
    query = query.eq("customer_in_us", options.inUs);
  }
  if (options.customerId) {
    query = query.eq("customer_id", options.customerId);
  }

  const sortField = options.sortBy || "raw_created_at";
  const ascending = (options.sortDir || "desc") === "asc";
  query = query.order(sortField, { ascending }).range(offset, offset + pageSize - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error("Error fetching transactions:", error);
    return { transactions: [], total: 0 };
  }

  return {
    transactions: (data || []).map((row) => ({
      id: row.id,
      rawCreatedAt: row.raw_created_at,
      unitId: row.unit_id,
      unitType: row.unit_type,
      amountCents: row.amount_cents,
      direction: row.direction,
      balanceCents: row.balance_cents,
      summary: row.summary,
      customerId: row.customer_id,
      accountId: row.account_id,
      counterpartyName: row.counterparty_name,
      paymentId: row.payment_id,
      transactionGroup: row.transaction_group,
      remittanceVendor: row.remittance_vendor,
      vendorMatchEvidence: row.vendor_match_evidence,
      employerName: row.employer_name,
      employerKey: row.employer_key,
      locationRaw: row.location_raw,
      locationCity: row.location_city,
      locationState: row.location_state,
      locationCountry: row.location_country,
      customerInUs: row.customer_in_us,
    })),
    total: count || 0,
  };
}

function mapSortField(field: string): string {
  const fieldMap: Record<string, string> = {
    transactionCount: "transaction_count",
    totalDebitCents: "total_debit_cents",
    totalCreditCents: "total_credit_cents",
    cardAmountCents: "card_amount_cents",
    atmAmountCents: "atm_amount_cents",
    feeAmountCents: "fee_amount_cents",
    bookAmountCents: "book_amount_cents",
    remittanceAmountCents: "remittance_amount_cents",
    remittanceCount: "remittance_count",
    workerCount: "worker_count",
    employerName: "employer_name",
  };
  return fieldMap[field] || field;
}

function mapEmployerRow(row: Record<string, unknown>): EmployerRollup {
  return {
    employerName: row.employer_name as string,
    employerKey: row.employer_key as string,
    workerCount: row.worker_count as number,
    transactionCount: row.transaction_count as number,
    totalDebitCents: Number(row.total_debit_cents),
    totalCreditCents: Number(row.total_credit_cents),
    cardCount: row.card_count as number,
    cardAmountCents: Number(row.card_amount_cents),
    atmCount: row.atm_count as number,
    atmAmountCents: Number(row.atm_amount_cents),
    feeCount: row.fee_count as number,
    feeAmountCents: Number(row.fee_amount_cents),
    bookCount: row.book_count as number,
    bookAmountCents: Number(row.book_amount_cents),
    remittanceCount: row.remittance_count as number,
    remittanceAmountCents: Number(row.remittance_amount_cents),
    workersInUs: row.workers_in_us as number,
    workersNotInUs: row.workers_not_in_us as number,
    workersUnknownUs: row.workers_unknown_us as number,
    vendorBreakdown: (row.vendor_breakdown as Record<string, { count: number; amountCents: number }>) || {},
  };
}
