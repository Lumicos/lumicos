from datetime import datetime, timedelta

def to_thai_date(iso_str):
    dt = datetime.strptime(iso_str, "%Y-%m-%d")
    months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
               "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
    thai_year = dt.year + 543
    return f"{dt.day} {months[dt.month - 1]} {thai_year}"

def days_between(date_a, date_b):
    dt_a = datetime.strptime(date_a, "%Y-%m-%d")
    dt_b = datetime.strptime(date_b, "%Y-%m-%d")
    return (dt_b - dt_a).days

def add_days(iso_str, n):
    dt = datetime.strptime(iso_str, "%Y-%m-%d")
    new_dt = dt + timedelta(days=n)
    return new_dt.strftime("%Y-%m-%d")
