/**
 * Background processing endpoint for CSV files.
 * 
 * FAST PROCESSING STRATEGY:
 * 1. Parse CSV and compute rollups in memory (fast - ~15 seconds for 500k rows)
 * 2. Store transactions as compressed JSON blob in Supabase Storage (1 upload)
 * 3. Insert only rollups to database (small - hundreds of rows max)
 * 4. Transactions loaded on-demand from blob when user browses
 */

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { createServiceClient } from "@/lib/supabase";
import { runIngestionPipeline, extractCustomerLocations } from "@/lib/pipeline/ingest";
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

    // 2. Fetch employer mapping
    const mappingStart = Date.now();
    const employerMapping = await fetchOfficialMapping().catch(() => ({}));
    console.log(`[Process] Fetched employer mapping in ${Date.now() - mappingStart}ms`);

    // 3. Run ingestion pipeline (CPU-bound, should be fast)
    const pipelineStart = Date.now();
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson: employerMapping,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });
    console.log(`[Process] Pipeline: ${result.transactions.length} txns in ${Date.now() - pipelineStart}ms`);

    // 4. Store transactions as JSON blob (single upload instead of 250+ DB inserts)
    const blobStart = Date.now();
    const transactionsBlobPath = `transactions/${body.slug}.json`;
    
    // Compress transaction data - only keep fields needed for display
    const compactTransactions = result.transactions.map((tx, idx) => ({
      i: idx, // id
      d: tx.rawCreatedAt?.toISOString() || null, // date
      t: tx.unitType, // type
      a: tx.amountCents, // amount
      dr: tx.direction, // direction
      s: tx.summary, // summary
      c: tx.customerId, // customer
      cp: tx.counterpartyName, // counterparty
      g: tx.transactionGroup, // group
      v: tx.remittanceVendor, // vendor
      e: tx.employerName, // employer
      ek: tx.employerKey, // employer key
      lr: tx.locationRaw, // location raw
      lc: tx.locationCountry, // location country
      u: tx.customerInUs, // in us
    }));
    
    const transactionsJson = JSON.stringify(compactTransactions);
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

    // Customer locations
    const customerLocations = extractCustomerLocations(result.transactions);
    const txCountPerCustomer = new Map<string, number>();
    for (const tx of result.transactions) {
      txCountPerCustomer.set(tx.customerId, (txCountPerCustomer.get(tx.customerId) || 0) + 1);
    }
    const customerEmployers = new Map<string, { name: string; key: string }>();
    for (const tx of result.transactions) {
      if (!customerEmployers.has(tx.customerId)) {
        customerEmployers.set(tx.customerId, { name: tx.employerName, key: tx.employerKey });
      }
    }

    const locationRows = Array.from(customerLocations.entries()).map(([customerId, loc]) => {
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

    // Batch insert rollups (these are small - hundreds of rows max)
    const BATCH_SIZE = 500;
    
    // Insert employer rollups
    for (let i = 0; i < employerRows.length; i += BATCH_SIZE) {
      const batch = employerRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("report_employer_rollups").insert(batch);
      if (error) throw new Error(`Employer rollup insert failed: ${error.message}`);
    }

    // Insert vendor rollups
    if (vendorRows.length > 0) {
      const { error } = await supabase.from("report_vendor_rollups").insert(vendorRows);
      if (error) throw new Error(`Vendor rollup insert failed: ${error.message}`);
    }

    // Insert customer locations
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
      stats: result.stats,
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
    console.log(`[Process] ✓ Complete! ${result.transactions.length} transactions in ${(totalTime / 1000).toFixed(1)}s`);

    return NextResponse.json({ 
      success: true, 
      slug: body.slug, 
      transactions: result.transactions.length,
      processingTimeMs: totalTime 
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
