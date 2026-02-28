import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import type { VendorRollup, EmployerRollup } from "@/lib/types";

// Average interchange rates from vendor data (from vendor-summary.xlsx)
const VENDOR_INTERCHANGE_RATES: Record<string, number> = {
  "Remitly": 0.079,
  "TapTap Send": 1.261,
  "RIA": 1.253,
  "Boss Money": 1.255,
  "Felix": 1.256,
  "Felix Pago": 1.256,
  "MaxiTransfers": 0.572,
  "Omni Money Transfer": 0.501,
  "Viamericas": 0.505,
  "Western Union": 0.062,
  "MoneyGram": 0.073,
  "Uniteller": 1.341,
  "Pangea": 0.018,
  "MyBambu": 0.891,
  "Xoom": 0.035,
  "Tornado Bus": 0.138,
  "WorldRemit": 0.075,
  "Intermex": 0.50, // Estimated based on similar vendors
};

interface VendorSummaryProps {
  rollups: VendorRollup[];
  slug?: string;
  employerRollups?: EmployerRollup[];
}

export function VendorSummary({ rollups, slug, employerRollups }: VendorSummaryProps) {
  const remittanceVendors = rollups.filter(
    (v) => v.vendorName !== "Not remittance"
  );
  const sorted = [...remittanceVendors].sort(
    (a, b) => b.totalAmountCents - a.totalAmountCents
  );

  // Count how many employers use each vendor
  const vendorEmployerCounts: Record<string, number> = {};
  if (employerRollups) {
    for (const er of employerRollups) {
      for (const vendorName of Object.keys(er.vendorBreakdown)) {
        vendorEmployerCounts[vendorName] = (vendorEmployerCounts[vendorName] || 0) + 1;
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Remittance Vendors</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted">No remittance transactions detected</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {sorted.map((v) => {
              const employerCount = vendorEmployerCounts[v.vendorName] || 0;
              const interchangeRate = VENDOR_INTERCHANGE_RATES[v.vendorName];
              const content = (
                <div className={`flex items-center justify-between rounded-lg border border-dark-border bg-dark-bg-tertiary/50 px-4 py-3 transition-all ${slug ? "hover:border-accent/50 hover:bg-accent/5 cursor-pointer" : ""}`}>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {v.vendorName}
                      {interchangeRate !== undefined && (
                        <span className="ml-2 text-orange-400">{interchangeRate.toFixed(2)}%</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {formatNumber(v.transactionCount)} txns · {formatNumber(v.uniqueCustomers)} customers
                      {employerCount > 0 && ` · ${formatNumber(employerCount)} employers`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-violet-400">
                      {formatCents(v.totalAmountCents)}
                    </p>
                    {slug && (
                      <p className="text-xs text-muted">Explore →</p>
                    )}
                  </div>
                </div>
              );

              if (slug) {
                return (
                  <Link
                    key={v.vendorName}
                    href={`/r/${slug}/vendor/${encodeURIComponent(v.vendorName)}`}
                  >
                    {content}
                  </Link>
                );
              }

              return <div key={v.vendorName}>{content}</div>;
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
