import { useEffect, useState } from 'react';

interface Health { build?: { version?: string; src?: string; startedAt?: string } }

/** Shows which build the page and the backend are running, and warns when they differ
 *  (page opened before a rebuild, or backend started from different code than the page). */
export function BuildStamp() {
  const [health, setHealth] = useState<Health | null>(null);
  const page = typeof __LUMICOS_SRC_BUILD__ === 'string' ? __LUMICOS_SRC_BUILD__ : 'unknown';
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/health', { headers: { 'X-PersonalAI': '1' }, signal: c.signal })
      .then((r) => (r.ok ? r.json() : null)).then(setHealth).catch(() => undefined);
    return () => c.abort();
  }, []);
  const backend = health?.build?.src;
  const mismatch = !!backend && backend !== 'unknown' && page !== 'unknown' && backend !== page;
  return (
    <div className="build-stamp" style={{ fontSize: 11, opacity: 0.7, padding: '4px 12px' }} title={`หน้าเว็บ ${page} · backend ${backend ?? '?'}`}>
      Lumicos {health?.build?.version ?? ''} · build {page}
      {mismatch && <div role="status" style={{ color: '#b45309', opacity: 1 }}>หน้าเว็บกับ backend คนละเวอร์ชัน (หน้าเว็บ {page} / backend {backend}) — รีเฟรชหน้า หรือกด Restart Lumicos</div>}
    </div>
  );
}
