/**
 * Average interchange rates by remittance vendor.
 * Data source: vendor-summary.xlsx
 * 
 * These rates represent the average interchange fee percentage
 * that Yepzy earns on transactions through each vendor.
 */

// Map vendor names (as they appear in classification) to interchange rates
export const VENDOR_INTERCHANGE_RATES: Record<string, number> = {
  // High-volume vendors
  "Remitly": 0.072,
  "RIA": 1.268,
  "Felix": 0.066,
  "Felix Pago": 0.066,
  "TapTap Send": 0.038,
  "Western Union": 0.058,
  "MoneyGram": 0.073,
  "Uniteller": 1.338,
  "Intermex": 0.50,
  "Pangea": 0.009,
  "Xoom": 0.058,
  "WorldRemit": 0.063,
  "Wise": 0.10, // Estimated
  "Sendwave": 0.50, // Estimated
  "Sigue": 0.50, // Estimated
  
  // Lower-volume vendors from xlsx
  "Boss Money": 1.246,
  "MaxiTransfers": 0.575,
  "Omni Money Transfer": 0.501,
  "Viamericas": 0.575,
  "MyBambu": 0.891,
  "Tornado Bus": 0.239,
  
  // Unknown/generic
  "Remittance (Unknown)": 0.397,
};

/**
 * Get the interchange rate for a vendor name.
 * Returns undefined if vendor is not in the map.
 */
export function getVendorInterchangeRate(vendorName: string): number | undefined {
  return VENDOR_INTERCHANGE_RATES[vendorName];
}

/**
 * Format interchange rate as percentage string (e.g., "0.08%")
 */
export function formatInterchangeRate(rate: number): string {
  return `${rate.toFixed(2)}%`;
}
