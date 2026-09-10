// ============================================================
// Shared CSV helpers — used by every report export route
// (sales, products, shift-sales, payments, multi-outlet).
//
// - RFC 4180-compatible escaping (commas, double quotes, CR/LF)
// - UTF-8 BOM (\uFEFF) so Excel opens Indonesian text correctly
// - CRLF (Windows) line endings for maximum spreadsheet compatibility
// ============================================================

/**
 * Escape a single CSV field per RFC 4180. Null/undefined → empty cell.
 *
 * Formula-injection guard: a TEXT cell that starts with `=`, `+`, `-`, `@`
 * (or tab/CR) is prefixed with a single quote so Excel/LibreOffice never
 * evaluates it as a formula. Numeric cells are passed as JS numbers and are
 * never touched, so negative values survive unchanged.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Guard spreadsheet-formula injection on text fields only.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(str)) {
    const guarded = `'${str}`;
    return /[",\n\r]/.test(guarded)
      ? `"${guarded.replace(/"/g, '""')}"`
      : guarded;
  }
  // Quote when the value contains a comma, quote, or newline.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a complete CSV document: UTF-8 BOM + header row + data rows,
 * CRLF line endings, and every cell escaped via `csvCell`.
 */
export function buildCsv(
  header: Array<string | number | null | undefined>,
  rows: Array<Array<string | number | null | undefined>>
): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}