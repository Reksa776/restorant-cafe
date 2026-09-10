// ============================================================
// Shared CSV helpers — used by every report export route
// (sales, products, shift-sales, payments, multi-outlet).
//
// - RFC 4180-compatible escaping (commas, double quotes, CR/LF)
// - UTF-8 BOM (\uFEFF) so Excel opens Indonesian text correctly
// - CRLF (Windows) line endings for maximum spreadsheet compatibility
// ============================================================

/** Escape a single CSV field per RFC 4180. Null/undefined → empty cell. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
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