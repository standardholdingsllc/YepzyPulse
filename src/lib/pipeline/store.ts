/**
 * Store ingestion results into Supabase.
 *
 * Updated to use the streaming pipeline's output:
 * - CompactTransaction[] → stored as JSON blob (not individual DB rows)
 * - CustomerLocationRow[] → inserted to DB (no extra iteration over transactions)
 */

import { createServiceClient } from "@/lib/supabase";
import type {
  EmployerRollup,
  VendorRollup,
  ReportStats,
  InUsFilterMode,
} from "@/lib/types";
import type { TransactionTypeRule } from "@/lib/classification/transaction-types";
import type { RemittanceVendorRule } from "@/lib/classification/remittance-vendors";
import type { CompactTransaction, CustomerLocationRow } from "@/lib/pipeline/ingest";

interface StoreReportOptions {
  slug: string;
  title?: string;
  inUsFilter: InUsFilterMode;
  classificationRules: {
    transactionTypeRules: TransactionTypeRule[];
    remittanceVendorRules: RemittanceVendorRule[];
  };
  compactTransactions: CompactTransaction[];
  employerRollups: EmployerRollup[];
  vendorRollups: VendorRollup[];
  customerLocationRows: CustomerLocationRow[];
  stats: ReportStats;
}

const BATCH_SIZE = 500;
const TRANSACTIONS_BUCKET = "csv-uploads";

export async function storeReport(options: StoreReportOptions): Promise<string> {
  const supabase = createServiceClient();

  // 1. Create report row
  console.log("[Store] Creating report...");
  const { data: report, error: reportError } = await supabase
    .from("reports")
    .insert({
      slug: options.slug,
      title: options.title || `Report ${new Date().toISOString().split("T")[0]}`,
      status: "processing",
      in_us_filter: options.inUsFilter,
      classification_rules: options.classificationRules,
      stats: options.stats,
    })
    .select("id")
    .single();

  if (reportError || !report) {
    throw new Error(`Failed to create report: ${reportError?.message}`);
  }

  const reportId = report.id;

  try {
    // 2. Store transactions as JSON blob (instead of individual DB rows)
    console.log(`[Store] Storing ${options.compactTransactions.length} transactions as blob...`);
    const transactionsBlobPath = `transactions/${options.slug}.json`;
    const transactionsJson = JSON.stringify(options.compactTransactions);
    const transactionsBlob = new Blob([transactionsJson], { type: "application/json" });

    const { error: uploadError } = await supabase.storage
      .from(TRANSACTIONS_BUCKET)
      .upload(transactionsBlobPath, transactionsBlob, { upsert: true });

    if (uploadError) {
      throw new Error(`Failed to upload transactions blob: ${uploadError.message}`);
    }
    console.log(`[Store] Uploaded ${(transactionsJson.length / 1024 / 1024).toFixed(1)}MB transactions blob`);

    // 3. Insert employer rollups
    console.log(`[Store] Inserting ${options.employerRollups.length} employer rollups...`);
    if (options.employerRollups.length > 0) {
      const employerRows = options.employerRollups.map((er) => ({
        report_id: reportId,
        employer_name: er.employerName,
        employer_key: er.employerKey,
        worker_count: er.workerCount,
        transaction_count: er.transactionCount,
        total_debit_cents: er.totalDebitCents,
        total_credit_cents: er.totalCreditCents,
        card_count: er.cardCount,
        card_amount_cents: er.cardAmountCents,
        atm_count: er.atmCount,
        atm_amount_cents: er.atmAmountCents,
        fee_count: er.feeCount,
        fee_amount_cents: er.feeAmountCents,
        book_count: er.bookCount,
        book_amount_cents: er.bookAmountCents,
        remittance_count: er.remittanceCount,
        remittance_amount_cents: er.remittanceAmountCents,
        workers_in_us: er.workersInUs,
        workers_not_in_us: er.workersNotInUs,
        workers_unknown_us: er.workersUnknownUs,
        vendor_breakdown: er.vendorBreakdown,
      }));

      for (let i = 0; i < employerRows.length; i += BATCH_SIZE) {
        const batch = employerRows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("report_employer_rollups")
          .insert(batch);
        if (error) {
          throw new Error(`Failed to insert employer rollups: ${error.message}`);
        }
      }
    }

    // 4. Insert vendor rollups
    console.log(`[Store] Inserting ${options.vendorRollups.length} vendor rollups...`);
    if (options.vendorRollups.length > 0) {
      const vendorRows = options.vendorRollups.map((vr) => ({
        report_id: reportId,
        vendor_name: vr.vendorName,
        transaction_count: vr.transactionCount,
        total_amount_cents: vr.totalAmountCents,
        unique_customers: vr.uniqueCustomers,
      }));

      const { error } = await supabase
        .from("report_vendor_rollups")
        .insert(vendorRows);
      if (error) {
        throw new Error(`Failed to insert vendor rollups: ${error.message}`);
      }
    }

    // 5. Insert customer locations (already computed by pipeline — no extra iterations!)
    console.log(`[Store] Inserting ${options.customerLocationRows.length} customer locations...`);
    if (options.customerLocationRows.length > 0) {
      const locationRows = options.customerLocationRows.map((loc) => ({
        report_id: reportId,
        customer_id: loc.customerId,
        employer_name: loc.employerName,
        employer_key: loc.employerKey,
        in_us: loc.inUs,
        latest_location_raw: loc.latestLocationRaw,
        latest_location_city: loc.latestLocationCity,
        latest_location_state: loc.latestLocationState,
        latest_location_country: loc.latestLocationCountry,
        latest_location_date: loc.latestLocationDate,
        transaction_count: loc.transactionCount,
      }));

      for (let i = 0; i < locationRows.length; i += BATCH_SIZE) {
        const batch = locationRows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("report_customer_locations")
          .insert(batch);
        if (error) {
          throw new Error(`Failed to insert customer locations: ${error.message}`);
        }
      }
    }

    // 6. Mark report as ready
    console.log("[Store] Marking report as ready...");
    await supabase
      .from("reports")
      .update({
        status: "ready",
        transactions_blob_path: transactionsBlobPath,
      })
      .eq("id", reportId);

    return reportId;
  } catch (error) {
    // Mark report as errored
    await supabase
      .from("reports")
      .update({
        status: "error",
        error_message: error instanceof Error ? error.message : String(error),
      })
      .eq("id", reportId);

    throw error;
  }
}
