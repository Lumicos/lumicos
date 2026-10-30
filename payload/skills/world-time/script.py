"""เวลาต่างประเทศ: ตอนนี้ที่ไหนกี่โมง และแปลงเวลา (เช่น "3 ทุ่ม", "บ่าย 2", "ตี 3", "21:30") จากเมืองหนึ่งไปอีกเมือง.
ใช้ฐานข้อมูลเขตเวลาของเครื่องถ้ามี ถ้าไม่มี (Windows ที่ไม่มี tzdata) ใช้กฎเวลาออมแสงที่ใส่ไว้ในไฟล์นี้."""
import re
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python เก่า
    ZoneInfo = None

# ชื่อที่ผู้ใช้พิมพ์ → (ชื่อที่แสดง, IANA zone, ชั่วโมงต่าง UTC ช่วงปกติ, กฎเวลาออมแสง, หมายเหตุ)
_P = {}


def _add(names, show, zone, std, rule=None, note=""):
    for n in names:
        _P[n.lower()] = (show, zone, std, rule, note)


_add(["กรุงเทพ", "กรุงเทพฯ", "ไทย", "bangkok", "thailand"], "กรุงเทพ", "Asia/Bangkok", 7)
_add(["ญี่ปุ่น", "โตเกียว", "โอซาก้า", "เกียวโต", "japan", "tokyo", "osaka"], "โตเกียว", "Asia/Tokyo", 9)
_add(["เกาหลี", "โซล", "ปูซาน", "korea", "seoul"], "โซล", "Asia/Seoul", 9)
_add(["จีน", "ปักกิ่ง", "เซี่ยงไฮ้", "china", "beijing", "shanghai"], "ปักกิ่ง", "Asia/Shanghai", 8)
_add(["ฮ่องกง", "hong kong"], "ฮ่องกง", "Asia/Hong_Kong", 8)
_add(["ไต้หวัน", "ไทเป", "taiwan", "taipei"], "ไทเป", "Asia/Taipei", 8)
_add(["สิงคโปร์", "singapore"], "สิงคโปร์", "Asia/Singapore", 8)
_add(["มาเลเซีย", "กัวลาลัมเปอร์", "malaysia", "kuala lumpur"], "กัวลาลัมเปอร์", "Asia/Kuala_Lumpur", 8)
_add(["ฟิลิปปินส์", "มะนิลา", "philippines", "manila"], "มะนิลา", "Asia/Manila", 8)
_add(["เวียดนาม", "ฮานอย", "โฮจิมินห์", "vietnam", "hanoi"], "ฮานอย", "Asia/Ho_Chi_Minh", 7)
_add(["ลาว", "เวียงจันทน์", "laos"], "เวียงจันทน์", "Asia/Vientiane", 7)
_add(["กัมพูชา", "พนมเปญ", "cambodia"], "พนมเปญ", "Asia/Phnom_Penh", 7)
_add(["พม่า", "เมียนมา", "ย่างกุ้ง", "myanmar", "yangon"], "ย่างกุ้ง", "Asia/Yangon", 6.5)
_add(["อินโดนีเซีย", "จาการ์ตา", "indonesia", "jakarta"], "จาการ์ตา", "Asia/Jakarta", 7, note="อินโดนีเซียมีหลายเขตเวลา ใช้จาการ์ตา")
_add(["บาหลี", "bali"], "บาหลี", "Asia/Makassar", 8)
_add(["อินเดีย", "นิวเดลี", "มุมไบ", "india", "delhi", "mumbai"], "นิวเดลี", "Asia/Kolkata", 5.5)
_add(["เนปาล", "กาฐมาณฑุ", "nepal"], "กาฐมาณฑุ", "Asia/Kathmandu", 5.75)
_add(["ดูไบ", "ยูเออี", "อาบูดาบี", "dubai", "uae"], "ดูไบ", "Asia/Dubai", 4)
_add(["กาตาร์", "โดฮา", "qatar", "doha"], "โดฮา", "Asia/Qatar", 3)
_add(["ซาอุ", "ซาอุดีอาระเบีย", "ริยาด", "saudi", "riyadh"], "ริยาด", "Asia/Riyadh", 3)
_add(["ตุรกี", "อิสตันบูล", "turkey", "istanbul"], "อิสตันบูล", "Europe/Istanbul", 3)
_add(["รัสเซีย", "มอสโก", "russia", "moscow"], "มอสโก", "Europe/Moscow", 3, note="รัสเซียมีหลายเขตเวลา ใช้มอสโก")
_add(["อังกฤษ", "ลอนดอน", "uk", "england", "london"], "ลอนดอน", "Europe/London", 0, "EU")
_add(["ไอร์แลนด์", "ดับลิน", "ireland", "dublin"], "ดับลิน", "Europe/Dublin", 0, "EU")
_add(["โปรตุเกส", "ลิสบอน", "portugal", "lisbon"], "ลิสบอน", "Europe/Lisbon", 0, "EU")
_add(["ฝรั่งเศส", "ปารีส", "france", "paris"], "ปารีส", "Europe/Paris", 1, "EU")
_add(["เยอรมนี", "เยอรมัน", "เบอร์ลิน", "มิวนิค", "germany", "berlin", "munich"], "เบอร์ลิน", "Europe/Berlin", 1, "EU")
_add(["อิตาลี", "โรม", "มิลาน", "italy", "rome", "milan"], "โรม", "Europe/Rome", 1, "EU")
_add(["สเปน", "มาดริด", "บาร์เซโลนา", "spain", "madrid", "barcelona"], "มาดริด", "Europe/Madrid", 1, "EU")
_add(["เนเธอร์แลนด์", "ฮอลแลนด์", "อัมสเตอร์ดัม", "netherlands", "amsterdam"], "อัมสเตอร์ดัม", "Europe/Amsterdam", 1, "EU")
_add(["สวิตเซอร์แลนด์", "ซูริค", "เจนีวา", "switzerland", "zurich", "geneva"], "ซูริค", "Europe/Zurich", 1, "EU")
_add(["สวีเดน", "สตอกโฮล์ม", "sweden", "stockholm"], "สตอกโฮล์ม", "Europe/Stockholm", 1, "EU")
_add(["ฟินแลนด์", "เฮลซิงกิ", "finland", "helsinki"], "เฮลซิงกิ", "Europe/Helsinki", 2, "EU")
_add(["กรีซ", "เอเธนส์", "greece", "athens"], "เอเธนส์", "Europe/Athens", 2, "EU")
_add(["อเมริกา", "สหรัฐ", "นิวยอร์ก", "วอชิงตัน", "บอสตัน", "ไมอามี", "usa", "new york", "washington", "boston", "miami"],
     "นิวยอร์ก", "America/New_York", -5, "US", "อเมริกามีหลายเขตเวลา ใช้นิวยอร์ก (ฝั่งตะวันออก)")
_add(["ชิคาโก", "เท็กซัส", "ดัลลาส", "ฮิวสตัน", "chicago", "dallas", "houston"], "ชิคาโก", "America/Chicago", -6, "US")
_add(["เดนเวอร์", "denver"], "เดนเวอร์", "America/Denver", -7, "US")
_add(["แอลเอ", "ลอสแอนเจลิส", "ซานฟรานซิสโก", "ซีแอตเทิล", "ลาสเวกัส", "los angeles", "san francisco", "seattle", "las vegas"],
     "ลอสแอนเจลิส", "America/Los_Angeles", -8, "US")
_add(["ฮาวาย", "โฮโนลูลู", "hawaii", "honolulu"], "โฮโนลูลู", "Pacific/Honolulu", -10)
_add(["แคนาดา", "โทรอนโต", "canada", "toronto"], "โทรอนโต", "America/Toronto", -5, "US", "แคนาดามีหลายเขตเวลา ใช้โทรอนโต")
_add(["แวนคูเวอร์", "vancouver"], "แวนคูเวอร์", "America/Vancouver", -8, "BC")
_add(["เม็กซิโก", "mexico"], "เม็กซิโกซิตี", "America/Mexico_City", -6)
_add(["บราซิล", "เซาเปาโล", "brazil", "sao paulo"], "เซาเปาโล", "America/Sao_Paulo", -3, note="บราซิลมีหลายเขตเวลา ใช้เซาเปาโล")
_add(["อาร์เจนตินา", "บัวโนสไอเรส", "argentina", "buenos aires"], "บัวโนสไอเรส", "America/Argentina/Buenos_Aires", -3)
_add(["ออสเตรเลีย", "ซิดนีย์", "เมลเบิร์น", "แคนเบอร์รา", "australia", "sydney", "melbourne"], "ซิดนีย์", "Australia/Sydney", 10, "AU",
     "ออสเตรเลียมีหลายเขตเวลา ใช้ซิดนีย์")
_add(["บริสเบน", "brisbane"], "บริสเบน", "Australia/Brisbane", 10)
_add(["เพิร์ธ", "perth"], "เพิร์ธ", "Australia/Perth", 8)
_add(["นิวซีแลนด์", "โอ๊คแลนด์", "new zealand", "auckland"], "โอ๊คแลนด์", "Pacific/Auckland", 12, "NZ")
_add(["แอฟริกาใต้", "โจฮันเนสเบิร์ก", "south africa", "johannesburg"], "โจฮันเนสเบิร์ก", "Africa/Johannesburg", 2)
_add(["เคนยา", "ไนโรบี", "kenya", "nairobi"], "ไนโรบี", "Africa/Nairobi", 3)

_WEEKDAY = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]
_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]


def _place(name):
    s = str(name).strip().lower()
    for w in ("ประเทศ", "เมือง", "ที่", "ตอนนี้", "เวลา"):
        s = s.replace(w, "")
    s = s.strip()
    if s in _P:
        return _P[s]
    for key in sorted(_P, key=len, reverse=True):  # "โตเกียว ญี่ปุ่น", "นิวยอร์กซิตี้"
        if key.isascii():
            if re.search(r"(^|[^a-z])" + re.escape(key) + r"($|[^a-z])", s):
                return _P[key]
        elif key in s:
            return _P[key]
    raise ValueError(f"ไม่รู้จักเมือง/ประเทศ: {name}")


def _nth_sunday(y, m, n):
    d = date(y, m, 1)
    return d + timedelta(days=(6 - d.weekday()) % 7 + 7 * (n - 1))


def _last_sunday(y, m):
    d = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - 6) % 7)


def _at(d, hour_utc):
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(hours=hour_utc)


def _dst(rule, std, utc):
    y = utc.year
    if rule == "US":    # อาทิตย์ที่ 2 ของ มี.ค. 02:00 ถึงอาทิตย์แรกของ พ.ย. 02:00 (เวลาท้องถิ่น)
        return _at(_nth_sunday(y, 3, 2), 2 - std) <= utc < _at(_nth_sunday(y, 11, 1), 1 - std)
    if rule == "BC":    # บริติชโคลัมเบีย: ใช้ UTC-7 ตลอดปีตั้งแต่ 1 พ.ย. 2026 (tzdata 2026e) ก่อนหน้านั้นเหมือนสหรัฐฯ
        return utc >= datetime(2026, 11, 1, 9, tzinfo=timezone.utc) or _dst("US", std, utc)
    if rule == "EU":    # อาทิตย์สุดท้ายของ มี.ค. ถึงอาทิตย์สุดท้ายของ ต.ค. 01:00 UTC
        return _at(_last_sunday(y, 3), 1) <= utc < _at(_last_sunday(y, 10), 1)
    if rule == "AU":    # อาทิตย์แรกของ ต.ค. ถึงอาทิตย์แรกของ เม.ย. (ซีกโลกใต้)
        return utc < _at(_nth_sunday(y, 4, 1), 2 - std) or utc >= _at(_nth_sunday(y, 10, 1), 2 - std)
    if rule == "NZ":    # อาทิตย์สุดท้ายของ ก.ย. ถึงอาทิตย์แรกของ เม.ย.
        return utc < _at(_nth_sunday(y, 4, 1), 2 - std) or utc >= _at(_last_sunday(y, 9), 2 - std)
    return False


def _offset(info, utc, use_tzdb=True):
    _, zone, std, rule, _ = info
    if use_tzdb and ZoneInfo is not None:
        try:
            return utc.astimezone(ZoneInfo(zone)).utcoffset().total_seconds() / 3600
        except Exception:  # ไม่มีฐานข้อมูลเขตเวลาในเครื่อง
            pass
    return std + (1 if _dst(rule, std, utc) else 0)


def _fmt(local):
    return f"{local:%H:%M} วัน{_WEEKDAY[local.weekday()]}ที่ {local.day} {_MONTH[local.month - 1]}"


def _diff(hours, ref):
    if hours == 0:
        return f"เวลาเดียวกับ{ref}"
    h, m = divmod(round(abs(hours) * 60), 60)
    span = f"{h} ชั่วโมง" + (f" {m} นาที" if m else "") if h else f"{m} นาที"
    return ("เร็วกว่า" if hours > 0 else "ช้ากว่า") + f"{ref} " + span


_TH_NUM = {"สิบเอ็ด": 11, "สิบสอง": 12, "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7,
           "แปด": 8, "เก้า": 9, "สิบ": 10}


def parse_thai_time(text):
    """"3 ทุ่ม" → (21, 0), "บ่าย 2" → (14, 0), "ตี 3" → (3, 0), "สี่โมงเช้า" → (10, 0), "2 ทุ่มครึ่ง" → (20, 30),
    "21:30" / "21.30 น." → (21, 30), "9pm" → (21, 0), "เที่ยงคืน" → (0, 0)."""
    s = str(text).strip().lower().translate(str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")).replace(" ", "")
    for word, n in _TH_NUM.items():
        s = s.replace(word, str(n))
    minute = 30 if "ครึ่ง" in s else 0
    m = re.search(r"(\d{1,2})[:.](\d{2})", s)
    if m:
        h, minute = int(m[1]), int(m[2])
        if "pm" in s and h < 12:
            h += 12
        if "am" in s and h == 12:
            h = 0
        if h > 23 or minute > 59:
            raise ValueError(f"เวลาไม่ถูกต้อง: {text}")
        return h, minute
    m = re.search(r"(\d{1,2})(am|pm)", s)
    if m:
        h = int(m[1]) % 12
        return (h + 12 if m[2] == "pm" else h), minute
    if "เที่ยงคืน" in s:
        return 0, minute
    if "เที่ยง" in s:
        return 12, minute
    m = re.search(r"ตี(\d{1,2})", s)
    if m:
        return int(m[1]) % 24, minute
    m = re.search(r"(\d{1,2})?ทุ่ม", s)
    if m:
        return 18 + int(m[1] or 1), minute
    m = re.search(r"บ่าย(\d{1,2})?", s)
    if m:
        return 12 + int(m[1] or 1), minute
    m = re.search(r"(\d{1,2})?โมงเย็น", s)
    if m:
        return 12 + int(m[1] or 6), minute
    m = re.search(r"(\d{1,2})?โมงเช้า", s)
    if m:
        n = int(m[1] or 1)
        return (6 + n if n <= 5 else n), minute
    m = re.search(r"(\d{1,2})โมง", s)
    if m:
        n = int(m[1])
        return (12 + n if 1 <= n <= 5 else n % 24), minute
    m = re.fullmatch(r"(\d{1,2})", s)
    if m and int(m[1]) < 24:
        return int(m[1]), 0
    raise ValueError(f"อ่านเวลาไม่ออก: {text}")


def now_in(*places, now=None, use_tzdb=True):
    """เวลาตอนนี้ของแต่ละที่ เทียบกับเวลาไทย. now = datetime UTC (ไว้ทดสอบ) ปกติไม่ต้องใส่."""
    utc = now or datetime.now(timezone.utc)
    th = _offset(_place("กรุงเทพ"), utc, use_tzdb)
    rows = []
    for p in places or ("กรุงเทพ",):
        info = _place(p)
        off = _offset(info, utc, use_tzdb)
        local = utc.replace(tzinfo=None) + timedelta(hours=off)
        text = f"{info[0]}: {_fmt(local)}" + ("" if info[0] == "กรุงเทพ" else f" ({_diff(off - th, 'ไทย')})")
        rows.append({"place": info[0], "time": f"{local:%H:%M}", "date": local.date().isoformat(), "vs_thailand_hours": off - th,
                     "text": text + (f" — {info[4]}" if info[4] else "")})
    return rows


def convert_time(when, from_place="กรุงเทพ", to_place="โตเกียว", on=None, now=None, use_tzdb=True):
    """แปลงเวลา when (เช่น "3 ทุ่ม", "21:30") ของ from_place เป็นเวลาที่ to_place.
    on = วันที่ของต้นทาง "YYYY-MM-DD" (ไม่ใส่ = วันนี้ของต้นทาง)."""
    h, m = parse_thai_time(when)
    src, dst = _place(from_place), _place(to_place)
    utc_now = now or datetime.now(timezone.utc)
    if on:
        day = date.fromisoformat(str(on))
    else:
        day = (utc_now.replace(tzinfo=None) + timedelta(hours=_offset(src, utc_now, use_tzdb))).date()
    local_src = datetime(day.year, day.month, day.day, h, m)
    guess = (local_src - timedelta(hours=src[2])).replace(tzinfo=timezone.utc)
    utc = (local_src - timedelta(hours=_offset(src, guess, use_tzdb))).replace(tzinfo=timezone.utc)
    off_src, off_dst = _offset(src, utc, use_tzdb), _offset(dst, utc, use_tzdb)
    local_dst = utc.replace(tzinfo=None) + timedelta(hours=off_dst)
    shift = (local_dst.date() - local_src.date()).days
    day_note = {0: "วันเดียวกัน", 1: "วันถัดไป", -1: "วันก่อนหน้า"}.get(shift, f"ต่างกัน {shift} วัน")
    text = (f"{_fmt(local_src)} ที่{src[0]} = {_fmt(local_dst)} ที่{dst[0]} "
            f"({dst[0]}{_diff(off_dst - off_src, src[0])}, {day_note})")
    notes = [n for n in (src[4], dst[4]) if n]
    return {"from": f"{local_src:%Y-%m-%d %H:%M}", "to": f"{local_dst:%Y-%m-%d %H:%M}", "day": day_note,
            "text": text + (" — " + "; ".join(notes) if notes else "")}
