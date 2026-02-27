import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getReportBySlug,
  getEmployerRollups,
  getCustomerLocations,
  getTransactions,
} from "@/lib/queries/reports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import { TransactionsTable } from "@/components/transactions-table";

interface PageProps {
  params: Promise<{ slug: string; employerKey: string }>;
}

export default async function EmployerDetailPage({ params }: PageProps) {
  const { slug, employerKey } = await params;
  const decodedKey = decodeURIComponent(employerKey);

  const report = await getReportBySlug(slug);
  if (!report || report.status !== "ready") {
    notFound();
  }

  // Fetch employer data
  const [allRollups, workers, txData] = await Promise.all([
    getEmployerRollups(report.id),
    getCustomerLocations(report.id, decodedKey),
    getTransactions({
      reportId: report.id,
      employerKey: decodedKey,
      page: 1,
      pageSize: 50,
    }),
  ]);

  const rollup = allRollups.find((r) => r.employerKey === decodedKey);
  if (!rollup) {
    notFound();
  }

  const vendorEntries = Object.entries(rollup.vendorBreakdown).sort(
    ([, a], [, b]) => b.amountCents - a.amountCents
  );

  const transactionGroups = Object.keys(report.stats.transactionGroupCounts || {});
  const vendorNames = Object.keys(report.stats.vendorMatchCounts || {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/r/${slug}`}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← Back to report
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">
          {rollup.employerName}
        </h2>
        <p className="text-sm text-gray-500">
          {formatNumber(rollup.workerCount)} workers · {formatNumber(rollup.transactionCount)} transactions
        </p>
      </div>

      {/* Employer KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Workers" value={formatNumber(rollup.workerCount)} />
        <StatCard label="Total Debit" value={formatCents(rollup.totalDebitCents)} color="text-red-600" />
        <StatCard label="Total Credit" value={formatCents(rollup.totalCreditCents)} color="text-green-600" />
        <StatCard label="Card Spend" value={formatCents(rollup.cardAmountCents)} color="text-blue-600" />
        <StatCard label="ATM" value={formatCents(rollup.atmAmountCents)} color="text-amber-600" />
        <StatCard label="Remittance" value={formatCents(rollup.remittanceAmountCents)} color="text-purple-600" />
      </div>

      {/* Two columns: Workers + Vendor Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workers */}
        <Card>
          <CardHeader>
            <CardTitle>Workers ({formatNumber(workers.length)})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Customer ID</th>
                  <th className="px-4 py-3 font-medium text-gray-600">US Status</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Latest Location</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Txns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {workers.map((w) => (
                  <tr key={w.customerId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {w.customerId}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          w.inUs === "true"
                            ? "success"
                            : w.inUs === "false"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {w.inUs === "true"
                          ? "In US"
                          : w.inUs === "false"
                            ? "Outside US"
                            : "Unknown"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {w.latestLocationRaw || "No location data"}
                      {w.latestLocationDate && (
                        <span className="ml-1 text-gray-400">
                          ({new Date(w.latestLocationDate).toLocaleDateString()})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(w.transactionCount)}
                    </td>
                  </tr>
                ))}
                {workers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                      No workers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Vendor Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Remittance Vendor Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {vendorEntries.length === 0 ? (
              <p className="text-sm text-gray-400">No remittance transactions</p>
            ) : (
              <div className="space-y-3">
                {vendorEntries.map(([vendor, data]) => (
                  <div
                    key={vendor}
                    className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{vendor}</p>
                      <p className="text-xs text-gray-500">
                        {formatNumber(data.count)} transactions
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-purple-600">
                      {formatCents(data.amountCents)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Transaction type breakdown */}
            <h4 className="mt-6 mb-3 text-sm font-semibold text-gray-700">
              Transaction Types
            </h4>
            <div className="space-y-2">
              {[
                { label: "Card", count: rollup.cardCount, amount: rollup.cardAmountCents },
                { label: "ATM", count: rollup.atmCount, amount: rollup.atmAmountCents },
                { label: "Fee", count: rollup.feeCount, amount: rollup.feeAmountCents },
                { label: "Book/Payment", count: rollup.bookCount, amount: rollup.bookAmountCents },
              ].filter(item => item.count > 0).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-gray-600">{item.label} ({formatNumber(item.count)})</span>
                  <span className="font-medium tabular-nums">{formatCents(item.amount)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transactions for this employer */}
      <TransactionsTable
        reportId={report.id}
        initialTransactions={txData.transactions}
        initialTotal={txData.total}
        transactionGroups={transactionGroups}
        vendorNames={vendorNames}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-gray-900",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
