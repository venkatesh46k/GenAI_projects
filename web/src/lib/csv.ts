/** One field, quoted only when it needs to be (a comma, quote or newline forces RFC 4180 quoting). */
function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds a CSV from column {header, value} pairs and triggers a browser download. Client-side only: nothing is sent
 * to the server, so this works on whatever the console already has fetched and rendered. */
export function downloadCsv(filename: string, columns: string[], rows: unknown[][]): void {
  const lines = [columns.map(csvField).join(","), ...rows.map((row) => row.map(csvField).join(","))];
  // A UTF-8 BOM so Excel (which guesses the encoding otherwise) shows ₹ correctly instead of mangling it.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link); // some browsers only honour `download` on a link that is actually in the page
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
