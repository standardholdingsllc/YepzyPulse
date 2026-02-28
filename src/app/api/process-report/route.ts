/**
 * Background processing endpoint for CSV files.
 *
 * MEMORY-OPTIMIZED STRATEGY (fits in Vercel Pro 3009MB limit):
 * 1. Download CSV (~118MB in memory)
 * 2. Two-pass streaming parse with PapaParse step mode
 *    - Pass 1: build customer-in-US map (lightweight, ~5MB)
 *    - Pass 2: build rollups + compact transaction array (~100-150MB)
 *    → No PapaParse result array, no NormalizedTransaction array
 * 3. JSON.stringify compact transactions → upload blob (~100-150MB)
 * 4. Insert rollups to DB (small – hundreds of rows)
 *
 * Peak memory: ~400MB for a 118MB / 500k-row CSV
 * (vs ~1.2GB+ in the previous non-streaming approach)
 */

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { createServiceClient } from "@/lib/supabase";
import { runIngestionPipeline } from "@/lib/pipeline/ingest";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode } from "@/lib/types";

export const maxDuration = 300;

const CSV_BUCKET = "csv-uploads";
const TRANSACTIONS_BUCKET = "csv-uploads"; // Reuse same bucket for transaction blobs

const OFFICIAL_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

async function fetchOfficialMapping(): Promise<Record<string, string>> {
  const response = await fetch(OFFICIAL_MAPPING_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch mapping: ${response.status}`);
  return response.json();
}

interface ProcessRequest {
  reportId: string;
  slug: string;
  fileReference?: string;
  blobUrl?: string;
  storagePath?: string;
  inUsFilter: InUsFilterMode;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  let reportId: string | null = null;
  let fileReference: string | null = null;

  try {
    const body: ProcessRequest = await request.json();
    reportId = body.reportId;

    const resolvedReference =
      (typeof body.fileReference === "string" && body.fileReference.trim()) ||
      (typeof body.blobUrl === "string" && body.blobUrl.trim()) ||
      (typeof body.storagePath === "string" && body.storagePath.trim()) ||
      "";
    fileReference = isHttpUrl(resolvedReference)
      ? resolvedReference
      : resolvedReference.replace(/^\/+/, "");

    if (!fileReference) {
      throw new Error("Missing file reference");
    }

    const startTime = Date.now();
    console.log(`[Process] Starting processing for ${body.slug}`);

    // 1. Download CSV
    let csvText: string;
    const downloadStart = Date.now();
    if (isHttpUrl(fileReference)) {
      const csvResponse = await fetch(fileReference);
      if (!csvResponse.ok) throw new Error(`Download failed: ${csvResponse.status}`);
      csvText = await csvResponse.text();
    } else {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(CSV_BUCKET)
        .download(fileReference);
      if (downloadError || !fileData) {
        throw new Error(`Download failed: ${downloadError?.message ?? "No data"}`);
      }
      csvText = await fileData.text();
    }
    console.log(`[Process] Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)}MB in ${Date.now() - downloadStart}ms`);

    // 2. Fetch employer mapping (runs in parallel would be nice, but we need csvText first)
    const mappingStart = Date.now();
    const employerMapping = await fetchOfficialMapping().catch(() => ({}));
    console.log(`[Process] Fetched employer mapping in ${Date.now() - mappingStart}ms`);

    // 3. Run streaming ingestion pipeline
    //    This uses PapaParse step mode — no giant arrays in memory
    const pipelineStart = Date.now();
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson: employerMapping,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });
    console.log(`[Process] Pipeline: ${result.compactTransactions.length} txns in ${Date.now() - pipelineStart}ms`);

    // Free csvText immediately — no longer needed
    csvText = null as unknown as string;

    // 4. Store transactions as JSON blob
    const blobStart = Date.now();
    const transactionsBlobPath = `transactions/${body.slug}.json`;

    const transactionsJson = JSON.stringify(result.compactTransactions);
    // Free the compact array now that we have the JSON string
    result.compactTransactions = null as unknown as typeof result.compactTransactions;

    const transactionsBlob = new Blob([transactionsJson], { type: "application/json" });

    const { error: uploadError } = await supabase.storage
      .from(TRANSACTIONS_BUCKET)
      .upload(transactionsBlobPath, transactionsBlob, { upsert: true });

    if (uploadError) {
      throw new Error(`Failed to upload transactions blob: ${uploadError.message}`);
    }
    console.log(`[Process] Stored ${(transactionsJson.length / 1024 / 1024).toFixed(1)}MB transactions blob in ${Date.now() - blobStart}ms`);

    // 5. Insert rollups to database (small amount of data)
    const dbStart = Date.now();

    // Employer rollups
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

    // Vendor rollups
    const vendorRows = result.vendorRollups.map((vr) => ({
      report_id: reportId,
      vendor_name: vr.vendorName,
      transaction_count: vr.transactionCount,
      total_amount_cents: vr.totalAmountCents,
      unique_customers: vr.uniqueCustomers,
    }));

    // Customer locations (already computed by the pipeline — no extra iteration!)
    const locationRows = result.customerLocationRows.map((loc) => ({
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

    // Batch insert rollups (these are small — hundreds of rows max)
    const BATCH_SIZE = 500;

    for (let i = 0; i < employerRows.length; i += BATCH_SIZE) {
      const batch = employerRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("report_employer_rollups").insert(batch);
      if (error) throw new Error(`Employer rollup insert failed: ${error.message}`);
    }

    if (vendorRows.length > 0) {
      const { error } = await supabase.from("report_vendor_rollups").insert(vendorRows);
      if (error) throw new Error(`Vendor rollup insert failed: ${error.message}`);
    }

    for (let i = 0; i < locationRows.length; i += BATCH_SIZE) {
      const batch = locationRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("report_customer_locations").insert(batch);
      if (error) throw new Error(`Customer location insert failed: ${error.message}`);
    }

    console.log(`[Process] DB inserts (${employerRows.length} employers, ${vendorRows.length} vendors, ${locationRows.length} customers) in ${Date.now() - dbStart}ms`);

    // 6. Update report as ready
    await supabase.from("reports").update({
      status: "ready",
      csv_blob_url: null,
      transactions_blob_path: transactionsBlobPath,
      stats: result.stats as unknown as Record<string, unknown>,
      classification_rules: {
        transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
        remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
      },
    }).eq("id", reportId);

    // 7. Cleanup source CSV
    try {
      if (isHttpUrl(fileReference)) {
        await del(fileReference);
      } else {
        await supabase.storage.from(CSV_BUCKET).remove([fileReference]);
      }
    } catch (e) {
      console.error("[Process] Cleanup error (non-fatal):", e);
    }

    const totalTime = Date.now() - startTime;
    console.log(`[Process] ✓ Complete! ${result.stats.totalRows} transactions in ${(totalTime / 1000).toFixed(1)}s`);

    return NextResponse.json({
      success: true,
      slug: body.slug,
      transactions: result.stats.totalRows,
      processingTimeMs: totalTime,
    });

  } catch (error) {
    console.error("[Process] Error:", error);

    if (reportId) {
      await supabase.from("reports").update({
        status: "error",
        error_message: error instanceof Error ? error.message : String(error),
      }).eq("id", reportId);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
