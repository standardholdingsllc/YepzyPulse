/**
 * Background processing endpoint for large CSV files.
 * 
 * CHUNKED PROCESSING: For files over a threshold, we process in chunks
 * across multiple function invocations to avoid the 5-minute timeout.
 */

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { createServiceClient } from "@/lib/supabase";
import { runIngestionPipeline, extractCustomerLocations } from "@/lib/pipeline/ingest";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode, NormalizedTransaction } from "@/lib/types";

export const maxDuration = 300; // 5 minutes max

const CSV_BUCKET = "csv-uploads";

// Processing thresholds
const CHUNK_SIZE_BYTES = 15 * 1024 * 1024; // 15MB per chunk - safe margin under timeout
const MAX_ROWS_PER_CHUNK = 150000; // ~150k rows per chunk

// DB insert settings
const BATCH_SIZE = 2000;
const PARALLEL_INSERTS = 5;

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
  // Chunking params
  chunkIndex?: number;
  totalChunks?: number;
  byteOffset?: number;
  isLastChunk?: boolean;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

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

  for (let i = 0; i < batches.length; i += parallelism) {
    const chunk = batches.slice(i, i + parallelism);
    await Promise.all(
      chunk.map((batch) =>
        supabase.from(table).insert(batch as Record<string, unknown>[]).then(({ error }) => {
          if (error) throw new Error(`Insert to ${table} failed: ${error.message}`);
        })
      )
    );
  }
}

/**
 * Split CSV text into chunks at line boundaries.
 * Returns array of { text, startLine, endLine } for each chunk.
 */
function splitCsvIntoChunks(
  csvText: string,
  maxBytesPerChunk: number
): { header: string; chunks: string[] } {
  const lines = csvText.split("\n");
  const header = lines[0];
  const dataLines = lines.slice(1);
  
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;
  
  for (const line of dataLines) {
    const lineSize = line.length + 1; // +1 for newline
    
    if (currentSize + lineSize > maxBytesPerChunk && currentChunk.length > 0) {
      // Start new chunk
      chunks.push(currentChunk.join("\n"));
      currentChunk = [];
      currentSize = 0;
    }
    
    currentChunk.push(line);
    currentSize += lineSize;
  }
  
  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }
  
  return { header, chunks };
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  let reportId: string | null = null;
  let fileReference: string | null = null;

  try {
    const body: ProcessRequest = await request.json();
    reportId = body.reportId;
    const chunkIndex = body.chunkIndex ?? 0;
    const isChunkedMode = typeof body.totalChunks === "number" && body.totalChunks > 1;
    
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
    console.log(`[Process] Starting chunk ${chunkIndex + 1}${isChunkedMode ? `/${body.totalChunks}` : ""} for ${body.slug}`);

    // Download CSV
    let csvText: string;
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
    
    const fileSizeMB = csvText.length / 1024 / 1024;
    console.log(`[Process] Downloaded ${fileSizeMB.toFixed(1)}MB in ${Date.now() - startTime}ms`);

    // Check if we need to chunk this file
    const needsChunking = csvText.length > CHUNK_SIZE_BYTES * 1.5 && !isChunkedMode;
    
    if (needsChunking) {
      // First call with a large file - split and process first chunk, queue the rest
      console.log(`[Process] Large file detected (${fileSizeMB.toFixed(1)}MB), splitting into chunks...`);
      
      const { header, chunks } = splitCsvIntoChunks(csvText, CHUNK_SIZE_BYTES);
      const totalChunks = chunks.length;
      
      console.log(`[Process] Split into ${totalChunks} chunks`);
      
      // Update report with chunk progress
      await supabase.from("reports").update({
        stats: { processingChunks: totalChunks, currentChunk: 1 },
      }).eq("id", reportId);
      
      // Process first chunk inline
      const firstChunkCsv = header + "\n" + chunks[0];
      const employerMapping = await fetchOfficialMapping().catch(() => ({}));
      
      const result = runIngestionPipeline({
        csvText: firstChunkCsv,
        employerMappingJson: employerMapping,
        transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
        remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
      });
      
      console.log(`[Process] Chunk 1: ${result.transactions.length} transactions`);
      
      // Insert first chunk data
      await insertChunkData(supabase, reportId!, result, true);
      
      // Store remaining chunks in Supabase storage for subsequent processing
      for (let i = 1; i < chunks.length; i++) {
        const chunkPath = `${fileReference}_chunk_${i}`;
        const chunkCsv = header + "\n" + chunks[i];
        
        await supabase.storage
          .from(CSV_BUCKET)
          .upload(chunkPath, new Blob([chunkCsv], { type: "text/csv" }), { upsert: true });
      }
      
      // Queue next chunk
      if (totalChunks > 1) {
        const nextChunkUrl = new URL("/api/process-report", request.url);
        fetch(nextChunkUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reportId,
            slug: body.slug,
            storagePath: `${fileReference}_chunk_1`,
            inUsFilter: body.inUsFilter,
            chunkIndex: 1,
            totalChunks,
            isLastChunk: totalChunks === 2,
            originalFileReference: fileReference,
          }),
        }).catch(console.error);
      }
      
      return NextResponse.json({ 
        success: true, 
        chunked: true, 
        chunk: 1, 
        totalChunks,
        processingTimeMs: Date.now() - startTime 
      });
    }
    
    // Regular processing (small file or subsequent chunk)
    const employerMapping = chunkIndex === 0 
      ? await fetchOfficialMapping().catch(() => ({}))
      : {}; // Only fetch mapping on first chunk
    
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson: employerMapping,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });
    
    console.log(`[Process] Processed ${result.transactions.length} transactions in ${Date.now() - startTime}ms`);

    // Insert data
    const isFirstChunk = chunkIndex === 0;
    await insertChunkData(supabase, reportId!, result, isFirstChunk);
    
    // Update progress
    if (isChunkedMode) {
      await supabase.from("reports").update({
        stats: { processingChunks: body.totalChunks, currentChunk: chunkIndex + 1 },
      }).eq("id", reportId);
    }

    // Check if this is the last chunk
    const isLastChunk = body.isLastChunk || !isChunkedMode;
    
    if (isLastChunk) {
      // Finalize report
      console.log("[Process] Finalizing report...");
      
      // Get final stats by counting rows
      const { count: txCount } = await supabase
        .from("report_transactions")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId);
      
      const { count: customerCount } = await supabase
        .from("report_customer_locations")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId);
      
      await supabase.from("reports").update({
        status: "ready",
        csv_blob_url: null,
        stats: {
          ...result.stats,
          totalRows: txCount || result.stats.totalRows,
          totalCustomers: customerCount || result.stats.totalCustomers,
        },
      }).eq("id", reportId);

      // Cleanup all chunk files
      const originalRef = (body as { originalFileReference?: string }).originalFileReference || fileReference;
      try {
        if (isHttpUrl(originalRef)) {
          await del(originalRef);
        } else {
          // Delete original and all chunks
          const filesToDelete = [originalRef];
          if (body.totalChunks) {
            for (let i = 1; i < body.totalChunks; i++) {
              filesToDelete.push(`${originalRef}_chunk_${i}`);
            }
          }
          await supabase.storage.from(CSV_BUCKET).remove(filesToDelete);
        }
      } catch (e) {
        console.error("[Process] Cleanup error (non-fatal):", e);
      }

      console.log(`[Process] Report ${body.slug} complete! Total: ${Date.now() - startTime}ms`);
    } else {
      // Queue next chunk
      const nextChunkIndex = chunkIndex + 1;
      const originalRef = (body as { originalFileReference?: string }).originalFileReference || fileReference;
      const nextChunkPath = `${originalRef}_chunk_${nextChunkIndex}`;
      
      console.log(`[Process] Queuing chunk ${nextChunkIndex + 1}/${body.totalChunks}`);
      
      const nextChunkUrl = new URL("/api/process-report", request.url);
      fetch(nextChunkUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId,
          slug: body.slug,
          storagePath: nextChunkPath,
          inUsFilter: body.inUsFilter,
          chunkIndex: nextChunkIndex,
          totalChunks: body.totalChunks,
          isLastChunk: nextChunkIndex === (body.totalChunks! - 1),
          originalFileReference: originalRef,
        }),
      }).catch(console.error);
      
      // Delete current chunk file (already processed)
      if (chunkIndex > 0) {
        await supabase.storage.from(CSV_BUCKET).remove([fileReference]).catch(() => {});
      }
    }

    return NextResponse.json({ 
      success: true, 
      chunk: chunkIndex + 1,
      totalChunks: body.totalChunks || 1,
      transactions: result.transactions.length,
      processingTimeMs: Date.now() - startTime 
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

/**
 * Insert chunk data into database.
 */
async function insertChunkData(
  supabase: ReturnType<typeof createServiceClient>,
  reportId: string,
  result: ReturnType<typeof runIngestionPipeline>,
  includeRollups: boolean
): Promise<void> {
  
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
    vendor_match_evidence: null,
    employer_name: tx.employerName,
    employer_key: tx.employerKey,
    location_raw: tx.locationRaw || null,
    location_city: tx.locationCity || null,
    location_state: tx.locationState || null,
    location_country: tx.locationCountry || null,
    customer_in_us: tx.customerInUs,
  }));

  await parallelBatchInsert(supabase, "report_transactions", transactionRows);

  // Customer locations (always insert, will have duplicates across chunks but that's ok)
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

  // Use upsert for customer locations to handle duplicates across chunks
  for (let i = 0; i < locationRows.length; i += BATCH_SIZE) {
    const batch = locationRows.slice(i, i + BATCH_SIZE);
    await supabase.from("report_customer_locations").upsert(batch, {
      onConflict: "report_id,customer_id",
      ignoreDuplicates: true,
    });
  }

  // Only insert rollups on first chunk (they'll be recalculated at the end if needed)
  if (includeRollups) {
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

    const vendorRows = result.vendorRollups.map((vr) => ({
      report_id: reportId,
      vendor_name: vr.vendorName,
      transaction_count: vr.transactionCount,
      total_amount_cents: vr.totalAmountCents,
      unique_customers: vr.uniqueCustomers,
    }));

    await Promise.all([
      parallelBatchInsert(supabase, "report_employer_rollups", employerRows, 500, 3),
      parallelBatchInsert(supabase, "report_vendor_rollups", vendorRows, 500, 3),
    ]);
  }
}
