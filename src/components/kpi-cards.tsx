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

  const kpis = [
    {
      label: "Total Transactions",
      value: formatNumber(stats.totalRows),
      sub: `${stats.totalCustomers} customers`,
      color: "text-white",
      accent: "bg-dark-bg-tertiary",
    },
    {
      label: "Customers in US",
      value: formatNumber(stats.customersInUsTrue),
      sub: `${stats.customersInUsFalse} outside, ${stats.customersInUsUnknown} unknown`,
      color: "text-emerald-400",
      accent: "bg-emerald-500/10",
    },
    {
      label: "Employers",
      value: formatNumber(stats.totalEmployers),
      sub: `${stats.unknownEmployerCount} unmapped txns`,
      color: "text-accent",
      accent: "bg-accent/10",
    },
    {
      label: "Remittance Volume",
      value: formatCents(totalRemittanceAmount),
      sub: `${formatNumber(totalRemittanceTxns)} transactions`,
      color: "text-violet-400",
      accent: "bg-violet-500/10",
    },
    {
      label: "Locations Parsed",
      value: formatNumber(stats.rowsWithLocations),
      sub: `${((stats.rowsWithLocations / Math.max(stats.totalRows, 1)) * 100).toFixed(1)}% of transactions`,
      color: "text-amber-400",
      accent: "bg-amber-500/10",
    },
    {
      label: "Remittance Rate",
      value: `${(stats.remittanceMatchRate * 100).toFixed(1)}%`,
      sub: "of all transactions",
      color: "text-blue-400",
      accent: "bg-blue-500/10",
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
