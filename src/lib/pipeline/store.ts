/**
 * Store ingestion results into Supabase.
 */

import { createServiceClient } from "@/lib/supabase";
import type {
  NormalizedTransaction,
  EmployerRollup,
  VendorRollup,
  ReportStats,
  InUsFilterMode,
} from "@/lib/types";
import type { TransactionTypeRule } from "@/lib/classification/transaction-types";
import type { RemittanceVendorRule } from "@/lib/classification/remittance-vendors";
import { classifyCustomersInUs } from "@/lib/parsing/location";

interface StoreReportOptions {
  slug: string;
  title?: string;
  inUsFilter: InUsFilterMode;
  classificationRules: {
    transactionTypeRules: TransactionTypeRule[];
    remittanceVendorRules: RemittanceVendorRule[];
  };
  transactions: NormalizedTransaction[];
  employerRollups: EmployerRollup[];
  vendorRollups: VendorRollup[];
  stats: ReportStats;
}

const BATCH_SIZE = 500;

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
    // 2. Insert transactions in batches
    console.log(`[Store] Inserting ${options.transactions.length} transactions...`);
    for (let i = 0; i < options.transactions.length; i += BATCH_SIZE) {
      const batch = options.transactions.slice(i, i + BATCH_SIZE);
      const rows = batch.map((tx) => ({
        report_id: reportId,
        raw_created_at: tx.rawCreatedAt?.toISOString() || null,
        unit_id: tx.unitId || null,
        unit_type: tx.unitType || null,
        amount_cents: tx.amountCents,
        direction: tx.direction || null,
        balance_cents: tx.balanceCents,
        summary: tx.summary || null,
        customer_id: tx.customerId || null,
        account_id: tx.accountId || null,
        counterparty_name: tx.counterpartyName || null,
        counterparty_customer: tx.counterpartyCustomer || null,
        counterparty_account: tx.counterpartyAccount || null,
        payment_id: tx.paymentId || null,
        transaction_group: tx.transactionGroup,
        remittance_vendor: tx.remittanceVendor,
        vendor_match_evidence: tx.vendorMatchEvidence || null,
        employer_name: tx.employerName,
        employer_key: tx.employerKey,
        location_raw: tx.locationRaw || null,
        location_city: tx.locationCity || null,
        location_state: tx.locationState || null,
        location_country: tx.locationCountry || null,
        customer_in_us: tx.customerInUs,
      }));

      const { error } = await supabase
        .from("report_transactions")
        .insert(rows);

      if (error) {
        throw new Error(`Failed to insert transactions batch ${i}: ${error.message}`);
      }

      console.log(`[Store] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(options.transactions.length / BATCH_SIZE)}`);
    }

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

    // 5. Insert customer locations
    console.log("[Store] Inserting customer locations...");
    const customerLocationResults = classifyCustomersInUs(
      options.transactions.map((tx) => ({
        customerId: tx.customerId,
        unitType: tx.unitType,
        summary: tx.summary,
        createdAt: tx.rawCreatedAt,
      }))
    );

    // Count transactions per customer
    const txCountPerCustomer = new Map<string, number>();
    for (const tx of options.transactions) {
      txCountPerCustomer.set(
        tx.customerId,
        (txCountPerCustomer.get(tx.customerId) || 0) + 1
      );
    }

    // Get employer info per customer
    const customerEmployers = new Map<string, { name: string; key: string }>();
    for (const tx of options.transactions) {
      if (!customerEmployers.has(tx.customerId)) {
        customerEmployers.set(tx.customerId, {
          name: tx.employerName,
          key: tx.employerKey,
        });
      }
    }

    const locationRows = Array.from(customerLocationResults.entries()).map(
      ([customerId, loc]) => {
        const emp = customerEmployers.get(customerId);
        return {
          report_id: reportId,
          customer_id: customerId,
          employer_name: emp?.name || "Unknown employer",
          employer_key: emp?.key || "UNKNOWN EMPLOYER",
          in_us: loc.inUs,
          latest_location_raw: loc.latestLocationRaw,
          latest_location_city: loc.latestLocationCity,
          latest_location_state: loc.latestLocationState,
          latest_location_country: loc.latestLocationCountry,
          latest_location_date: loc.latestLocationDate?.toISOString() || null,
          transaction_count: txCountPerCustomer.get(customerId) || 0,
        };
      }
    );

    for (let i = 0; i < locationRows.length; i += BATCH_SIZE) {
      const batch = locationRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("report_customer_locations")
        .insert(batch);

      if (error) {
        throw new Error(`Failed to insert customer locations: ${error.message}`);
      }
    }

    // 6. Mark report as ready
    console.log("[Store] Marking report as ready...");
    await supabase
      .from("reports")
      .update({ status: "ready" })
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
