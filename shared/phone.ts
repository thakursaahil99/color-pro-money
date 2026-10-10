/**
 * Normalises an Indian mobile number to its 10-digit form.
 * Accepts "98765 43210", "+91 98765-43210", "919876543210", "09876543210".
 * Returns null if it is not a valid mobile number.
 */
export function normalizeMobile(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "9876543210" -> "98******10" (for display to admins and the owner only). */
export function maskMobile(m: string | null | undefined): string {
  return m ? `${m.slice(0, 2)}******${m.slice(-2)}` : "-";
}
