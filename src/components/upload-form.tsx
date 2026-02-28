"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { runIngestionPipeline, type IngestResult } from "@/lib/pipeline/ingest";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import { generateSlug } from "@/lib/utils";

type InUsFilter = "strict" | "lenient" | "all";
type LocationRecency = 7 | 14 | 30 | 0;
type Stage = "idle" | "reading" | "mapping" | "processing" | "uploading" | "saving" | "done";

const EMPLOYER_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

const BUCKET = "csv-uploads";
const TUS_CHUNK_SIZE = 6 * 1024 * 1024; // 6MB – required by Supabase Storage
const MAX_FILE_SIZE_MB = 500;

const STAGE_MESSAGES: Record<Stage, string> = {
  idle: "",
  reading: "Reading file…",
  mapping: "Loading employer data…",
  processing: "Processing transactions locally…",
  uploading: "Uploading results…",
  saving: "Saving report…",
  done: "Done! Redirecting…",
};

/**
 * Upload a Blob to Supabase Storage via TUS resumable protocol.
 */
function uploadBlobViaTus(
  blob: Blob,
  storagePath: string,
  supabaseUrl: string,
  anonKey: string,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const projectId = new URL(supabaseUrl).hostname.split(".")[0];
  const tusEndpoint = `https://${projectId}.supabase.co/storage/v1/upload/resumable`;

  const attemptUpload = (attemptContentType: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const upload = new tus.Upload(blob, {
        endpoint: tusEndpoint,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        headers: {
          authorization: `Bearer ${anonKey}`,
          "x-upsert": "true",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: TUS_CHUNK_SIZE,
        metadata: {
          bucketName: BUCKET,
          objectName: storagePath,
          contentType: attemptContentType,
          cacheControl: "3600",
        },
        onError: (err) => reject(err),
        onProgress: (bytesUploaded, bytesTotal) => {
          onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100));
        },
        onSuccess: () => resolve(),
      });

      upload.start();
    });

  return attemptUpload(contentType).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const unsupportedJsonMime =
      contentType === "application/json" &&
      /mime type application\/json is not supported|response code:\s*415/i.test(msg);

    if (unsupportedJsonMime) {
      // Some Supabase buckets are restricted to CSV MIME types only.
      // Keep JSON payload, but upload with CSV-compatible contentType metadata.
      return attemptUpload("text/csv");
    }

    throw err;
  });
}

export function UploadForm() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [inUsFilter, setInUsFilter] = useState<InUsFilter>("strict");
  const [locationRecency, setLocationRecency] = useState<LocationRecency>(30);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const isProcessing = stage !== "idle";

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) {
      setCsvFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing || !csvFile) return;

    if (csvFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File too large (${(csvFile.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }

    setError("");
    const fileSizeMB = (csvFile.size / 1024 / 1024).toFixed(1);
    const totalStart = Date.now();

    try {
      // ─── 1. Read CSV file as text ───
      setStage("reading");
      setProgress(`Reading file (${fileSizeMB}MB)…`);
      console.log(`[Client] Reading CSV file: ${csvFile.name} (${fileSizeMB}MB)`);

      const csvText = await csvFile.text();
      console.log(`[Client] File read: ${csvText.length} chars in ${Date.now() - totalStart}ms`);

      // ─── 2. Fetch employer mapping ───
      setStage("mapping");
      setProgress("Loading employer data…");

      let employerMappingJson: unknown = {};
      try {
        const res = await fetch(EMPLOYER_MAPPING_URL);
        if (res.ok) {
          employerMappingJson = await res.json();
          console.log("[Client] Employer mapping loaded");
        }
      } catch (err) {
        console.warn("[Client] Failed to fetch employer mapping, continuing without it:", err);
      }

      // ─── 3. Run ingestion pipeline LOCALLY ───
      setStage("processing");
      const rowEstimate = csvText.split("\n").length - 1;
      setProgress(`Processing ~${rowEstimate.toLocaleString()} transactions locally… this may take a minute.`);

      // Yield to UI so the "Processing…" message renders before the CPU-intensive work
      await new Promise((r) => setTimeout(r, 100));

      const pipelineStart = Date.now();
      const result: IngestResult = runIngestionPipeline({
        csvText,
        employerMappingJson,
        transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
        remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
        locationRecencyDays: locationRecency,
      });

      const pipelineMs = Date.now() - pipelineStart;
      console.log(`[Client] Pipeline complete: ${result.stats.totalRows} txns in ${(pipelineMs / 1000).toFixed(1)}s`);
      setProgress(`Processed ${result.stats.totalRows.toLocaleString()} transactions in ${(pipelineMs / 1000).toFixed(1)}s`);

      // ─── 4. Upload transactions blob to Supabase Storage ───
      setStage("uploading");
      setProgress("Uploading transaction data…");
      setUploadPct(0);

      const slug = generateSlug(12);
      const transactionsBlobPath = `transactions/${slug}.json`;

      // Build JSON blob
      const transactionsJson = JSON.stringify(result.compactTransactions);
      const blobSizeMB = (transactionsJson.length / 1024 / 1024).toFixed(1);
      console.log(`[Client] Transactions blob: ${blobSizeMB}MB, uploading to ${transactionsBlobPath}`);

      // Get Supabase credentials (reuse get-upload-url endpoint for the URL/key)
      const credRes = await fetch("/api/get-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "data.csv" }), // filename doesn't matter, we just need creds
      });

      if (!credRes.ok) {
        throw new Error("Failed to get upload credentials");
      }

      const { supabaseUrl, anonKey } = await credRes.json();

      const transactionsBlob = new Blob([transactionsJson], { type: "application/json" });

      // Free the JSON string (let GC collect it)
      // transactionsJson is const so we can't null it, but it goes out of scope

      await uploadBlobViaTus(
        transactionsBlob,
        transactionsBlobPath,
        supabaseUrl,
        anonKey,
        "application/json",
        (pct) => {
          setUploadPct(pct);
          setProgress(`Uploading transaction data… ${pct}%`);
        },
      );

      console.log(`[Client] Blob uploaded to ${transactionsBlobPath}`);

      // ─── 5. Save report via thin API ───
      setStage("saving");
      setProgress("Saving report…");

      // Format rollup data for the server (snake_case for DB)
      const employerRollups = result.employerRollups.map((er) => ({
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

      const vendorRollups = result.vendorRollups.map((vr) => ({
        vendor_name: vr.vendorName,
        transaction_count: vr.transactionCount,
        total_amount_cents: vr.totalAmountCents,
        unique_customers: vr.uniqueCustomers,
      }));

      const customerLocationRows = result.customerLocationRows.map((loc) => ({
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

      const saveRes = await fetch("/api/save-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          inUsFilter,
          transactionsBlobPath,
          stats: result.stats,
          classificationRules: {
            transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
            remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
          },
          employerRollups,
          vendorRollups,
          customerLocationRows,
        }),
      });

      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to save report (${saveRes.status})`);
      }

      const saveResult = await saveRes.json();
      const totalSec = ((Date.now() - totalStart) / 1000).toFixed(1);
      console.log(`[Client] ✓ Report saved! ${slug} — total time: ${totalSec}s`);

      // ─── 6. Done! Redirect ───
      setStage("done");
      setProgress(`Done! ${result.stats.totalRows.toLocaleString()} transactions processed in ${totalSec}s`);

      router.push(saveResult.url || `/r/${slug}`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "An error occurred";
      console.error("[Client] Processing failed:", err);
      setError(errMsg);
      setStage("idle");
      setProgress("");
      setUploadPct(0);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* CSV Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction CSV</CardTitle>
          <CardDescription>
            Upload a Unit transaction export CSV file — processed locally in your browser
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-all cursor-pointer ${
              isDragging
                ? "border-accent bg-accent/10"
                : csvFile
                  ? "border-accent/50 bg-accent/5"
                  : "border-dark-border hover:border-accent/50 hover:bg-dark-bg-tertiary/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className={`mb-4 rounded-full p-3 ${csvFile ? "bg-accent/20" : "bg-dark-bg-tertiary"}`}>
              <svg className={`h-8 w-8 ${csvFile ? "text-accent" : "text-muted"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            {csvFile ? (
              <div className="text-center">
                <p className="text-sm font-medium text-accent">{csvFile.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {(csvFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-muted-light">
                  <span className="font-medium text-accent">Drag & drop</span> a CSV here
                </p>
                <p className="mt-2 text-xs text-muted">or<span className="text-accent ml-1">Browse Files</span></p>
                <p className="mt-3 text-xs text-muted/70">CSV files only • Up to 500MB • Processed locally</p>
              </div>
            )}
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="absolute inset-0 z-10 cursor-pointer opacity-0"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Filter Options */}
      <Card>
        <CardHeader>
          <CardTitle>US Location Filter</CardTitle>
          <CardDescription>
            Control how customers are filtered based on their detected US location
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { value: "strict", label: "Strict — Only confirmed US", desc: "Only include customers with a recent US location" },
              { value: "lenient", label: "Lenient — Include unknowns", desc: "Include US-confirmed and customers with no location data" },
              { value: "all", label: "All — No filtering", desc: "Include all customers regardless of location" },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-all ${
                  inUsFilter === option.value
                    ? "border-accent/50 bg-accent/5"
                    : "border-dark-border hover:border-dark-border-hover hover:bg-dark-bg-tertiary/30"
                }`}
              >
                <input
                  type="radio"
                  name="inUsFilter"
                  value={option.value}
                  checked={inUsFilter === option.value}
                  onChange={() => setInUsFilter(option.value as InUsFilter)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <div>
                  <p className="text-sm font-medium text-white">{option.label}</p>
                  <p className="text-xs text-muted">{option.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Location Recency */}
      <Card>
        <CardHeader>
          <CardTitle>Location Recency Window</CardTitle>
          <CardDescription>
            How recent must a transaction be to count toward a worker&apos;s &quot;in US&quot; status?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {([
              { value: 7, label: "Last 7 days", desc: "Only the most recent week of data determines location" },
              { value: 14, label: "Last 14 days", desc: "Two weeks of data — good for bi-weekly pay cycles" },
              { value: 30, label: "Last 30 days", desc: "One month of data — recommended default" },
              { value: 0, label: "All time", desc: "Any location in the file counts — use for short date ranges" },
            ] as const).map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-all ${
                  locationRecency === option.value
                    ? "border-accent/50 bg-accent/5"
                    : "border-dark-border hover:border-dark-border-hover hover:bg-dark-bg-tertiary/30"
                }`}
              >
                <input
                  type="radio"
                  name="locationRecency"
                  value={option.value}
                  checked={locationRecency === option.value}
                  onChange={() => setLocationRecency(option.value)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <div>
                  <p className="text-sm font-medium text-white">{option.label}</p>
                  <p className="text-xs text-muted">{option.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Progress */}
      {isProcessing && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-4">
          <div className="flex items-center gap-3">
            {stage !== "done" ? (
              <svg className="h-5 w-5 animate-spin text-accent flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${stage === "done" ? "text-emerald-400" : "text-accent"}`}>
                {progress || STAGE_MESSAGES[stage]}
              </p>

              {/* Stage indicator */}
              <div className="mt-2 flex gap-1">
                {(["reading", "mapping", "processing", "uploading", "saving"] as Stage[]).map((s) => {
                  const stages: Stage[] = ["reading", "mapping", "processing", "uploading", "saving", "done"];
                  const currentIdx = stages.indexOf(stage);
                  const stageIdx = stages.indexOf(s);
                  const isComplete = currentIdx > stageIdx;
                  const isCurrent = stage === s;

                  return (
                    <div
                      key={s}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                        isComplete
                          ? "bg-accent"
                          : isCurrent
                            ? "bg-accent/60 animate-pulse"
                            : "bg-dark-bg-tertiary"
                      }`}
                    />
                  );
                })}
              </div>

              {/* Upload progress bar */}
              {stage === "uploading" && uploadPct > 0 && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-dark-bg-tertiary overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              )}

              {stage === "processing" && (
                <p className="mt-1 text-xs text-muted">
                  Your browser is doing all the work — no data leaves your machine until upload.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isProcessing || !csvFile}
        className="w-full rounded-xl bg-accent px-6 py-4 text-sm font-semibold text-white shadow-glow transition-all hover:bg-accent-hover hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {isProcessing ? "Processing..." : "Generate Report"}
      </button>

      <p className="text-center text-xs text-muted">
        Files are processed locally in your browser. Only results are uploaded. Reports expire after 7 days.
      </p>
    </form>
  );
}
