// FileContextService: turns a file into text the model can use, without
// dumping huge documents into the context window.
//   small file  -> whole content
//   large file  -> split into chunks; return the chunk asked for, the chunks
//                  most relevant to a query, or the first part + a table of parts.
// The ranker is replaceable (embeddings / semantic search later).
import path from 'node:path';
import { bm25Scores } from '../memory/text.mjs';
import { docxBlocksToMarkdown, readDocx } from './formats/docx.mjs';
import { parseCsv, rowsToMarkdown } from './formats/text.mjs';
import { readXlsx, xlsxToMarkdown } from './formats/xlsx.mjs';
import { readPdf, pdfToText } from './formats/pdf.mjs';

export const SUPPORTED_EXTS = ['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.docx', '.xlsx', '.pdf'];

/** Default ranker: keyword BM25. Swap for an embedding ranker with the same signature. */
export const keywordRanker = {
  rank(query, chunks) {
    const scores = bm25Scores(query, chunks.map((c) => c.text));
    return chunks.map((c, i) => ({ ...c, score: scores[i] })).sort((a, b) => b.score - a.score);
  },
};

/** Extracts readable text (Markdown-flavoured) from a file buffer. */
export async function extractText(name, buf) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') {
    const pdf = await readPdf(buf);
    return { kind: 'pdf', text: pdfToText(pdf), meta: { pages: pdf.numPages, truncated: pdf.truncated, scannedPages: pdf.pages.filter(p => !p.hasText).map(p => p.page) } };
  }
  if (ext === '.docx') {
    const { blocks, stats } = await readDocx(buf);
    return { kind: 'docx', text: docxBlocksToMarkdown(blocks), meta: stats, structured: { blocks } };
  }
  if (ext === '.xlsx') {
    const wb = await readXlsx(buf, { maxRows: 500 });
    return {
      kind: 'xlsx',
      text: xlsxToMarkdown(wb, { maxRows: 500 }),
      meta: { sheets: wb.sheets.map((s) => ({ name: s.name, rows: s.rowCount, columns: s.columnCount })) },
      structured: wb,
    };
  }
  const raw = buf.toString('utf8').replace(/^﻿/, '');
  if (ext === '.csv') {
    const rows = parseCsv(raw);
    return { kind: 'csv', text: rowsToMarkdown(rows, { maxRows: 1000 }), meta: { rows: rows.length }, structured: { rows } };
  }
  if (ext === '.json') {
    let pretty = raw;
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      /* keep as-is; the model can still read it */
    }
    return { kind: 'json', text: pretty, meta: {} };
  }
  if (!SUPPORTED_EXTS.includes(ext) && raw.includes('\u0000')) {
    throw new Error(`"${name}" looks like a binary file; only ${SUPPORTED_EXTS.join(', ')} can be read.`);
  }
  return { kind: ext === '.md' || ext === '.markdown' ? 'markdown' : 'text', text: raw, meta: {} };
}

/** Splits on blank lines, packing paragraphs into ~size-character chunks. */
export function chunkText(text, size = 1800) {
  const paras = text.split(/\n{2,}/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur);
      cur = '';
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.map((t, index) => ({ index, text: t }));
}

/**
 * Model-facing view of a document.
 * @param {{ maxChars?: number, chunk?: number, query?: string }} opts
 */
export function contextFor(text, { maxChars = 6000, chunk, query, ranker = keywordRanker } = {}) {
  if (text.length <= maxChars && chunk == null) return { content: text, totalChunks: 1, shown: [0], complete: true };

  const chunks = chunkText(text);
  if (chunk != null) {
    const c = chunks[chunk];
    if (!c) throw new Error(`Part ${chunk} does not exist (this file has parts 0–${chunks.length - 1}).`);
    return { content: c.text, totalChunks: chunks.length, shown: [chunk], complete: chunks.length === 1 };
  }

  let picked;
  if (query) {
    picked = [];
    let used = 0;
    for (const c of ranker.rank(query, chunks)) {
      if (c.score <= 0 && picked.length) break;
      if (used + c.text.length > maxChars && picked.length) break;
      picked.push(c);
      used += c.text.length;
    }
    picked.sort((a, b) => a.index - b.index);
  } else {
    picked = [];
    let used = 0;
    for (const c of chunks) {
      if (used + c.text.length > maxChars && picked.length) break;
      picked.push(c);
      used += c.text.length;
    }
  }
  const content = picked.map((c) => `[Part ${c.index + 1}/${chunks.length}]\n${c.text}`).join('\n\n');
  return { content, totalChunks: chunks.length, shown: picked.map((c) => c.index), complete: false };
}
