// Football scores straight from ESPN's public scoreboard JSON (no key, no GPU).
// Used by the web search service so "ผลบอลล่าสุด" is answered with real numbers, not links to JS-only live-score pages.
const LEAGUES = [
  { slug: 'eng.1', name: 'Premier League', re: /พรีเมียร์|พรีเมียร์ลีก|premier\s*league|epl|ngoại hạng/iu },
  { slug: 'esp.1', name: 'La Liga', re: /ลาลีกา|la\s*liga/iu },
  { slug: 'ger.1', name: 'Bundesliga', re: /บุนเดส|bundesliga/iu },
  { slug: 'ita.1', name: 'Serie A', re: /เซเรีย|serie\s*a/iu },
  { slug: 'fra.1', name: 'Ligue 1', re: /ลีกเอิง|ligue\s*1/iu },
  { slug: 'uefa.champions', name: 'Champions League', re: /แชมป์เปี้ยนส์|แชมเปียนส์|champions\s*league|ucl/iu },
  { slug: 'uefa.europa', name: 'Europa League', re: /ยูโรป้า|europa/iu },
  { slug: 'tha.1', name: 'Thai League 1', re: /ไทยลีก|thai\s*league/iu },
];
const FOOTBALL = /(ผลบอล|ผลฟุตบอล|ฟุตบอล|ผลการแข่งขัน.*(บอล|ลีก)|บอล(เมื่อคืน|คืนนี้|วันนี้|ล่าสุด)|football|soccer|premier\s*league|la\s*liga|bundesliga|serie\s*a|champions\s*league)/iu;
const DEFAULT = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'uefa.champions'];

/** Which leagues the text asks about, or null when it is not a football-score question. */
export function sportsIntent(text) {
  const t = String(text ?? '');
  const named = LEAGUES.filter(l => l.re.test(t));
  if (!named.length && !FOOTBALL.test(t)) return null;
  if (!/(ผล|สกอร์|score|result|ชนะ|แพ้|เสมอ|ล่าสุด|เมื่อคืน|คืนนี้|วันนี้|latest|last night|tonight|today)/iu.test(t)) return null;
  return named.length ? named : LEAGUES.filter(l => DEFAULT.includes(l.slug));
}

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const status = e => e.status?.type?.state; // pre | in | post

export function formatEvent(e) {
  const comp = e.competitions?.[0]; const [h, a] = ['home', 'away'].map(s => comp?.competitors?.find(c => c.homeAway === s));
  if (!h || !a) return null;
  const st = status(e), d = e.status?.type?.shortDetail ?? '';
  if (st === 'pre') return null;
  const tag = st === 'in' ? `กำลังแข่ง ${d}` : (/FT|Full/i.test(d) ? 'FT' : d || 'FT');
  return `${h.team.displayName} ${h.score}–${a.score} ${a.team.displayName} (${tag})`;
}

/** Fetch finished/live matches for the last `days` days. Returns { text, matches } or null when nothing found. */
export async function fetchFootballScores(leagues, { now = Date.now(), days = 4, fetchImpl = fetch, signal } = {}) {
  const dates = Array.from({ length: days + 1 }, (_, i) => ymd(new Date(now - i * 86_400_000)));
  const blocks = [];
  let count = 0;
  await Promise.all(leagues.map(async l => {
    const lines = [];
    const days = await Promise.all(dates.map(async dt => {
      try {
        const r = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/soccer/${l.slug}/scoreboard?dates=${dt}`, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]) });
        if (!r.ok) return [dt, []];
        return [dt, (await r.json()).events ?? []];
      } catch { return [dt, []]; }
    }));
    for (const [dt, events] of days.sort((x, y) => y[0].localeCompare(x[0]))) {
      const rows = events.map(formatEvent).filter(Boolean);
      if (rows.length) lines.push(`${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6)}: ${rows.join('; ')}`);
      count += rows.length;
    }
    if (lines.length) blocks.push({ order: LEAGUES.findIndex(x => x.slug === l.slug), text: `${l.name} — ${lines.slice(0, 3).join(' | ')}` });
  }));
  if (!count) return null;
  blocks.sort((a, b) => a.order - b.order);
  return { text: blocks.map(b => b.text).join('\n'), matches: count };
}
