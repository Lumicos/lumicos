// Word files the agent writes (trip plans, quizzes): a small block list → .docx with fonts that show Thai, Chinese and
// English (claude-20261025). Blocks: {title|heading|paragraph|note|bullets|numbered|table|options|pagebreak|links}.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, PageBreak, ExternalHyperlink, TableLayoutType, Tab, TabStopType } from 'docx';

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Leelawadee UI', eastAsia: 'Microsoft YaHei' };
const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
const run = (text, opts = {}) => new TextRun({ text: String(text ?? ''), font: FONT, ...opts });
/** "**bold**" parts become bold runs. */
const runs = (text, opts = {}) => String(text ?? '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  .map((p) => (p.startsWith('**') && p.endsWith('**') ? run(p.slice(2, -2), { ...opts, bold: true }) : run(p, opts)));

const TEXT_WIDTH = 9026; // A4 width minus 1-inch margins, in twips (the docx default page)
function table(rows, { header = true, widths } = {}) {
  const width = Math.max(...rows.map((r) => r.length));
  const shares = widths?.length === width ? widths : Array(width).fill(100 / width), total = shares.reduce((a, b) => a + b, 0);
  const cols = shares.map((w) => Math.round((TEXT_WIDTH * w) / total));
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA }, columnWidths: cols, layout: TableLayoutType.FIXED,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: header && i === 0,
      children: Array.from({ length: width }, (_, c) => new TableCell({
        width: { size: cols[c], type: WidthType.DXA },
        shading: header && i === 0 ? { type: ShadingType.CLEAR, fill: 'EDEFF5', color: 'auto' } : undefined,
        children: [new Paragraph({ children: runs(r[c] ?? '', { bold: header && i === 0, size: 20 }) })],
      })),
    })),
  });
}

/** Builds the .docx (Buffer). */
export async function buildDocx({ title, blocks = [] }) {
  const out = [];
  for (const b of [...(title ? [{ type: 'title', text: title }] : []), ...blocks]) {
    if (b.type === 'title') out.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(b.text, { size: 40, bold: true }), spacing: { after: 160 } }));
    else if (b.type === 'heading') out.push(new Paragraph({ heading: HEAD[Math.min(3, Math.max(1, b.level ?? 1)) - 1], children: runs(b.text, { bold: true }), spacing: { before: 200, after: 80 }, pageBreakBefore: !!b.pageBreakBefore }));
    else if (b.type === 'note') out.push(new Paragraph({ children: runs(b.text, { size: 18, color: '666666' }), spacing: { after: 120 } }));
    else if (b.type === 'bullets') for (const item of b.items ?? []) out.push(new Paragraph({ bullet: { level: 0 }, children: runs(item), spacing: { after: 40 } }));
    else if (b.type === 'numbered') (b.items ?? []).forEach((item, i) => out.push(new Paragraph({ children: runs(`${(b.start ?? 1) + i}. ${item}`), spacing: { after: 40 } })));
    else if (b.type === 'options') {
      const items = b.items ?? [], pairs = b.columns === 2 ? Array.from({ length: Math.ceil(items.length / 2) }, (_, i) => items.slice(i * 2, i * 2 + 2)) : items.map((i) => [i]);
      // two short options per line ("A) …<tab>B) …"); keepNext holds a question's options together on one page
      pairs.forEach((pair, i) => out.push(new Paragraph({ indent: { left: 540 }, spacing: { after: 20 }, keepNext: i < pairs.length - 1, keepLines: true,
        tabStops: [{ type: TabStopType.LEFT, position: 540 + Math.round((TEXT_WIDTH - 540) / 2) }],
        children: pair.flatMap((item, k) => [...(k ? [new TextRun({ children: [new Tab()], font: FONT })] : []), ...runs(item)]) })));
    }
    else if (b.type === 'table') { out.push(table(b.rows ?? [], b)); out.push(new Paragraph('')); }
    else if (b.type === 'pagebreak') out.push(new Paragraph({ children: [new PageBreak()] }));
    else if (b.type === 'links') {
      (b.items ?? []).forEach((l, i) => out.push(new Paragraph({ spacing: { after: 30 }, children: [run(`${i + 1}. ${l.title ? `${l.title} — ` : ''}`, { size: 18 }),
        ...(l.url ? [new ExternalHyperlink({ link: l.url, children: [run(l.url, { size: 18, color: '1F4E99', underline: {} })] })] : [])] })));
    } else out.push(new Paragraph({ children: runs(b.text), spacing: { after: 100 }, alignment: b.center ? AlignmentType.CENTER : undefined, keepNext: !!b.keepNext }));
  }
  const doc = new Document({ creator: 'Lumicos', title: title ?? '', styles: { default: { document: { run: { font: FONT, size: 22 } } } }, sections: [{ children: out }] });
  return Packer.toBuffer(doc);
}
