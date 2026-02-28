"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";

export interface VendorEmployerData {
  employerName: string;
  employerKey: string;
  workerCount: number;
  totalRemittanceAmountCents: number;
  totalRemittanceCount: number;
  totalDebitCents: number;
  vendorAmountCents: number;
  vendorCount: number;
  vendorPctOfRemittanceVolume: number;
  vendorPctOfRemittanceTxns: number;
  vendorPctOfDebit: number;
}

interface VendorEmployerTableProps {
  data: VendorEmployerData[];
  vendorName: string;
  slug: string;
}

type SortKey =
  | "employerName"
  | "workerCount"
  | "vendorAmountCents"
  | "vendorCount"
  | "vendorPctOfRemittanceVolume"
  | "vendorPctOfRemittanceTxns"
  | "totalRemittanceAmountCents"
  | "totalDebitCents";

const columns: { key: SortKey; label: string; align?: string }[] = [
  { key: "employerName", label: "Employer" },
  { key: "workerCount", label: "Workers", align: "right" },
  { key: "vendorAmountCents", label: "Vendor $", align: "right" },
  { key: "vendorCount", label: "Vendor Txns", align: "right" },
  { key: "vendorPctOfRemittanceVolume", label: "% of Remit $", align: "right" },
  { key: "vendorPctOfRemittanceTxns", label: "% of Remit #", align: "right" },
  { key: "totalRemittanceAmountCents", label: "Total Remit $", align: "right" },
  { key: "totalDebitCents", label: "Total Debit", align: "right" },
];

export function VendorEmployerTable({
  data,
  vendorName,
  slug,
}: VendorEmployerTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("vendorAmountCents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showPerformance, setShowPerformance] = useState<
    "all" | "overperforming" | "underperforming"
  >("all");

  // Average vendor % across all employers (weighted by remittance volume)
  const avgVendorPct = useMemo(() => {
    const totalVendorAmt = data.reduce((s, d) => s + d.vendorAmountCents, 0);
    const totalRemitAmt = data.reduce(
      (s, d) => s + d.totalRemittanceAmountCents,
      0
    );
    return totalRemitAmt > 0 ? (totalVendorAmt / totalRemitAmt) * 100 : 0;
  }, [data]);

  const filtered = useMemo(() => {
    let items = [...data];

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((d) =>
        d.employerName.toLowerCase().includes(q)
      );
    }

    if (showPerformance === "overperforming") {
      items = items.filter(
        (d) => d.vendorPctOfRemittanceVolume > avgVendorPct
      );
    } else if (showPerformance === "underperforming") {
      items = items.filter(
        (d) => d.vendorPctOfRemittanceVolume < avgVendorPct
      );
    }

    items.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const aNum = Number(aVal) || 0;
      const bNum = Number(bVal) || 0;
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });

    return items;
  }, [data, search, sortKey, sortDir, showPerformance, avgVendorPct]);

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
          <div>
            <CardTitle>
              Employers Using {vendorName} ({formatNumber(filtered.length)})
            </CardTitle>
            <p className="mt-1 text-xs text-muted">
              Average {vendorName} share of remittance volume:{" "}
              <span className="font-medium text-accent">
                {avgVendorPct.toFixed(1)}%
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search employers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <select
              value={showPerformance}
              onChange={(e) =>
                setShowPerformance(
                  e.target.value as "all" | "overperforming" | "underperforming"
                )
              }
              className="rounded-lg border border-dark-border bg-dark-bg-tertiary px-3 py-1.5 text-sm text-white focus:border-accent focus:outline-none"
            >
              <option value="all">All employers</option>
              <option value="overperforming">
                Above avg ({avgVendorPct.toFixed(0)}%+)
              </option>
              <option value="underperforming">
                Below avg (&lt;{avgVendorPct.toFixed(0)}%)
              </option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {filtered.map((d) => {
              const isAboveAvg =
                d.vendorPctOfRemittanceVolume > avgVendorPct;

              return (
                <tr
                  key={d.employerKey}
                  className="table-row-hover transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/r/${slug}/employer/${encodeURIComponent(d.employerKey)}`}
                      className="font-medium text-accent hover:text-accent-light hover:underline"
                    >
                      {d.employerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                    {formatNumber(d.workerCount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-violet-400">
                    {formatCents(d.vendorAmountCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                    {formatNumber(d.vendorCount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1 tabular-nums font-medium ${
                        isAboveAvg ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {isAboveAvg ? "▲" : "▼"}{" "}
                      {d.vendorPctOfRemittanceVolume.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                    {d.vendorPctOfRemittanceTxns.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                    {formatCents(d.totalRemittanceAmountCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-light">
                    {formatCents(d.totalDebitCents)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-muted"
                >
                  No employers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
