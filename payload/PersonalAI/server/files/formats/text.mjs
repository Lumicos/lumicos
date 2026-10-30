// Plain text, Markdown, CSV and JSON helpers.

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text, { maxRows = Infinity } = {}) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const delimiter = detectDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) return rows;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 500);
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

export function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? '' : String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Markdown table from rows (first row = header). Pipes and newlines are escaped. */
export function rowsToMarkdown(rows, { maxRows = 50 } = {}) {
  if (!rows.length) return '(empty)';
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const pad = (r) => Array.from({ length: width }, (_, i) => cell(r[i]));
  const [head, ...body] = rows;
  const shown = body.slice(0, maxRows);
  const lines = [`| ${pad(head).join(' | ')} |`, `| ${pad(head).map(() => '---').join(' | ')} |`, ...shown.map((r) => `| ${pad(r).join(' | ')} |`)];
  if (body.length > shown.length) lines.push(`… ${body.length - shown.length} more rows`);
  return lines.join('\n');
}
