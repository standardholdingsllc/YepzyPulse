import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import type { VendorRollup } from "@/lib/types";

interface VendorSummaryProps {
  rollups: VendorRollup[];
}

export function VendorSummary({ rollups }: VendorSummaryProps) {
  const remittanceVendors = rollups.filter(
    (v) => v.vendorName !== "Not remittance"
  );
  const sorted = [...remittanceVendors].sort(
    (a, b) => b.totalAmountCents - a.totalAmountCents
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Remittance Vendors</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted">No remittance transactions detected</p>
        ) : (
          <div className="space-y-3">
            {sorted.map((v) => (
              <div
                key={v.vendorName}
                className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-bg-tertiary/50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {v.vendorName}
                  </p>
                  <p className="text-xs text-muted">
                    {formatNumber(v.transactionCount)} txns · {formatNumber(v.uniqueCustomers)} customers
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-violet-400">
                  {formatCents(v.totalAmountCents)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
