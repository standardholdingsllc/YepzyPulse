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

// Customer aggregation for a specific vendor
export interface VendorCustomerData {
  customerId: string;
  employerName: string;
  employerKey: string;
  vendorTransactionCount: number;
  vendorAmountCents: number;
  totalRemittanceCount: number;
  totalRemittanceAmountCents: number;
  vendorPctOfRemittanceVolume: number;
  vendorPctOfRemittanceTxns: number;
  latestTransactionDate: string | null;
  inUs: string;
}

async function loadTransactionsFromBlob(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string
): Promise<CompactTransaction[]> {
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
  return JSON.parse(jsonText) as CompactTransaction[];
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = params.get("slug");
  const vendorName = params.get("vendor");

  if (!slug || !vendorName) {
    return NextResponse.json(
      { error: "slug and vendor parameters are required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Load all transactions from blob
  const allTransactions = await loadTransactionsFromBlob(supabase, slug);

  if (allTransactions.length === 0) {
    return NextResponse.json({ customers: [], total: 0 });
  }

  // Aggregate by customer for the specified vendor
  const customerMap = new Map<string, {
    customerId: string;
    employerName: string;
    employerKey: string;
    vendorTxns: number;
    vendorAmount: number;
    totalRemitTxns: number;
    totalRemitAmount: number;
    latestDate: string | null;
    inUs: string;
  }>();

  for (const tx of allTransactions) {
    const isRemittance = tx.v !== "Not remittance";
    const isThisVendor = tx.v === vendorName;

    if (!isRemittance && !isThisVendor) continue;

    let customer = customerMap.get(tx.c);
    if (!customer) {
      customer = {
        customerId: tx.c,
        employerName: tx.e,
        employerKey: tx.ek,
        vendorTxns: 0,
        vendorAmount: 0,
        totalRemitTxns: 0,
        totalRemitAmount: 0,
        latestDate: null,
        inUs: tx.u,
      };
      customerMap.set(tx.c, customer);
    }

    const amt = Math.abs(tx.a);

    if (isRemittance) {
      customer.totalRemitTxns++;
      customer.totalRemitAmount += amt;
    }

    if (isThisVendor) {
      customer.vendorTxns++;
      customer.vendorAmount += amt;

      // Track latest transaction date for this vendor
      if (tx.d && (!customer.latestDate || tx.d > customer.latestDate)) {
        customer.latestDate = tx.d;
      }
    }
  }

  // Filter to only customers who used this vendor
  const vendorCustomers: VendorCustomerData[] = [];
  for (const c of customerMap.values()) {
    if (c.vendorTxns > 0) {
      vendorCustomers.push({
        customerId: c.customerId,
        employerName: c.employerName,
        employerKey: c.employerKey,
        vendorTransactionCount: c.vendorTxns,
        vendorAmountCents: c.vendorAmount,
        totalRemittanceCount: c.totalRemitTxns,
        totalRemittanceAmountCents: c.totalRemitAmount,
        vendorPctOfRemittanceVolume:
          c.totalRemitAmount > 0
            ? (c.vendorAmount / c.totalRemitAmount) * 100
            : 0,
        vendorPctOfRemittanceTxns:
          c.totalRemitTxns > 0
            ? (c.vendorTxns / c.totalRemitTxns) * 100
            : 0,
        latestTransactionDate: c.latestDate,
        inUs: c.inUs,
      });
    }
  }

  // Sort by vendor amount (most prolific first)
  const sortBy = params.get("sortBy") || "vendorAmountCents";
  const sortDir = params.get("sortDir") || "desc";

  vendorCustomers.sort((a, b) => {
    const aVal = a[sortBy as keyof VendorCustomerData] ?? 0;
    const bVal = b[sortBy as keyof VendorCustomerData] ?? 0;

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    const aNum = Number(aVal) || 0;
    const bNum = Number(bVal) || 0;
    return sortDir === "asc" ? aNum - bNum : bNum - aNum;
  });

  // Paginate
  const page = parseInt(params.get("page") || "1");
  const pageSize = parseInt(params.get("pageSize") || "50");
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  const paged = vendorCustomers.slice(start, end);

  return NextResponse.json({
    customers: paged,
    total: vendorCustomers.length,
  });
}
