import { Card, CardContent } from "@/components/ui/card";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import type { ReportStats, VendorRollup } from "@/lib/types";

interface KpiCardsProps {
  stats: ReportStats;
  vendorRollups: VendorRollup[];
}

export function KpiCards({ stats, vendorRollups }: KpiCardsProps) {
  const totalRemittanceAmount = vendorRollups
    .filter((v) => v.vendorName !== "Not remittance")
    .reduce((sum, v) => sum + v.totalAmountCents, 0);

  const totalRemittanceTxns = vendorRollups
    .filter((v) => v.vendorName !== "Not remittance")
    .reduce((sum, v) => sum + v.transactionCount, 0);

  // Volume-based remittance rate: remittance $ / total debit $
  const remittanceRatePct =
    stats.totalDebitCents > 0
      ? (stats.totalRemittanceAmountCents / stats.totalDebitCents) * 100
      : stats.remittanceMatchRate * 100; // fallback for older reports

  const kpis = [
    {
      label: "Total Transactions",
      value: formatNumber(stats.totalRows),
      sub: `${stats.totalCustomers} customers`,
      color: "text-white",
    },
    {
      label: "Customers in US",
      value: formatNumber(stats.customersInUsTrue),
      sub: `${stats.customersInUsFalse} outside, ${stats.customersInUsUnknown} unknown`,
      color: "text-emerald-400",
    },
    {
      label: "Employers",
      value: formatNumber(stats.totalEmployers),
      sub: `${stats.unknownEmployerCount} unmapped txns`,
      color: "text-accent",
    },
    {
      label: "Remittance Volume",
      value: formatCents(totalRemittanceAmount),
      sub: `${formatNumber(totalRemittanceTxns)} transactions`,
      color: "text-violet-400",
    },
    {
      label: "Book/Payment",
      value: formatCents(stats.totalBookAmountCents || 0),
      sub: `${formatNumber(stats.transactionGroupCounts?.["Book/Payment"] || 0)} transactions`,
      color: "text-emerald-400",
    },
    {
      label: "Remittance Rate",
      value: `${remittanceRatePct.toFixed(1)}%`,
      sub: "of debit volume",
      color: "text-blue-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="overflow-hidden">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted truncate">
              {kpi.label}
            </p>
            <p className={`mt-1 text-xl font-bold ${kpi.color} truncate`}>
              {kpi.value}
            </p>
            <p className="mt-0.5 text-xs text-muted/70 truncate">{kpi.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
