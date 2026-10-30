"""thai_baht_text(amount) -> Thai words for a money amount, like Excel BAHTTEXT.
1234.5 -> หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์ ; 21 -> ยี่สิบเอ็ดบาทถ้วน ; 0.25 -> ยี่สิบห้าสตางค์ ; -5 -> ลบห้าบาทถ้วน
Checked against 18 test amounts (0, 1, 10, 11, 21, 101, 111, 1234.5, 0.25, 1,000,000, 21,000,000, 2,500,000.75, -5, 1.01, 0.21, 100, 12,345,678, "99.99").
"""
_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def _below_million(n):
    out = ""
    for i, ch in enumerate(str(n)[::-1]):
        d = int(ch)
        if d == 0:
            continue
        if i == 1 and d == 1:
            out = "สิบ" + out
        elif i == 1 and d == 2:
            out = "ยี่สิบ" + out
        elif i == 0 and d == 1 and n > 1:
            out = "เอ็ด" + out
        else:
            out = _DIGITS[d] + _PLACES[i] + out
    return out


def _read(n):
    if n < 1000000:
        return _below_million(n)
    rest = n % 1000000
    return _read(n // 1000000) + "ล้าน" + (_below_million(rest) if rest else "")


def thai_baht_text(amount):
    satang_total = round(float(amount) * 100)
    negative = satang_total < 0
    baht, satang = divmod(abs(satang_total), 100)
    if baht == 0 and satang == 0:
        return "ศูนย์บาทถ้วน"
    text = (_read(baht) + "บาท" if baht else "") + (_read(satang) + "สตางค์" if satang else "ถ้วน")
    return ("ลบ" if negative else "") + text
