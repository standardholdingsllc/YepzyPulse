"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRouter } from "next/navigation";

type InUsFilter = "strict" | "lenient" | "all";
type MappingSource = "official" | "custom";

const OFFICIAL_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

export function UploadForm() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [mappingSource, setMappingSource] = useState<MappingSource>("official");
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [inUsFilter, setInUsFilter] = useState<InUsFilter>("strict");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);
  const mappingInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) {
      setError("Please select a CSV file");
      return;
    }

    setIsProcessing(true);
    setError("");
    setProgress("Uploading files...");

    try {
      const formData = new FormData();
      formData.append("csv", csvFile);
      
      // Use official mapping URL or custom file
      if (mappingSource === "official") {
        formData.append("mappingUrl", OFFICIAL_MAPPING_URL);
      } else if (mappingFile) {
        formData.append("mapping", mappingFile);
      }
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
            Upload a Unit transaction export CSV file (up to 25k+ rows supported)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 transition-colors hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer"
            onClick={() => csvInputRef.current?.click()}
          >
            <svg className="mb-3 h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {csvFile ? (
              <div className="text-center">
                <p className="text-sm font-medium text-brand-600">{csvFile.name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {(csvFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-brand-600">Click to upload</span> or drag and drop
                </p>
                <p className="mt-1 text-xs text-gray-500">CSV files only</p>
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

      {/* Employer Mapping */}
      <Card>
        <CardHeader>
          <CardTitle>Employer Mapping</CardTitle>
          <CardDescription>
            Maps customer IDs to their employer. The official mapping is pulled from GitHub automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="mappingSource"
                value="official"
                checked={mappingSource === "official"}
                onChange={() => setMappingSource("official")}
                className="mt-0.5 h-4 w-4 text-brand-600"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">Official Mapping (Recommended)</p>
                <p className="text-xs text-gray-500 mt-1">
                  Fetches the latest customer→employer mapping from the{" "}
                  <a
                    href="https://github.com/standardholdingsllc/hubspot-address-mapper"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    hubspot-address-mapper
                  </a>{" "}
                  repository
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Auto-updated
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="mappingSource"
                value="custom"
                checked={mappingSource === "custom"}
                onChange={() => setMappingSource("custom")}
                className="mt-0.5 h-4 w-4 text-brand-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Custom Mapping</p>
                <p className="text-xs text-gray-500 mt-1">Upload your own JSON file</p>
              </div>
            </label>

            {/* Custom file upload (only shown when custom is selected) */}
            {mappingSource === "custom" && (
              <div
                className="relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 transition-colors hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer mt-3"
                onClick={() => mappingInputRef.current?.click()}
              >
                <svg className="mb-2 h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {mappingFile ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-brand-600">{mappingFile.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {(mappingFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-brand-600">Click to upload</span> JSON file
                    </p>
                    <p className="mt-1 text-xs text-gray-500">Format: {`{"customerId": "Employer Name", ...}`}</p>
                  </div>
                )}
                <input
                  ref={mappingInputRef}
                  type="file"
                  accept=".json"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(e) => setMappingFile(e.target.files?.[0] || null)}
                />
              </div>
            )}
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
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="inUsFilter"
                value="strict"
                checked={inUsFilter === "strict"}
                onChange={() => setInUsFilter("strict")}
                className="mt-0.5 h-4 w-4 text-brand-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Strict — Only confirmed US</p>
                <p className="text-xs text-gray-500">Only include customers with a recent US location</p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="inUsFilter"
                value="lenient"
                checked={inUsFilter === "lenient"}
                onChange={() => setInUsFilter("lenient")}
                className="mt-0.5 h-4 w-4 text-brand-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Lenient — Include unknowns</p>
                <p className="text-xs text-gray-500">Include US-confirmed and customers with no location data</p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="inUsFilter"
                value="all"
                checked={inUsFilter === "all"}
                onChange={() => setInUsFilter("all")}
                className="mt-0.5 h-4 w-4 text-brand-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">All — No filtering</p>
                <p className="text-xs text-gray-500">Include all customers regardless of location</p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Progress */}
      {isProcessing && progress && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-sm font-medium text-brand-700">{progress}</p>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isProcessing || !csvFile}
        className="w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isProcessing ? "Processing..." : "Generate Report"}
      </button>
    </form>
  );
}
