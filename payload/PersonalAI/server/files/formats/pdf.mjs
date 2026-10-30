// PDF text extraction (pdfjs-dist, pure JavaScript — no native tools, works on Windows).
//
// What this does:   pulls the text layer of each page, with page numbers.
// What it does NOT: OCR. A page without a text layer (a scan / photo) is reported
//                   as "no text layer"; the web UI can render such pages to images
//                   for the vision model (see src/attachments/pdfPages.ts). Nothing
//                   here claims to have read a scanned page.

/** Pages with fewer visible characters than this are treated as having no text layer. */
export const MIN_TEXT_CHARS = 20;
export const MAX_PDF_PAGES = 1000;

let pdfjs;
async function lib() {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/**
 * @returns {Promise<{ numPages: number, pages: { page: number, text: string, chars: number, hasText: boolean }[], truncated: boolean, title?: string }>}
 */
export async function readPdf(buf, { maxPages = MAX_PDF_PAGES } = {}) {
  const { getDocument } = await lib();
  const task = getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    if (e?.name === 'PasswordException') throw Object.assign(new Error('This PDF is password-protected. Remove the password and attach it again.'), { status: 422 });
    throw Object.assign(new Error(`Could not open the PDF (${e?.message ?? e}). The file may be damaged.`), { status: 422 });
  }
  try {
    const pages = [];
    const count = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const chars = text.replace(/\s/g, '').length;
      pages.push({ page: n, text, chars, hasText: chars >= MIN_TEXT_CHARS });
      page.cleanup();
    }
    const meta = await doc.getMetadata().catch(() => null);
    return { numPages: doc.numPages, pages, truncated: doc.numPages > count, title: meta?.info?.Title || undefined };
  } finally {
    await task.destroy();
  }
}

/** Markdown-ish text with a "[Page n]" marker before every page. */
export function pdfToText(pdf) {
  return pdf.pages
    .map((p) => `[Page ${p.page}]\n${p.hasText ? p.text : '(no text layer on this page — possibly a scan or picture)'}`)
    .join('\n\n');
}

/**
 * Chunks that never lose their page reference: each page is cut into pieces
 * of at most `size` characters, each piece starts with "[Page n]" (or
 * "[Page n, continued]"), and pieces are packed into chunks.
 */
export function pdfChunks(pdf, size = 1800) {
  const pieces = [];
  for (const p of pdf.pages) {
    const body = p.hasText ? p.text : '(no text layer on this page — possibly a scan or picture)';
    for (let i = 0; i < body.length || i === 0; i += size) {
      pieces.push({ page: p.page, text: `[Page ${p.page}${i ? ', continued' : ''}]\n${body.slice(i, i + size)}` });
    }
  }
  const chunks = [];
  let cur = null;
  for (const piece of pieces) {
    if (cur && cur.text.length + piece.text.length + 2 > size) {
      chunks.push(cur);
      cur = null;
    }
    if (!cur) cur = { text: piece.text, pages: [piece.page] };
    else {
      cur.text += `\n\n${piece.text}`;
      if (!cur.pages.includes(piece.page)) cur.pages.push(piece.page);
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map((c, index) => ({ index, text: c.text, pages: c.pages }));
}

/**
 * Render one PDF page as PNG for the vision model.
 * Returns { png, width, height, page, totalPages }.
 */
export async function renderPdfPage(buf, pageNumber, { maxDimension = 1280 } = {}) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw Object.assign(new Error('Invalid PDF page number.'), { status: 400 });
  }

  const { getDocument } = await lib();
  const { createCanvas } = await import('@napi-rs/canvas');

  const task = getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  try {
    const doc = await task.promise;

    if (pageNumber > doc.numPages) {
      throw Object.assign(new Error('PDF page does not exist.'), { status: 400 });
    }

    const page = await doc.getPage(pageNumber);

    try {
      const original = page.getViewport({ scale: 1 });
      const limit = Math.min(1280, Math.max(256, maxDimension));
      const scale = Math.min(1, limit / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });

      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = createCanvas(width, height);

      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;

      return {
        png: canvas.toBuffer('image/png'),
        width,
        height,
        page: pageNumber,
        totalPages: doc.numPages,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}
