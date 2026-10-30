// Lumicos web search = Search MCP v6 engine (C:\AI\LumicosSearchMCP\search_core.py).
// One long-lived Python process (bridge.py) speaks JSON lines; no API key, no GPU.
import fs from 'node:fs';
import { pythonLaunch } from '../util/hiddenPython.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rewriteSearchQuery } from '../knowledge/web/queryRewrite.mjs';
import { sportsIntent, fetchFootballScores } from './sportsScores.mjs';
import { fuelPriceAsk, fetchFuelPrices, FUEL_URL } from './fuelPrices.mjs';
import { stripWebAsk } from '../knowledge/askWords.mjs';

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

export class SearchV6Service {
  constructor(options = {}) {
    this.root = options.root ?? process.env.LUMICOS_SEARCH_DIR ?? 'C:/AI/LumicosSearchMCP';
    this.python = options.python ?? process.env.LUMICOS_SEARCH_PYTHON ?? 'C:/AI/Lumicos-Sandbox/python/python.exe';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.child = null; this.pending = new Map(); this.ready = null; this.cache = new Map();
    // What each search found (and the engines' own errors) goes to this file, so "ค้นเว็บแล้วไม่เจอ" can be explained later.
    this.logFile = options.logFile ?? null;
  }

  #log(text) {
    if (!this.logFile) return;
    try {
      if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > 2_000_000) fs.renameSync(this.logFile, this.logFile + '.old');
      fs.appendFileSync(this.logFile, text.endsWith('\n') ? text : text + '\n');
    } catch { /* logging must never break a search */ }
  }

  async status() {
    const ok = fs.existsSync(path.join(this.root, 'bridge.py')) && fs.existsSync(path.join(this.root, 'deps', 'ddgs')) && fs.existsSync(this.python);
    return { ready: ok, label: 'ค้นเว็บ (Lumicos Search v6)' };
  }

  #start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const launch = pythonLaunch(this.python);
      const child = spawn(launch.command, ['-u', '-X', 'utf8', path.join(this.root, 'bridge.py')], {
        cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', ...launch.env },
      });
      this.child = child;
      let buffer = '';
      const startTimer = setTimeout(() => reject(fail('Search v6 start timed out')), 20_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          let msg; try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { clearTimeout(startTimer); resolve(); continue; }
          const job = this.pending.get(msg.id);
          if (job) { this.pending.delete(msg.id); job.resolve(msg); }
        }
      });
      if (this.logFile) { child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => this.#log(String(chunk).slice(0, 4000))); }
      else child.stderr.resume();
      child.on('error', e => { clearTimeout(startTimer); reject(e); });
      child.on('exit', () => {
        clearTimeout(startTimer);
        for (const job of this.pending.values()) job.reject(fail('Search v6 stopped'));
        this.pending.clear(); this.child = null; this.ready = null;
      });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async call(tool, args, signal) {
    signal?.throwIfAborted();
    await this.#start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      const timer = setTimeout(() => { this.pending.delete(id); done(); reject(fail(`ค้นเว็บเกินเวลา ${Math.round(this.timeoutMs / 1000)} วินาที`)); }, this.timeoutMs);
      const onAbort = () => { this.pending.delete(id); done(); reject(signal.reason); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve: m => { done(); m.ok === false && m.error ? reject(fail(m.error)) : resolve(m); }, reject: e => { done(); reject(e); } });
      this.child.stdin.write(JSON.stringify({ id, tool, args }) + '\n');
    });
  }

  async search(query, limit = 4, signal) {
    if (typeof limit === 'object') { signal = limit?.signal; limit = query.limit ?? 4; query = query.query; }
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw fail('คำค้นต้องมี 1–500 ตัวอักษร', 400);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw fail('ค้นได้ครั้งละ 1–5 ผลลัพธ์', 400);
    const key = JSON.stringify([query.trim(), limit]);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 120_000) return { ...cached.value, cacheHit: true };
    const value = await this.#search(query.trim(), limit, signal);
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async #search(query, limit, signal) {
    const rewrite = rewriteSearchQuery(query);
    const started = performance.now();
    // Football results: real numbers from ESPN's scoreboard instead of links to JS-only live-score pages.
    const leagues = sportsIntent(rewrite.original);
    if (leagues) {
      const scores = await fetchFootballScores(leagues, { signal }).catch(() => null);
      if (scores) return { query: rewrite.original, searchedAt: new Date().toISOString(), cacheHit: false, elapsedMs: Math.round(performance.now() - started),
        results: [{ id: '1', title: 'ESPN scoreboard — football results (last 5 days, newest first)', url: 'https://www.espn.com/soccer/scoreboard', snippet: scores.text.slice(0, 3800), publishedAt: new Date().toISOString(), metadata: { retrievalMethod: 'espn-scoreboard', read: true } }],
        providerDiagnostics: { engine: 'espn-scoreboard', providerLatencyMs: Math.round(performance.now() - started), fallbackCount: null, providerCacheHit: false, rewritten: false } };
    }
    // Thai pump prices: the prices themselves from gasprice.kapook.com instead of links to price pages (fuelPrices.mjs).
    if (fuelPriceAsk(rewrite.original)) {
      const fuel = await fetchFuelPrices(rewrite.original, { signal }).catch(() => null);
      if (fuel) return { query: rewrite.original, searchedAt: new Date().toISOString(), cacheHit: false, elapsedMs: Math.round(performance.now() - started),
        results: [{ id: '1', title: `ราคาน้ำมันวันนี้${fuel.date ? ` (อัปเดต ${fuel.date})` : ''} — gasprice.kapook.com`, url: FUEL_URL, snippet: fuel.text.slice(0, 3500),
          publishedAt: fuel.isoDate ? `${fuel.isoDate}T00:00:00+07:00` : new Date().toISOString(), metadata: { retrievalMethod: 'kapook-gasprice' } }],
        providerDiagnostics: { engine: 'kapook-gasprice', providerLatencyMs: Math.round(performance.now() - started), fallbackCount: null, providerCacheHit: false, rewritten: false } };
    }
    // "ค้นเว็บ …" is the command, not the topic: the engine and its passage ranking get the topic only (askWords.mjs).
    const topic = stripWebAsk(rewrite.original) || rewrite.original;
    const queries = [...new Set([stripWebAsk(rewrite.providerQuery) || rewrite.providerQuery, topic].filter(Boolean))].slice(0, 2);
    const research = async (qs, attempt) => {
      const res = await this.call('research', { question: topic, queries: qs, max_pages: Math.min(Math.max(limit, 2), 5), recent: '' }, signal);
      const sources = res.sources ?? [];
      const usable = sources.filter(s => s.url && !s.lowRelevance).slice(0, limit).map(s => ({
        id: String(s.n), title: String(s.title ?? s.url).slice(0, 240), url: s.url, snippet: String(s.passage ?? '').slice(0, 1100),
        publishedAt: s.date || null, metadata: { retrievalMethod: 'search-v6-research', read: s.read },
      }));
      this.#log(`${new Date().toISOString()} research#${attempt} ${JSON.stringify(qs).slice(0, 300)} sources=${sources.length} usable=${usable.length} lowRelevance=${sources.filter(s => s.lowRelevance).length}${res.errors?.length ? ` errors=${JSON.stringify(res.errors).slice(0, 600)}` : ''}`);
      return usable;
    };
    let results = await research(queries, 1);
    let attempts = 1;
    // Search engines sometimes answer with nothing for a moment (rate limits): one more try before giving up.
    if (!results.length) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      signal?.throwIfAborted();
      results = await research([...queries].reverse(), 2);
      attempts = 2;
    }
    if (!results.length) throw fail('ไม่พบผลค้นเว็บที่ใช้อ้างอิงได้ กรุณาลองคำค้นอื่น');
    return { query: rewrite.original, searchedAt: new Date().toISOString(), cacheHit: false, results,
      elapsedMs: Math.round(performance.now() - started),
      providerDiagnostics: { engine: 'search-v6', providerLatencyMs: Math.round(performance.now() - started), fallbackCount: attempts - 1, providerCacheHit: false, rewritten: rewrite.rewritten } };
  }

  async fetchUrl(url, signal) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw fail('Invalid URL', 400);
    const page = await this.call('fetch_page', { url: parsed.href, max_chars: 3500 }, signal);
    return { url: page.url || parsed.href, title: page.title || parsed.hostname, content: String(page.text ?? '').slice(0, 3500), fetchedAt: new Date().toISOString() };
  }

  async close() { const child = this.child; this.child = null; this.ready = null; child?.kill(); }
}
