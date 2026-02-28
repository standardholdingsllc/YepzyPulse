/**
 * LEGACY API route for report generation.
 *
 * The primary flow now uses client-side processing:
 *   1. Browser parses CSV + runs pipeline locally
 *   2. Browser uploads blob to Supabase Storage
 *   3. Browser calls /api/save-report with results
 *
 * This endpoint is kept for backward compatibility (e.g., small inline
 * CSV uploads via FormData). For large files, clients should use the
 * new client-side processing flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { runIngestionPipeline } from "@/lib/pipeline/ingest";
import { storeReport } from "@/lib/pipeline/store";
import { generateSlug } from "@/lib/utils";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode } from "@/lib/types";

export const maxDuration = 60;

const OFFICIAL_MAPPING_URL =
  "https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json";

async function fetchOfficialMapping(): Promise<Record<string, string>> {
  const response = await fetch(OFFICIAL_MAPPING_URL, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch official mapping: ${response.status}`);
  }
  return response.json();
}

function resolveInUsFilter(value: unknown): InUsFilterMode {
  if (value === "strict" || value === "lenient" || value === "all") {
    return value;
  }
  return "strict";
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    // Only handle FormData (inline small file uploads)
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Use /api/save-report for processed data, or upload via FormData" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const csvFile = formData.get("csv") as File | null;
    const inUsFilter = resolveInUsFilter(formData.get("inUsFilter") || "strict");

    if (!csvFile) {
      return NextResponse.json(
        { error: "CSV file is required" },
        { status: 400 }
      );
    }

    console.log("[API] Reading CSV file...");
    const csvText = await csvFile.text();
    console.log(`[API] CSV size: ${(csvText.length / 1024 / 1024).toFixed(2)} MB`);

    let employerMappingJson: unknown = {};
    try {
      employerMappingJson = await fetchOfficialMapping();
    } catch (err) {
      console.error("[API] Failed to fetch official mapping:", err);
    }

    console.log("[API] Running ingestion pipeline...");
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson,
      transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
      remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
    });

    const slug = generateSlug(12);
    console.log(`[API] Storing report with slug: ${slug}`);

    await storeReport({
      slug,
      inUsFilter,
      classificationRules: {
        transactionTypeRules: DEFAULT_TRANSACTION_TYPE_RULES,
        remittanceVendorRules: DEFAULT_REMITTANCE_VENDOR_RULES,
      },
      compactTransactions: result.compactTransactions,
      employerRollups: result.employerRollups,
      vendorRollups: result.vendorRollups,
      customerLocationRows: result.customerLocationRows,
      stats: result.stats,
    });

    return NextResponse.json({
      slug,
      stats: result.stats,
      url: `/r/${slug}`,
    });
  } catch (error) {
    console.error("[API] Error generating report:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error occurred" },
      { status: 500 }
    );
  }
}
