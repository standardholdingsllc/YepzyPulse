"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";

interface VendorMatchEvidence {
  vendor: string;
  matchedKeyword: string;
  matchedField: "summary" | "counterpartyName" | "both";
  matchPosition: number;
}

interface Transaction {
  id: number;
  rawCreatedAt: string | null;
  unitId: string;
  unitType: string;
  amountCents: number;
  direction: string;
  summary: string;
  customerId: string;
  counterpartyName: string;
  transactionGroup: string;
  remittanceVendor: string;
  vendorMatchEvidence?: VendorMatchEvidence | null;
  employerName: string;
  employerKey: string;
  locationRaw: string | null;
  locationCountry: string | null;
  customerInUs: string;
}

interface TransactionsTableProps {
  reportId: string;
  initialTransactions: Transaction[];
  initialTotal: number;
  transactionGroups: string[];
  vendorNames: string[];
}

export function TransactionsTable({
  reportId,
  initialTransactions,
  initialTotal,
  transactionGroups,
  vendorNames,
}: TransactionsTableProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState({
    transactionGroup: "",
    remittanceVendor: "",
    inUs: "",
    employerKey: "",
  });

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const fetchData = useCallback(async (pageNum: number, currentFilters: typeof filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        reportId,
        page: String(pageNum),
        pageSize: String(pageSize),
      });

      if (currentFilters.transactionGroup) {
        params.set("transactionGroup", currentFilters.transactionGroup);
      }
      if (currentFilters.remittanceVendor) {
        params.set("remittanceVendor", currentFilters.remittanceVendor);
      }
      if (currentFilters.inUs) {
        params.set("inUs", currentFilters.inUs);
      }

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const data = await res.json();
      setTransactions(data.transactions);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (page === 1 && !filters.transactionGroup && !filters.remittanceVendor && !filters.inUs) {
      return;
    }
    fetchData(page, filters);
  }, [page, filters, fetchData]);

  const handleFilterChange = (key: string, value: string) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleRowExpand = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
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
            <CardTitle>Transactions ({formatNumber(total)})</CardTitle>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDebug}
                onChange={(e) => setShowDebug(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-dark-border accent-accent"
              />
              Debug
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filters.transactionGroup}
              onChange={(e) => handleFilterChange("transactionGroup", e.target.value)}
              className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white focus:border-accent focus:outline-none"
            >
              <option value="">All types</option>
              {transactionGroups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              value={filters.remittanceVendor}
              onChange={(e) => handleFilterChange("remittanceVendor", e.target.value)}
              className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white focus:border-accent focus:outline-none"
            >
              <option value="">All vendors</option>
              {vendorNames.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              value={filters.inUs}
              onChange={(e) => handleFilterChange("inUs", e.target.value)}
              className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white focus:border-accent focus:outline-none"
            >
              <option value="">All locations</option>
              <option value="true">In US</option>
              <option value="false">Outside US</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <svg className="h-6 w-6 animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}
        {!loading && (
          <>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border bg-dark-bg-tertiary/50 text-left">
                  {showDebug && (
                    <th className="whitespace-nowrap px-2 py-3 font-medium text-muted w-8"></th>
                  )}
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Date</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted text-right">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Dir</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Customer</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Employer</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Vendor</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Location</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-muted">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border">
                {transactions.map((tx) => {
                  const isExpanded = expandedRows.has(tx.id);
                  const hasEvidence = tx.vendorMatchEvidence && tx.remittanceVendor !== "Not remittance";

                  return (
                    <>
                      <tr key={tx.id} className="table-row-hover">
                        {showDebug && (
                          <td className="px-2 py-3">
                            {hasEvidence && (
                              <button
                                onClick={() => toggleRowExpand(tx.id)}
                                className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-dark-bg-tertiary hover:text-white"
                                title="Show match evidence"
                              >
                                <svg
                                  className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            )}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                          {formatDate(tx.rawCreatedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              tx.transactionGroup === "Card"
                                ? "info"
                                : tx.transactionGroup === "ATM"
                                  ? "warning"
                                  : tx.transactionGroup === "Fee"
                                    ? "danger"
                                    : "default"
                            }
                          >
                            {tx.transactionGroup}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-white">
                          {formatCents(tx.amountCents)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              tx.direction === "Debit"
                                ? "text-red-400"
                                : "text-emerald-400"
                            }
                          >
                            {tx.direction}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs font-mono text-muted-light">
                          {tx.customerId}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-light">
                          {tx.employerName}
                        </td>
                        <td className="px-4 py-3">
                          {tx.remittanceVendor !== "Not remittance" ? (
                            <Badge variant="info">{tx.remittanceVendor}</Badge>
                          ) : (
                            <span className="text-xs text-muted/50">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          {tx.locationCountry ? (
                            <Badge
                              variant={
                                tx.customerInUs === "true"
                                  ? "success"
                                  : tx.customerInUs === "false"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {tx.locationRaw || tx.locationCountry}
                            </Badge>
                          ) : (
                            <span className="text-muted/50">—</span>
                          )}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3 text-xs text-muted" title={tx.summary}>
                          {tx.summary || "—"}
                        </td>
                      </tr>
                      {/* Debug row - vendor match evidence */}
                      {showDebug && isExpanded && hasEvidence && (
                        <tr key={`${tx.id}-debug`} className="bg-dark-bg-tertiary/30">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="rounded-md bg-dark-bg-tertiary px-3 py-2 font-mono text-xs border border-dark-border">
                              <div className="flex flex-wrap gap-4">
                                <div>
                                  <span className="text-muted">vendor:</span>{" "}
                                  <span className="text-violet-400 font-semibold">
                                    {tx.vendorMatchEvidence?.vendor}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted">keyword:</span>{" "}
                                  <span className="text-emerald-400 font-semibold">
                                    &quot;{tx.vendorMatchEvidence?.matchedKeyword}&quot;
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted">field:</span>{" "}
                                  <span className="text-accent">
                                    {tx.vendorMatchEvidence?.matchedField}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted">pos:</span>{" "}
                                  <span className="text-amber-400">
                                    {tx.vendorMatchEvidence?.matchPosition}
                                  </span>
                                </div>
                              </div>
                              {tx.summary && (
                                <div className="mt-2 pt-2 border-t border-dark-border">
                                  <span className="text-muted">summary:</span>{" "}
                                  <HighlightedSummary
                                    summary={tx.summary}
                                    keyword={tx.vendorMatchEvidence?.matchedKeyword || ""}
                                    field={tx.vendorMatchEvidence?.matchedField || "summary"}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={showDebug ? 10 : 9} className="px-4 py-8 text-center text-muted">
                      No transactions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-dark-border px-4 py-3">
                <p className="text-xs text-muted">
                  Page {page} of {formatNumber(totalPages)} · {formatNumber(total)} total
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
    </Card>
  );
}

/**
 * Highlights the matched keyword in the summary text
 */
function HighlightedSummary({
  summary,
  keyword,
  field,
}: {
  summary: string;
  keyword: string;
  field: string;
}) {
  if (field === "counterpartyName" || !keyword) {
    return <span className="text-muted-light">{summary}</span>;
  }

  const lowerSummary = summary.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const idx = lowerSummary.indexOf(lowerKeyword);

  if (idx === -1) {
    return <span className="text-muted-light">{summary}</span>;
  }

  const before = summary.slice(0, idx);
  const match = summary.slice(idx, idx + keyword.length);
  const after = summary.slice(idx + keyword.length);

  return (
    <span className="text-muted-light">
      {before}
      <span className="bg-accent/30 text-accent-light px-0.5 rounded">{match}</span>
      {after}
    </span>
  );
}
