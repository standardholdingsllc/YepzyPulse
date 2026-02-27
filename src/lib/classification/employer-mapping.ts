/**
 * Employer mapping adapter layer.
 * Supports multiple JSON formats for mapping customer IDs to employers.
 */

export interface EmployerMapping {
  customerId: string;
  employerName: string;
}

/**
 * Normalize an employer name for use as a grouping key.
 * Trims, collapses whitespace, converts to uppercase.
 */
export function normalizeEmployerKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Detect the format of the mapping JSON and parse accordingly.
 * Supports:
 *   (a) Direct dictionary: { "customerId": "employerName" }
 *   (b) Array of records: [{ "customerId": "...", "employerName": "..." }]
 *   (c) Employer-keyed with nested workers:
 *       { "employer123": { "name": "Acme", "workers": ["cust1", "cust2"] } }
 *       or { "employer123": { "name": "Acme", "customerIds": ["cust1"] } }
 */
export function parseEmployerMapping(
  data: unknown
): EmployerMapping[] {
  if (!data) return [];

  // Format (b): Array of records
  if (Array.isArray(data)) {
    return parseArrayFormat(data);
  }

  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length === 0) return [];

    // Check first value to determine format
    const firstVal = obj[keys[0]];

    // Format (a): Direct dictionary { customerId: employerName }
    if (typeof firstVal === "string") {
      return parseDictFormat(obj as Record<string, string>);
    }

    // Format (c): Employer-keyed with nested workers
    if (typeof firstVal === "object" && firstVal !== null) {
      return parseEmployerKeyedFormat(
        obj as Record<string, Record<string, unknown>>
      );
    }
  }

  return [];
}

function parseDictFormat(dict: Record<string, string>): EmployerMapping[] {
  const results: EmployerMapping[] = [];
  for (const [customerId, employerName] of Object.entries(dict)) {
    if (customerId && employerName) {
      results.push({
        customerId: String(customerId).trim(),
        employerName: String(employerName).trim(),
      });
    }
  }
  return results;
}

function parseArrayFormat(arr: unknown[]): EmployerMapping[] {
  const results: EmployerMapping[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    // Try various field name conventions
    const customerId =
      record.customerId ||
      record.customer_id ||
      record.customerID ||
      record.workerId ||
      record.worker_id;
    const employerName =
      record.employerName ||
      record.employer_name ||
      record.employer ||
      record.company ||
      record.companyName;

    if (customerId && employerName) {
      results.push({
        customerId: String(customerId).trim(),
        employerName: String(employerName).trim(),
      });
    }
  }
  return results;
}

function parseEmployerKeyedFormat(
  obj: Record<string, Record<string, unknown>>
): EmployerMapping[] {
  const results: EmployerMapping[] = [];

  for (const [, value] of Object.entries(obj)) {
    if (typeof value !== "object" || value === null) continue;

    const name =
      (value.name as string) ||
      (value.employerName as string) ||
      (value.employer_name as string) ||
      (value.companyName as string) ||
      "Unknown employer";

    const workers: string[] = [];

    // Try various worker list field names
    const workerField =
      value.workers ||
      value.workerIds ||
      value.worker_ids ||
      value.customerIds ||
      value.customer_ids;

    if (Array.isArray(workerField)) {
      for (const w of workerField) {
        if (w) workers.push(String(w).trim());
      }
    }

    for (const workerId of workers) {
      results.push({
        customerId: workerId,
        employerName: String(name).trim(),
      });
    }
  }

  return results;
}

/**
 * Build a lookup map from customer ID to employer info.
 */
export function buildEmployerLookup(
  mappings: EmployerMapping[]
): Map<string, { employerName: string; employerKey: string }> {
  const map = new Map<
    string,
    { employerName: string; employerKey: string }
  >();

  for (const m of mappings) {
    map.set(m.customerId, {
      employerName: m.employerName,
      employerKey: normalizeEmployerKey(m.employerName),
    });
  }

  return map;
}
