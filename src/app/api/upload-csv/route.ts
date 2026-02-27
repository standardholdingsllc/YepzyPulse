/**
 * API endpoint for generating client-upload tokens for Vercel Blob.
 *
 * Handles two event types from the @vercel/blob client protocol:
 *   1. blob.generate-client-token  – returns a signed token for direct upload
 *   2. blob.upload-completed       – acknowledged after Vercel Blob finishes storing the file
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    console.log(`[Upload] Received event type: ${body?.type ?? "unknown"}`);

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const normalized = pathname.toLowerCase();
        if (!normalized.endsWith(".csv")) {
          throw new Error("Only CSV files are allowed");
        }

        console.log(`[Upload] Generating token for: ${pathname}`);

        return {
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
      onUploadCompleted: async ({ blob }) => {
        console.log(
          `[Upload] Blob upload completed - url: ${blob.url}, path: ${blob.pathname}, contentType: ${blob.contentType}`
        );
      },
    });

    console.log(`[Upload] Responding to ${body?.type ?? "unknown"} event`);
    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("[Upload] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }
}
