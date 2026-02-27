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
  const [progress, setProgress] = useState("");
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) {
      setError("Please select a CSV file");
      return;
    }

    setIsProcessing(true);
    setError("");
    setProgress("Uploading file...");

    try {
      const formData = new FormData();
      formData.append("csv", csvFile);
      formData.append("inUsFilter", inUsFilter);

      setProgress("Processing transactions...");

      const response = await fetch("/api/generate-report", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate report");
      }

      const result = await response.json();
      setProgress("Report generated! Redirecting...");

      router.push(`/r/${result.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsProcessing(false);
      setProgress("");
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
            onClick={() => csvInputRef.current?.click()}
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
                <p className="mt-3 text-xs text-muted/70">CSV files only • Max 200MB</p>
              </div>
            )}
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="absolute inset-0 cursor-pointer opacity-0"
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
            <p className="text-sm font-medium text-accent">{progress}</p>
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
