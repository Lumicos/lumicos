import { getLang } from '../i18n';

export const TYPE_NAME: Record<string, string> = {
  folder: 'Folder',
  text: 'Text',
  markdown: 'Markdown',
  csv: 'CSV',
  json: 'JSON',
  docx: 'Word document',
  xlsx: 'Excel workbook',
  image: 'Image',
  pdf: 'PDF',
  file: 'File',
};

export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(getLang() === 'en' ? 'en-US' : 'th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
