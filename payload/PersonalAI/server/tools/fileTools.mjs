// File, document, spreadsheet, attachment and memory-suggestion tools.
// Handlers only use the service layer (FileService / FileContext / formats).
import fs from 'node:fs/promises';
import path from 'node:path';
import { contextFor, extractText, SUPPORTED_EXTS } from '../files/fileContext.mjs';
import { createDocx, editDocx, validateBlocks } from '../files/formats/docx.mjs';
import { createXlsx, editXlsx } from '../files/formats/xlsx.mjs';
import { tokenize } from '../memory/text.mjs';
import { MEMORY_TYPES } from '../memory/memoryStore.mjs';

const MAX_TOOL_CHARS = 6000;
const TEXT_CREATE_EXTS = ['.txt', '.md', '.csv', '.json'];

const S = {
  path: { type: 'string', description: 'Path inside the workspace, e.g. "notes/project.md"' },
};

const short = (s, n = 280) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const cleanKnowledgeLine = (value, max = 700) =>
  String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/^\s*(?:[-*#]+|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, max);

function verifiedKnowledgeArgs(a) {
  const heading = cleanKnowledgeLine(a.heading, 140);
  const facts = [...new Set((a.facts ?? []).map((v) => cleanKnowledgeLine(v)).filter(Boolean))].slice(0, 6);
  const sources = [...new Set((a.sources ?? []).map((v) => String(v ?? '').trim()).filter((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }))].slice(0, 8);
  if (!heading) throw new Error('heading must contain a clear topic.');
  if (!facts.length) throw new Error('facts must contain at least one standalone fact.');
  if (!sources.length) throw new Error('sources must contain at least one valid http/https URL.');
  return { heading, facts, sources };
}
const extOf = (p) => path.extname(String(p)).toLowerCase();

function requireExt(p, allowed, what) {
  const ext = extOf(p);
  if (!allowed.includes(ext)) throw new Error(`${what} must end with ${allowed.join(' / ')} (got "${p}").`);
}

function blocksSummary(blocks = []) {
  return blocks
    .map((b) => (b.type === 'heading' || b.type === 'title' ? `# ${b.text}` : b.type === 'table' ? `[table ${b.rows?.length ?? 0} rows]` : b.items ? b.items.map((i) => `• ${i}`).join('\n') : b.text))
    .join('\n');
}

function xlsxOpsSummary(ops = []) {
  return ops
    .map((o) => {
      if (o.op === 'add_rows') return `Add row${o.rows?.length > 1 ? 's' : ''} to ${o.sheet ?? 'first sheet'}:\n${(o.rows ?? []).map((r) => r.join(' | ')).join('\n')}`;
      if (o.op === 'update_cells') return `Update ${o.sheet ?? 'first sheet'}: ${Object.entries(o.cells ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}`;
      if (o.op === 'add_sheet') return `Add sheet "${o.name}"`;
      if (o.op === 'rename_sheet') return `Rename sheet "${o.from}" → "${o.to}"`;
      return o.op;
    })
    .join('\n');
}

function docxOpsSummary(ops = []) {
  return ops
    .map((o) => {
      if (o.op === 'append') return `Append at the end:\n${blocksSummary(o.blocks)}`;
      if (o.op === 'insert_after_heading') return `Insert under "${o.heading}":\n${blocksSummary(o.blocks)}`;
      if (o.op === 'replace_text') return `Replace "${o.find}" → "${o.replace}"`;
      if (o.op === 'rename_heading') return `Rename heading "${o.from}" → "${o.to}"`;
      return o.op;
    })
    .join('\n');
}

const editedName = (p) => {
  const ext = extOf(p);
  return `${p.slice(0, -ext.length)}-edited${ext}`;
};

const defaultFolderFor = (name) => {
  const ext = extOf(name);
  if (ext === '.docx') return 'documents';
  if (ext === '.xlsx' || ext === '.csv') return 'spreadsheets';
  return 'notes';
};

/** @returns {import('./registry.mjs').Tool[]} */
export function fileTools() {
  return [
    /* ------------------------------ READ ------------------------------ */
    {
      name: 'list_files',
      permission: 'read',
      description: 'List files and folders in the workspace (or a sub-folder).',
      parameters: { type: 'object', properties: { path: { ...S.path, description: 'Folder; empty for the workspace root' }, recursive: { type: 'boolean' } } },
      example: { path: 'notes' },
      preview: (a) => ({ action: 'List files', target: a.path || '/' }),
      async handler(a, { files }) {
        const r = await files.list(a.path ?? '', { recursive: !!a.recursive, maxEntries: 300 });
        const lines = r.entries.map((e) => `${e.type === 'folder' ? '[folder]' : `[${e.type}]`} ${e.path}${e.type === 'folder' ? '/' : ` (${e.size} bytes, modified ${e.modified.slice(0, 10)})`}`);
        return {
          summary: `Listed ${r.entries.length} item(s) in ${r.path || '/'}`,
          content: lines.length ? lines.join('\n') + (r.truncated ? '\n… (truncated)' : '') : '(empty folder)',
          data: { entries: r.entries.length },
        };
      },
    },
    {
      name: 'read_file',
      permission: 'read',
      description:
        'Read a file (.txt .md .csv .json .docx .xlsx). Large files are split into parts: pass "part" (1-based) or a "query" to get the most relevant parts. For .xlsx you may pass "sheet".',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: { path: S.path, part: { type: 'integer', minimum: 1 }, query: { type: 'string' }, sheet: { type: 'string' } },
      },
      example: { path: 'notes/project.md' },
      preview: (a) => ({ action: 'Read', target: a.path }),
      async handler(a, { files }) {
        const buf = await files.readBytes(a.path);
        let ex = await extractText(a.path, buf);
        if (a.sheet && ex.kind === 'xlsx') {
          const sheet = ex.structured.sheets.find((s) => s.name === a.sheet);
          if (!sheet) throw new Error(`Sheet "${a.sheet}" not found. Sheets: ${ex.structured.sheets.map((s) => s.name).join(', ')}`);
          const { xlsxToMarkdown } = await import('../files/formats/xlsx.mjs');
          ex = { ...ex, text: xlsxToMarkdown({ sheets: [sheet] }, { maxRows: 500 }) };
        }
        const ctx = contextFor(ex.text, { maxChars: MAX_TOOL_CHARS, chunk: a.part ? a.part - 1 : undefined, query: a.query });
        const note = ctx.complete ? '' : `\n\n(Showing part${ctx.shown.length > 1 ? 's' : ''} ${ctx.shown.map((i) => i + 1).join(', ')} of ${ctx.totalChunks}. Ask for another "part" or use "query".)`;
        return {
          summary: `Read ${a.path}${ctx.complete ? '' : ` (part ${ctx.shown.map((i) => i + 1).join(', ')}/${ctx.totalChunks})`}`,
          content: `File: ${a.path} (${ex.kind})\n\n${ctx.content}${note}`,
          data: { kind: ex.kind, meta: ex.meta, totalParts: ctx.totalChunks },
        };
      },
    },
    {
      name: 'search_files',
      permission: 'read',
      description: 'Find files whose name or content contains the query (searches text, Markdown, CSV, JSON, Word and Excel files).',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, path: { ...S.path, description: 'Folder to search in; empty = whole workspace' } } },
      example: { query: 'Gemma' },
      preview: (a) => ({ action: 'Search files for', target: `"${a.query}"` }),
      async handler(a, { files }) {
        const q = a.query.toLowerCase();
        const qTokens = tokenize(a.query);
        const { entries } = await files.list(a.path ?? '', { recursive: true, maxEntries: 800 });
        const hits = [];
        for (const e of entries) {
          if (e.type === 'folder') continue;
          const nameHit = e.name.toLowerCase().includes(q);
          let snippet = '';
          if (SUPPORTED_EXTS.includes(e.ext) && e.size <= 3 * 1024 * 1024) {
            try {
              const text = (await extractText(e.name, await files.readBytes(e.path))).text;
              const lower = text.toLowerCase();
              let at = lower.indexOf(q);
              if (at < 0 && qTokens.length && qTokens.every((t) => lower.includes(t))) at = lower.indexOf(qTokens[0]);
              if (at >= 0) snippet = text.slice(Math.max(0, at - 60), at + 90).replace(/\s+/g, ' ').trim();
            } catch {
              /* unreadable file: name match only */
            }
          }
          if (nameHit || snippet) hits.push({ path: e.path, nameHit, snippet });
          if (hits.length >= 25) break;
        }
        return {
          summary: `Found ${hits.length} file(s) for "${a.query}"`,
          content: hits.length ? hits.map((h) => `${h.path}${h.snippet ? `\n  …${h.snippet}…` : ' (name match)'}`).join('\n') : 'No files found.',
          data: { count: hits.length },
        };
      },
    },

    /* ------------------------------ WRITE ----------------------------- */
    {
      name: 'create_folder',
      permission: 'write',
      description: 'Create a folder in the workspace.',
      parameters: { type: 'object', required: ['path'], properties: { path: S.path } },
      preview: (a) => ({ action: 'Create folder', target: a.path }),
      async handler(a, { files }) {
        const r = await files.mkdir(a.path);
        return { summary: `Created folder ${r.path}`, content: `Folder created: ${r.path}` };
      },
    },
    {
      name: 'create_file',
      permission: 'write',
      description: 'Create a NEW text file (.txt .md .csv .json). Never overwrites: if the name is taken, a numbered name is used.',
      parameters: { type: 'object', required: ['path', 'content'], properties: { path: S.path, content: { type: 'string' } } },
      example: { path: 'notes/summary.md', content: '# Summary\n\n- ...' },
      preview: (a) => ({ action: 'Create file', target: a.path, details: short(a.content, 600) }),
      async handler(a, { files }) {
        requireExt(a.path, TEXT_CREATE_EXTS, 'File name');
        const r = await files.write(a.path, a.content, { mode: 'create' });
        return {
          summary: `Created ${r.path}`,
          content: `Created ${r.path}${r.renamed ? ` ("${a.path}" already existed, so a new name was used)` : ''}.`,
          data: { path: r.path },
        };
      },
    },
    {
      name: 'write_file',
      permission: 'write',
      description: 'Write to a text file. mode "append" adds to the end (default). mode "overwrite" replaces the whole file and needs extra confirmation.',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: { path: S.path, content: { type: 'string' }, mode: { type: 'string', enum: ['append', 'overwrite'] } },
      },
      example: { path: 'notes/project.md', content: '- New idea', mode: 'append' },
      async permissionFor(a, { files }) {
        return (a.mode ?? 'append') === 'overwrite' && (await files.exists(a.path)) ? 'destructive' : 'write';
      },
      async preview(a, { files }) {
        const exists = await files.exists(a.path);
        const mode = a.mode ?? 'append';
        return {
          action: mode === 'overwrite' ? (exists ? 'OVERWRITE' : 'Create file') : exists ? 'Append to' : 'Create file',
          target: a.path,
          details: short(a.content, 600),
          warning: mode === 'overwrite' && exists ? 'The current content will be replaced (a backup is kept in data/backups).' : undefined,
        };
      },
      async handler(a, { files }) {
        requireExt(a.path, TEXT_CREATE_EXTS, 'File name');
        const mode = a.mode ?? 'append';
        const r = await files.write(a.path, a.content, { mode: mode === 'overwrite' ? 'overwrite' : 'append' });
        return { summary: `${mode === 'overwrite' ? 'Overwrote' : 'Updated'} ${r.path}`, content: `${mode === 'overwrite' ? 'Replaced' : 'Appended to'} ${r.path}.`, data: { path: r.path, backup: r.backup } };
      },
    },
    {
      name: 'rename_file',
      permission: 'write',
      description: 'Rename a file or folder (same folder). Fails if the new name exists.',
      parameters: { type: 'object', required: ['path', 'new_name'], properties: { path: S.path, new_name: { type: 'string', description: 'New name only, no folders' } } },
      preview: (a) => ({ action: 'Rename', target: a.path, details: `→ ${a.new_name}` }),
      async handler(a, { files }) {
        const r = await files.rename(a.path, a.new_name);
        return { summary: `Renamed ${r.from} → ${r.path}`, content: `Renamed to ${r.path}.` };
      },
    },
    {
      name: 'move_file',
      permission: 'write',
      description: 'Move a file or folder to another folder or path. Never overwrites.',
      parameters: { type: 'object', required: ['path', 'to'], properties: { path: S.path, to: { type: 'string', description: 'Destination folder or full new path' } } },
      preview: (a) => ({ action: 'Move', target: a.path, details: `→ ${a.to}` }),
      async handler(a, { files }) {
        const r = await files.move(a.path, a.to);
        return { summary: `Moved ${r.from} → ${r.path}`, content: `Moved to ${r.path}.` };
      },
    },
    {
      name: 'copy_file',
      permission: 'write',
      description: 'Copy a file or folder. If the destination exists, a numbered name is used.',
      parameters: { type: 'object', required: ['path', 'to'], properties: { path: S.path, to: { type: 'string' } } },
      preview: (a) => ({ action: 'Copy', target: a.path, details: `→ ${a.to}` }),
      async handler(a, { files }) {
        const r = await files.copy(a.path, a.to);
        return { summary: `Copied ${r.from} → ${r.path}`, content: `Copied to ${r.path}.`, data: { path: r.path } };
      },
    },
    {
      name: 'create_docx',
      permission: 'write',
      description:
        'Create a NEW Word document. blocks: {type:"heading",level:1-3,text} | {type:"paragraph",text} (**bold** allowed) | {type:"bullets",items:[...]} | {type:"numbered",items:[...]} | {type:"table",rows:[[...],[...]]} (first row = header).',
      parameters: {
        type: 'object',
        required: ['path', 'blocks'],
        properties: { path: S.path, title: { type: 'string' }, blocks: { type: 'array', items: { type: 'object' } } },
      },
      example: { path: 'documents/report.docx', title: 'Report', blocks: [{ type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: '...' }] },
      preview: (a) => ({ action: 'Create Word document', target: a.path, details: short(`${a.title ? `Title: ${a.title}\n` : ''}${blocksSummary(a.blocks)}`, 700) }),
      async handler(a, { files }) {
        requireExt(a.path, ['.docx'], 'Word file name');
        validateBlocks(a.blocks);
        const r = await files.write(a.path, await createDocx({ title: a.title, blocks: a.blocks }), { mode: 'create' });
        return { summary: `Created ${r.path}`, content: `Created Word document ${r.path}${r.renamed ? ' (name was taken, so a numbered name was used)' : ''}.`, data: { path: r.path } };
      },
    },
    {
      name: 'edit_docx',
      permission: 'write',
      description:
        'Edit a Word document, keeping existing content. operations: {op:"append",blocks} | {op:"insert_after_heading",heading,blocks} | {op:"replace_text",find,replace} | {op:"rename_heading",from,to}. Saves to "<name>-edited.docx" by default; set "output" to the same path only if the user wants the original replaced.',
      parameters: {
        type: 'object',
        required: ['path', 'operations'],
        properties: { path: S.path, operations: { type: 'array', items: { type: 'object', required: ['op'] } }, output: { type: 'string' } },
      },
      example: { path: 'documents/report.docx', operations: [{ op: 'append', blocks: [{ type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: '...' }] }] },
      async permissionFor(a, { ws }) {
        const out = a.output ?? editedName(a.path);
        return ws.resolve(out).rel === ws.resolve(a.path).rel ? 'destructive' : 'write';
      },
      preview: (a, { ws }) => {
        const out = a.output ?? editedName(a.path);
        const replacing = ws.resolve(out).rel === ws.resolve(a.path).rel;
        return {
          action: replacing ? 'REPLACE original' : 'Edit Word document',
          target: a.path,
          details: `${short(docxOpsSummary(a.operations), 700)}\n\nSave as: ${out}`,
          warning: replacing ? 'The original document will be replaced (a backup is kept in data/backups).' : undefined,
        };
      },
      async handler(a, { files, ws }) {
        requireExt(a.path, ['.docx'], 'Word file');
        const out = a.output ?? editedName(a.path);
        requireExt(out, ['.docx'], 'Output file');
        const replacing = ws.resolve(out).rel === ws.resolve(a.path).rel;
        const { buffer, report } = await editDocx(await files.readBytes(a.path), a.operations);
        const r = await files.write(out, buffer, { mode: replacing ? 'overwrite' : 'create' });
        return { summary: `Edited ${a.path} → ${r.path}`, content: `${report.join('. ')}. Saved as ${r.path}.`, data: { path: r.path, report } };
      },
    },
    {
      name: 'create_xlsx',
      permission: 'write',
      description:
        'Create a NEW Excel workbook. sheets: [{name, rows:[[header...],[values...]]}]. First row is formatted as a header. Strings starting with "=" are formulas (e.g. "=SUM(B2:B10)"); "YYYY-MM-DD" strings become dates.',
      parameters: {
        type: 'object',
        required: ['path', 'sheets'],
        properties: { path: S.path, sheets: { type: 'array', items: { type: 'object', required: ['name', 'rows'], properties: { name: { type: 'string' }, rows: { type: 'array', items: { type: 'array' } } } } } },
      },
      example: { path: 'spreadsheets/expenses.xlsx', sheets: [{ name: 'Expenses', rows: [['Date', 'Item', 'Amount'], ['2026-09-25', 'Food', 120], ['Total', '', '=SUM(C2:C2)']] }] },
      preview: (a) => ({
        action: 'Create Excel workbook',
        target: a.path,
        details: short(a.sheets.map((s) => `Sheet "${s.name}": ${s.rows.length} rows\n${s.rows.slice(0, 4).map((r) => r.join(' | ')).join('\n')}`).join('\n\n'), 700),
      }),
      async handler(a, { files }) {
        requireExt(a.path, ['.xlsx'], 'Excel file name');
        const r = await files.write(a.path, await createXlsx({ sheets: a.sheets }), { mode: 'create' });
        return { summary: `Created ${r.path}`, content: `Created workbook ${r.path} with sheet(s): ${a.sheets.map((s) => s.name).join(', ')}${r.renamed ? ' (name was taken, so a numbered name was used)' : ''}.`, data: { path: r.path } };
      },
    },
    {
      name: 'edit_xlsx',
      permission: 'write',
      description:
        'Edit an Excel workbook in place (a backup is kept). operations: {op:"add_rows",sheet,rows:[[...]]} (inserted above a SUM total row if there is one) | {op:"update_cells",sheet,cells:{"B3":120}} | {op:"add_sheet",name,rows?} | {op:"rename_sheet",from,to}. Set "output" to save as a new file instead.',
      parameters: {
        type: 'object',
        required: ['path', 'operations'],
        properties: { path: S.path, operations: { type: 'array', items: { type: 'object', required: ['op'] } }, output: { type: 'string' } },
      },
      example: { path: 'spreadsheets/expenses.xlsx', operations: [{ op: 'add_rows', sheet: 'Expenses', rows: [['2026-09-25', 'Food', 120]] }] },
      preview: (a) => ({ action: a.output ? 'Edit workbook (save as copy)' : 'Modify workbook', target: a.path, details: short(`${xlsxOpsSummary(a.operations)}${a.output ? `\n\nSave as: ${a.output}` : ''}`, 700) }),
      async handler(a, { files }) {
        requireExt(a.path, ['.xlsx'], 'Excel file');
        if (a.output) requireExt(a.output, ['.xlsx'], 'Output file');
        const { buffer, report } = await editXlsx(await files.readBytes(a.path), a.operations);
        const r = a.output ? await files.write(a.output, buffer, { mode: 'create' }) : await files.write(a.path, buffer, { mode: 'overwrite' });
        return { summary: report.join('; '), content: `${report.join('. ')}. Saved ${r.path}.`, data: { path: r.path, report, backup: r.backup } };
      },
    },
    {
      name: 'import_attachment',
      permission: 'write',
      description: 'Save a file the user attached to the chat into the workspace (so it can be edited).',
      parameters: { type: 'object', required: ['attachment_id'], properties: { attachment_id: { type: 'string' }, path: { ...S.path, description: 'Where to save it; default picks a folder by type' } } },
      async preview(a, { attachments }) {
        const { info } = await attachments.get(a.attachment_id);
        return { action: 'Import attachment', target: a.path ?? `${defaultFolderFor(info.name)}/${info.name}`, details: `${info.name} (${info.size} bytes)` };
      },
      async handler(a, { attachments, files }) {
        const { info, file } = await attachments.get(a.attachment_id);
        const target = a.path ?? `${defaultFolderFor(info.name)}/${info.name}`;
        const r = await files.write(target, await fs.readFile(file), { mode: 'create' });
        return { summary: `Imported ${info.name} → ${r.path}`, content: `Saved the attachment as ${r.path}.`, data: { path: r.path } };
      },
    },
    {
      name: 'read_attachment',
      permission: 'read',
      description: 'Read more of a file the user attached to this chat (use "part" or "query" for long files).',
      parameters: { type: 'object', required: ['attachment_id'], properties: { attachment_id: { type: 'string' }, part: { type: 'integer', minimum: 1 }, query: { type: 'string' } } },
      preview: () => ({ action: 'Read attachment', target: '' }),
      async handler(a, { attachments }) {
        const r = await attachments.read(a.attachment_id, { part: a.part, query: a.query });
        return { summary: `Read attachment ${r.info.name}`, content: `Attachment: ${r.info.name}\n\n${r.content}${r.complete ? '' : `\n\n(Part(s) ${r.shown.map((i) => i + 1).join(', ')} of ${r.totalChunks}.)`}` };
      },
    },

    /* ------------------------ VERIFIED KNOWLEDGE ---------------------- */
    {
      name: 'save_web_knowledge',
      permission: 'write',
      description: 'Add web-sourced facts to Lumicos RAG after the user explicitly confirms they are correct and asks to save them. Only writes knowledge/lumicos-verified-web.md. Never use in the same turn as the web search.',
      parameters: {
        type: 'object', required: ['heading', 'facts', 'sources'],
        properties: {
          heading: { type: 'string', description: 'Specific searchable Thai topic heading' },
          facts: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' }, description: 'Standalone verified facts with dates, names and status where relevant' },
          sources: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' }, description: 'Actual http/https source URLs already shown to the user' },
        },
      },
      preview: (a) => {
        const clean = verifiedKnowledgeArgs(a);
        return { action: 'Add user-confirmed web knowledge to RAG', target: 'knowledge/lumicos-verified-web.md', details: short(`## ${clean.heading}\n${clean.facts.map((fact) => `- ${fact}`).join('\n')}\n${clean.sources.join('\n')}`, 700) };
      },
      async handler(a, { files }) {
        const clean = verifiedKnowledgeArgs(a);
        const target = 'knowledge/lumicos-verified-web.md';
        const exists = await files.exists(target);
        const current = exists ? await files.readText(target) : '';
        if (current.toLocaleLowerCase('th-TH').includes(`## ${clean.heading}`.toLocaleLowerCase('th-TH'))) {
          return { summary: `Knowledge already exists: ${clean.heading}`, content: `ไม่ได้เพิ่มข้อมูลซ้ำ เพราะมีหัวข้อ “${clean.heading}” อยู่ใน ${target} แล้ว`, data: { path: target, added: false, duplicate: true } };
        }
        const today = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' }).format(new Date());
        const header = exists ? '' : `# ความรู้จากเว็บที่ผู้ใช้ยืนยัน\nรวบรวมเมื่อ ${today} ข้อมูลหลังวันนี้อาจเปลี่ยน\n\n`;
        const section = `## ${clean.heading}\n${clean.facts.map((fact) => `- ${fact}`).join('\n')}\n${clean.sources.map((url) => `- แหล่งที่มา: ${url}`).join('\n')}\n\n`;
        await files.write(target, `${header}${section}`, { mode: exists ? 'append' : 'create' });
        return { summary: `Added verified knowledge: ${clean.heading}`, content: `เพิ่มหัวข้อ “${clean.heading}” ลง ${target} แล้ว ระบบจะนำเข้า RAG อัตโนมัติภายในไม่กี่วินาที`, data: { path: target, added: true, facts: clean.facts.length, sources: clean.sources.length } };
      },
    },

    /* --------------------------- DESTRUCTIVE -------------------------- */
    {
      name: 'delete_file',
      permission: 'destructive',
      description: 'Delete a file or folder. ALWAYS requires the user to confirm. A backup copy is kept in data/backups.',
      parameters: { type: 'object', required: ['path'], properties: { path: S.path } },
      async preview(a, { files }) {
        const st = await files.stat(a.path).catch(() => null);
        return {
          action: 'DELETE',
          target: a.path,
          details: st ? `${st.type === 'folder' ? 'Folder (and everything in it)' : `${st.type} file, ${st.size} bytes`}, modified ${st.modified.slice(0, 10)}` : 'File not found',
          warning: 'This removes it from the workspace. A backup copy is kept in data/backups.',
        };
      },
      async handler(a, { files }) {
        const r = await files.remove(a.path);
        return { summary: `Deleted ${r.path}`, content: `Deleted ${r.path}.`, data: r };
      },
    },

    /* ------------------------------ MEMORY ---------------------------- */
    {
      name: 'propose_memory',
      permission: 'read',
      description:
        'Suggest a long-term memory about the user (stable facts, preferences, projects, decisions). It is NOT saved: the user sees it and decides. Do not propose greetings, jokes, guesses or temporary things.',
      parameters: {
        type: 'object',
        required: ['content', 'type'],
        properties: { content: { type: 'string' }, type: { type: 'string', enum: MEMORY_TYPES }, tags: { type: 'array', items: { type: 'string' } } },
      },
      preview: (a) => ({ action: 'Suggest memory', target: short(a.content, 80) }),
      async handler(a) {
        return {
          summary: 'Suggested a memory (waiting for your approval)',
          content: 'The suggestion was shown to the user for approval. Do not assume it is saved.',
          candidate: { content: a.content, type: a.type, tags: a.tags ?? [], importance: 3, rule: 'model' },
        };
      },
    },
  ];
}
