"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import type { EmployerRollup, VendorRollup } from "@/lib/types";

interface EmployersTableProps {
  rollups: EmployerRollup[];
  slug: string;
  vendorRollups?: VendorRollup[];
}

type SortKey =
  | "employerName"
  | "workerCount"
  | "transactionCount"
  | "totalDebitCents"
  | "totalCreditCents"
  | "cardAmountCents"
  | "atmAmountCents"
  | "feeAmountCents"
  | "bookAmountCents"
  | "remittanceAmountCents"
  | "remittanceCount"
  | "vendorAmount";

function getTopVendor(rollup: EmployerRollup): { name: string; amountCents: number; count: number } | null {
  const entries = Object.entries(rollup.vendorBreakdown);
  if (entries.length === 0) return null;
  let top = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i][1].amountCents > top[1].amountCents) {
      top = entries[i];
    }
  }
  return { name: top[0], amountCents: top[1].amountCents, count: top[1].count };
}

function getVendorData(rollup: EmployerRollup, vendorName: string): { amountCents: number; count: number } | null {
  const data = rollup.vendorBreakdown[vendorName];
  return data || null;
}

const baseColumns: { key: SortKey; label: string; align?: string }[] = [
  { key: "employerName", label: "Employer" },
  { key: "workerCount", label: "Workers", align: "right" },
  { key: "transactionCount", label: "Txns", align: "right" },
  { key: "totalDebitCents", label: "Debit Total", align: "right" },
  { key: "cardAmountCents", label: "Card", align: "right" },
  { key: "atmAmountCents", label: "ATM", align: "right" },
  { key: "feeAmountCents", label: "ATM Fees", align: "right" },
  { key: "remittanceAmountCents", label: "Remittance $", align: "right" },
  { key: "remittanceCount", label: "Remit. #", align: "right" },
];

export function EmployersTable({ rollups, slug, vendorRollups }: EmployersTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("remittanceAmountCents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterRemittance, setFilterRemittance] = useState<"all" | "yes" | "no">("all");
  const [vendorFilter, setVendorFilter] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Get all unique vendor names from employer rollups
  const vendorNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rollups) {
      for (const vn of Object.keys(r.vendorBreakdown)) {
        names.add(vn);
      }
    }
    // Sort by total amount from vendorRollups if available
    const arr = Array.from(names);
    if (vendorRollups) {
      const amountMap = new Map(vendorRollups.map((v) => [v.vendorName, v.totalAmountCents]));
      arr.sort((a, b) => (amountMap.get(b) || 0) - (amountMap.get(a) || 0));
    } else {
      arr.sort();
    }
    return arr;
  }, [rollups, vendorRollups]);

  // Build columns dynamically (add vendor column when filtered)
  const columns = useMemo(() => {
    const cols = [...baseColumns];
    if (vendorFilter) {
      // Insert vendor-specific column before Remittance $
      const remIdx = cols.findIndex((c) => c.key === "remittanceAmountCents");
      cols.splice(remIdx, 0, {
        key: "vendorAmount" as SortKey,
        label: `${vendorFilter} $`,
        align: "right",
      });
    }
    return cols;
  }, [vendorFilter]);

  const filtered = useMemo(() => {
    let data = [...rollups];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter((r) => r.employerName.toLowerCase().includes(q));
    }

    // Filter by remittance
    if (filterRemittance === "yes") {
      data = data.filter((r) => r.remittanceCount > 0);
    } else if (filterRemittance === "no") {
      data = data.filter((r) => r.remittanceCount === 0);
    }

    // Filter by vendor
    if (vendorFilter) {
      data = data.filter((r) => r.vendorBreakdown[vendorFilter] !== undefined);
    }

    // Sort
    data.sort((a, b) => {
      if (sortKey === "vendorAmount" && vendorFilter) {
        const aAmt = a.vendorBreakdown[vendorFilter]?.amountCents || 0;
        const bAmt = b.vendorBreakdown[vendorFilter]?.amountCents || 0;
        return sortDir === "asc" ? aAmt - bAmt : bAmt - aAmt;
      }

      const aVal = a[sortKey as keyof EmployerRollup];
      const bVal = b[sortKey as keyof EmployerRollup];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const aNum = Number(aVal) || 0;
      const bNum = Number(bVal) || 0;
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });

    return data;
  }, [rollups, search, sortKey, sortDir, filterRemittance, vendorFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
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
                Employers ({formatNumber(filtered.length)})
              </CardTitle>
            </button>
          </div>
          {!isCollapsed && (
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Search employers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <select
                value={vendorFilter}
                onChange={(e) => {
                  setVendorFilter(e.target.value);
                  if (e.target.value) {
                    setSortKey("vendorAmount");
                    setSortDir("desc");
                  }
                }}
                className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white focus:border-accent focus:outline-none"
              >
                <option value="">All vendors</option>
                {vendorNames.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <select
                value={filterRemittance}
                onChange={(e) => setFilterRemittance(e.target.value as "all" | "yes" | "no")}
                className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white focus:border-accent focus:outline-none"
              >
                <option value="all">All employers</option>
                <option value="yes">Has remittance</option>
                <option value="no">No remittance</option>
              </select>
            </div>
          )}
        </div>
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border bg-dark-bg-tertiary/50 text-left">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium text-muted hover:text-white transition-colors ${
                      col.align === "right" ? "text-right" : ""
                    } ${col.key === "vendorAmount" ? "text-accent" : ""}`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}{" "}
                    <span className="text-xs text-muted/50">
                      {sortIcon(col.key)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {filtered.map((r) => {
                const topVendor = getTopVendor(r);
                const vendorData = vendorFilter ? getVendorData(r, vendorFilter) : null;

                return (
                  <tr
                    key={r.employerKey}
                    className="table-row-hover transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/r/${slug}/employer/${encodeURIComponent(r.employerKey)}`}
                        className="font-medium text-accent hover:text-accent-light hover:underline"
                      >
                        {r.employerName}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.workersInUs > 0 && (
                          <Badge variant="success">{r.workersInUs} in US</Badge>
                        )}
                        {r.workersNotInUs > 0 && (
                          <Badge variant="danger">{r.workersNotInUs} outside</Badge>
                        )}
                        {r.workersUnknownUs > 0 && (
                          <Badge variant="warning">{r.workersUnknownUs} unknown</Badge>
                        )}
                        {topVendor && !vendorFilter && (
                          <Badge variant="info">{topVendor.name}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                      {formatNumber(r.workerCount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                      {formatNumber(r.transactionCount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-white">
                      {formatCents(r.totalDebitCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                      {formatCents(r.cardAmountCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                      {formatCents(r.atmAmountCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                      {formatCents(r.feeAmountCents)}
                    </td>
                    {vendorFilter && (
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-accent">
                        {vendorData
                          ? formatCents(vendorData.amountCents)
                          : <span className="text-muted/50">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-violet-400">
                      {r.remittanceAmountCents > 0
                        ? formatCents(r.remittanceAmountCents)
                        : <span className="text-muted/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                      {r.remittanceCount > 0 ? formatNumber(r.remittanceCount) : <span className="text-muted/50">—</span>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                    No employers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      )}

      {isCollapsed && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted">
            Click header to expand • {formatNumber(rollups.length)} employers
          </p>
        </CardContent>
      )}
    </Card>
  );
}
