import { useCallback, useEffect, useState } from 'react';
import type { LLMProvider } from '../providers/types';
import type { ConnectionState, ServerInfo } from '../types';

/** Polls the provider so the UI shows real Online / Loading / Offline state. */
export function useServerStatus(provider: LLMProvider, intervalMs = 5000) {
  const [state, setState] = useState<ConnectionState>('checking');
  const [info, setInfo] = useState<ServerInfo>({});
  const [detail, setDetail] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('checking');
    setInfo({});

    const tick = async () => {
      const r = await provider.checkConnection();
      if (cancelled) return;
      setState(r.state);
      setDetail(r.detail);
      if (r.state === 'online') setInfo(r.info);
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [provider, intervalMs, nonce]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { state, info, detail, recheck };
}
