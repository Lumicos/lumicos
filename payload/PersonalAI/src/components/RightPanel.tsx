import type {ReactNode} from 'react';
import { PanelRightClose, PanelRightOpen, Pencil } from 'lucide-react';
import type { AIState, Character, GenerationStats, ServerInfo, ServiceState } from '../types';
import { Avatar } from './Avatar';

interface Props {
  open: boolean;
  callButton?: ReactNode;
  state: AIState;
  info: ServerInfo;
  detail?: string;
  serverUrl: string;
  isMock: boolean;
  stats?: GenerationStats;
  character?: Character;
  service: { state: ServiceState; workspace?: string };
  onToggle: () => void;
  onRecheck: () => void;
  onEditCharacter: () => void;
}

/** Companion panel: just the character. Technical details (model, server, tokens) were removed on purpose. */
export function RightPanel(p: Props) {
  return (
    <aside className={p.open ? "right" : "right right-rail"}>
      {!p.open && <button className="icon-btn" onClick={p.onToggle} title="Show panel"><PanelRightOpen size={18}/></button>}
      <div style={{display:p.open ? 'contents' : 'none'}}>
      <div className="right-head">
        <span>Companion</span>
        <button className="icon-btn" onClick={p.onToggle} title="Hide panel">
          <PanelRightClose size={18} />
        </button>
      </div>
      <div className="card char-card companion-character">
        <Avatar character={p.character} size={44} />
        <div className="char-card-text">
          <button className="char-card-name companion-edit" onClick={p.onEditCharacter} title="Open character editor">
            {p.character?.name ?? 'Character deleted'}
            {p.character?.nickname && <span className="char-card-nick">“{p.character.nickname}”</span>}
          </button>
          <div className="char-card-desc">
            {p.character ? p.character.description || p.character.personality || 'No description' : 'This chat is read-only.'}
          </div>
        </div>
        <button className="icon-btn char-card-edit" onClick={p.onEditCharacter} aria-label="Edit character">
          <Pencil size={15} />
        </button>
      </div>
      </div>
    </aside>
  );
}
