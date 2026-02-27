/**
 * DEPRECATED: Large CSV uploads now use Vercel Blob client uploads via /api/upload-csv.
 * This endpoint is intentionally disabled to prevent stale clients from using
 * signed Supabase PUT uploads that can fail on large files.
 */

import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        "Deprecated endpoint. Uploads now use /api/upload-csv (Vercel Blob). Please refresh and retry.",
    },
    { status: 410 }
  );
}
