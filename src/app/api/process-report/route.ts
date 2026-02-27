/**
 * Background processing endpoint for large CSV files.
 * This is triggered by the start-processing endpoint after the file is stored in Supabase Storage.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { runIngestionPipeline } from "@/lib/pipeline/ingest";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode } from "@/lib/types";
import { classifyCustomersInUs } from "@/lib/parsing/location";

export const maxDuration = 300; // 5 minutes for large file processing (Pro plan)

const CSV_BUCKET = "csv-uploads";

// Official employer mapping source
const OFFICIAL_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

async function fetchOfficialMapping(): Promise<Record<string, string>> {
  console.log("[Process] Fetching official employer mapping from GitHub...");
  const response = await fetch(OFFICIAL_MAPPING_URL, {
    cache: "no-store", // Always fetch fresh in background job
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch official mapping: ${response.status}`);
  }

  const data = await response.json();
  console.log(`[Process] Fetched ${Object.keys(data).length} customer→employer mappings`);
  return data;
}

interface ProcessRequest {
  reportId: string;
  slug: string;
  storagePath: string;
  inUsFilter: InUsFilterMode;
}

const BATCH_SIZE = 500;

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  let reportId: string | null = null;
  let storagePath: string | null = null;

  try {
    const body: ProcessRequest = await request.json();
    reportId = body.reportId;
    storagePath = body.storagePath;

    console.log(`[Process] Starting background processing for report ${body.slug}`);
    console.log(`[Process] Storage path: ${storagePath}`);

    // 1. Download CSV from Supabase Storage
    console.log("[Process] Downloading CSV from Supabase Storage...");
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(CSV_BUCKET)
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download CSV: ${downloadError?.message ?? "No data returned"}`);
    }

    const csvText = await fileData.text();
    console.log(`[Process] CSV size: ${csvText.length} chars (${(csvText.length / 1024 / 1024).toFixed(2)} MB)`);

    // 2. Fetch employer mapping
    let employerMappingJson: unknown = {};
    try {
      employerMappingJson = await fetchOfficialMapping();
    } catch (err) {
      console.error("[Process] Failed to fetch official mapping:", err);
      console.log("[Process] Proceeding without employer mapping");
    }

    // 3. Run ingestion pipeline
    console.log("[Process] Running ingestion pipeline...");
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });

    console.log(`[Process] Pipeline complete: ${result.transactions.length} transactions`);

    // 4. Update report with classification rules and stats
    await supabase
      .from("reports")
      .update({
        classification_rules: {
          transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
          remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
        },
        stats: result.stats,
      })
      .eq("id", reportId);

    // 5. Insert transactions in batches
    console.log(`[Process] Inserting ${result.transactions.length} transactions...`);
    for (let i = 0; i < result.transactions.length; i += BATCH_SIZE) {
      const batch = result.transactions.slice(i, i + BATCH_SIZE);
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

      const { error } = await supabase.from("report_transactions").insert(rows);
      if (error) {
        throw new Error(`Failed to insert transactions batch ${i}: ${error.message}`);
      }

      console.log(`[Process] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(result.transactions.length / BATCH_SIZE)}`);
    }

    // 6. Insert employer rollups
    console.log(`[Process] Inserting ${result.employerRollups.length} employer rollups...`);
    if (result.employerRollups.length > 0) {
      const employerRows = result.employerRollups.map((er) => ({
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
        const { error } = await supabase.from("report_employer_rollups").insert(batch);
        if (error) {
          throw new Error(`Failed to insert employer rollups: ${error.message}`);
        }
      }
    }

    // 7. Insert vendor rollups
    console.log(`[Process] Inserting ${result.vendorRollups.length} vendor rollups...`);
    if (result.vendorRollups.length > 0) {
      const vendorRows = result.vendorRollups.map((vr) => ({
        report_id: reportId,
        vendor_name: vr.vendorName,
        transaction_count: vr.transactionCount,
        total_amount_cents: vr.totalAmountCents,
        unique_customers: vr.uniqueCustomers,
      }));

      const { error } = await supabase.from("report_vendor_rollups").insert(vendorRows);
      if (error) {
        throw new Error(`Failed to insert vendor rollups: ${error.message}`);
      }
    }

    // 8. Insert customer locations
    console.log("[Process] Inserting customer locations...");
    const customerLocationResults = classifyCustomersInUs(
      result.transactions.map((tx) => ({
        customerId: tx.customerId,
        unitType: tx.unitType,
        summary: tx.summary,
        createdAt: tx.rawCreatedAt,
      }))
    );

    const txCountPerCustomer = new Map<string, number>();
    for (const tx of result.transactions) {
      txCountPerCustomer.set(tx.customerId, (txCountPerCustomer.get(tx.customerId) || 0) + 1);
    }

    const customerEmployers = new Map<string, { name: string; key: string }>();
    for (const tx of result.transactions) {
      if (!customerEmployers.has(tx.customerId)) {
        customerEmployers.set(tx.customerId, {
          name: tx.employerName,
          key: tx.employerKey,
        });
      }
    }

    const locationRows = Array.from(customerLocationResults.entries()).map(([customerId, loc]) => {
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
    });

    for (let i = 0; i < locationRows.length; i += BATCH_SIZE) {
      const batch = locationRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("report_customer_locations").insert(batch);
      if (error) {
        throw new Error(`Failed to insert customer locations: ${error.message}`);
      }
    }

    // 9. Mark report as ready and clear the storage path
    console.log("[Process] Marking report as ready...");
    await supabase
      .from("reports")
      .update({ status: "ready", csv_blob_url: null })
      .eq("id", reportId);

    // 10. Delete the file from Supabase Storage (cleanup)
    console.log("[Process] Cleaning up storage...");
    try {
      const { error: removeError } = await supabase.storage
        .from(CSV_BUCKET)
        .remove([storagePath]);

      if (removeError) {
        console.error("[Process] Failed to delete storage file (non-fatal):", removeError);
      } else {
        console.log("[Process] Storage file deleted successfully");
      }
    } catch (delError) {
      console.error("[Process] Failed to delete storage file (non-fatal):", delError);
    }

    console.log(`[Process] Report ${body.slug} processed successfully!`);

    return NextResponse.json({ success: true, slug: body.slug });
  } catch (error) {
    console.error("[Process] Error processing report:", error);

    // Mark report as errored
    if (reportId) {
      await supabase
        .from("reports")
        .update({
          status: "error",
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", reportId);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
