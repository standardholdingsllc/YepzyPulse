/**
 * Background processing endpoint for large CSV files.
 * OPTIMIZED: Parallel DB inserts, larger batches, no duplicate work.
 */

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { createServiceClient } from "@/lib/supabase";
import { runIngestionPipeline, extractCustomerLocations } from "@/lib/pipeline/ingest";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode } from "@/lib/types";

export const maxDuration = 300; // 5 minutes for large file processing (Pro plan)

const CSV_BUCKET = "csv-uploads";

// Larger batch size = fewer round trips
// Supabase can handle 1000+ rows per insert efficiently
const BATCH_SIZE = 2000;

// Number of parallel insert operations
const PARALLEL_INSERTS = 5;

// Official employer mapping source
const OFFICIAL_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

async function fetchOfficialMapping(): Promise<Record<string, string>> {
  console.log("[Process] Fetching official employer mapping from GitHub...");
  const response = await fetch(OFFICIAL_MAPPING_URL, {
    cache: "no-store",
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
  fileReference?: string;
  blobUrl?: string;
  storagePath?: string;
  inUsFilter: InUsFilterMode;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Insert rows in parallel batches for maximum throughput.
 */
async function parallelBatchInsert<T>(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  rows: T[],
  batchSize: number = BATCH_SIZE,
  parallelism: number = PARALLEL_INSERTS
): Promise<void> {
  if (rows.length === 0) return;

  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  console.log(`[Process] Inserting ${rows.length} rows into ${table} in ${batches.length} batches (${parallelism} parallel)`);

  // Process batches in parallel chunks
  for (let i = 0; i < batches.length; i += parallelism) {
    const chunk = batches.slice(i, i + parallelism);
    const promises = chunk.map((batch, idx) =>
      supabase
        .from(table)
        .insert(batch as Record<string, unknown>[])
        .then(({ error }) => {
          if (error) {
            throw new Error(`Failed to insert batch ${i + idx + 1} into ${table}: ${error.message}`);
          }
        })
    );

    await Promise.all(promises);
    
    const completed = Math.min(i + parallelism, batches.length);
    if (completed % 10 === 0 || completed === batches.length) {
      console.log(`[Process] ${table}: ${completed}/${batches.length} batches complete`);
    }
  }
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
      throw new Error("Missing file reference for report processing");
    }

    const startTime = Date.now();
    console.log(`[Process] Starting background processing for report ${body.slug}`);
    console.log(`[Process] File reference: ${fileReference}`);

    // 1. Download CSV
    let csvText: string;
    if (isHttpUrl(fileReference)) {
      console.log("[Process] Downloading CSV from blob URL...");
      const csvResponse = await fetch(fileReference);
      if (!csvResponse.ok) {
        throw new Error(`Failed to download CSV: ${csvResponse.status}`);
      }
      csvText = await csvResponse.text();
    } else {
      console.log("[Process] Downloading CSV from Supabase Storage...");
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(CSV_BUCKET)
        .download(fileReference);

      if (downloadError || !fileData) {
        throw new Error(`Failed to download CSV: ${downloadError?.message ?? "No data returned"}`);
      }

      csvText = await fileData.text();
    }
    console.log(`[Process] CSV downloaded: ${(csvText.length / 1024 / 1024).toFixed(2)} MB in ${Date.now() - startTime}ms`);

    // 2. Fetch employer mapping (can happen in parallel with nothing else yet)
    let employerMappingJson: unknown = {};
    try {
      employerMappingJson = await fetchOfficialMapping();
    } catch (err) {
      console.error("[Process] Failed to fetch official mapping:", err);
      console.log("[Process] Proceeding without employer mapping");
    }

    // 3. Run optimized ingestion pipeline
    console.log("[Process] Running ingestion pipeline...");
    const pipelineStart = Date.now();
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });
    console.log(`[Process] Pipeline complete: ${result.transactions.length} transactions in ${Date.now() - pipelineStart}ms`);

    // 4. Update report with stats (quick operation)
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

    // 5. Prepare all insert data upfront (avoid repeated mapping in loops)
    const dbStart = Date.now();
    
    // Transaction rows
    const transactionRows = result.transactions.map((tx) => ({
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
      vendor_match_evidence: null, // Skip evidence for performance
      employer_name: tx.employerName,
      employer_key: tx.employerKey,
      location_raw: tx.locationRaw || null,
      location_city: tx.locationCity || null,
      location_state: tx.locationState || null,
      location_country: tx.locationCountry || null,
      customer_in_us: tx.customerInUs,
    }));

    // Employer rollup rows
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

    // Vendor rollup rows
    const vendorRows = result.vendorRollups.map((vr) => ({
      report_id: reportId,
      vendor_name: vr.vendorName,
      transaction_count: vr.transactionCount,
      total_amount_cents: vr.totalAmountCents,
      unique_customers: vr.uniqueCustomers,
    }));

    // Customer location rows
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

    console.log(`[Process] Data prepared in ${Date.now() - dbStart}ms`);

    // 6. Insert all data with parallel batches
    // Transactions are the bulk - do them first
    await parallelBatchInsert(supabase, "report_transactions", transactionRows);

    // These are smaller, can do in parallel with each other
    await Promise.all([
      parallelBatchInsert(supabase, "report_employer_rollups", employerRows, 500, 3),
      parallelBatchInsert(supabase, "report_vendor_rollups", vendorRows, 500, 3),
      parallelBatchInsert(supabase, "report_customer_locations", locationRows, 1000, 3),
    ]);

    console.log(`[Process] All DB inserts complete in ${Date.now() - dbStart}ms`);

    // 7. Mark report as ready
    await supabase
      .from("reports")
      .update({ status: "ready", csv_blob_url: null })
      .eq("id", reportId);

    // 8. Cleanup uploaded file (non-blocking)
    try {
      if (isHttpUrl(fileReference)) {
        await del(fileReference);
        console.log("[Process] Blob file deleted");
      } else {
        await supabase.storage.from(CSV_BUCKET).remove([fileReference]);
        console.log("[Process] Storage file deleted");
      }
    } catch (delError) {
      console.error("[Process] Cleanup failed (non-fatal):", delError);
    }

    const totalTime = Date.now() - startTime;
    console.log(`[Process] Report ${body.slug} complete! Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);

    return NextResponse.json({ success: true, slug: body.slug, processingTimeMs: totalTime });
  } catch (error) {
    console.error("[Process] Error processing report:", error);

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
