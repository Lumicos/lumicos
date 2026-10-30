import path from 'node:path';
import { extractText } from '../../files/fileContext.mjs';
import { readDocx, docxBlocksToMarkdown } from '../../files/formats/docx.mjs';
import { readPdf } from '../../files/formats/pdf.mjs';
import { readXlsx, xlsxToMarkdown } from '../../files/formats/xlsx.mjs';
import { rowsToMarkdown } from '../../files/formats/text.mjs';
import { chunkSections, sha256 } from './chunker.mjs';

function markdownSections(text) {
  const sections = [];
  const headings = [];
  let body = [];
  const flush = () => {
    if (body.length) sections.push({ heading: headings.join(' > ') || null, text: body.join('\n') });
    body = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) { body.push(line); continue; }
    flush();
    const level = match[1].length;
    headings.splice(level - 1);
    headings[level - 1] = match[2].trim();
  }
  flush();
  return sections.length ? sections : [{ text }];
}

function docxSections(blocks) {
  const headings = [];
  const sections = [];
  for (const block of blocks) {
    if (block.type === 'title' || block.type === 'heading') {
      const level = block.type === 'title' ? 1 : Math.min(6, (block.level ?? 1) + 1);
      headings.splice(level - 1);
      headings[level - 1] = block.text;
      continue;
    }
    sections.push({ heading: headings.filter(Boolean).join(' > ') || null, text: docxBlocksToMarkdown([block]) });
  }
  return sections;
}

export async function extractDocument(name, buffer, options = {}) {
  const ext = path.extname(name).toLowerCase();
  let sections;
  let metadata;
  let kind;
  if (ext === '.pdf') {
    const pdf = await readPdf(buffer);
    kind = 'pdf';
    sections = pdf.pages.filter((page) => page.hasText)
      .map((page) => ({ page: page.page, text: page.text, metadata: { hasText: true } }));
    metadata = { pages: pdf.numPages, truncated: pdf.truncated,
      scannedPages: pdf.pages.filter((page) => !page.hasText).map((page) => page.page) };
  } else if (ext === '.docx') {
    const docx = await readDocx(buffer);
    kind = 'docx'; sections = docxSections(docx.blocks); metadata = docx.stats;
  } else if (ext === '.xlsx') {
    const workbook = await readXlsx(buffer, { maxRows: options.maxRows ?? 500 });
    kind = 'xlsx';
    sections = workbook.sheets.map((sheet) => ({ heading: `Sheet: ${sheet.name}`,
      text: rowsToMarkdown(sheet.rows.map((row) => row.map((cell) => cell.f ? `${cell.v} (${cell.f})` : cell.v)), { maxRows: 500 }),
      metadata: { sheet: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, truncated: sheet.truncated } }));
    metadata = { sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount })) };
  } else {
    const extracted = await extractText(name, buffer);
    kind = extracted.kind; metadata = extracted.meta;
    sections = kind === 'markdown' ? markdownSections(extracted.text) : [{ text: extracted.text }];
  }
  const chunks = chunkSections(sections, { maxChars: options.maxChars ?? 1800 });
  return { kind, metadata, chunks, contentHash: sha256(buffer) };
}

