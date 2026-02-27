/**
 * DEPRECATED: This endpoint was used for the Vercel Blob client-upload token flow.
 * Large file uploads now go directly to Supabase Storage via signed URLs.
 * See /api/get-upload-url for the new flow.
 */

import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. Uploads now use Supabase Storage via /api/get-upload-url.",
    },
    { status: 410 }
  );
}
