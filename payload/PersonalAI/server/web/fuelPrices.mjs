// Thai pump prices straight from gasprice.kapook.com (server-rendered HTML; the page credits the Ministry of Energy),
// so "ราคาน้ำมันดีเซลวันนี้" is answered with the prices themselves. Web search found the same pages, but the passages
// it picked were the intro text, so Lumicos only listed links (claude-20261024, Real Chat Check rounds 9 and 10).
// Anything unexpected (page down, layout changed, nothing for the asked fuel) falls back to the normal web search.
export const FUEL_URL = 'https://gasprice.kapook.com/';

const FUEL_WORD = /ดีเซล|เบนซิน|แก๊สโซฮอ|โซฮอ|เอ็นจีวี|\bNGV\b|\bE\s?(?:20|85)\b|\bB\s?(?:7|20)\b|diesel|gasohol|petrol|gasoline/iu;
// "ราคาน้ำมัน…" alone means pump prices, but not cooking, crude or engine oil.
const OIL_PRICE = /ราคา\s*น้ำมัน(?!\s*(?:พืช|ปาล์ม|มะพร้าว|มะกอก|ถั่ว|งา|รำข้าว|หอย|ดิบ|เครื่อง|เกียร์|หล่อลื่น|เตา|ก๊าด|หอม|นวด|ละหุ่ง|ปลา|ตับปลา|เบรก))/u;
const PRICE_ASK = /ราคา|ลิตรละ|กี่บาท|เท่าไห?ร่|เท่าไร|เท่าใด|\bprice|how much|\bcost/iu;
// Not today's price at Thai pumps (news, forecasts, history, other countries, crude): the normal web search fits better.
const OTHER_ASK = /พรุ่งนี้|เมื่อวาน|ย้อนหลัง|ที่แล้ว|ปรับ|ขึ้นราคา|ลดราคา|ขึ้นอีก|ลงอีก|แนวโน้ม|คาดการณ์|คาดว่า|ข่าว|ประกาศ|ทำไม|เพราะอะไร|ตลาดโลก|น้ำมันดิบ|\bcrude|\bbrent|\bwti|ต่างประเทศ|ญี่ปุ่น|เกาหลี|จีน|อเมริกา|สหรัฐ|มาเลเซีย|ลาว|เวียดนาม|สิงคโปร์|กัมพูชา|พม่า|ยุโรป|อินเดีย|เครื่องบิน|เจ็ท|\bjet\b|กองทุน|ภาษี|โครงสร้างราคา|ต้นทุน|หุ้น/iu;

/** True for "today's price at Thai pumps" questions ("ราคาน้ำมันดีเซลวันนี้", "แก๊สโซฮอล์ 95 ลิตรละเท่าไหร่"). */
export function fuelPriceAsk(text) {
  const t = String(text ?? '');
  return PRICE_ASK.test(t) && (FUEL_WORD.test(t) || OIL_PRICE.test(t)) && !OTHER_ASK.test(t);
}

// What the question asks about (ask) and which listed items belong to it (item).
const FAMILIES = [
  { ask: /ดีเซล|diesel|\bB\s?(?:7|20)\b/iu, item: /ดีเซล/u },
  { ask: /แก๊สโซฮอ|โซฮอ|gasohol|\bE\s?(?:20|85)\b/iu, item: /แก๊สโซฮอล์/u },
  // In everyday Thai "เบนซิน" often means any petrol, gasohol included.
  { ask: /เบนซิน|petrol|gasoline/iu, item: /เบนซิน|แก๊สโซฮอล์/u },
  { ask: /\bNGV\b|เอ็นจีวี/iu, item: /NGV/u },
];
const BRAND_ASK = new Map([
  ['ปตท.', /ปตท|\bptt\b/iu], ['บางจาก', /บางจาก|bangchak/iu], ['เชลล์', /เชลล์|\bshell\b/iu], ['คาลเท็กซ์', /คาลเท็กซ์|caltex/iu],
  ['ไออาร์พีซี', /ไออาร์พีซี|\birpc\b/iu], ['พีที', /พีที(?!ที)|\bpt\b/iu], ['ซัสโก้', /ซัสโก้|susco/iu], ['เพียว', /เพียว|\bpure\b/iu],
  ['ซัสโก้ ดีลเลอร์', /ดีลเลอร์|dealer/iu],
]);
const brandAsked = (text, brand) => (BRAND_ASK.get(brand) ?? { test: (t) => t.includes(brand) }).test(text);

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** { date, isoDate, brands: [{ brand, items: [{ name, price, unit }] }] } from the kapook page, or null. */
export function parseKapookFuel(html) {
  const body = String(html ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '');
  const heads = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => ({ at: m.index, end: m.index + m[0].length, text: words(m[1]) }));
  const brands = [];
  heads.forEach((h, i) => {
    const name = h.text.match(/^ราคาน้ำมัน\s*(.+)$/u)?.[1]?.trim();
    if (!name) return;
    const items = [];
    for (const li of body.slice(h.end, heads[i + 1]?.at ?? body.length).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const parts = li[1].replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]+>/).map((s) => decode(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
      const at = parts.findIndex((p) => /^\d{1,3}\.\d{1,2}$/.test(p));
      const unit = at > 0 ? parts.slice(at + 1).find((p) => /^บาท\s*\/\s*\S+$/.test(p)) : undefined;
      if (unit) items.push({ name: parts[0], price: Number(parts[at]), unit: unit.replace(/\s+/g, '') });
    }
    if (items.length) brands.push({ brand: name, items });
  });
  if (!brands.length) return null;
  const d = heads.map((h) => h.text.match(/อัปเดต.*?(\d{1,2})\s*([ก-๙]+)\s*(\d{4})/u)).find(Boolean);
  const month = d ? THAI_MONTHS.indexOf(d[2]) + 1 : 0;
  const year = d ? Number(d[3]) - (Number(d[3]) > 2400 ? 543 : 0) : 0;
  return {
    date: d ? `${Number(d[1])} ${d[2]} ${d[3]}` : '',
    isoDate: month ? `${year}-${String(month).padStart(2, '0')}-${String(Number(d[1])).padStart(2, '0')}` : '',
    brands,
  };
}

/** Evidence text for the question: only the fuels and brands it names (all of them when it names none), or null. */
export function formatFuel(data, text = '') {
  const t = String(text ?? '');
  const families = FAMILIES.filter((f) => f.ask.test(t));
  const asked = data.brands.filter((b) => brandAsked(t, b.brand));
  const lines = [];
  for (const b of asked.length ? asked : data.brands) {
    const items = b.items.filter((it) => !families.length || families.some((f) => f.item.test(it.name)));
    if (items.length) lines.push(`${b.brand}: ${items.map((it) => `${it.name} ${it.price.toFixed(2)}${it.unit === 'บาท/ลิตร' ? '' : ` ${it.unit}`}`).join(' · ')}`);
  }
  if (!lines.length) return null;
  return [`ราคาน้ำมันขายปลีกหน้าปั๊มในประเทศไทย${data.date ? ` อัปเดต ${data.date}` : ''} หน่วย บาท/ลิตร (gasprice.kapook.com อ้างอิงข้อมูลกระทรวงพลังงาน)`, ...lines].join('\n');
}

/** { text, date, isoDate } for the question, or null (then the caller does a normal web search). */
export async function fetchFuelPrices(text, { fetchImpl = fetch, signal } = {}) {
  try {
    const r = await fetchImpl(FUEL_URL, {
      headers: { 'user-agent': 'LumicosLocalAI/1.0', accept: 'text/html', 'accept-language': 'th,en;q=0.8' },
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]),
    });
    if (!r.ok) return null;
    const data = parseKapookFuel(await r.text());
    const out = data && formatFuel(data, text);
    return out ? { text: out, date: data.date, isoDate: data.isoDate } : null;
  } catch { return null; }
}
