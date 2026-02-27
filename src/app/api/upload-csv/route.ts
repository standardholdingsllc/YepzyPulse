/**
 * API endpoint for generating client-upload tokens for Vercel Blob.
 *
 * We intentionally do not use the onUploadCompleted callback here because
 * the app starts processing via /api/start-processing after upload() resolves.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Basic validation to keep uploads scoped to CSV-like files.
        const normalized = pathname.toLowerCase();
        if (!normalized.endsWith(".csv")) {
          throw new Error("Only CSV files are allowed");
        }

        console.log(`[Upload] Generating token for: ${pathname}`);

        return {
          // Keep this broad enough for browser/OS CSV mime variations.
          allowedContentTypes: [
            "text/csv",
            "application/csv",
            "application/vnd.ms-excel",
            "text/plain",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB max
          addRandomSuffix: true,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("[Upload] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }
}
