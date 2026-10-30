import {useEffect,useState} from 'react';
import {sync} from '../services/sync';
export function ConnectionStatus(){
 const [,render]=useState(0);useEffect(()=>sync.subscribe(()=>render(v=>v+1)),[]);
 const s=sync.status;if(!sync.enabled)return null;
 const label=s.connected?(s.transport==='tailscale'?'Remote / Tailscale':'Local'):(navigator.onLine?'Reconnecting':'Disconnected');
 return <span className="connection-status" role="status" data-connected={s.connected} aria-label={label} title={s.error||label}><span className="connection-label">{label}</span>{s.error&&<span className="connection-error">{s.error}</span>}</span>;
}
