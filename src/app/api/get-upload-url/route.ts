/**
 * Generates a signed upload URL for Supabase Storage.
 *
 * The client calls this endpoint to get a URL it can PUT the CSV file to
 * directly, without needing auth headers. This replaces the Vercel Blob
 * client-token flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const CSV_BUCKET = "csv-uploads";

export async function POST(request: NextRequest) {
  try {
    const { filename } = await request.json();

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Sanitise the filename and build a unique path
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${Date.now()}-${safeFilename}`;

    console.log(`[GetUploadUrl] Generating signed URL for: ${path}`);

    const { data, error } = await supabase.storage
      .from(CSV_BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      console.error("[GetUploadUrl] Failed to create signed URL:", error);
      return NextResponse.json(
        { error: `Storage error: ${error.message}` },
        { status: 500 }
      );
    }

    console.log(`[GetUploadUrl] Signed URL created for path: ${data.path}`);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    });
  } catch (error) {
    console.error("[GetUploadUrl] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate upload URL",
      },
      { status: 500 }
    );
  }
}
