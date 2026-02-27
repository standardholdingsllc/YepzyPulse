import { NextRequest, NextResponse } from "next/server";
import { runIngestionPipeline } from "@/lib/pipeline/ingest";
import { storeReport } from "@/lib/pipeline/store";
import { generateSlug } from "@/lib/utils";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode } from "@/lib/types";

export const maxDuration = 60; // Vercel function timeout (Pro plan)

// Official employer mapping source (always used)
const OFFICIAL_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

async function fetchOfficialMapping(): Promise<Record<string, string>> {
  console.log("[API] Fetching official employer mapping from GitHub...");
  const response = await fetch(OFFICIAL_MAPPING_URL, {
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch official mapping: ${response.status}`);
  }

  const data = await response.json();
  console.log(`[API] Fetched ${Object.keys(data).length} customer→employer mappings`);
  return data;
}

interface AsyncGenerateReportRequest {
  blobUrl?: string;
  storagePath?: string;
  inUsFilter?: InUsFilterMode;
  options?: {
    inUsFilter?: InUsFilterMode;
  };
}

function resolveInUsFilter(value: unknown): InUsFilterMode {
  if (value === "strict" || value === "lenient" || value === "all") {
    return value;
  }
  return "strict";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeFileReference(value: string): string {
  const trimmed = value.trim();
  if (isHttpUrl(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/^\/+/, "");
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as AsyncGenerateReportRequest;
      const requestedPath =
        (typeof body.storagePath === "string" && body.storagePath) ||
        (typeof body.blobUrl === "string" && body.blobUrl) ||
        "";
      const fileReference = normalizeFileReference(requestedPath);
      const inUsFilter = resolveInUsFilter(body.options?.inUsFilter ?? body.inUsFilter);

      if (!fileReference) {
        return NextResponse.json(
          { error: "blobUrl or storagePath is required" },
          { status: 400 }
        );
      }

      console.log(`[API] Starting async report generation for file reference: ${fileReference}`);

      const startProcessingUrl = new URL("/api/start-processing", request.url);
      const startPayload = isHttpUrl(fileReference)
        ? { blobUrl: fileReference, inUsFilter }
        : { storagePath: fileReference, inUsFilter };
      const startProcessingResponse = await fetch(startProcessingUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startPayload),
      });

      if (!startProcessingResponse.ok) {
        const startContentType = startProcessingResponse.headers.get("content-type") ?? "";
        if (startContentType.includes("application/json")) {
          const errorJson = await startProcessingResponse.json().catch(() => ({}));
          return NextResponse.json(
            { error: errorJson.error || "Failed to start processing" },
            { status: startProcessingResponse.status }
          );
        }

        const errorText = await startProcessingResponse.text();
        return NextResponse.json(
          { error: errorText || "Failed to start processing" },
          { status: startProcessingResponse.status }
        );
      }

      const result = await startProcessingResponse.json();
      return NextResponse.json(result);
    }

    const formData = await request.formData();

    const csvFile = formData.get("csv") as File | null;
    const inUsFilter = (formData.get("inUsFilter") as InUsFilterMode) || "strict";

    if (!csvFile) {
      return NextResponse.json(
        { error: "CSV file is required" },
        { status: 400 }
      );
    }

    // Read CSV
    console.log("[API] Reading CSV file...");
    const csvText = await csvFile.text();
    console.log(`[API] CSV size: ${csvText.length} chars (${(csvText.length / 1024 / 1024).toFixed(2)} MB)`);

    // Always fetch official employer mapping
    let employerMappingJson: unknown = {};
    try {
      employerMappingJson = await fetchOfficialMapping();
    } catch (err) {
      console.error("[API] Failed to fetch official mapping:", err);
      // Continue without mapping rather than failing
      console.log("[API] Proceeding without employer mapping");
    }

    // Run pipeline
    console.log("[API] Running ingestion pipeline...");
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });

    // Generate slug and store
    const slug = generateSlug(12);
    console.log(`[API] Storing report with slug: ${slug}`);

    await storeReport({
      slug,
      inUsFilter,
      classificationRules: {
        transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
        remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
      },
      transactions: result.transactions,
      employerRollups: result.employerRollups,
      vendorRollups: result.vendorRollups,
      stats: result.stats,
    });

    console.log("[API] Report generated successfully!");

    return NextResponse.json({
      slug,
      stats: result.stats,
      url: `/r/${slug}`,
    });
  } catch (error) {
    console.error("[API] Error generating report:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
