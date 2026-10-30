export function requestedQuality(text='') {
 if(/\b(?:high|best)\s+quality\b|คุณภาพสูง|\bHQ\b|ดีที่สุด/i.test(text))return 'high';
 if(/\bfast\b|เร็ว|\bdraft\b/i.test(text))return 'fast';
 if(/\b(?:normal|standard|quality)\b|ปกติ|คุณภาพ/i.test(text))return 'normal';
}
