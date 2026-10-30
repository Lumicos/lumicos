import type {ChatReasoningMode} from '../types';
export function ChatReasoningControl({mode,onChange,disabled=false}:{mode:ChatReasoningMode;onChange:(m:ChatReasoningMode)=>void;disabled?:boolean}){
 return <label className="chat-reasoning-control"><span>การคิดในแชท</span><select aria-label="Chat reasoning mode" value={mode??'FAST'} disabled={disabled} onChange={e=>onChange(e.target.value as ChatReasoningMode)} title="FAST ตอบไว (ค่าเริ่มต้น) · AUTO · DEEP คิดละเอียด"><option value="FAST">FAST</option><option value="AUTO">AUTO</option><option value="DEEP">DEEP</option></select></label>;
}
