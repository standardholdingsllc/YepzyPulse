/**
 * API endpoint to start background processing after a file has been uploaded to Vercel Blob.
 * 
 * This is called by the client after the blob upload completes.
 * It creates the report record and triggers background processing.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateSlug } from "@/lib/utils";
import type { InUsFilterMode } from "@/lib/types";

interface StartProcessingRequest {
  blobUrl: string;
  inUsFilter: InUsFilterMode;
}

export async function POST(request: NextRequest) {
  try {
    const body: StartProcessingRequest = await request.json();
    const { blobUrl, inUsFilter } = body;

    if (!blobUrl) {
      return NextResponse.json(
        { error: "Blob URL is required" },
        { status: 400 }
      );
    }

    // Generate slug for the report
    const slug = generateSlug(12);

    console.log(`[StartProcessing] Creating report ${slug} for blob: ${blobUrl}`);

    // Create report record in "processing" state
    const supabase = createServiceClient();
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .insert({
        slug,
        title: `Report ${new Date().toISOString().split("T")[0]}`,
        status: "processing",
        in_us_filter: inUsFilter,
        classification_rules: {},
        stats: {},
        csv_blob_url: blobUrl,
      })
      .select("id")
      .single();

    if (reportError || !report) {
      console.error("[StartProcessing] Failed to create report:", reportError);
      return NextResponse.json(
        { error: `Failed to create report: ${reportError?.message}` },
        { status: 500 }
      );
    }

    console.log(`[StartProcessing] Created report ${slug} (id: ${report.id}), triggering background processing...`);

    // Trigger background processing
    const processUrl = new URL("/api/process-report", request.url);
    
    // Fire and forget - don't await
    fetch(processUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId: report.id,
        slug,
        blobUrl,
        inUsFilter,
      }),
    }).catch((err) => {
      console.error("[StartProcessing] Failed to trigger processing:", err);
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
