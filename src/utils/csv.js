/**
 * CSV EXPORT
 *
 * Shared "build a CSV and trigger a browser download" helper -- Excel opens
 * a .csv file natively, so this covers both "export as CSV" and "export as
 * Excel" asks without a spreadsheet-writing dependency. Used anywhere a
 * dashboard needs to hand someone a roster/registration list (club members,
 * club applications, event rosters, ...).
 */

export function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
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
