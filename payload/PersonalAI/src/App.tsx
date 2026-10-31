import {InstallAppButton} from './pwa/InstallAppButton';
import { ThemeUndo } from './theme/ThemeUndo';
import {BuildStamp} from './components/BuildStamp';
import { Menu, MessageSquare, MessageCircleDashed, History, Settings as SettingsIcon, SquarePen, MoreHorizontal, Eraser } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import {useVoice} from './voice/Voice';
import {ChatReasoningControl} from './components/ChatReasoningControl';
import {ConnectionStatus} from './components/ConnectionStatus';
import { ChatActionsContext, type ChatActions } from './chat/chatActions';
import { useLocalService } from './hooks/useLocalService';
import { MemoryPage } from './memory/MemoryPage';
import { localService } from './services/localService';
import { textOf } from './chat/messageUtils';
import { WorkspacePage } from './workspace/WorkspacePage';
import type { View } from './components/Sidebar';
import { CharacterManager } from './characters/CharacterManager';
import { useCharacters } from './characters/useCharacters';
import { ChatView } from './chat/ChatView';
import { useChat } from './chat/useChat';
import { Avatar } from './components/Avatar';
import { ImageEditPage } from './components/ImageEditPage';
import { ASSISTANT_ID, LUMICOS_ID } from './config/defaults';


import { ConfirmDialog } from './components/Modal';
import {ComposerCall} from './voice/ComposerCall';
import { Sidebar } from './components/Sidebar';
import { useServerStatus } from './hooks/useServerStatus';
import { createProvider } from './providers';
import { SettingsModal } from './settings/SettingsModal';
import { useSettings } from './settings/useSettings';
import type { AttachmentPart, Character, Conversation, MemoryCandidate } from './types';

type Dialog = { kind: 'settings'; initialTab?: 'general' } | { kind: 'characters'; characterId?: string; roleplay?: boolean } | null;

export default function App() {
  const { settings, update, replace } = useSettings();
  const chars = useCharacters();
  const [dialog, setDialog] = useState<Dialog>(null);
  /** Character the user picked while the current chat already has messages. */
  const [pendingSwitch, setPendingSwitch] = useState<Character | null>(null);
  const [view, setView] = useState<View>('chat');
  const [navigationOpen,setNavigationOpen]=useState(false);
  const navigationRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!navigationOpen)return;
    const outside=(event:PointerEvent)=>{if(!navigationRef.current?.contains(event.target as Node))setNavigationOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setNavigationOpen(false);navigationRef.current?.querySelector<HTMLButtonElement>('.mobile-brand-button')?.focus()}};
    const resized=()=>{if(window.innerWidth>780)setNavigationOpen(false)};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resized);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resized)};
  },[navigationOpen]);
  const [calling,setCalling]=useState(false);
  const [focusPath, setFocusPath] = useState<string>();
  const service = useLocalService();
  const imagesEnabled = service.health?.features?.images !== false;
  const sttEnabled = service.health?.features?.stt !== false;
  const ttsEnabled = service.health?.features?.tts !== false;
  const voiceCallEnabled = sttEnabled && ttsEnabled;
  useEffect(() => {
    if (!imagesEnabled && (view === 'imageedit' || view === 'gallery')) setView('chat');
  }, [imagesEnabled, view]);

  // The only place that decides which backend is used.
  const provider = useMemo(
    () => createProvider({ provider: settings.provider, serverUrl: settings.serverUrl }),
    [settings.provider, settings.serverUrl],
  );
  const server = useServerStatus(provider);

  // Character for brand-new chats: the selected one, else the first available.
  const defaultCharacter = chars.byId(settings.activeCharacterId) ?? chars.characters[0];

  const serviceDeps = useMemo(() => ({ online: service.online, tools: service.tools }), [service.online, service.tools]);
  const chat = useChat({
    provider,
    settings,
    resolveCharacter: chars.byId,
    defaultCharacter,
    service: serviceDeps,
    contextTokens: server.info.contextSize,
  });

  const voice=useVoice();
  useEffect(()=>{voice.stop()},[chat.active.id,voice.stop]);

  // Each conversation keeps its own character. Undefined = that character was deleted.
  const character = chars.byId(chat.active.characterId);

  const connectionHint =
    server.state === 'offline'
      ? 'ยังติดต่อ Lumicos ไม่ได้ ลองเปิด Lumicos ใหม่อีกครั้ง'
      : server.state === 'loading'
        ? 'Nova กำลังเตรียมพร้อม…'
        : undefined;

  const toggleSidebar = (open: boolean) => update({ sidebarOpen: open });

  // One time: new chats start as the general assistant; Lumicos stays one tap away in the character picker.
  useEffect(() => {
    try {
      if (localStorage.getItem('lumicos.generalDefault.v1')) return;
      localStorage.setItem('lumicos.generalDefault.v1', '1');
      if (settings.activeCharacterId === LUMICOS_ID) update({ activeCharacterId: ASSISTANT_ID });
    } catch { /* storage unavailable: keep the current default */ }
  }, []);

  // A character can bring its own colour theme (extensions.theme); layout stays the same.
  const charTheme = typeof character?.extensions?.theme === 'string' ? (character.extensions.theme as string) : '';
  useEffect(() => {
    const root = document.documentElement;
    if (charTheme) root.dataset.charTheme = charTheme; else delete root.dataset.charTheme;
    return () => { delete root.dataset.charTheme; };
  }, [charTheme]);

  /** Picking a character never changes the personality of an ongoing chat. */
  const pickCharacter = (id: string) => {
    const target = chars.byId(id);
    if (!target || chat.isGenerating) return;
    if (id === chat.active.characterId) {
      update({ activeCharacterId: id });
      return;
    }
    if (!chat.hasUserMessages) {
      // Nothing said yet: just give this empty chat the new character.
      chat.assignCharacterToEmptyChat(id);
      update({ activeCharacterId: id });
      setDialog(null);
      return;
    }
    setPendingSwitch(target);
  };

  const startChatWith = (c: Character) => {
    update({ activeCharacterId: c.id });
    chat.newChat(c.id);
    setDialog(null);
  };

  const selectConversation = (id: string) => {
    chat.select(id);
    const conv = chat.conversations.find((c) => c.id === id);
    if (conv?.characterId && chars.byId(conv.characterId)) update({ activeCharacterId: conv.characterId });
  };

  const chatCount = (characterId: string) => chat.conversations.filter((c) => c.characterId === characterId).length;

  /** Saves a memory suggestion (from a chat message) to long-term memory. */
  const saveCandidate = async (conv: Conversation, messageId: string, c: MemoryCandidate, _characterOnly: boolean) => {
    const saved = await localService.memory.create({
      type: c.type,
      content: c.content,
      tags: c.tags,
      importance: c.importance,
      sourceConversationId: conv.id,
      sourceConversationTitle: conv.title,
      // Memories are per agent: what you tell the assistant is not visible to Lumicos, and the other way round.
      characterId: conv.characterId ?? null,
    });
    chat.setCandidate(conv.id, messageId, c.id, { status: 'saved', memoryId: saved.id, content: c.content, type: c.type });
  };

  const openFile = (path: string) => {
    setFocusPath(path);
    setView('workspace');
  };

  const actions: ChatActions = {
    characterName: character?.name ?? 'AI',
    serviceOnline: service.online && !chat.active.private,
    toolDebug: settings.developer.toolDebug,
    memoryDebug: settings.developer.memoryDebug,
    respondToTool: chat.respondToTool,
    saveCandidate: (messageId, c, characterOnly) => saveCandidate(chat.active, messageId, c, characterOnly),
    ignoreCandidate: (messageId, candidateId) => chat.setCandidate(chat.active.id, messageId, candidateId, { status: 'ignored' }),
    importAttachment: async (messageId: string, part: AttachmentPart) => {
      // The user's click is the confirmation for this write.
      const v = await localService.tools.validate('import_attachment', { attachment_id: part.id });
      const r = await localService.tools.execute('import_attachment', { attachment_id: part.id }, v.approvalId);
      chat.setAttachmentImported(chat.active.id, messageId, part.id, (r.data as { path: string }).path);
    },
    openFile,
    openMemory: () => setView('memory'),
    learnKnowledge: async (messageId: string) => {
      const m = chat.active.messages.find((x) => x.id === messageId);
      if (!m?.knowledgeCandidate) return false;
      try {
        const saved = await localService.knowledge.learn({ question: m.knowledgeCandidate.question, answer: textOf(m), sources: m.knowledgeCandidate.sources, confirmed: true });
        chat.setKnowledgeCandidate(chat.active.id, messageId, { status: 'saved', file: saved.file, error: undefined });
        return true;
      } catch (e) {
        chat.setKnowledgeCandidate(chat.active.id, messageId, { error: (e as Error).message });
        return false;
      }
    },
    dismissKnowledge: (messageId: string) => chat.setKnowledgeCandidate(chat.active.id, messageId, { status: 'dismissed' }),
  };

  return (
    <div className={`app ${settings.sidebarOpen ? '' : 'no-sidebar'}`}>
      <ThemeUndo />
      <Sidebar
        showRoleplayAgents={!!settings.developer.showRoleplayAgents}
        open={settings.sidebarOpen}
        view={view}
        showImageLab={imagesEnabled}
        serviceOnline={service.online && !chat.active.private}
        onNavigate={(v) => {
          setView(v);
          if (v !== 'workspace') setFocusPath(undefined);
          // Phones: the sidebar is a drawer — close it after choosing where to go.
          if (window.innerWidth <= 780) update({ sidebarOpen: false });
        }}
        conversations={chat.conversations}
        activeId={chat.active.id}
        busy={chat.isGenerating}
        characters={chars.characters}
        currentCharacterId={chat.active.characterId}
        pickerCharacter={character ?? defaultCharacter}
        historyFilter={settings.historyFilter}
        onHistoryFilter={(historyFilter) => update({ historyFilter })}
        onToggle={() => toggleSidebar(!settings.sidebarOpen)}
        onNewChat={() => chat.newChat()}
        onSelect={selectConversation}
        onRename={chat.rename}
        onDelete={chat.remove}
        onPickCharacter={pickCharacter}
        onManageCharacters={() => { if (window.innerWidth <= 780) toggleSidebar(false); setDialog({ kind: 'characters' }); }}
        onOpenSettings={() => setDialog({ kind: 'settings' })}
      />

      <div className="app-main">
      <header className="workspace-top"><button className="mobile-drawer-button" aria-label="เปิดเมนูและประวัติแชท" onClick={()=>toggleSidebar(true)}><Menu size={21}/></button><div className="workspace-brand" ref={navigationRef}><button className="mobile-brand-button" aria-label="ตัวเลือก Lumicos" aria-expanded={navigationOpen} aria-controls="lumicos-navigation" onClick={()=>setNavigationOpen(open=>!open)}><MoreHorizontal size={21}/></button>{navigationOpen&&<nav id="lumicos-navigation" className="mobile-navigation-popover" aria-label="การนำทางหลัก">
        <button aria-current={view==='chat'?'page':undefined} onClick={()=>{setView('chat');toggleSidebar(false);setNavigationOpen(false)}}><MessageSquare size={18}/>Chat</button>
        <button onClick={()=>{toggleSidebar(true);setNavigationOpen(false)}}><History size={18}/>History</button>
        <button onClick={()=>{setDialog({kind:'settings'});setNavigationOpen(false)}}><SettingsIcon size={18}/>Settings</button><InstallAppButton/><BuildStamp/>
        <button disabled={chat.isGenerating} onClick={()=>{window.dispatchEvent(new Event('lumicos-clear-chat'));setNavigationOpen(false)}}><Eraser size={18}/>ล้างแชท</button><ChatReasoningControl mode={settings.chatReasoningMode} disabled={calling} onChange={chatReasoningMode=>update({chatReasoningMode})}/><div className="mobile-menu-divider"/>
        <button disabled={calling||chat.isGenerating||chat.suggesting} aria-pressed={!!chat.active.private} onClick={()=>{chat.togglePrivate();setView('chat');setNavigationOpen(false)}}><MessageSquare size={18}/>{chat.active.private?'ออกจากแชทชั่วคราว':'แชทชั่วคราว'}</button>
        {chat.active.private&&<p className="mobile-menu-note">Private ไม่บันทึกแชท ไม่ใช้ความจำ ไฟล์ หรือเครื่องมือ ข้อความหายเมื่อออกจากโหมดหรือรีเฟรช</p>}
        <div className="mobile-menu-connection"><ConnectionStatus/></div>
      </nav>}</div><button className="mobile-new-chat" aria-label="แชทใหม่" disabled={calling||chat.isGenerating} onClick={()=>{chat.newChat();setView('chat')}}><SquarePen size={20}/></button><div className="workspace-top-actions"><button className="private-toggle" disabled={calling||chat.isGenerating||chat.suggesting} aria-label={chat.active.private?'ออกจากแชทชั่วคราว':'แชทชั่วคราว'} data-tooltip={chat.active.private?'ออกจากแชทชั่วคราว':'แชทชั่วคราว'} aria-pressed={!!chat.active.private} onClick={()=>{chat.togglePrivate();setView('chat')}}><MessageCircleDashed size={18}/></button></div></header>
      {chat.active.private&&<div className="model-banner private-banner"><span className="private-info-desktop">Private · ไม่บันทึกประวัติและไม่ใช้ความจำ · รองรับข้อความเท่านั้น ปิดไฟล์ เครื่องมือ และภาพ · ออกจากโหมดหรือรีเฟรชแล้วข้อความจะหาย</span><details className="private-info-mobile"><summary>ไม่บันทึกแชท · ดูรายละเอียด</summary><p>ไม่ใช้ความจำ รองรับข้อความเท่านั้น ไม่ใช้ไฟล์ เครื่องมือ หรือภาพ ข้อความจะหายเมื่อออกจาก Private หรือรีเฟรช</p></details></div>}
      {imagesEnabled && view === 'gallery' ? <ImageEditPage key="album" initialScreen="album" online={service.online} provider={provider} onBack={() => setView('chat')}/> : imagesEnabled && view === 'imageedit' ? <ImageEditPage key="lab" online={service.online} provider={provider} onBack={() => setView('chat')}/> : view === 'memory' ? (
        <MemoryPage
          online={service.online}
          dataDir={service.health?.dataDir}
          characters={chars.characters}
          conversations={chat.conversations}
          onBack={() => setView('chat')}
          onOpenConversation={(id) => {
            selectConversation(id);
            setView('chat');
          }}
          onSaveSuggestion={(s) => saveCandidate(s.conversation, s.messageId, s.candidate, s.candidate.type === 'relationship')}
          onIgnoreSuggestion={(s) => chat.setCandidate(s.conversation.id, s.messageId, s.candidate.id, { status: 'ignored' })}
        />
      ) : view === 'workspace' ? (
        <WorkspacePage online={service.online} workspaceRoot={service.health?.workspace} focusPath={focusPath} onBack={() => setView('chat')} />
      ) : (
        <ChatActionsContext.Provider value={actions}>
      <ChatView
        callButton={voiceCallEnabled && character?.id === ASSISTANT_ID ? <ComposerCall conversationId={chat.active.id} disabled={!character||!service.online||!!chat.active.private} busy={chat.isGenerating} onReply={chat.callReply} onActive={setCalling} onFinish={chat.finishCall}/> : undefined}
        sttEnabled={sttEnabled}
        ttsEnabled={ttsEnabled}
        conversation={chat.active}
        character={character}
        characterMissing={!character}
        generatingId={chat.generatingId}
        enterToSend={settings.ui.enterToSend}
        showReasoning={settings.ui.showReasoning}
        isMock={provider.isMock}
        connectionHint={connectionHint}
        onSend={chat.send}
        calling={calling}
        onStop={chat.stop}
        onGenerateImage={chat.generateImage}
        reasoningMode={settings.chatReasoningMode}
        onReasoningChange={chatReasoningMode=>update({chatReasoningMode})}
        onRegenerate={chat.regenerate}
        onEdit={chat.editAndResend}
        onCopy={chat.copyText}
        onFeedback={chat.setFeedback}
        onClear={chat.clear}
        onNewChat={() => chat.newChat()}
        serviceOnline={service.online && !chat.active.private}
        memoryEnabled={settings.memory.enabled && !chat.active.private}
        suggesting={chat.suggesting}
        onSuggestMemories={chat.suggestMemories}
      />
        </ChatActionsContext.Provider>
      )}

      </div>
      {/* Small screens: the history/sidebar becomes a drawer. */}
      <div className="scrim scrim-left" onClick={() => update({ sidebarOpen: false })} />
      <button className="fab menu-fab" onClick={() => toggleSidebar(true)} aria-label="Open sidebar">
        <Menu size={18} />
      </button>

      {dialog?.kind === 'settings' && (
        <SettingsModal
          settings={settings}
          initialTab={dialog.initialTab}
          sttEnabled={sttEnabled}
          ttsEnabled={ttsEnabled}
          service={{ online: service.online, health: service.health, tools: service.tools }}
          info={server.info}
          character={character ?? defaultCharacter}
          onSave={replace}
          onManageCharacters={() => { if (window.innerWidth <= 780) toggleSidebar(false); setDialog({ kind: 'characters' }); }}
          onRoleplay={() => { if (window.innerWidth <= 780) toggleSidebar(false); setDialog({ kind: 'characters', roleplay: true }); }}
          roleplayChats={chat.conversations.filter((c) => c.mode === 'roleplay').map((c) => ({ id: c.id, title: c.title }))}
          onOpenChat={(id) => { selectConversation(id); setView('chat'); setDialog(null); }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'characters' && (
        <CharacterManager
          characters={chars.characters}
          activeId={character?.id}
          initialId={dialog.characterId}
          globalPrompt={settings.systemPrompt}
          userName={settings.userName}
          greetingMode={settings.greetingMode}
          chatCount={chatCount}
          onSave={chars.upsert}
          onDelete={chars.remove}
          onUse={pickCharacter}
          {...(dialog.roleplay ? { onRoleplay: (id: string) => { if (chat.isGenerating) return; chat.newChat(id, 'roleplay'); setView('chat'); setDialog(null); } } : {})}
          onClose={() => setDialog(null)}
        />
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title="Start a new conversation with this character?"
          tone="primary"
          confirmLabel={`New chat with ${pendingSwitch.name}`}
          cancelLabel="Stay in this chat"
          message={
            <div className="switch-confirm">
              <div className="switch-confirm-avatars">
                <Avatar character={character} size={36} />
                <span className="muted">→</span>
                <Avatar character={pendingSwitch} size={36} />
              </div>
              <p>
                This chat stays with <b>{character?.name ?? 'its character'}</b>. A conversation keeps the same character
                from start to finish, so {pendingSwitch.name} starts in a new chat.
              </p>
            </div>
          }
          onConfirm={() => startChatWith(pendingSwitch)}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}
