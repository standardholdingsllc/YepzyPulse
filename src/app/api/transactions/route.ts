import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const TRANSACTIONS_BUCKET = "csv-uploads";

// Compact transaction format from blob
interface CompactTransaction {
  i: number;      // id
  d: string | null; // date
  t: string;      // type
  a: number;      // amount
  dr: string;     // direction
  s: string;      // summary
  c: string;      // customer
  cp: string;     // counterparty
  g: string;      // group
  v: string;      // vendor
  e: string;      // employer
  ek: string;     // employer key
  lr: string | null; // location raw
  lc: string | null; // location country
  u: string;      // in us
}

// Expanded transaction format for API response
interface Transaction {
  id: number;
  rawCreatedAt: string | null;
  unitType: string;
  amountCents: number;
  direction: string;
  summary: string;
  customerId: string;
  counterpartyName: string;
  transactionGroup: string;
  remittanceVendor: string;
  employerName: string;
  employerKey: string;
  locationRaw: string | null;
  locationCountry: string | null;
  customerInUs: string;
}

// Cache for transaction blobs (in-memory, per-request)
const blobCache = new Map<string, CompactTransaction[]>();

async function loadTransactionsFromBlob(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string
): Promise<CompactTransaction[]> {
  // Check cache first
  if (blobCache.has(slug)) {
    return blobCache.get(slug)!;
  }

  // Get blob path from report
  const { data: report } = await supabase
    .from("reports")
    .select("transactions_blob_path")
    .eq("slug", slug)
    .single();

  if (!report?.transactions_blob_path) {
    return [];
  }

  // Download blob
  const { data: blobData, error } = await supabase.storage
    .from(TRANSACTIONS_BUCKET)
    .download(report.transactions_blob_path);

  if (error || !blobData) {
    console.error("Failed to download transactions blob:", error);
    return [];
  }

  const jsonText = await blobData.text();
  const transactions = JSON.parse(jsonText) as CompactTransaction[];
  
  // Cache for subsequent requests
  blobCache.set(slug, transactions);
  
  return transactions;
}

function expandTransaction(compact: CompactTransaction): Transaction {
  return {
    id: compact.i,
    rawCreatedAt: compact.d,
    unitType: compact.t,
    amountCents: compact.a,
    direction: compact.dr,
    summary: compact.s,
    customerId: compact.c,
    counterpartyName: compact.cp,
    transactionGroup: compact.g,
    remittanceVendor: compact.v,
    employerName: compact.e,
    employerKey: compact.ek,
    locationRaw: compact.lr,
    locationCountry: compact.lc,
    customerInUs: compact.u,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const reportId = params.get("reportId");
  const slug = params.get("slug");

  if (!reportId && !slug) {
    return NextResponse.json({ error: "reportId or slug required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get slug if we only have reportId
  let reportSlug = slug;
  if (!reportSlug && reportId) {
    const { data: report } = await supabase
      .from("reports")
      .select("slug, transactions_blob_path")
      .eq("id", reportId)
      .single();
    
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    
    reportSlug = report.slug;
    
    // If no blob path, this is an old report - fall back to DB query
    if (!report.transactions_blob_path) {
      return fallbackToDbQuery(params, reportId);
    }
  }

  // Load transactions from blob
  const allTransactions = await loadTransactionsFromBlob(supabase, reportSlug!);
  
  if (allTransactions.length === 0) {
    // Fall back to DB query for old reports
    if (reportId) {
      return fallbackToDbQuery(params, reportId);
    }
    return NextResponse.json({ transactions: [], total: 0 });
  }

  // Apply filters
  let filtered = allTransactions;

  const transactionGroup = params.get("transactionGroup");
  if (transactionGroup) {
    filtered = filtered.filter(tx => tx.g === transactionGroup);
  }

  const remittanceVendor = params.get("remittanceVendor");
  if (remittanceVendor) {
    filtered = filtered.filter(tx => tx.v === remittanceVendor);
  }

  const employerKey = params.get("employerKey");
  if (employerKey) {
    filtered = filtered.filter(tx => tx.ek === employerKey);
  }

  const inUs = params.get("inUs");
  if (inUs) {
    filtered = filtered.filter(tx => tx.u === inUs);
  }

  const customerId = params.get("customerId");
  if (customerId) {
    filtered = filtered.filter(tx => tx.c === customerId);
  }

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    filtered = filtered.filter(tx => tx.d && tx.d >= dateFrom);
  }

  const dateTo = params.get("dateTo");
  if (dateTo) {
    filtered = filtered.filter(tx => tx.d && tx.d <= dateTo);
  }

  // Sort
  const sortBy = params.get("sortBy") || "d";
  const sortDir = params.get("sortDir") || "desc";
  
  filtered.sort((a, b) => {
    let aVal: string | number | null;
    let bVal: string | number | null;
    
    switch (sortBy) {
      case "d":
      case "rawCreatedAt":
        aVal = a.d;
        bVal = b.d;
        break;
      case "a":
      case "amountCents":
        aVal = a.a;
        bVal = b.a;
        break;
      default:
        aVal = a.d;
        bVal = b.d;
    }
    
    if (aVal === null) return sortDir === "asc" ? -1 : 1;
    if (bVal === null) return sortDir === "asc" ? 1 : -1;
    
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // Paginate
  const page = parseInt(params.get("page") || "1");
  const pageSize = parseInt(params.get("pageSize") || "50");
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  
  const paged = filtered.slice(start, end);
  const expanded = paged.map(expandTransaction);

  return NextResponse.json({
    transactions: expanded,
    total: filtered.length,
  });
}

// Fallback for old reports that still have transactions in DB
async function fallbackToDbQuery(
  params: URLSearchParams,
  reportId: string
) {
  const { getTransactions } = await import("@/lib/queries/reports");
  
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
