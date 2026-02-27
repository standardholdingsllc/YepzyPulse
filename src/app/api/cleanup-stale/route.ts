/**
 * API endpoint to mark stale processing jobs as failed.
 * 
 * This should be called periodically (e.g., via Vercel Cron) to clean up
 * jobs that timed out without properly updating their status.
 * 
 * Jobs are considered stale if they've been processing for more than 6 minutes.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// Jobs processing longer than this are considered stale/timed out
const STALE_THRESHOLD_MINUTES = 6;

export async function GET() {
  try {
    const supabase = createServiceClient();
    
    // Find and update stale processing jobs
    const staleThreshold = new Date(
      Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    // First, get the stale reports for logging
    const { data: staleReports } = await supabase
      .from("reports")
      .select("id, slug, processing_started_at, created_at")
      .eq("status", "processing")
      .or(`processing_started_at.lt.${staleThreshold},and(processing_started_at.is.null,created_at.lt.${staleThreshold})`);

    if (!staleReports || staleReports.length === 0) {
      console.log("[CleanupStale] No stale processing jobs found");
      return NextResponse.json({ cleaned: 0 });
    }

    console.log(`[CleanupStale] Found ${staleReports.length} stale processing jobs:`, 
      staleReports.map(r => r.slug));

    // Mark them as errored
    const { error: updateError } = await supabase
      .from("reports")
      .update({
        status: "error",
        error_message: `Processing timed out after ${STALE_THRESHOLD_MINUTES} minutes. The file may be too large to process.`,
      })
      .eq("status", "processing")
      .or(`processing_started_at.lt.${staleThreshold},and(processing_started_at.is.null,created_at.lt.${staleThreshold})`);

    if (updateError) {
      console.error("[CleanupStale] Failed to update stale reports:", updateError);
      return NextResponse.json(
        { error: "Failed to clean up stale jobs" },
        { status: 500 }
      );
    }

    console.log(`[CleanupStale] Marked ${staleReports.length} jobs as timed out`);

    return NextResponse.json({
      cleaned: staleReports.length,
      slugs: staleReports.map(r => r.slug),
    });
  } catch (error) {
    console.error("[CleanupStale] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed" },
      { status: 500 }
    );
  }
}

// Also support POST for flexibility
export { GET as POST };
