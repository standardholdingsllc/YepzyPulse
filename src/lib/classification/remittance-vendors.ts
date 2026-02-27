/**
 * Remittance vendor classification.
 * Applies keyword rules to summary and counterpartyName fields.
 * Records match evidence for debugging misclassifications.
 */

export interface RemittanceVendorRule {
  vendor: string;
  keywords: string[];
  exclusions?: string[]; // Keywords that, if present, disqualify the match
}

export interface VendorMatchEvidence {
  vendor: string;
  matchedKeyword: string;
  matchedField: "summary" | "counterpartyName" | "both";
  matchPosition: number;
}

export const DEFAULT_REMITTANCE_VENDOR_RULES: RemittanceVendorRule[] = [
  // Specific patterns first (more precise matches)
  {
    vendor: "Remitly",
    keywords: ["rmtly*", "rmtly_flx*", "remitly.com", "remitly"],
  },
  {
    vendor: "Felix",
    keywords: ["felix pago", "felixpago.com", "felixpago"],
    exclusions: [],
  },
  {
    vendor: "RIA",
    keywords: ["ria financial services", "ria money transfer", "ria financial", "ria money", "ria envia"],
    exclusions: ["criteria", "material", "victoria", "gloria", "maria"],
  },
  {
    vendor: "Western Union",
    keywords: ["wu digital usa", "western union", "wu "],
    exclusions: ["western union bank"],
  },
  {
    vendor: "MoneyGram",
    keywords: ["moneygram us online", "moneygram", "money gram"],
  },
  {
    vendor: "Pangea",
    keywords: ["pangea money transfer", "pangea"],
  },
  {
    vendor: "Boss Money",
    keywords: ["boss money", "www.idt.net"],
  },
  {
    vendor: "TapTap Send",
    keywords: ["taptap send"],
  },
  {
    vendor: "Uniteller",
    keywords: ["servicio uniteller", "uniteller"],
  },
  {
    vendor: "Intermex",
    keywords: ["intermex", "inter mex"],
  },
  {
    vendor: "Xoom",
    keywords: ["xoom"],
    exclusions: ["zoom"], // Avoid matching Zoom video calls
  },
  {
    vendor: "Wise",
    keywords: ["wise.com", "transferwise", "wise payment"],
    exclusions: ["otherwise", "likewise", "clockwise"],
  },
  {
    vendor: "Sendwave",
    keywords: ["sendwave"],
  },
  {
    vendor: "WorldRemit",
    keywords: ["worldremit", "world remit"],
  },
  {
    vendor: "Sigue",
    keywords: ["sigue corp", "sigue money"],
    exclusions: ["consigue"], // Spanish word meaning "gets/obtains"
  },
  {
    vendor: "Remittance (Unknown)",
    keywords: ["remittance", "remesa", "envio de dinero", "money transfer"],
    exclusions: [],
  },
];

export interface VendorClassificationResult {
  vendor: string;
  evidence: VendorMatchEvidence | null;
}

/**
 * Classify a transaction as a remittance vendor based on summary and
 * counterpartyName fields. Returns both the vendor name and match evidence.
 */
export function classifyRemittanceVendorWithEvidence(
  summary: string | null | undefined,
  counterpartyName: string | null | undefined,
  rules: RemittanceVendorRule[] = DEFAULT_REMITTANCE_VENDOR_RULES
): VendorClassificationResult {
  const summaryLower = (summary || "").toLowerCase();
  const counterpartyLower = (counterpartyName || "").toLowerCase();
  const combinedText = `${summaryLower} ${counterpartyLower}`;

  if (!combinedText.trim()) {
    return { vendor: "Not remittance", evidence: null };
  }

  for (const rule of rules) {
    // Check exclusions first
    const hasExclusion = (rule.exclusions || []).some((ex) =>
      combinedText.includes(ex.toLowerCase())
    );
    if (hasExclusion) continue;

    // Find matching keyword and which field it matched in
    for (const keyword of rule.keywords) {
      const kwLower = keyword.toLowerCase();
      const summaryPos = summaryLower.indexOf(kwLower);
      const counterpartyPos = counterpartyLower.indexOf(kwLower);

      if (summaryPos >= 0 || counterpartyPos >= 0) {
        let matchedField: "summary" | "counterpartyName" | "both";
        let matchPosition: number;

        if (summaryPos >= 0 && counterpartyPos >= 0) {
          matchedField = "both";
          matchPosition = summaryPos;
        } else if (summaryPos >= 0) {
          matchedField = "summary";
          matchPosition = summaryPos;
        } else {
          matchedField = "counterpartyName";
          matchPosition = counterpartyPos;
        }

        return {
          vendor: rule.vendor,
          evidence: {
            vendor: rule.vendor,
            matchedKeyword: keyword,
            matchedField,
            matchPosition,
          },
        };
      }
    }
  }

  return { vendor: "Not remittance", evidence: null };
}

/**
 * Simple classification without evidence (for backward compatibility).
 */
export function classifyRemittanceVendor(
  summary: string | null | undefined,
  counterpartyName: string | null | undefined,
  rules: RemittanceVendorRule[] = DEFAULT_REMITTANCE_VENDOR_RULES
): string {
  return classifyRemittanceVendorWithEvidence(summary, counterpartyName, rules).vendor;
}

/**
 * Fast classification without creating evidence objects.
 * Used in hot path for large file processing.
 */
export function classifyRemittanceVendorFast(
  summary: string | null | undefined,
  counterpartyName: string | null | undefined,
  rules: RemittanceVendorRule[] = DEFAULT_REMITTANCE_VENDOR_RULES
): string {
  const summaryLower = (summary || "").toLowerCase();
  const counterpartyLower = (counterpartyName || "").toLowerCase();
  
  if (!summaryLower && !counterpartyLower) {
    return "Not remittance";
  }

  for (const rule of rules) {
    // Check exclusions first
    let hasExclusion = false;
    if (rule.exclusions) {
      for (const ex of rule.exclusions) {
        const exLower = ex.toLowerCase();
        if (summaryLower.includes(exLower) || counterpartyLower.includes(exLower)) {
          hasExclusion = true;
          break;
        }
      }
    }
    if (hasExclusion) continue;

    // Check keywords
    for (const keyword of rule.keywords) {
      const kwLower = keyword.toLowerCase();
      if (summaryLower.includes(kwLower) || counterpartyLower.includes(kwLower)) {
        return rule.vendor;
      }
    }
  }

  return "Not remittance";
}