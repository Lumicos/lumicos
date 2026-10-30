/** A model promise is not a submitted image job. Never auto-execute from prose. */
export function unsubmittedImageClaim(text, runs = []) {
 if(runs.some(run=>run.tool==='generate_image'&&run.status==='done'&&typeof run.data?.jobId==='string'))return false;
 return /(?:^|\n)\s*(?:ฉัน|โนวา|เรา)?\s*กำลัง(?:สร้าง|เจน)(?:ภาพ|รูป)|(?:^|\n)\s*(?:I(?:'m| am)|We(?:'re| are))\s+(?:generating|creating|rendering)\s+(?:an?\s+|the\s+)?(?:image|picture|photo)/i.test(text);
}
export const UNSUBMITTED_IMAGE_MESSAGE='ยังไม่ได้ส่งงานสร้างภาพ: คำตอบนี้ไม่ได้เรียกเครื่องมือสร้างภาพ จึงไม่มีภาพกำลังประมวลผล';
