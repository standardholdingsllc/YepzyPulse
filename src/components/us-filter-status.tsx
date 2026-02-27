import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import type { ReportStats, InUsFilterMode } from "@/lib/types";

interface UsFilterStatusProps {
  stats: ReportStats;
  filterMode: InUsFilterMode;
}

export function UsFilterStatus({ stats, filterMode }: UsFilterStatusProps) {
  const { customersInUsTrue, customersInUsFalse, customersInUsUnknown } = stats;
  const total = customersInUsTrue + customersInUsFalse + customersInUsUnknown;

  // Calculate what's included/excluded based on filter mode
  let includedCount: number;
  let excludedCount: number;
  let includedLabel: string;
  let excludedLabel: string;

  switch (filterMode) {
    case "strict":
      includedCount = customersInUsTrue;
      excludedCount = customersInUsFalse + customersInUsUnknown;
      includedLabel = "US confirmed";
      excludedLabel = "non-US + unknown";
      break;
    case "lenient":
      includedCount = customersInUsTrue + customersInUsUnknown;
      excludedCount = customersInUsFalse;
      includedLabel = "US + unknown";
      excludedLabel = "non-US";
      break;
    case "all":
    default:
      includedCount = total;
      excludedCount = 0;
      includedLabel = "all customers";
      excludedLabel = "none";
      break;
  }

  const filterModeLabels: Record<InUsFilterMode, string> = {
    strict: "Strict",
    lenient: "Lenient",
    all: "All",
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-sm font-medium text-amber-300">
            US Location Filter:{" "}
            <Badge variant="warning" className="ml-1">
              {filterModeLabels[filterMode]}
            </Badge>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="font-semibold text-emerald-400">
              {formatNumber(customersInUsTrue)}
            </span>
            <span className="text-muted">in US</span>
          </span>

          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="font-semibold text-red-400">
              {formatNumber(customersInUsFalse)}
            </span>
            <span className="text-muted">outside US</span>
          </span>

          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-500" />
            <span className="font-semibold text-muted-light">
              {formatNumber(customersInUsUnknown)}
            </span>
            <span className="text-muted">unknown</span>
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-dark-bg-tertiary/50 px-3 py-2 border border-dark-border">
        <p className="text-xs text-amber-200">
          <span className="font-semibold">Included:</span>{" "}
          <span className="text-emerald-400 font-medium">
            {formatNumber(includedCount)} customers
          </span>{" "}
          ({includedLabel})
          {excludedCount > 0 && (
            <>
              {" · "}
              <span className="font-semibold">Excluded:</span>{" "}
              <span className="text-red-400 font-medium">
                {formatNumber(excludedCount)} customers
              </span>{" "}
              ({excludedLabel})
            </>
          )}
        </p>
        {filterMode === "strict" && customersInUsUnknown > 0 && (
          <p className="mt-1 text-xs text-amber-300/80">
            ⚠️ {formatNumber(customersInUsUnknown)} customers have no location data
            (book/fee-only activity or online merchants). Consider &quot;Lenient&quot; mode
            to include them.
          </p>
        )}
      </div>
    </div>
  );
}
