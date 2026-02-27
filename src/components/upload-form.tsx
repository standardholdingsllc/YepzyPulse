"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRouter } from "next/navigation";

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

  // Threshold for using storage upload (files larger than this use storage + background processing)
  const STORAGE_UPLOAD_THRESHOLD_MB = 4; // Use storage for anything over 4MB (Vercel's limit is 4.5MB)
  const MAX_FILE_SIZE_MB = 500; // Max file size supported with storage upload
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

  /**
   * Upload a file to Supabase Storage using a signed URL.
   * Uses XMLHttpRequest for upload progress tracking.
   */
  const uploadToStorage = (
    signedUrl: string,
    file: File,
    contentType: string,
    onProgress: (percent: number) => void,
    abortSignal: AbortSignal,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Wire up abort signal
      const onAbort = () => {
        xhr.abort();
        reject(new Error("Upload aborted"));
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        abortSignal.removeEventListener("abort", onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          let errorMsg = `Storage upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.error || body.message) {
              errorMsg = body.error || body.message;
            }
          } catch {
            // ignore parse errors
          }
          reject(new Error(errorMsg));
        }
      };

      xhr.onerror = () => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(new Error("Network error during upload"));
      };

      xhr.ontimeout = () => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(new Error("Upload timed out"));
      };

      xhr.timeout = UPLOAD_TOTAL_TIMEOUT_MS;
      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.send(file);
    });
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
    const useStorageUpload = fileSizeMB > STORAGE_UPLOAD_THRESHOLD_MB;

    log("init", `Starting upload – size: ${fileSizeMB.toFixed(1)}MB, type: "${csvFile.type}", useStorageUpload: ${useStorageUpload}`);

    try {
      if (useStorageUpload) {
        // Large file: upload to Supabase Storage via signed URL, then process in background
        setProgress(`Uploading file (${fileSizeMB.toFixed(1)}MB)...`);
        setIsUploading(true);

        // 1. Get a signed upload URL from the server
        log("storage", "Requesting signed upload URL...");
        const urlResponse = await fetch("/api/get-upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: csvFile.name }),
        });

        if (!urlResponse.ok) {
          const errData = await urlResponse.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to get upload URL (${urlResponse.status})`);
        }

        const { signedUrl, path: storagePath } = await urlResponse.json();
        log("storage", `Got signed URL for path: ${storagePath}`);

        // 2. Upload file directly to Supabase Storage via the signed URL
        const controller = new AbortController();
        const totalTimer = setTimeout(() => {
          log("storage", `Total timeout after ${UPLOAD_TOTAL_TIMEOUT_MS / 1000}s. Aborting.`);
          controller.abort();
        }, UPLOAD_TOTAL_TIMEOUT_MS);

        const startTime = Date.now();

        try {
          await uploadToStorage(
            signedUrl,
            csvFile,
            csvFile.type || "text/csv",
            (percent) => {
              setUploadProgress(percent);
              setProgress(`Uploading file… ${percent}%`);
              if (percent % 20 === 0 || percent >= 100) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                log("storage", `Progress: ${percent}% – ${elapsed}s elapsed`);
              }
            },
            controller.signal,
          );
        } finally {
          clearTimeout(totalTimer);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log("storage", `Upload completed in ${elapsed}s, storagePath: ${storagePath}`);

        setProgress("File uploaded! Starting processing…");
        setUploadProgress(100);
        setIsUploading(false);

        // 3. Tell the server to start background processing
        log("process", `Calling /api/start-processing with storagePath: ${storagePath}`);
        const response = await fetch("/api/start-processing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath,
            inUsFilter,
          }),
        });

        log("process", `start-processing response: ${response.status}`);

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

        // Redirect to report page (will show processing status)
        router.push(`/r/${result.slug}`);
      } else {
        // Small file: use direct processing (original flow)
        setProgress("Uploading file…");
        log("direct", "Using direct upload (small file)");

        const formData = new FormData();
        formData.append("csv", csvFile);
        formData.append("inUsFilter", inUsFilter);

        const response = await fetch("/api/generate-report", {
          method: "POST",
          body: formData,
        });

        log("direct", `generate-report response: ${response.status}`);

        if (!response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to generate report");
          } else {
            const errorText = await response.text();
            if (errorText.includes("FUNCTION_PAYLOAD_TOO_LARGE") || response.status === 413) {
              throw new Error("File is too large for direct processing. Please try again.");
            }
            throw new Error(errorText || `Server error (${response.status})`);
          }
        }

        const result = await response.json();
        log("direct", `Report generated, redirecting to /r/${result.slug}`);
        setProgress("Report generated! Redirecting…");

        router.push(`/r/${result.slug}`);
      }
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
                  Establishing connection to storage… (check browser console for details)
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
