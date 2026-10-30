import type { MemoryType } from '../types';

export const TYPE_LABEL: Record<MemoryType, string> = {
  user_fact: 'Fact',
  preference: 'Preference',
  project: 'Project',
  decision: 'Decision',
  instruction: 'Instruction',
  relationship: 'Relationship',
  general: 'General',
};
