import { createContext, useContext } from 'react';
import type { AttachmentPart, MemoryCandidate } from '../types';

/**
 * Actions that message sub-components (tool cards, memory suggestions,
 * attachments) need. Provided once by App instead of drilling props.
 */
export interface ChatActions {
  characterName: string;
  serviceOnline: boolean;
  toolDebug: boolean;
  memoryDebug: boolean;
  respondToTool: (runId: string, allow: boolean) => void;
  saveCandidate: (messageId: string, candidate: MemoryCandidate, characterOnly: boolean) => Promise<void>;
  ignoreCandidate: (messageId: string, candidateId: string) => void;
  importAttachment: (messageId: string, part: AttachmentPart) => Promise<void>;
  openFile: (path: string) => void;
  openMemory: () => void;
  learnKnowledge: (messageId: string) => Promise<boolean>;
  dismissKnowledge: (messageId: string) => void;
}

const noop = () => {};
export const ChatActionsContext = createContext<ChatActions>({
  characterName: 'AI',
  serviceOnline: false,
  toolDebug: false,
  memoryDebug: false,
  respondToTool: noop,
  saveCandidate: async () => {},
  ignoreCandidate: noop,
  importAttachment: async () => {},
  openFile: noop,
  openMemory: noop,
  learnKnowledge: async () => false,
  dismissKnowledge: noop,
});

export const useChatActions = () => useContext(ChatActionsContext);
