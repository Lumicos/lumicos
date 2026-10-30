// XLSX support without Microsoft Excel, using exceljs.
// Note: exceljs does not calculate formulas. Values of formulas come from the
// cached results Excel saved; new files are flagged so Excel recalculates on open.
import ExcelJS from 'exceljs';
import { rowsToMarkdown } from './text.mjs';

/** Converts an exceljs cell value to { v, f? } (display value + optional formula). */
function cellOut(value) {
  if (value == null) return { v: '' };
  if (value instanceof Date) return { v: value.toISOString().slice(0, 10) };
  if (typeof value !== 'object') return { v: value };
  if ('formula' in value || 'sharedFormula' in value) {
    const f = `=${value.formula ?? value.sharedFormula}`;
    const r = value.result;
    const v = r == null ? '' : r instanceof Date ? r.toISOString().slice(0, 10) : typeof r === 'object' ? (r.error ?? '') : r;
    return { v, f };
  }
  if ('richText' in value) return { v: value.richText.map((t) => t.text).join('') };
  if ('text' in value) return { v: value.text };
  if ('error' in value) return { v: value.error };
  return { v: String(value) };
}

/** Converts an input value into what exceljs should store ("=SUM(A1:A3)" -> formula). */
function cellIn(value) {
  if (typeof value === 'string' && value.startsWith('=') && value.length > 1) return { formula: value.slice(1) };
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value ?? null;
}

async function load(buf) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new Error('This file is not a valid .xlsx workbook.');
  }
  return wb;
}

/**
 * @returns {{ sheets: { name, rowCount, columnCount, rows: {v,f?}[][], truncated }[] }}
 */
export async function readXlsx(buf, { maxRows = 200, maxCols = 30, sheet } = {}) {
  const wb = await load(buf);
  const sheets = [];
  wb.eachSheet((ws) => {
    if (sheet && ws.name !== sheet) return;
    const rowCount = ws.actualRowCount ? ws.rowCount : 0;
    const columnCount = Math.min(ws.columnCount, maxCols);
    const rows = [];
    for (let r = 1; r <= Math.min(ws.rowCount, maxRows); r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= columnCount; c++) cells.push(cellOut(row.getCell(c).value));
      rows.push(cells);
    }
    // Drop trailing empty rows.
    while (rows.length && rows[rows.length - 1].every((c) => c.v === '' && !c.f)) rows.pop();
    sheets.push({ name: ws.name, rowCount, columnCount: ws.columnCount, rows, truncated: ws.rowCount > maxRows });
  });
  if (sheet && !sheets.length) throw new Error(`Sheet "${sheet}" not found. Sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`);
  return { sheets };
}

export function xlsxToMarkdown({ sheets }, { maxRows = 60 } = {}) {
  return sheets
    .map((s) => {
      const rows = s.rows.map((r, i) => (i === 0 ? r.map((c) => c.v) : r.map((c) => (c.f ? (c.v === '' ? c.f : `${c.v} (${c.f})`) : c.v))));
      return `## Sheet: ${s.name} (${s.rowCount} rows × ${s.columnCount} columns)\n\n${rows.length ? rowsToMarkdown(rows, { maxRows }) : '(empty)'}${s.truncated ? '\n… more rows not shown' : ''}`;
    })
    .join('\n\n');
}

function styleSheet(ws, { header = true } = {}) {
  if (header && ws.rowCount >= 1) {
    const first = ws.getRow(1);
    first.font = { bold: true };
    first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF5' } };
    first.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  // Width from content (roughly), 8–50 characters.
  ws.columns.forEach((col) => {
    let max = 8;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cellOut(cell.value);
      max = Math.max(max, String(v.f && v.v === '' ? v.f : v.v).length + 2);
    });
    col.width = Math.min(50, max);
  });
}

function addRows(ws, rows) {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new Error('"rows" must be an array of arrays.');
  for (const r of rows) ws.addRow(r.map(cellIn));
}

const TOTAL_FORMULA = /^(SUM|AVERAGE|COUNT|COUNTA|MIN|MAX)\(([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)\)$/i;

/** Last row, if it is a totals row like =SUM(B2:B9) covering the rows right above it. */
function findTotalsRow(ws) {
  const last = ws.actualRowCount ? ws.lastRow?.number : 0;
  if (!last || last < 3) return null;
  let found = false;
  ws.getRow(last).eachCell((cell) => {
    const f = cell.value && typeof cell.value === 'object' ? cell.value.formula : null;
    const m = f && TOTAL_FORMULA.exec(f);
    if (m && Number(m[5]) === last - 1) found = true;
  });
  return found ? last : null;
}

/**
 * Adds rows. position 'auto' (default): above a totals row if the sheet ends with one,
 * extending its SUM/AVERAGE/... ranges; otherwise at the end. 'end': always at the end.
 */
function addRowsSmart(ws, rows, position = 'auto') {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new Error('"rows" must be an array of arrays.');
  const totals = position === 'end' ? null : findTotalsRow(ws);
  if (!totals) {
    addRows(ws, rows);
    return 'at the end';
  }
  ws.insertRows(totals, rows.map((r) => r.map(cellIn)));
  const moved = totals + rows.length;
  ws.getRow(moved).eachCell((cell) => {
    const f = cell.value && typeof cell.value === 'object' ? cell.value.formula : null;
    const m = f && TOTAL_FORMULA.exec(f);
    if (m) cell.value = { formula: `${m[1]}(${m[2]}${m[3]}:${m[4]}${Number(m[5]) + rows.length})` };
  });
  return `above the totals row (row ${moved})`;
}

function validSheetName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Sheet name is required.');
  if (name.length > 31 || /[\\/?*[\]:]/.test(name)) throw new Error(`Invalid sheet name "${name}" (max 31 characters, no \\ / ? * [ ] :).`);
  return name;
}

/**
 * sheets: [{ name, rows: any[][], header?: boolean }]
 * Strings starting with "=" become formulas; "YYYY-MM-DD" strings become dates.
 */
export async function createXlsx({ sheets }) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('"sheets" must be a non-empty array.');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PersonalAI';
  wb.calcProperties.fullCalcOnLoad = true;
  for (const s of sheets) {
    const ws = wb.addWorksheet(validSheetName(s.name ?? 'Sheet1'));
    addRows(ws, s.rows ?? []);
    styleSheet(ws, { header: s.header !== false });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Operations:
 *   { op: 'add_rows', sheet, rows, position?: 'auto' | 'end' }
 *   { op: 'update_cells', sheet, cells: { "B3": 120, "C3": "=SUM(C2:C3)" } }
 *   { op: 'add_sheet', name, rows? }
 *   { op: 'rename_sheet', from, to }
 */
export async function editXlsx(buf, operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('"operations" must be a non-empty array.');
  const wb = await load(buf);
  wb.calcProperties.fullCalcOnLoad = true;
  const report = [];
  const sheetOf = (name, i) => {
    const ws = name ? wb.getWorksheet(name) : wb.worksheets[0];
    if (!ws) throw new Error(`Operation ${i}: sheet "${name}" not found. Sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`);
    return ws;
  };

  for (const [i, op] of operations.entries()) {
    switch (op?.op) {
      case 'add_rows': {
        const ws = sheetOf(op.sheet, i);
        const where = addRowsSmart(ws, op.rows, op.position);
        report.push(`Added ${op.rows.length} row(s) to "${ws.name}" ${where}`);
        break;
      }
      case 'update_cells': {
        const ws = sheetOf(op.sheet, i);
        const entries = Object.entries(op.cells ?? {});
        if (!entries.length) throw new Error(`Operation ${i}: "cells" is empty.`);
        for (const [addr, value] of entries) {
          if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/i.test(addr)) throw new Error(`Operation ${i}: invalid cell address "${addr}".`);
          ws.getCell(addr.toUpperCase()).value = cellIn(value);
        }
        report.push(`Updated ${entries.length} cell(s) in "${ws.name}"`);
        break;
      }
      case 'add_sheet': {
        const name = validSheetName(op.name);
        if (wb.getWorksheet(name)) throw new Error(`Operation ${i}: sheet "${name}" already exists.`);
        const ws = wb.addWorksheet(name);
        if (op.rows) addRows(ws, op.rows);
        styleSheet(ws, { header: op.header !== false });
        report.push(`Added sheet "${name}"`);
        break;
      }
      case 'rename_sheet': {
        const ws = sheetOf(op.from, i);
        const to = validSheetName(op.to);
        if (wb.getWorksheet(to)) throw new Error(`Operation ${i}: sheet "${to}" already exists.`);
        report.push(`Renamed sheet "${ws.name}" to "${to}"`);
        ws.name = to;
        break;
      }
      default:
        throw new Error(`Operation ${i}: unknown op "${op?.op}". Use add_rows, update_cells, add_sheet or rename_sheet.`);
    }
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), report };
}
