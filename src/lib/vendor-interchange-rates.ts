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
  "Remitly": 0.079,
  "RIA": 1.253,
  "Felix": 1.256,
  "Felix Pago": 1.256,
  "TapTap Send": 1.261,
  "Western Union": 0.062,
  "MoneyGram": 0.073,
  "Uniteller": 1.341,
  "Intermex": 0.50,
  "Pangea": 0.018,
  "Xoom": 0.035,
  "WorldRemit": 0.075,
  "Wise": 0.10, // Estimated
  "Sendwave": 0.50, // Estimated
  "Sigue": 0.50, // Estimated
  
  // Lower-volume vendors from xlsx
  "Boss Money": 1.255,
  "MaxiTransfers": 0.572,
  "Omni Money Transfer": 0.501,
  "Viamericas": 0.505,
  "MyBambu": 0.891,
  "Tornado Bus": 0.138,
  
  // Unknown/generic
  "Remittance (Unknown)": 0.306,
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
