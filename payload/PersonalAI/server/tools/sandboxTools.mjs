// run_python + skills. No approval step: the sandbox is the safety boundary.
import fs from 'node:fs';
import path from 'node:path';

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const fail = (message, code = 'INVALID_ARGS', status = 400) => Object.assign(new Error(message), { code, status });

function parseSkill(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

/** "triggers: VAT, ภาษีมูลค่าเพิ่ม, ส่วนลด" → words that make the server attach this skill to a message (see skillMatch.mjs). */
export const parseTriggers = (raw) => String(raw ?? '').split(',').map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 30);
/** "needs: ญี่ปุ่น, โตเกียว, …" → the skill fires only when one of these words is in the message too (see skillMatch.mjs). */
export const parseNeeds = (raw) => String(raw ?? '').split(',').map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 300);
/** "unless: vat, ดอกเบี้ย, …" → the skill stays quiet when one of these words is in the message (a more specific skill
 *  owns it): percent-calc's "% ของ" also appears in "คิด VAT 7% ของ 980" (claude-20261024). */
export const parseUnless = parseNeeds;

export class SkillStore {
  constructor(workspaceRoot) { this.dir = path.join(workspaceRoot, 'skills'); fs.mkdirSync(this.dir, { recursive: true }); }

  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { return []; }
    const skills = [];
    for (const name of names) {
      const file = path.join(this.dir, name, 'SKILL.md');
      try {
        const { meta } = parseSkill(fs.readFileSync(file, 'utf8'));
        skills.push({ name, description: (meta.description || '').slice(0, 200), triggers: parseTriggers(meta.triggers), needs: parseNeeds(meta.needs), unless: parseUnless(meta.unless), exactOutput: /^exact$/i.test(meta.output ?? ''), hasScript: fs.readdirSync(path.join(this.dir, name)).some((f) => f.endsWith('.py')) });
      } catch { /* folder without SKILL.md */ }
    }
    return skills;
  }

  read(name) {
    if (!SKILL_NAME.test(name)) throw fail('ชื่อ skill ไม่ถูกต้อง');
    const folder = path.join(this.dir, name);
    let text;
    try { text = fs.readFileSync(path.join(folder, 'SKILL.md'), 'utf8'); }
    catch { throw fail(`ไม่พบ skill "${name}" (มี: ${this.list().map(s => s.name).join(', ') || 'ยังไม่มี'})`, 'SKILL_NOT_FOUND', 404); }
    const files = fs.readdirSync(folder).filter(f => f !== 'SKILL.md');
    return { name, text, files: files.map(f => `skills/${name}/${f}`) };
  }

  static slug(raw) {
    let s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
    if (s.length < 3) s = `skill-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
    return s;
  }

  save({ name, description, instructions, files, triggers }) {
    name = SkillStore.slug(name);
    if (!description?.trim() || description.length > 300) throw fail('ต้องมี description 1-300 ตัวอักษร');
    if (!instructions?.trim() || instructions.length > 20_000) throw fail('ต้องมี instructions 1-20,000 ตัวอักษร');
    const extra = files && typeof files === 'object' ? Object.entries(files) : [];
    if (extra.length > 10) throw fail('ไฟล์ประกอบได้ไม่เกิน 10 ไฟล์');
    for (const [f, content] of extra) {
      if (!FILE_NAME.test(f) || f === 'SKILL.md') throw fail(`ชื่อไฟล์ไม่ถูกต้อง: ${f}`);
      if (typeof content !== 'string' || content.length > 100_000) throw fail(`เนื้อหาไฟล์ ${f} ต้องเป็นข้อความไม่เกิน 100,000 ตัวอักษร`);
    }
    const folder = path.join(this.dir, name);
    const existed = fs.existsSync(path.join(folder, 'SKILL.md'));
    // Keep the trigger words of an existing skill unless new ones are given (Lumicos re-saving a skill must not drop them).
    let keep = '', keepNeeds = '', keepUnless = '', keepOutput = '';
    if (existed) { try { const old = parseSkill(fs.readFileSync(path.join(folder, 'SKILL.md'), 'utf8')).meta; keep = old.triggers ?? ''; keepNeeds = old.needs ?? ''; keepUnless = old.unless ?? ''; keepOutput = old.output ?? ''; } catch {} }
    const trig = parseTriggers(Array.isArray(triggers) ? triggers.join(',') : triggers ?? keep).join(', ');
    const needs = parseNeeds(keepNeeds).join(', ');
    const unless = parseUnless(keepUnless).join(', ');
    fs.mkdirSync(folder, { recursive: true });
    const oneLine = description.replace(/\s+/g, ' ').trim();
    fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${oneLine}\n${trig ? `triggers: ${trig}\n` : ''}${needs ? `needs: ${needs}\n` : ''}${unless ? `unless: ${unless}\n` : ''}${/^exact$/i.test(keepOutput) ? 'output: exact\n' : ''}---\n\n${instructions.trim()}\n`, 'utf8');
    for (const [f, content] of extra) fs.writeFileSync(path.join(folder, f), content, 'utf8');
    return { name, existed, files: ['SKILL.md', ...extra.map(([f]) => f)].map(f => `skills/${name}/${f}`) };
  }
}

/** run_python code that only exec()s a skill script prints nothing: name the functions it defines (claude-20261023:
 * Gemma ran just the exec line three times, got nothing back and then worked the answer out wrongly by itself). */
export function skillLoadHint(code, skillsDir) {
  const m = String(code ?? '').match(/exec\(\s*open\(\s*["'](?:\.\/)?skills[\\/]([a-z0-9-]+)[\\/]([A-Za-z0-9._-]+\.py)["']/);
  if (!m || !skillsDir) return '';
  let text;
  try { text = fs.readFileSync(path.join(skillsDir, m[1], m[2]), 'utf8'); } catch { return ''; }
  const fns = [...text.matchAll(/^def\s+([A-Za-z]\w*)\s*\(([^)]*)\)/gm)].map(([, n, a]) => `${n}(${a.replace(/\s+/g, ' ').trim()})`);
  if (!fns.length) return '';
  return [`Nothing was printed: exec(...) only loads skills/${m[1]}/${m[2]}, which defines:`, ...fns.map((f) => `- ${f}`),
    `Run run_python again with the same exec line plus a line that calls the right one with the user's numbers inside print(), e.g. print(${fns[0].split('(')[0]}(...)).`].join('\n');
}

function formatRun(r, emptyHint = '') {
  const parts = [`exit_code: ${r.exitCode}${r.timedOut ? ` (หมดเวลา ${r.timeoutSeconds}s)` : ''}${r.memoryKilled ? ' (หน่วยความจำไม่พอ)' : ''} · ${r.seconds}s`];
  if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout.trimEnd()}`);
  if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr.trimEnd()}`);
  const f = r.files;
  if (f.created.length) parts.push(`created: ${f.created.join(', ')}`);
  if (f.changed.length) parts.push(`changed: ${f.changed.join(', ')}`);
  if (f.deleted.length) parts.push(`deleted: ${f.deleted.join(', ')}`);
  if (!r.stdout.trim() && !r.stderr.trim() && r.exitCode === 0) parts.push(emptyHint || '(no output — use print() to show results)');
  return parts.join('\n\n');
}

export function sandboxTools(sandbox, skills) {
  return [
    {
      name: 'run_python',
      permission: 'read',
      description: 'Run Python 3.13 in Lumicos\'s sandbox and get stdout/stderr back. Use it for exact math, counting, dates, data/CSV/Excel processing, charts (save PNG to exports/), file conversion, or fetching a web page with requests. Working folder = the workspace (same files as the file tools). print() the answer. Preinstalled: numpy pandas scipy sympy matplotlib openpyxl python-docx pillow requests bs4 pythainlp tabulate; install others with pip_install("name"). Internet works; localhost/LAN do not. Thai has no spaces between words: to count or split Thai words use pythainlp.word_tokenize(text, keep_whitespace=False), never str.split(). Default timeout 120s.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['code'],
        properties: {
          code: { type: 'string', description: 'Complete Python program. Print results.' },
          timeout_seconds: { type: 'integer', minimum: 1, maximum: 270 },
        },
      },
      example: { code: 'import pandas as pd\ndf = pd.read_csv("spreadsheets/data.csv")\nprint(df.describe())' },
      preview: ({ code }) => ({ action: 'รัน Python', target: String(code).split('\n').find(l => l.trim())?.slice(0, 120) ?? '' }),
      handler: async ({ code, timeout_seconds }, ctx) => {
        const r = await sandbox.runPython({ code, timeoutSeconds: timeout_seconds }, ctx?.signal);
        const ok = r.exitCode === 0 && !r.timedOut;
        const made = [...r.files.created, ...r.files.changed];
        const silent = !r.stdout.trim() && !r.stderr.trim() && r.exitCode === 0;
        return {
          summary: ok ? `รันเสร็จ ${r.seconds}s${made.length ? ` · ${made.length} ไฟล์` : ''}` : (r.timedOut ? 'หมดเวลา' : `error (exit ${r.exitCode})`),
          content: formatRun(r, silent ? skillLoadHint(code, skills?.dir) : ''),
          data: r,
        };
      },
    },
    {
      name: 'read_skill',
      permission: 'read',
      // Getter: the list is rebuilt every time tools are rendered into the prompt.
      get description() {
        const list = skills.list();
        const names = list.length ? list.map(s => `${s.name} (${s.description})`).join('; ') : 'none yet';
        return `Read a saved skill (step-by-step instructions + scripts in skills/<name>/) BEFORE doing a task it covers, then follow it. Saved skills: ${names}.`;
      },
      parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } },
      preview: ({ name }) => ({ action: 'อ่าน skill', target: name }),
      handler: async ({ name }) => {
        const s = skills.read(name);
        return { summary: `อ่าน skill ${name}`, content: `${s.text}\n\nFiles: ${s.files.join(', ') || '(none)'}\nRun a script with run_python, e.g. exec(open("skills/${name}/script.py", encoding="utf-8").read())`, data: s };
      },
    },
    {
      name: 'save_skill',
      permission: 'read',
      description: 'Save (or update) a reusable skill after you solved a task that will come up again, or when the user asks. instructions = clear steps for your future self; files = optional {"script.py": "..."} helper scripts that run with run_python.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['name', 'description', 'instructions'],
        properties: {
          name: { type: 'string', description: 'short English name, lowercase-with-hyphens (e.g. loan-installment); other names are converted automatically' },
          description: { type: 'string', description: 'One line: when to use this skill' },
          instructions: { type: 'string' },
          files: { type: 'object' },
          triggers: { type: 'string', description: 'optional comma-separated words in the user message that should bring this skill up automatically (e.g. "VAT, ภาษีมูลค่าเพิ่ม")' },
        },
      },
      preview: ({ name }) => ({ action: 'บันทึก skill', target: name }),
      handler: async (args) => {
        const s = skills.save(args);
        return { summary: `${s.existed ? 'อัปเดต' : 'บันทึก'} skill ${s.name}`, content: JSON.stringify(s), data: s };
      },
    },
  ];
}
