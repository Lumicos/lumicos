import {Download} from 'lucide-react';
import {useState,useSyncExternalStore} from 'react';
import {installController} from './install.mjs';
export function InstallAppButton(){
 const state=useSyncExternalStore(installController.subscribe,installController.getState);
 const [help,setHelp]=useState('');
 if(state.installed)return null;
 return <><button disabled={state.working} onClick={()=>{void installController.install().then(result=>setHelp(result==='menu'?'เปิด Lumicos ผ่านลิงก์ HTTPS ของ Tailscale ใน Chrome แล้วกด ⋮ → เพิ่มลงในหน้าจอหลัก → ติดตั้ง':result==='accepted'?'ยืนยันการติดตั้งใน Chrome แล้วเปิดจากไอคอน Lumicos ได้เลย':'')).catch(()=>setHelp('ติดตั้งได้จากเมนู ⋮ ของ Chrome → เพิ่มลงในหน้าจอหลัก'))}}><Download size={18}/>{state.working?'กำลังติดตั้ง…':'ติดตั้ง Lumicos'}</button>{help&&<p className="mobile-menu-note" role="status">{help}</p>}</>;
}
