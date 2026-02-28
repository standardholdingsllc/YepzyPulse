import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getReportBySlug,
  getEmployerRollups,
  getVendorRollups,
} from "@/lib/queries/reports";
import { formatCents } from "@/lib/parsing/amount";
import { formatNumber } from "@/lib/utils";
import { getVendorInterchangeRate, formatInterchangeRate } from "@/lib/vendor-interchange-rates";
import { VendorEmployerTable } from "./vendor-employer-table";

interface PageProps {
  params: Promise<{ slug: string; vendorName: string }>;
}

export default async function VendorDetailPage({ params }: PageProps) {
  const { slug, vendorName: rawVendorName } = await params;
  const vendorName = decodeURIComponent(rawVendorName);

  const report = await getReportBySlug(slug);
  if (!report || report.status !== "ready") {
    notFound();
  }

  const [allEmployerRollups, vendorRollups] = await Promise.all([
    getEmployerRollups(report.id),
    getVendorRollups(report.id),
  ]);

  // Find the vendor rollup
  const vendorRollup = vendorRollups.find((v) => v.vendorName === vendorName);
  if (!vendorRollup) {
    notFound();
  }

  // Build employer data for this vendor
  const employerVendorData = allEmployerRollups
    .filter((er) => er.vendorBreakdown[vendorName] !== undefined)
    .map((er) => {
      const vd = er.vendorBreakdown[vendorName];
      return {
        employerName: er.employerName,
        employerKey: er.employerKey,
        workerCount: er.workerCount,
        totalRemittanceAmountCents: er.remittanceAmountCents,
        totalRemittanceCount: er.remittanceCount,
        totalDebitCents: er.totalDebitCents,
        vendorAmountCents: vd.amountCents,
        vendorCount: vd.count,
        vendorPctOfRemittanceVolume:
          er.remittanceAmountCents > 0
            ? (vd.amountCents / er.remittanceAmountCents) * 100
            : 0,
        vendorPctOfRemittanceTxns:
          er.remittanceCount > 0
            ? (vd.count / er.remittanceCount) * 100
            : 0,
        vendorPctOfDebit:
          er.totalDebitCents > 0
            ? (vd.amountCents / er.totalDebitCents) * 100
            : 0,
      };
    });

  // Get all other vendor rollups for comparison
  const otherVendors = vendorRollups
    .filter((v) => v.vendorName !== "Not remittance" && v.vendorName !== vendorName)
    .sort((a, b) => b.totalAmountCents - a.totalAmountCents);

  // Global totals for context
  const totalRemittanceVolume = vendorRollups
    .filter((v) => v.vendorName !== "Not remittance")
    .reduce((sum, v) => sum + v.totalAmountCents, 0);

  const vendorShareOfTotal =
    totalRemittanceVolume > 0
      ? (vendorRollup.totalAmountCents / totalRemittanceVolume) * 100
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/r/${slug}`}
          className="text-sm text-muted hover:text-accent transition-colors"
        >
          ← Back to report
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-white">
          {vendorName}
          {getVendorInterchangeRate(vendorName) !== undefined && (
            <span className="ml-3 text-orange-400 text-lg font-semibold">
              {formatInterchangeRate(getVendorInterchangeRate(vendorName)!)}
            </span>
          )}
        </h2>
        <p className="text-sm text-muted">
          Remittance vendor analysis ·{" "}
          {formatNumber(employerVendorData.length)} employers use this vendor
          {getVendorInterchangeRate(vendorName) !== undefined && (
            <> · <span className="text-orange-400">Avg interchange rate</span></>
          )}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <VendorKpi
          label="Total Volume"
          value={formatCents(vendorRollup.totalAmountCents)}
          color="text-violet-400"
        />
        <VendorKpi
          label="Transactions"
          value={formatNumber(vendorRollup.transactionCount)}
        />
        <VendorKpi
          label="Unique Customers"
          value={formatNumber(vendorRollup.uniqueCustomers)}
        />
        <VendorKpi
          label="Employers"
          value={formatNumber(employerVendorData.length)}
        />
        <VendorKpi
          label="Share of All Remittance"
          value={`${vendorShareOfTotal.toFixed(1)}%`}
          color="text-accent"
        />
        <VendorKpi
          label="Avg per Txn"
          value={
            vendorRollup.transactionCount > 0
              ? formatCents(
                  Math.round(
                    vendorRollup.totalAmountCents /
                      vendorRollup.transactionCount
                  )
                )
              : "$0"
          }
        />
      </div>

      {/* Vendor comparison bar */}
      <div className="rounded-xl border border-dark-border bg-dark-bg-secondary/50 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Market Share Comparison
        </h3>
        <div className="space-y-3">
          {/* This vendor */}
          <VendorBar
            name={vendorName}
            amountCents={vendorRollup.totalAmountCents}
            total={totalRemittanceVolume}
            txns={vendorRollup.transactionCount}
            isHighlighted
          />
          {/* Other vendors */}
          {otherVendors.map((v) => (
            <VendorBar
              key={v.vendorName}
              name={v.vendorName}
              amountCents={v.totalAmountCents}
              total={totalRemittanceVolume}
              txns={v.transactionCount}
              slug={slug}
            />
          ))}
        </div>
      </div>

      {/* Employer breakdown table (client component for sort/filter) */}
      <VendorEmployerTable
        data={employerVendorData}
        vendorName={vendorName}
        slug={slug}
      />
    </div>
  );
}

function VendorKpi({
  label,
  value,
  color = "text-white",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-bg-secondary/50 p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function VendorBar({
  name,
  amountCents,
  total,
  txns,
  isHighlighted,
  slug,
}: {
  name: string;
  amountCents: number;
  total: number;
  txns: number;
  isHighlighted?: boolean;
  slug?: string;
}) {
  const pct = total > 0 ? (amountCents / total) * 100 : 0;

  const content = (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span
          className={`font-medium ${isHighlighted ? "text-accent" : "text-muted-light"}`}
        >
          {name}
          {isHighlighted && (
            <span className="ml-2 text-xs text-accent/70">(this vendor)</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-violet-400 font-medium">
            {formatCents(amountCents)}
          </span>
          <span className="tabular-nums text-muted text-xs">
            {formatNumber(txns)} txns · {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-dark-bg-tertiary">
        <div
          className={`h-2 rounded-full transition-all ${isHighlighted ? "bg-accent" : "bg-violet-500/60"}`}
          style={{ width: `${Math.max(pct, 0.5)}%` }}
        />
      </div>
    </div>
  );

  if (slug && !isHighlighted) {
    return (
      <Link
        href={`/r/${slug}/vendor/${encodeURIComponent(name)}`}
        className="block hover:bg-dark-bg-tertiary/30 rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors"
      >
        {content}
      </Link>
    );
  }

  return content;
}
