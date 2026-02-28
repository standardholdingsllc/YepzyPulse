import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getReportBySlug,
  getEmployerRollups,
  getVendorRollups,
} from "@/lib/queries/reports";
import { formatCents } from "@/lib/parsing/amount";
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
    // Check chunk progress from stats
    const stats = report.stats as { processingChunks?: number; currentChunk?: number } | null;
    const totalChunks = stats?.processingChunks || 0;
    const currentChunk = stats?.currentChunk || 0;
    const isChunkedProcessing = totalChunks > 1;
    
    // For chunked processing, extend the timeout threshold per chunk
    // Each chunk gets ~4 minutes, so total allowed = chunks * 4 min
    const STALE_THRESHOLD_MS = isChunkedProcessing 
      ? Math.max(10 * 60 * 1000, totalChunks * 4 * 60 * 1000) // At least 10 min, or 4 min per chunk
      : 6 * 60 * 1000; // 6 minutes for non-chunked
    
    const processingStarted = report.processingStartedAt
      ? new Date(report.processingStartedAt).getTime()
      : new Date(report.createdAt).getTime();
    const elapsedMs = Date.now() - processingStarted;
    const isStale = elapsedMs > STALE_THRESHOLD_MS;

    if (isStale) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center max-w-md">
            <svg className="mx-auto mb-4 h-12 w-12 text-red-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-xl font-semibold text-red-400 mb-2">Processing Timed Out</h2>
            <p className="text-sm text-red-300 mb-4">
              Your file was too large to process within the time limit.
            </p>
            <p className="text-xs text-muted mb-4">
              Processing started {Math.round(elapsedMs / 60000)} minutes ago
              {isChunkedProcessing && ` (chunk ${currentChunk}/${totalChunks})`}.
            </p>
            <Link href="/" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors">
              ← Try again
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-8 text-center max-w-md">
          <svg className="mx-auto mb-4 h-12 w-12 animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <h2 className="text-xl font-semibold text-white mb-2">Processing Your Report</h2>
          <p className="text-sm text-muted-light mb-4">
            {isChunkedProcessing 
              ? `Processing large file in chunks (${currentChunk}/${totalChunks})...`
              : "Your CSV file is being processed in the background."
            }
          </p>
          {isChunkedProcessing && (
            <div className="mb-4">
              <div className="h-2 w-full rounded-full bg-dark-bg-tertiary overflow-hidden">
                <div 
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${Math.round((currentChunk / totalChunks) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {Math.round((currentChunk / totalChunks) * 100)}% complete
              </p>
            </div>
          )}
          <div className="flex items-center justify-center gap-2 text-xs text-muted">
            <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            <span>Auto-refreshing every 5 seconds...</span>
          </div>
        </div>
        <meta httpEquiv="refresh" content="5" />
      </div>
    );
  }

  if (report.status === "error") {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
        <h2 className="text-lg font-semibold text-red-400">Report Generation Failed</h2>
        <p className="mt-2 text-sm text-red-300">{report.errorMessage || "Unknown error"}</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          ← Generate a new report
        </Link>
      </div>
    );
  }

  // Fetch rollup data in parallel (transactions are loaded client-side from blob)
  const [employerRollups, vendorRollups] = await Promise.all([
    getEmployerRollups(report.id),
    getVendorRollups(report.id),
  ]);

  const transactionGroups = Object.keys(report.stats.transactionGroupCounts || {});
  const vendorNames = Object.keys(report.stats.vendorMatchCounts || {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-sm text-muted hover:text-accent transition-colors">
              ← Back
            </Link>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-white">
            {report.title || "Transaction Report"}
          </h2>
          <p className="text-sm text-muted">
            Generated {new Date(report.createdAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            US Filter: <span className="font-medium text-accent">{report.inUsFilter}</span>
            {report.stats.locationRecencyDays > 0 && (
              <>
                {" · "}
                Location Window: <span className="font-medium text-accent">{report.stats.locationRecencyDays} days</span>
              </>
            )}
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
          <VendorSummary rollups={vendorRollups} slug={slug} employerRollups={employerRollups} />
        </div>
        <div className="lg:col-span-2">
          <TransactionGroupSummary stats={report.stats} />
        </div>
      </div>

      {/* Employers Table */}
      <EmployersTable rollups={employerRollups} slug={slug} vendorRollups={vendorRollups} />

      {/* Transactions Table */}
      <TransactionsTable
        reportId={report.id}
        slug={slug}
        transactionGroups={transactionGroups}
        vendorNames={vendorNames}
      />
    </div>
  );
}

function TransactionGroupSummary({ stats }: { stats: { transactionGroupCounts: Record<string, number>; transactionGroupAmounts?: Record<string, number> } }) {
  const groups = Object.entries(stats.transactionGroupCounts || {}).sort(
    ([, a], [, b]) => b - a
  );
  const amounts = stats.transactionGroupAmounts || {};

  const total = groups.reduce((sum, [, count]) => sum + count, 0);

  const colors: Record<string, string> = {
    Card: "bg-accent",
    ATM: "bg-amber-500",
    "ATM Fee": "bg-red-500",
    Fee: "bg-red-500",
    "Book/Payment": "bg-emerald-500",
    "Transfer/Other": "bg-violet-500",
  };

  return (
    <div className="rounded-xl border border-dark-border bg-dark-bg-secondary/50 p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Transaction Types</h3>
      <div className="space-y-3">
        {groups.map(([group, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          const color = colors[group] || "bg-gray-500";
          const amountCents = amounts[group] || 0;
          return (
            <div key={group}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-muted-light">{group}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-violet-400 font-medium">
                    {formatCents(amountCents)}
                  </span>
                  <span className="tabular-nums text-muted">
                    {count.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-dark-bg-tertiary">
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
