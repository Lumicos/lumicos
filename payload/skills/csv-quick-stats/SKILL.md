---
name: csv-quick-stats
description: สรุปไฟล์ CSV อย่างเร็ว: จำนวนแถว ชื่อคอลัมน์ และค่าต่ำสุด/สูงสุด/เฉลี่ยของคอลัมน์ตัวเลข
triggers: csv
---

ใช้เมื่อผู้ใช้ขอสรุปหรือดูภาพรวมไฟล์ CSV

1. ไฟล์ต้องอยู่ใน workspace (เช่น spreadsheets/ หรือ documents/) ไฟล์ที่แนบในแชตอย่างเดียวสคริปต์อ่านไม่ได้ ให้บอกผู้ใช้ให้บันทึกลง workspace ก่อน
2. รัน run_python (สคริปต์มีอยู่แล้ว ไม่ต้องเขียนใหม่):
   exec(open("skills/csv-quick-stats/script.py", encoding="utf-8").read())
   print(summarize_csv("spreadsheets/sales.csv"))
3. ผลเป็น dict: rows (จำนวนแถว), columns (ชื่อคอลัมน์), numeric (min/max/mean ของคอลัมน์ที่เป็นตัวเลขทั้งหมด)
4. คอลัมน์ตัวเลขที่มีลูกน้ำ (เช่น 1,234) จะไม่ถูกนับเป็นตัวเลข ถ้าต้องการ ให้อ่านด้วย pandas: pd.read_csv(path, thousands=",")
5. ตอบสั้น ๆ: จำนวนแถว รายชื่อคอลัมน์ แล้วตารางสถิติของคอลัมน์ตัวเลข
