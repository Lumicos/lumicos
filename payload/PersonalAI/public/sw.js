// Install support only. Never cache conversations, API responses, images or audio.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if(event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || !['/','/index.html'].includes(url.pathname)) return;
 event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumicos · ไม่ได้เชื่อมต่อ</title><body style="background:#171719;color:#eee;font:18px system-ui;padding:32px;line-height:1.6"><h1>Lumicos</h1><p>ยังเชื่อมต่อเครื่องหลักไม่ได้ เปิด PC และ Lumicos แล้วตรวจว่า Tailscale เชื่อมต่ออยู่ค่ะ</p><a style="color:#93d6cd" href="/">ลองเชื่อมต่อใหม่</a></body></html>`, {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
