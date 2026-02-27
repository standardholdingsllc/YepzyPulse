/**
 * API endpoint to start background processing after a file has been uploaded.
 *
 * Supports either:
 * - blobUrl (public Vercel Blob URL)
 * - storagePath (Supabase Storage path)
 */

import { NextRequest, NextResponse } from "next/server";
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
        csv_blob_url: normalizedReference,
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
        blobUrl: isHttpUrl(normalizedReference) ? normalizedReference : undefined,
        storagePath: isHttpUrl(normalizedReference) ? undefined : normalizedReference,
        fileReference: normalizedReference,
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
