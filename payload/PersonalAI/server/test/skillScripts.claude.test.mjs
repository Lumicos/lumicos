// Runs the shipped skill scripts with Python (when this machine has python3/python) and checks their worked examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ws = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'workspace');
const python = ['python3', 'python'].find((cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0);
const run = (skill, code) => {
  const script = path.join(ws, 'skills', skill, 'script.py');
  const r = spawnSync(python, ['-X', 'utf8', '-c', `exec(open(${JSON.stringify(script)}, encoding="utf-8").read())\n${code}`], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const skip = (t, skill) => {
  if (!python) return t.skip('no python here'), true;
  if (!fs.existsSync(path.join(ws, 'skills', skill, 'script.py'))) return t.skip(`no ${skill} here`), true;
  return false;
};

test('split-bill: equal split, Thai service-then-VAT order, round-up, per-person items; shares add up to the satang', (t) => {
  if (skip(t, 'split-bill')) return;
  run('split-bill', `
r = split_bill(1250, 3); assert r["shares"] == [416.67, 416.67, 416.66], r
r = split_bill(2000, 4, service=10, vat=7); assert (r["service"], r["vat"], r["grand_total"], r["per_person"]) == (200.0, 154.0, 2354.0, 588.5), r
r = split_bill("1,999", 3, service=10, vat=7, round_up_to=10); assert (r["grand_total"], r["per_person_rounded"], r["extra"]) == (2352.82, 790.0, 17.18), r
r = split_items({"a": 250, "b": 180, "c": 320}, shared=300, service=10, vat=7); assert r["รวม"] == 1235.85 and round(r["a"] + r["b"] + r["c"], 2) == 1235.85, r`);
});

test('power-cost: watts × hours, air-con from BTU/SEER, fridge from the yearly label, real rate from a bill', (t) => {
  if (skip(t, 'power-cost')) return;
  run('power-cost', `
r = appliance_cost(1200, 8); assert (r["kwh_total"], r["baht_total"]) == (288.0, 1296.0), r
r = appliance_cost(3500, minutes_per_day=30, rate=4.5); assert (r["kwh_total"], r["baht_total"]) == (52.5, 236.25), r
try:
    appliance_cost(3500, 30); raise AssertionError("30 hours a day must be refused")
except ValueError as e:
    assert "minutes_per_day" in str(e), e
assert aircon_watts(12000) == 800 and appliance_cost(aircon_watts(12000), 8)["baht_total"] == 864.0
assert label_cost(320) == {"baht_per_year": 1440.0, "baht_per_month": 120.0, "rate": 4.5}
assert bill_rate(1850, 410) == 4.51
try:
    appliance_cost(100, 25); raise SystemExit("no error")
except ValueError: pass`);
});

test('world-time: Thai time words, daylight saving, day change; the built-in rules agree with the tz database', (t) => {
  if (skip(t, 'world-time')) return;
  run('world-time', `
from datetime import datetime, timedelta, timezone
for text, want in {"3 ทุ่ม": (21, 0), "2 ทุ่มครึ่ง": (20, 30), "บ่ายโมง": (13, 0), "บ่ายสามโมงครึ่ง": (15, 30), "ตีสาม": (3, 0), "สี่โมงเช้า": (10, 0),
                   "8 โมงเช้า": (8, 0), "5 โมงเย็น": (17, 0), "เที่ยงคืน": (0, 0), "21.30 น.": (21, 30), "9pm": (21, 0), "4 โมง": (16, 0)}.items():
    assert parse_thai_time(text) == want, (text, parse_thai_time(text))
fixed = datetime(2026, 10, 22, 14, 15, tzinfo=timezone.utc)
rows = {r["place"]: r["time"] for r in now_in("ญี่ปุ่น", "ลอนดอน", "นิวยอร์ก", "ซิดนีย์", now=fixed, use_tzdb=False)}
assert rows == {"โตเกียว": "23:15", "ลอนดอน": "15:15", "นิวยอร์ก": "10:15", "ซิดนีย์": "01:15"}, rows
r = convert_time("ตี 3", "กรุงเทพ", "นิวยอร์ก", on="2026-12-01", use_tzdb=False); assert r["to"] == "2026-11-30 15:00" and r["day"] == "วันก่อนหน้า", r
r = convert_time("12:00", "อเมริกา", "ไทย", on="2026-07-01", use_tzdb=False); assert r["to"] == "2026-07-01 23:00", r
try:
    from zoneinfo import ZoneInfo; ZoneInfo("Asia/Tokyo"); has_db = True
except Exception:
    has_db = False
if has_db:
    seen, bad, t = set(), [], datetime(2026, 1, 1, tzinfo=timezone.utc)
    zones = [v for v in _P.values() if not (v[1] in seen or seen.add(v[1]))]
    while t < datetime(2028, 1, 1, tzinfo=timezone.utc):
        bad += [(z[1], t) for z in zones if _offset(z, t, True) != _offset(z, t, False)]
        t += timedelta(hours=1)
    assert not bad, bad[:5]
try:
    now_in("แอตแลนติส"); raise SystemExit("no error")
except ValueError: pass`);
});

test('savings-growth: monthly compounding matches a month-by-month loop; goal helpers invert it', (t) => {
  if (skip(t, 'savings-growth')) return;
  run('savings-growth', `
bal = 0.0
for _ in range(120): bal = bal * (1 + 0.02 / 12) + 5000
r = savings(5000, 10, rate=2); assert r["final"] == round(bal, 2) == 663598.3 and r["deposited"] == 600000.0, r
assert savings(5000, 10, rate=2, tax=15)["tax"] == 9539.75
m = monthly_needed(1000000, 10, rate=2); assert m["monthly"] == 7534.68 and abs(savings(m["monthly"], 10, rate=2)["final"] - 1000000) < 1, m
g = months_to_goal(100000, 3000, rate=1.5); assert g["months"] == 33 and g["period"] == "2 ปี 9 เดือน", g
assert monthly_needed(120000, 2)["monthly"] == 5000.0`);
});
