/**
 * Thin API endpoint that stores pre-processed report data.
 *
 * ALL heavy processing (CSV parsing, classification, rollups) happens
 * in the browser. This endpoint just writes results to the database.
 *
 * Receives:
 *   - slug, inUsFilter, stats, classificationRules (small metadata)
 *   - transactionsBlobPath (where the client uploaded the blob)
 *   - employerRollups, vendorRollups, customerLocationRows (rollup data)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 60;

interface SaveReportRequest {
  slug: string;
  inUsFilter: string;
  transactionsBlobPath: string;
  stats: Record<string, unknown>;
  classificationRules: Record<string, unknown>;
  employerRollups: Array<Record<string, unknown>>;
  vendorRollups: Array<Record<string, unknown>>;
  customerLocationRows: Array<Record<string, unknown>>;
}

const BATCH_SIZE = 500;

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  let reportId: string | null = null;

  try {
    const body: SaveReportRequest = await request.json();
    const {
      slug,
      inUsFilter,
      transactionsBlobPath,
      stats,
      classificationRules,
      employerRollups,
      vendorRollups,
      customerLocationRows,
    } = body;

    if (!slug || !transactionsBlobPath) {
      return NextResponse.json(
        { error: "slug and transactionsBlobPath are required" },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    console.log(`[SaveReport] Saving report ${slug} — ${employerRollups.length} employers, ${vendorRollups.length} vendors, ${customerLocationRows.length} customers`);

    // 1. Create report record
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .insert({
        slug,
        title: `Report ${new Date().toISOString().split("T")[0]}`,
        status: "processing", // Will be set to "ready" after inserts
        in_us_filter: inUsFilter,
        classification_rules: classificationRules,
        stats,
        transactions_blob_path: transactionsBlobPath,
        processing_started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (reportError || !report) {
      // Retry without processing_started_at if column doesn't exist
      if (reportError?.message?.includes("processing_started_at")) {
        const { data: fallback, error: fallbackErr } = await supabase
          .from("reports")
          .insert({
            slug,
            title: `Report ${new Date().toISOString().split("T")[0]}`,
            status: "processing",
            in_us_filter: inUsFilter,
            classification_rules: classificationRules,
            stats,
            transactions_blob_path: transactionsBlobPath,
          })
          .select("id")
          .single();

        if (fallbackErr || !fallback) {
          throw new Error(`Failed to create report: ${fallbackErr?.message}`);
        }
        reportId = fallback.id;
      } else {
        throw new Error(`Failed to create report: ${reportError?.message}`);
      }
    } else {
      reportId = report.id;
    }

    // 2. Insert employer rollups in batches
    if (employerRollups.length > 0) {
      const rows = employerRollups.map((er) => ({
        report_id: reportId,
        ...er,
      }));

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from("report_employer_rollups").insert(batch);
        if (error) throw new Error(`Employer rollup insert failed: ${error.message}`);
      }
    }

    // 3. Insert vendor rollups
    if (vendorRollups.length > 0) {
      const rows = vendorRollups.map((vr) => ({
        report_id: reportId,
        ...vr,
      }));
      const { error } = await supabase.from("report_vendor_rollups").insert(rows);
      if (error) throw new Error(`Vendor rollup insert failed: ${error.message}`);
    }

    // 4. Insert customer locations in batches
    if (customerLocationRows.length > 0) {
      const rows = customerLocationRows.map((loc) => ({
        report_id: reportId,
        ...loc,
      }));

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from("report_customer_locations").insert(batch);
        if (error) throw new Error(`Customer location insert failed: ${error.message}`);
      }
    }

    // 5. Mark report as ready
    await supabase.from("reports").update({
      status: "ready",
    }).eq("id", reportId);

    const elapsed = Date.now() - startTime;
    console.log(`[SaveReport] ✓ Report ${slug} saved in ${elapsed}ms`);

    return NextResponse.json({
      slug,
      reportId,
      url: `/r/${slug}`,
      status: "ready",
    });

  } catch (error) {
    console.error("[SaveReport] Error:", error);

    // Mark report as error if it was created
    if (reportId) {
      await supabase.from("reports").update({
        status: "error",
        error_message: error instanceof Error ? error.message : String(error),
      }).eq("id", reportId);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save report" },
      { status: 500 }
    );
  }
}
