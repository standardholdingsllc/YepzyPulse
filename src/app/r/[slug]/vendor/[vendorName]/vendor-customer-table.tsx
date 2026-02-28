"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";

interface VendorCustomerData {
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

interface VendorCustomerTableProps {
  slug: string;
  vendorName: string;
}

type SortKey =
  | "customerId"
  | "employerName"
  | "vendorAmountCents"
  | "vendorTransactionCount"
  | "vendorPctOfRemittanceVolume"
  | "totalRemittanceAmountCents";

const columns: { key: SortKey; label: string; align?: string }[] = [
  { key: "customerId", label: "Customer ID" },
  { key: "employerName", label: "Employer" },
  { key: "vendorAmountCents", label: "Vendor $", align: "right" },
  { key: "vendorTransactionCount", label: "Vendor Txns", align: "right" },
  { key: "vendorPctOfRemittanceVolume", label: "% of Remit", align: "right" },
  { key: "totalRemittanceAmountCents", label: "Total Remit $", align: "right" },
];

export function VendorCustomerTable({ slug, vendorName }: VendorCustomerTableProps) {
  const [customers, setCustomers] = useState<VendorCustomerData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vendorAmountCents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const pageSize = 25;
  const totalPages = Math.ceil(total / pageSize);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        slug,
        vendor: vendorName,
        page: String(page),
        pageSize: String(pageSize),
        sortBy: sortKey,
        sortDir,
      });

      const res = await fetch(`/api/vendor-customers?${params.toString()}`);
      const data = await res.json();

      setCustomers(data.customers || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch vendor customers:", err);
    } finally {
      setLoading(false);
    }
  }, [slug, vendorName, page, sortKey, sortDir]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  // Client-side search filter
  const filtered = search.trim()
    ? customers.filter(
        (c) =>
          c.customerId.toLowerCase().includes(search.toLowerCase()) ||
          c.employerName.toLowerCase().includes(search.toLowerCase())
      )
    : customers;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center gap-2 group"
            >
              <svg
                className={`h-4 w-4 text-muted group-hover:text-white transition-all ${isCollapsed ? "" : "rotate-90"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <CardTitle className="cursor-pointer group-hover:text-accent transition-colors">
                Top Customers ({formatNumber(total)})
              </CardTitle>
            </button>
          </div>
          {!isCollapsed && (
            <input
              type="text"
              placeholder="Search by ID or employer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
            />
          )}
        </div>
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg
                className="h-6 w-6 animate-spin text-accent"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          ) : (
            <>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border bg-dark-bg-tertiary/50 text-left">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium text-muted hover:text-white transition-colors ${
                          col.align === "right" ? "text-right" : ""
                        }`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}{" "}
                        <span className="text-xs text-muted/50">
                          {sortIcon(col.key)}
                        </span>
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">
                      US Status
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">
                      Last Txn
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-border">
                  {filtered.map((c, idx) => (
                    <tr key={c.customerId} className="table-row-hover transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted/50 w-6">
                            #{(page - 1) * pageSize + idx + 1}
                          </span>
                          <span className="font-mono text-xs text-muted-light">
                            {c.customerId}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/r/${slug}/employer/${encodeURIComponent(c.employerKey)}`}
                          className="text-sm text-accent hover:text-accent-light hover:underline"
                        >
                          {c.employerName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-violet-400">
                        {formatCents(c.vendorAmountCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                        {formatNumber(c.vendorTransactionCount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`tabular-nums font-medium ${
                            c.vendorPctOfRemittanceVolume >= 80
                              ? "text-emerald-400"
                              : c.vendorPctOfRemittanceVolume >= 50
                                ? "text-accent"
                                : "text-muted-light"
                          }`}
                        >
                          {c.vendorPctOfRemittanceVolume.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                        {formatCents(c.totalRemittanceAmountCents)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            c.inUs === "true"
                              ? "success"
                              : c.inUs === "false"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {c.inUs === "true"
                            ? "In US"
                            : c.inUs === "false"
                              ? "Outside"
                              : "Unknown"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {formatDate(c.latestTransactionDate)}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-muted"
                      >
                        No customers found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-dark-border px-4 py-3">
                  <p className="text-xs text-muted">
                    Page {page} of {formatNumber(totalPages)} · {formatNumber(total)} customers
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1}
                      className="rounded-md border border-dark-border bg-dark-bg-tertiary px-3 py-1 text-xs font-medium text-white hover:bg-dark-border disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages}
                      className="rounded-md border border-dark-border bg-dark-bg-tertiary px-3 py-1 text-xs font-medium text-white hover:bg-dark-border disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}

      {isCollapsed && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted">
            Click header to expand · {formatNumber(total)} customers use {vendorName}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
