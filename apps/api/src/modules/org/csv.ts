/**
 * Minimal CSV parsing/escaping utilities for candidate import (CPF-35).
 *
 * Deliberately small: handles RFC4180-style quoting (quoted fields, doubled
 * quotes, embedded commas) without pulling in a dependency for two columns.
 */

/** Strips a UTF-8 byte-order-mark if present (common from Excel exports). */
export function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Splits into non-empty logical lines, tolerant of \r\n and \n line endings. */
export function splitCsvLines(text: string): string[] {
  return stripBom(text)
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Defends against CSV/formula injection if this value is ever re-exported to
 * a spreadsheet later: values that would be interpreted as a formula by
 * Excel/Sheets are prefixed with a leading apostrophe, matching the standard
 * mitigation (OWASP CSV Injection).
 */
export function neutraliseCsvFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}
