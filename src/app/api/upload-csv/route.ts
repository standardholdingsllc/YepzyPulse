/**
 * API endpoint that handles the server-side part of client uploads to Vercel Blob.
 * 
 * For client uploads, the flow is:
 * 1. Client calls this endpoint to get a signed upload URL
 * 2. Client uploads directly to Vercel Blob (bypassing the 4.5MB function limit)
 * 3. Client calls /api/start-processing with the blob URL
 * 
 * This endpoint handles the handleUpload callback from @vercel/blob/client
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
        // Validate the upload before generating a token
        // You can add authentication checks here
        console.log(`[Upload] Generating token for: ${pathname}`);
        
        return {
          allowedContentTypes: ["text/csv", "application/csv", "text/plain"],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB max
          tokenPayload: JSON.stringify({
            // You can add custom data here that will be available in onUploadCompleted
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This is called after the file is uploaded to Vercel Blob
        // Note: This won't be called if the upload is done from localhost
        console.log(`[Upload] Upload completed: ${blob.url}`);
        console.log(`[Upload] Token payload: ${tokenPayload}`);
        
        // We don't create the report here - the client will call /api/start-processing
        // This is because we need the inUsFilter from the client
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
