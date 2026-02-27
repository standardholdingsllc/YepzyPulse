/**
 * API endpoint to start background processing after a file has been uploaded.
 *
 * Supports either:
 * - blobUrl (public Vercel Blob URL)
 * - storagePath (Supabase Storage path)
 *
 * Uses waitUntil() to ensure the background job trigger is reliable and not
 * terminated when the response is sent.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateSlug } from "@/lib/utils";
import type { InUsFilterMode } from "@/lib/types";

interface StartProcessingRequest {
  blobUrl?: string;
  storagePath?: string;
  inUsFilter: InUsFilterMode;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body: StartProcessingRequest = await request.json();
    const inUsFilter = body.inUsFilter;
    const fileReference =
      (typeof body.blobUrl === "string" && body.blobUrl.trim()) ||
      (typeof body.storagePath === "string" && body.storagePath.trim()) ||
      "";
    const normalizedReference = isHttpUrl(fileReference)
      ? fileReference
      : fileReference.replace(/^\/+/, "");

    if (!normalizedReference) {
      return NextResponse.json(
        { error: "blobUrl or storagePath is required" },
        { status: 400 }
      );
    }

    // Generate slug for the report
    const slug = generateSlug(12);

    console.log(`[StartProcessing] Creating report ${slug} for file reference: ${normalizedReference}`);

    // Create report record in "processing" state
    // Note: processing_started_at requires migration 006 to be run
    const supabase = createServiceClient();
    const processingStartedAt = new Date().toISOString();
    
    // Try with processing_started_at first, fall back without it if column doesn't exist
    let report: { id: string } | null = null;
    let reportError: Error | null = null;
    
    const { data: reportData, error: insertError } = await supabase
      .from("reports")
      .insert({
        slug,
        title: `Report ${new Date().toISOString().split("T")[0]}`,
        status: "processing",
        in_us_filter: inUsFilter,
        classification_rules: {},
        stats: {},
        csv_blob_url: normalizedReference,
        processing_started_at: processingStartedAt,
      })
      .select("id")
      .single();
    
    if (insertError?.message?.includes("processing_started_at")) {
      // Column doesn't exist yet, retry without it
      console.log("[StartProcessing] processing_started_at column not found, inserting without it");
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("reports")
        .insert({
          slug,
          title: `Report ${new Date().toISOString().split("T")[0]}`,
          status: "processing",
          in_us_filter: inUsFilter,
          classification_rules: {},
          stats: {},
          csv_blob_url: normalizedReference,
        })
        .select("id")
        .single();
      report = fallbackData;
      reportError = fallbackError as Error | null;
    } else {
      report = reportData;
      reportError = insertError as Error | null;
    }

    if (reportError || !report) {
      console.error("[StartProcessing] Failed to create report:", reportError);
      return NextResponse.json(
        { error: `Failed to create report: ${reportError?.message}` },
        { status: 500 }
      );
    }

    console.log(`[StartProcessing] Created report ${slug} (id: ${report.id}), triggering background processing...`);

    // Trigger background processing using after() for reliable execution
    // This ensures the fetch completes even after response is sent
    const processUrl = new URL("/api/process-report", request.url);
    const processPayload = JSON.stringify({
      reportId: report.id,
      slug,
      blobUrl: isHttpUrl(normalizedReference) ? normalizedReference : undefined,
      storagePath: isHttpUrl(normalizedReference) ? undefined : normalizedReference,
      fileReference: normalizedReference,
      inUsFilter,
    });

    after(async () => {
      try {
        console.log(`[StartProcessing] after() triggering process-report for ${slug}`);
        const response = await fetch(processUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: processPayload,
        });
        if (!response.ok) {
          console.error(`[StartProcessing] process-report returned ${response.status} for ${slug}`);
        } else {
          console.log(`[StartProcessing] process-report triggered successfully for ${slug}`);
        }
      } catch (err) {
        console.error("[StartProcessing] Failed to trigger processing in after():", err);
        // Mark report as error since background job failed to start
        const supabase = createServiceClient();
        await supabase
          .from("reports")
          .update({
            status: "error",
            error_message: "Failed to start background processing job",
          })
          .eq("id", report.id);
      }
    });

    return NextResponse.json({
      slug,
      reportId: report.id,
      url: `/r/${slug}`,
      status: "processing",
    });
  } catch (error) {
    console.error("[StartProcessing] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start processing" },
      { status: 500 }
    );
  }
}
