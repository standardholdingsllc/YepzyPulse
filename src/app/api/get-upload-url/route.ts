/**
 * API endpoint that generates a unique storage path for client-side TUS uploads.
 *
 * Returns:
 *   - storagePath:  the object name inside the csv-uploads bucket
 *   - supabaseUrl:  the project URL (used to build the TUS endpoint)
 *   - anonKey:      the public anon key for the Authorization header
 *   - bucket:       bucket name
 *
 * The client then uses tus-js-client to upload directly to Supabase Storage's
 * TUS resumable-upload endpoint, which reliably handles files of any size.
 *
 * IMPORTANT: Requires RLS INSERT policy on storage.objects for the csv-uploads bucket.
 * Also requires the global file size limit in Supabase Storage Settings to be >= 500MB.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const filename: string = body.filename ?? "upload.csv";

    // Validate — allow CSV files and JSON blobs
    const normalized = filename.toLowerCase();
    if (!normalized.endsWith(".csv") && !normalized.endsWith(".json")) {
      return NextResponse.json(
        { error: "Only CSV and JSON files are allowed" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      console.error("[GetUploadUrl] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
      return NextResponse.json(
        { error: "Storage configuration error" },
        { status: 500 }
      );
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${Date.now()}-${safeFilename}`;

    console.log(`[GetUploadUrl] Generated storage path: ${storagePath}`);

    return NextResponse.json({
      storagePath,
      supabaseUrl,
      anonKey,
      bucket: "csv-uploads",
    });
  } catch (error) {
    console.error("[GetUploadUrl] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
