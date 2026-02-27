import { NextRequest, NextResponse } from "next/server";
import { getTransactions } from "@/lib/queries/reports";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const reportId = params.get("reportId");

  if (!reportId) {
    return NextResponse.json({ error: "reportId required" }, { status: 400 });
  }

  const result = await getTransactions({
    reportId,
    page: parseInt(params.get("page") || "1"),
    pageSize: parseInt(params.get("pageSize") || "50"),
    dateFrom: params.get("dateFrom") || undefined,
    dateTo: params.get("dateTo") || undefined,
    transactionGroup: params.get("transactionGroup") || undefined,
    remittanceVendor: params.get("remittanceVendor") || undefined,
    employerKey: params.get("employerKey") || undefined,
    inUs: params.get("inUs") || undefined,
    customerId: params.get("customerId") || undefined,
    sortBy: params.get("sortBy") || undefined,
    sortDir: (params.get("sortDir") as "asc" | "desc") || undefined,
  });

  return NextResponse.json(result);
}
