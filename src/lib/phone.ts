// ============================================================
// Phone Number Normalization
// ============================================================
// Handles Indonesian phone number formats:
//   081234567890  → 6281234567890
//   +6281234567890 → 6281234567890
//   6281234567890  → 6281234567890
//   81234567890    → 6281234567890
// ============================================================

/**
 * Normalize an Indonesian phone number to international format (62XXXXXXXXXXX).
 * Returns null if the input is empty/null/undefined.
 * Returns null if the input is invalid after normalization.
 */
export function normalizePhone(
  phone: string | null | undefined
): string | null {
  if (!phone || typeof phone !== "string") {
    return null;
  }

  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, "");

  // Empty after stripping
  if (digits.length === 0) {
    return null;
  }

  // Remove leading + if present (already stripped by \D)
  // Remove leading 00 (international prefix)
  if (digits.startsWith("00")) {
    digits = digits.substring(2);
  }

  // If starts with 62, it's already international format
  if (digits.startsWith("62")) {
    // Validate minimum length (62 + at least 8 digits for Indonesian mobile)
    if (digits.length < 10) {
      return null;
    }
    return digits;
  }

  // If starts with 0, replace with 62 (local to international)
  if (digits.startsWith("0")) {
    digits = "62" + digits.substring(1);
    // Validate minimum length
    if (digits.length < 10) {
      return null;
    }
    return digits;
  }

  // If starts with 8, assume Indonesian and prepend 62
  if (digits.startsWith("8")) {
    digits = "62" + digits;
    // Validate minimum length
    if (digits.length < 10) {
      return null;
    }
    return digits;
  }

  // Any other format — reject
  return null;
}

/**
 * Validate if a phone number is a valid Indonesian mobile number.
 * Must be in normalized format (62XXXXXXXXXXX).
 */
export function isValidIndonesianPhone(phone: string): boolean {
  // Must start with 628 (Indonesian mobile) and be 10-13 digits
  return /^628\d{8,10}$/.test(phone);
}

/**
 * Format phone number for display.
 * 6281234567890 → +62 812-3456-7890
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return phone;

  // Format: +62 XXX-XXXX-XXXX
  const local = normalized.substring(2); // Remove 62
  if (local.length >= 11) {
    const part1 = local.substring(0, 3);
    const part2 = local.substring(3, 7);
    const part3 = local.substring(7);
    return `+62 ${part1}-${part2}-${part3}`;
  }
  return `+62 ${local}`;
}
