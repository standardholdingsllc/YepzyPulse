"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

type InUsFilter = "strict" | "lenient" | "all";

export function UploadForm() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [inUsFilter, setInUsFilter] = useState<InUsFilter>("strict");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

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

  // All uploads go to blob storage first; no CSV payloads are sent to app API routes.
  const MAX_FILE_SIZE_MB = 500; // Max file size supported
  const UPLOAD_IDLE_TIMEOUT_MS = 90_000;
  const UPLOAD_TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute hard cap

  /** Structured client-side logger that timestamps every upload event. */
  const log = (phase: string, msg: string, data?: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    const prefix = `[Upload:${phase}]`;
    if (data) {
      console.log(`${ts} ${prefix} ${msg}`, data);
    } else {
      console.log(`${ts} ${prefix} ${msg}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) {
      return;
    }

    if (!csvFile) {
      setError("Please select a CSV file");
      return;
    }

    // Client-side file size check
    if (csvFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File is too large (${(csvFile.size / 1024 / 1024).toFixed(1)}MB). Maximum allowed size is ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }

    setIsProcessing(true);
    setError("");
    setUploadProgress(0);

    const fileSizeMB = csvFile.size / 1024 / 1024;
    log("init", `Starting upload – size: ${fileSizeMB.toFixed(1)}MB, type: "${csvFile.type}", mode: blob-upload`);

    try {
      // 1. Upload to Vercel Blob directly from the browser
      setProgress(`Uploading file (${fileSizeMB.toFixed(1)}MB)...`);
      setIsUploading(true);

      const safeFilename = csvFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const pathname = `csv-uploads/${Date.now()}-${safeFilename}`;
      log("blob", `Pathname: ${pathname}, safe filename: ${safeFilename}`);

      const uploadWithWatchdog = async (multipart: boolean) => {
        const mode = multipart ? "multipart" : "single-put";
        log(mode, `Starting ${mode} upload…`);

        const controller = new AbortController();
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let totalTimer: ReturnType<typeof setTimeout> | null = null;
        let lastLoaded = -1;
        let progressEventCount = 0;
        const startTime = Date.now();

        const clearIdleTimer = () => {
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
        };

        const resetIdleTimer = () => {
          clearIdleTimer();
          idleTimer = setTimeout(() => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log(mode, `Idle timeout after ${elapsed}s – no progress for ${UPLOAD_IDLE_TIMEOUT_MS / 1000}s. Aborting.`, {
              lastLoaded,
              progressEventCount,
            });
            controller.abort();
          }, UPLOAD_IDLE_TIMEOUT_MS);
        };

        totalTimer = setTimeout(() => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          log(mode, `Total timeout after ${elapsed}s. Aborting.`, {
            lastLoaded,
            progressEventCount,
          });
          controller.abort();
        }, UPLOAD_TOTAL_TIMEOUT_MS);

        resetIdleTimer();

        try {
          const blob = await upload(pathname, csvFile, {
            access: "public",
            handleUploadUrl: "/api/upload-csv",
            multipart,
            contentType: csvFile.type || "text/csv",
            abortSignal: controller.signal,
            onUploadProgress: (progressEvent) => {
              progressEventCount++;
              if (progressEvent.loaded > lastLoaded) {
                lastLoaded = progressEvent.loaded;
                resetIdleTimer();
              }
              const percent = Math.round(progressEvent.percentage);
              setUploadProgress(percent);
              setProgress(`Uploading file… ${percent}%`);

              if (progressEventCount <= 3 || progressEventCount % 10 === 0 || percent >= 100) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                log(mode, `Progress: ${percent}% (${(progressEvent.loaded / 1024 / 1024).toFixed(1)}MB) – event #${progressEventCount} – ${elapsed}s elapsed`);
              }
            },
          });

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          log(mode, `Upload completed in ${elapsed}s`, {
            url: blob.url,
            pathname: blob.pathname,
            contentType: blob.contentType,
            progressEvents: progressEventCount,
          });
          return blob;
        } catch (uploadErr) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const errMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          const errStack = uploadErr instanceof Error ? uploadErr.stack : undefined;
          log(mode, `Upload FAILED after ${elapsed}s: ${errMsg}`, {
            progressEvents: progressEventCount,
            lastLoaded,
            stack: errStack,
          });
          throw uploadErr;
        } finally {
          clearIdleTimer();
          if (totalTimer) {
            clearTimeout(totalTimer);
            totalTimer = null;
          }
        }
      };

      let blob;
      try {
        blob = await uploadWithWatchdog(true);
      } catch (firstErr) {
        const message = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const looksStalled = message.toLowerCase().includes("aborted") || message.toLowerCase().includes("abort");
        log("retry", `First attempt error: "${message}", looksStalled: ${looksStalled}`);
        if (!looksStalled) {
          throw firstErr;
        }

        setUploadProgress(0);
        setProgress("Upload stalled. Retrying in compatibility mode…");
        log("retry", "Falling back to single-PUT upload mode");
        blob = await uploadWithWatchdog(false);
      }

      setProgress("File uploaded! Starting processing…");
      setUploadProgress(100);
      setIsUploading(false);

      // 2. Start processing with a small JSON payload only (no CSV body)
      log("process", `Calling /api/generate-report with blobUrl: ${blob.url}`);
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          options: { inUsFilter },
        }),
      });

      log("process", `generate-report response: ${response.status}`);

      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to start processing");
        }
        const errorText = await response.text();
        throw new Error(errorText || `Failed to start processing (${response.status})`);
      }

      const result = await response.json();
      log("process", `Processing started, redirecting to /r/${result.slug}`);
      setProgress("Processing started! Redirecting…");
      router.push(`/r/${result.slug}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "An error occurred";
      log("error", `Upload flow failed: ${errMsg}`, {
        stack: err instanceof Error ? err.stack : undefined,
      });
      setError(errMsg);
      setIsProcessing(false);
      setIsUploading(false);
      setProgress("");
      setUploadProgress(0);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* CSV Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction CSV</CardTitle>
          <CardDescription>
            Upload a Unit transaction export CSV file
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
                <p className="mt-3 text-xs text-muted/70">CSV files only • Up to 500MB supported</p>
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

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Progress */}
      {isProcessing && progress && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-accent">{progress}</p>
              {isUploading && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-dark-bg-tertiary overflow-hidden">
                  {uploadProgress > 0 ? (
                    <div
                      className="h-full bg-accent transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse bg-accent/70" />
                  )}
                </div>
              )}
              {isUploading && uploadProgress === 0 && (
                <p className="mt-1.5 text-xs text-muted">
                  Establishing connection to upload service… (check browser console for details)
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
        Files are processed securely. Reports expire after 7 days.
      </p>
    </form>
  );
}
