import { useCallback, useEffect, useState } from 'react';
import { localService, type ServiceHealth, type ToolDefinition } from '../services/localService';
import type { ServiceState } from '../types';

/** Polls the local service; loads the tool list when it comes online. */
export function useLocalService(intervalMs = 5000) {
  const [state, setState] = useState<ServiceState>('checking');
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let wasOnline = false;
    const tick = async () => {
      try {
        const h = await localService.health();
        if (cancelled) return;
        setHealth(h);
        setState('online');
        if (!wasOnline) {
          wasOnline = true;
          const list = await localService.tools.list().catch(() => []);
          if (!cancelled) setTools(list);
        }
      } catch {
        if (cancelled) return;
        wasOnline = false;
        setState('offline');
        setTools([]);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, nonce]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { state, online: state === 'online', health, tools, recheck };
}
