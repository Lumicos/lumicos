// DOCX support without Microsoft Word.
//   read:   JSZip + @xmldom/xmldom walk word/document.xml -> structured blocks
//   create: the `docx` library builds a new document from blocks
//   edit:   the original XML is changed in place (append / insert / replace / rename heading);
//           everything not touched is kept byte-for-byte.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import JSZip from 'jszip';
import { rowsToMarkdown } from './text.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Block model shared by read, create and edit:
 *   { type: 'title', text }
 *   { type: 'heading', level: 1-6, text }
 *   { type: 'paragraph', text }            (**bold** supported when creating)
 *   { type: 'bullets', items: string[] }
 *   { type: 'numbered', items: string[] }
 *   { type: 'table', rows: string[][], header?: boolean }
 */

/* ================================================================== */
/* Read                                                                */
/* ================================================================== */

const children = (node, localName) =>
  Array.from(node?.childNodes ?? []).filter((n) => n.nodeType === 1 && (!localName || n.localName === localName));
const child = (node, localName) => children(node, localName)[0];
const wAttr = (node, name) => node?.getAttributeNS(W, name) || node?.getAttribute(`w:${name}`) || '';

function paragraphText(p) {
  let out = '';
  const walk = (n) => {
    for (const c of children(n)) {
      if (c.localName === 't') out += c.textContent;
      else if (c.localName === 'tab') out += '\t';
      else if (c.localName === 'br' || c.localName === 'cr') out += '\n';
      else if (c.localName !== 'pPr' && c.localName !== 'rPr' && c.localName !== 'instrText') walk(c);
    }
  };
  walk(p);
  return out;
}

async function loadParts(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('This file is not a valid .docx document.');
  }
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('This .docx has no word/document.xml.');
  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, 'text/xml');
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const numberingXml = await zip.file('word/numbering.xml')?.async('string');
  const styles = stylesXml ? parser.parseFromString(stylesXml, 'text/xml') : null;
  const numbering = numberingXml ? parser.parseFromString(numberingXml, 'text/xml') : null;
  return { zip, doc, styles, numbering };
}

/** styleId -> lower-case style name ("Heading1" -> "heading 1"). */
function styleNames(styles) {
  const map = new Map();
  if (!styles) return map;
  for (const s of Array.from(styles.getElementsByTagNameNS(W, 'style'))) {
    const id = wAttr(s, 'styleId');
    const name = wAttr(child(s, 'name'), 'val');
    if (id) map.set(id, (name || id).toLowerCase());
  }
  return map;
}

/** numId -> { ilvl -> 'bullet' | 'decimal' | ... } */
function numberingFormats(numbering) {
  const out = new Map();
  if (!numbering) return out;
  const abstract = new Map();
  for (const a of Array.from(numbering.getElementsByTagNameNS(W, 'abstractNum'))) {
    const lvls = new Map();
    for (const l of children(a, 'lvl')) lvls.set(wAttr(l, 'ilvl'), wAttr(child(l, 'numFmt'), 'val'));
    abstract.set(wAttr(a, 'abstractNumId'), lvls);
  }
  for (const n of Array.from(numbering.getElementsByTagNameNS(W, 'num'))) {
    out.set(wAttr(n, 'numId'), abstract.get(wAttr(child(n, 'abstractNumId'), 'val')) ?? new Map());
  }
  return out;
}

function classify(p, names, formats) {
  const pPr = child(p, 'pPr');
  const styleId = wAttr(child(pPr, 'pStyle'), 'val');
  const name = names.get(styleId) ?? styleId.toLowerCase();
  if (name === 'title') return { kind: 'title' };
  const h = /^heading\s?(\d)$/.exec(name);
  if (h) return { kind: 'heading', level: Number(h[1]) };
  const outline = wAttr(child(pPr, 'outlineLvl'), 'val');
  if (outline !== '' && Number(outline) < 6) return { kind: 'heading', level: Number(outline) + 1 };
  const numPr = child(pPr, 'numPr');
  if (numPr) {
    const fmt = formats.get(wAttr(child(numPr, 'numId'), 'val'))?.get(wAttr(child(numPr, 'ilvl'), 'val') || '0');
    return { kind: 'list', ordered: !!fmt && fmt !== 'bullet' && fmt !== 'none' };
  }
  if (/list bullet/.test(name)) return { kind: 'list', ordered: false };
  if (/list number/.test(name)) return { kind: 'list', ordered: true };
  return { kind: 'paragraph' };
}

function tableRows(tbl) {
  return children(tbl, 'tr').map((tr) =>
    children(tr, 'tc').map((tc) =>
      children(tc, 'p')
        .map(paragraphText)
        .join(' ')
        .trim(),
    ),
  );
}

/** Block-level elements of the body, looking through content controls (w:sdt). */
function bodyElements(body) {
  const out = [];
  for (const el of children(body)) {
    if (el.localName === 'sdt') out.push(...bodyElements(child(el, 'sdtContent')));
    else out.push(el);
  }
  return out;
}

export async function readDocx(buf) {
  const { doc, styles, numbering } = await loadParts(buf);
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const names = styleNames(styles);
  const formats = numberingFormats(numbering);
  const blocks = [];

  for (const el of bodyElements(body)) {
    if (el.localName === 'tbl') {
      blocks.push({ type: 'table', rows: tableRows(el), header: true });
      continue;
    }
    if (el.localName !== 'p') continue;
    const text = paragraphText(el).trim();
    if (!text) continue;
    const c = classify(el, names, formats);
    if (c.kind === 'title') blocks.push({ type: 'title', text });
    else if (c.kind === 'heading') blocks.push({ type: 'heading', level: c.level, text });
    else if (c.kind === 'list') {
      const type = c.ordered ? 'numbered' : 'bullets';
      const last = blocks[blocks.length - 1];
      if (last?.type === type) last.items.push(text);
      else blocks.push({ type, items: [text] });
    } else blocks.push({ type: 'paragraph', text });
  }
  return { blocks, stats: summarize(blocks) };
}

function summarize(blocks) {
  return {
    headings: blocks.filter((b) => b.type === 'heading' || b.type === 'title').length,
    paragraphs: blocks.filter((b) => b.type === 'paragraph').length,
    tables: blocks.filter((b) => b.type === 'table').length,
    lists: blocks.filter((b) => b.type === 'bullets' || b.type === 'numbered').length,
  };
}

export function docxBlocksToMarkdown(blocks) {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'title':
          return `# ${b.text}`;
        case 'heading':
          return `${'#'.repeat(Math.min(6, b.level + 1))} ${b.text}`;
        case 'bullets':
          return b.items.map((i) => `- ${i}`).join('\n');
        case 'numbered':
          return b.items.map((i, n) => `${n + 1}. ${i}`).join('\n');
        case 'table':
          return rowsToMarkdown(b.rows, { maxRows: 100 });
        default:
          return b.text;
      }
    })
    .join('\n\n');
}

/* ================================================================== */
/* Create                                                              */
/* ================================================================== */

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Leelawadee UI', eastAsia: 'Calibri' };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

/** "**bold** text" -> TextRuns */
function runs(text) {
  return String(text ?? '')
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => (part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part)));
}

function tableFromRows(rows, header = true) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(
      (r, i) =>
        new TableRow({
          tableHeader: header && i === 0,
          children: Array.from(
            { length: width },
            (_, c) =>
              new TableCell({
                shading: header && i === 0 ? { fill: 'EDEFF5' } : undefined,
                children: [new Paragraph({ children: [new TextRun({ text: String(r[c] ?? ''), bold: header && i === 0 })] })],
              }),
          ),
        }),
    ),
  });
}

export function validateBlocks(blocks) {
  if (!Array.isArray(blocks)) throw new Error('"blocks" must be an array.');
  for (const [i, b] of blocks.entries()) {
    if (!b || typeof b !== 'object') throw new Error(`Block ${i} is not an object.`);
    if (!['title', 'heading', 'paragraph', 'bullets', 'numbered', 'table'].includes(b.type)) {
      throw new Error(`Block ${i}: unknown type "${b.type}". Use title, heading, paragraph, bullets, numbered or table.`);
    }
    if ((b.type === 'bullets' || b.type === 'numbered') && !Array.isArray(b.items)) throw new Error(`Block ${i}: "items" must be an array.`);
    if (b.type === 'table' && (!Array.isArray(b.rows) || !b.rows.every(Array.isArray))) throw new Error(`Block ${i}: "rows" must be an array of arrays.`);
  }
}

export async function createDocx({ title, blocks = [] }) {
  validateBlocks(blocks);
  const all = title ? [{ type: 'title', text: title }, ...blocks] : blocks;
  const out = [];
  let listInstance = 0;
  for (const b of all) {
    if (b.type === 'title') out.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(b.text) }));
    else if (b.type === 'heading') out.push(new Paragraph({ heading: HEADINGS[Math.min(6, Math.max(1, b.level ?? 1)) - 1], children: runs(b.text) }));
    else if (b.type === 'bullets') for (const item of b.items) out.push(new Paragraph({ bullet: { level: 0 }, children: runs(item) }));
    else if (b.type === 'numbered') {
      listInstance++;
      for (const item of b.items) out.push(new Paragraph({ numbering: { reference: 'numbered', level: 0, instance: listInstance }, children: runs(item) }));
    } else if (b.type === 'table') {
      out.push(tableFromRows(b.rows, b.header !== false));
      out.push(new Paragraph(''));
    } else out.push(new Paragraph({ children: runs(b.text), spacing: { after: 120 } }));
  }

  const doc = new Document({
    creator: 'PersonalAI',
    title: title ?? '',
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ children: out }],
  });
  return Packer.toBuffer(doc);
}

/* ================================================================== */
/* Edit (in the original XML)                                          */
/* ================================================================== */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text, bold = false, size) =>
  `<w:r>${bold || size ? `<w:rPr>${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const runsXml = (text) =>
  String(text ?? '')
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith('**') && p.endsWith('**') ? run(p.slice(2, -2), true) : run(p)))
    .join('');

function findStyleId(names, wanted) {
  for (const [id, name] of names) if (name === wanted) return id;
  return null;
}

/** XML for new blocks, using the document's own styles when it has them. */
function blocksXml(blocks, names) {
  const para = (inner, pPr = '') => `<w:p xmlns:w="${W}">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
  const bulletStyle = findStyleId(names, 'list bullet');
  const out = [];
  for (const b of blocks) {
    if (b.type === 'title' || b.type === 'heading') {
      const level = b.type === 'title' ? 0 : Math.min(6, Math.max(1, b.level ?? 1));
      const id = b.type === 'title' ? findStyleId(names, 'title') : findStyleId(names, `heading ${level}`);
      out.push(id ? para(run(b.text), `<w:pStyle w:val="${id}"/>`) : para(run(b.text, true, [40, 32, 28, 26, 24, 24, 22][level])));
    } else if (b.type === 'bullets') {
      for (const item of b.items) out.push(bulletStyle ? para(runsXml(item), `<w:pStyle w:val="${bulletStyle}"/>`) : para(run('• ') + runsXml(item), '<w:ind w:left="360"/>'));
    } else if (b.type === 'numbered') {
      b.items.forEach((item, i) => out.push(para(run(`${i + 1}. `) + runsXml(item), '<w:ind w:left="360"/>')));
    } else if (b.type === 'table') {
      const width = Math.max(1, ...b.rows.map((r) => r.length));
      const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
      const rows = b.rows
        .map(
          (r, i) =>
            `<w:tr>${Array.from({ length: width }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${run(String(r[c] ?? ''), b.header !== false && i === 0)}</w:p></w:tc>`).join('')}</w:tr>`,
        )
        .join('');
      out.push(
        `<w:tbl xmlns:w="${W}"><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(width)}</w:tblGrid>${rows}</w:tbl>`,
      );
      out.push(para(''));
    } else out.push(para(runsXml(b.text)));
  }
  return out;
}

/** Puts `text` into the paragraph's first text run and empties the others (keeps the first run's formatting). */
function setParagraphText(p, text) {
  const ts = Array.from(p.getElementsByTagNameNS(W, 't'));
  if (!ts.length) return;
  ts[0].textContent = text;
  ts[0].setAttribute('xml:space', 'preserve');
  for (const t of ts.slice(1)) t.textContent = '';
}

/**
 * Operations:
 *   { op: 'append', blocks }
 *   { op: 'insert_after_heading', heading, blocks }   (at the end of that heading's section)
 *   { op: 'replace_text', find, replace }
 *   { op: 'rename_heading', from, to }
 * Returns { buffer, report: string[] }.
 */
export async function editDocx(buf, operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('"operations" must be a non-empty array.');
  const { zip, doc, styles, numbering } = await loadParts(buf);
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const names = styleNames(styles);
  const formats = numberingFormats(numbering);
  const parser = new DOMParser();
  const report = [];

  const nodesFor = (blocks) => {
    validateBlocks(blocks);
    return blocksXml(blocks, names).map((xml) => doc.importNode(parser.parseFromString(xml, 'text/xml').documentElement, true));
  };
  const headings = () =>
    children(body)
      .filter((el) => el.localName === 'p')
      .map((p) => ({ p, c: classify(p, names, formats), text: paragraphText(p).trim() }))
      .filter((h) => h.c.kind === 'heading' || h.c.kind === 'title');
  const findHeading = (label) => {
    const want = String(label ?? '').trim().toLowerCase();
    const hs = headings();
    return hs.find((h) => h.text.toLowerCase() === want) ?? hs.find((h) => h.text.toLowerCase().includes(want));
  };

  for (const [i, op] of operations.entries()) {
    switch (op?.op) {
      case 'append': {
        const sectPr = children(body, 'sectPr')[0] ?? null;
        for (const n of nodesFor(op.blocks ?? [])) body.insertBefore(n, sectPr);
        report.push(`Appended ${op.blocks.length} block(s) at the end`);
        break;
      }
      case 'insert_after_heading': {
        const h = findHeading(op.heading);
        if (!h) throw new Error(`Operation ${i}: heading "${op.heading}" not found.`);
        const level = h.c.kind === 'title' ? 0 : h.c.level;
        let anchor = h.p;
        for (let n = h.p.nextSibling; n; n = n.nextSibling) {
          if (n.nodeType !== 1) continue;
          if (n.localName === 'sectPr') break;
          if (n.localName === 'p') {
            const c = classify(n, names, formats);
            if ((c.kind === 'heading' && c.level <= level) || c.kind === 'title') break;
          }
          anchor = n;
        }
        const ref = anchor.nextSibling;
        for (const n of nodesFor(op.blocks ?? [])) body.insertBefore(n, ref);
        report.push(`Inserted ${op.blocks.length} block(s) under "${h.text}"`);
        break;
      }
      case 'replace_text': {
        if (!op.find) throw new Error(`Operation ${i}: "find" is required.`);
        let count = 0;
        for (const p of Array.from(body.getElementsByTagNameNS(W, 'p'))) {
          const text = paragraphText(p);
          if (!text.includes(op.find)) continue;
          count += text.split(op.find).length - 1;
          setParagraphText(p, text.split(op.find).join(op.replace ?? ''));
        }
        if (!count) throw new Error(`Operation ${i}: text "${op.find}" not found.`);
        report.push(`Replaced "${op.find}" ${count} time(s)`);
        break;
      }
      case 'rename_heading': {
        const h = findHeading(op.from);
        if (!h) throw new Error(`Operation ${i}: heading "${op.from}" not found.`);
        setParagraphText(h.p, String(op.to ?? ''));
        report.push(`Renamed heading "${h.text}" to "${op.to}"`);
        break;
      }
      default:
        throw new Error(`Operation ${i}: unknown op "${op?.op}". Use append, insert_after_heading, replace_text or rename_heading.`);
    }
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, report };
}
