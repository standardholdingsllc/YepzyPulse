/**
 * Parse a timestamp string into a Date object (UTC).
 * Handles ISO 8601 and various Unit export formats.
 * Returns null for unparseable values.
 */
export function parseTimestamp(raw: string | null | undefined): Date | null {
  if (raw == null || raw.trim() === "") return null;

  const trimmed = raw.trim();

  // Try ISO 8601 first
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try common alternative formats
  // MM/DD/YYYY HH:MM:SS
  const mdyMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?/
  );
  if (mdyMatch) {
    const [, month, day, year, hour, minute, second] = mdyMatch;
    const d = new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second || "0")
      )
    );
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Format a Date to a human-readable UTC string.
 */
export function formatTimestamp(date: Date | null): string {
  if (!date) return "N/A";
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
