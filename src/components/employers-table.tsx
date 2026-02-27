"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import type { EmployerRollup } from "@/lib/types";

interface EmployersTableProps {
  rollups: EmployerRollup[];
  slug: string;
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
  | "remittanceCount";

const columns: { key: SortKey; label: string; align?: string }[] = [
  { key: "employerName", label: "Employer" },
  { key: "workerCount", label: "Workers", align: "right" },
  { key: "transactionCount", label: "Txns", align: "right" },
  { key: "totalDebitCents", label: "Debit Total", align: "right" },
  { key: "cardAmountCents", label: "Card", align: "right" },
  { key: "atmAmountCents", label: "ATM", align: "right" },
  { key: "feeAmountCents", label: "Fees", align: "right" },
  { key: "remittanceAmountCents", label: "Remittance $", align: "right" },
  { key: "remittanceCount", label: "Remit. #", align: "right" },
];

export function EmployersTable({ rollups, slug }: EmployersTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("remittanceAmountCents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterRemittance, setFilterRemittance] = useState<"all" | "yes" | "no">("all");

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

    // Sort
    data.sort((a, b) => {
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

    return data;
  }, [rollups, search, sortKey, sortDir, filterRemittance]);

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
          <CardTitle>Employers ({formatNumber(filtered.length)})</CardTitle>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search employers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <select
              value={filterRemittance}
              onChange={(e) => setFilterRemittance(e.target.value as "all" | "yes" | "no")}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All employers</option>
              <option value="yes">Has remittance</option>
              <option value="no">No remittance</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium text-gray-600 hover:text-gray-900 ${
                    col.align === "right" ? "text-right" : ""
                  }`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}{" "}
                  <span className="text-xs text-gray-400">
                    {sortIcon(col.key)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r) => (
              <tr
                key={r.employerKey}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/r/${slug}/employer/${encodeURIComponent(r.employerKey)}`}
                    className="font-medium text-brand-600 hover:text-brand-800 hover:underline"
                  >
                    {r.employerName}
                  </Link>
                  <div className="mt-0.5 flex gap-1">
                    {r.workersInUs > 0 && (
                      <Badge variant="success">{r.workersInUs} in US</Badge>
                    )}
                    {r.workersNotInUs > 0 && (
                      <Badge variant="danger">{r.workersNotInUs} outside</Badge>
                    )}
                    {r.workersUnknownUs > 0 && (
                      <Badge variant="warning">{r.workersUnknownUs} unknown</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatNumber(r.workerCount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatNumber(r.transactionCount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {formatCents(r.totalDebitCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(r.cardAmountCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(r.atmAmountCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(r.feeAmountCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-purple-600">
                  {r.remittanceAmountCents > 0
                    ? formatCents(r.remittanceAmountCents)
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.remittanceCount > 0 ? formatNumber(r.remittanceCount) : "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400">
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
