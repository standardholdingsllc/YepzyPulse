import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getReportBySlug,
  getEmployerRollups,
  getVendorRollups,
  getTransactions,
} from "@/lib/queries/reports";
import { KpiCards } from "@/components/kpi-cards";
import { EmployersTable } from "@/components/employers-table";
import { VendorSummary } from "@/components/vendor-summary";
import { TransactionsTable } from "@/components/transactions-table";
import { ShareLink } from "@/components/share-link";
import { UsFilterStatus } from "@/components/us-filter-status";
import { ExpiryNotice } from "@/components/expiry-notice";
import type { InUsFilterMode } from "@/lib/types";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ReportPage({ params }: PageProps) {
  const { slug } = await params;
  const report = await getReportBySlug(slug);

  if (!report) {
    notFound();
  }

  if (report.status === "processing") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <svg className="mb-4 h-10 w-10 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <p className="text-lg font-medium text-gray-600">Report is processing...</p>
        <p className="mt-2 text-sm text-gray-400">This page will refresh automatically.</p>
        <meta httpEquiv="refresh" content="5" />
      </div>
    );
  }

  if (report.status === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <h2 className="text-lg font-semibold text-red-700">Report Generation Failed</h2>
        <p className="mt-2 text-sm text-red-600">{report.errorMessage || "Unknown error"}</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
          ← Generate a new report
        </Link>
      </div>
    );
  }

  // Fetch all data in parallel
  const [employerRollups, vendorRollups, initialTxData] = await Promise.all([
    getEmployerRollups(report.id),
    getVendorRollups(report.id),
    getTransactions({ reportId: report.id, page: 1, pageSize: 50 }),
  ]);

  const transactionGroups = Object.keys(report.stats.transactionGroupCounts || {});
  const vendorNames = Object.keys(report.stats.vendorMatchCounts || {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
              ← Back
            </Link>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            {report.title || "Transaction Report"}
          </h2>
          <p className="text-sm text-gray-500">
            Generated {new Date(report.createdAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            US Filter: <span className="font-medium">{report.inUsFilter}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ShareLink slug={slug} />
          <ExpiryNotice expiresAt={report.expiresAt} />
        </div>
      </div>

      {/* US Filter Status - explicit counts */}
      <UsFilterStatus
        stats={report.stats}
        filterMode={report.inUsFilter as InUsFilterMode}
      />

      {/* KPI Cards */}
      <KpiCards stats={report.stats} vendorRollups={vendorRollups} />

      {/* Two-column: Vendors + top info */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <VendorSummary rollups={vendorRollups} />
        </div>
        <div className="lg:col-span-2">
          <TransactionGroupSummary stats={report.stats} />
        </div>
      </div>

      {/* Employers Table */}
      <EmployersTable rollups={employerRollups} slug={slug} />

      {/* Transactions Table */}
      <TransactionsTable
        reportId={report.id}
        initialTransactions={initialTxData.transactions}
        initialTotal={initialTxData.total}
        transactionGroups={transactionGroups}
        vendorNames={vendorNames}
      />
    </div>
  );
}

function TransactionGroupSummary({ stats }: { stats: { transactionGroupCounts: Record<string, number> } }) {
  const groups = Object.entries(stats.transactionGroupCounts || {}).sort(
    ([, a], [, b]) => b - a
  );

  const total = groups.reduce((sum, [, count]) => sum + count, 0);

  const colors: Record<string, string> = {
    Card: "bg-blue-500",
    ATM: "bg-amber-500",
    Fee: "bg-red-500",
    "Book/Payment": "bg-green-500",
    "Transfer/Other": "bg-gray-500",
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Types</h3>
      <div className="space-y-3">
        {groups.map(([group, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          const color = colors[group] || "bg-gray-400";
          return (
            <div key={group}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">{group}</span>
                <span className="tabular-nums text-gray-500">
                  {count.toLocaleString()} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
                <div
                  className={`h-2 rounded-full ${color}`}
                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
