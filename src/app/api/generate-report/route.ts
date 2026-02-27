import { NextRequest, NextResponse } from "next/server";
import { runIngestionPipeline } from "@/lib/pipeline/ingest";
import { storeReport } from "@/lib/pipeline/store";
import { generateSlug } from "@/lib/utils";
import { DEFAULT_TRANSACTION_TYPE_RULES } from "@/lib/classification/transaction-types";
import { DEFAULT_REMITTANCE_VENDOR_RULES } from "@/lib/classification/remittance-vendors";
import type { InUsFilterMode } from "@/lib/types";

export const maxDuration = 60; // Vercel function timeout (Pro plan)

// Official employer mapping source
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const csvFile = formData.get("csv") as File | null;
    const mappingFile = formData.get("mapping") as File | null;
    const mappingUrl = formData.get("mappingUrl") as string | null;
    const inUsFilter = (formData.get("inUsFilter") as InUsFilterMode) || "strict";
    const customTypeRules = formData.get("transactionTypeRules") as string | null;
    const customVendorRules = formData.get("remittanceVendorRules") as string | null;

    if (!csvFile) {
      return NextResponse.json(
        { error: "CSV file is required" },
        { status: 400 }
      );
    }

    // Read CSV
    console.log("[API] Reading CSV file...");
    const csvText = await csvFile.text();
    console.log(`[API] CSV size: ${csvText.length} chars`);

    // Get employer mapping (priority: custom file > URL > empty)
    let employerMappingJson: unknown = {};
    
    if (mappingFile) {
      // Custom file upload takes priority
      console.log("[API] Reading custom mapping file...");
      const mappingText = await mappingFile.text();
      try {
        employerMappingJson = JSON.parse(mappingText);
        console.log(`[API] Loaded ${Object.keys(employerMappingJson as object).length} mappings from custom file`);
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON in mapping file" },
          { status: 400 }
        );
      }
    } else if (mappingUrl === OFFICIAL_MAPPING_URL) {
      // Fetch from official GitHub source
      try {
        employerMappingJson = await fetchOfficialMapping();
      } catch (err) {
        console.error("[API] Failed to fetch official mapping:", err);
        // Continue without mapping rather than failing
        console.log("[API] Proceeding without employer mapping");
      }
    }

    // Parse custom rules if provided
    let transactionTypeRules = DEFAULT_TRANSACTION_TYPE_RULES;
    if (customTypeRules) {
      try {
        transactionTypeRules = JSON.parse(customTypeRules);
      } catch {
        // Fall back to defaults
      }
    }

    let remittanceVendorRules = DEFAULT_REMITTANCE_VENDOR_RULES;
    if (customVendorRules) {
      try {
        remittanceVendorRules = JSON.parse(customVendorRules);
      } catch {
        // Fall back to defaults
      }
    }

    // Run pipeline
    console.log("[API] Running ingestion pipeline...");
    const result = runIngestionPipeline({
      csvText,
      employerMappingJson,
      transactionTypeRules,
      remittanceVendorRules,
    });

    // Generate slug and store
    const slug = generateSlug(12);
    console.log(`[API] Storing report with slug: ${slug}`);

    await storeReport({
      slug,
      inUsFilter,
      classificationRules: {
        transactionTypeRules,
        remittanceVendorRules,
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
