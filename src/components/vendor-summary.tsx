import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import { getVendorInterchangeRate, formatInterchangeRate } from "@/lib/vendor-interchange-rates";
import type { VendorRollup, EmployerRollup } from "@/lib/types";

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
              const interchangeRate = getVendorInterchangeRate(v.vendorName);
              const content = (
                <div className={`flex items-center justify-between rounded-lg border border-dark-border bg-dark-bg-tertiary/50 px-4 py-3 transition-all ${slug ? "hover:border-accent/50 hover:bg-accent/5 cursor-pointer" : ""}`}>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {v.vendorName}
                      {interchangeRate !== undefined && (
                        <span className="ml-2 text-orange-400">{formatInterchangeRate(interchangeRate)}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {formatNumber(v.transactionCount)} txns · {formatNumber(v.uniqueCustomers)} customers
                      {employerCount > 0 && ` · ${formatNumber(employerCount)} employers`}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-violet-400">
                    {formatCents(v.totalAmountCents)}
                  </p>
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
