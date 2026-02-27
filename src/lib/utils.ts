import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a random slug for reports.
 */
export function generateSlug(length = 10): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let result = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/**
 * Format large numbers with commas.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
