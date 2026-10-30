import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CHARACTER, EMPTY_CHARACTER, ASSISTANT_ID } from '../config/defaults';
import { ensureBuiltinCharacters, storage } from '../storage/storageService';
import type { Character } from '../types';
import {sync} from '../services/sync';

export function newCharacterDraft(): Character {
  const now = Date.now();
  return { ...EMPTY_CHARACTER, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

/** Copy with a new id and a unique "(copy)" name. */
export function duplicateCharacter(source: Character, existing: Character[]): Character {
  const names = new Set(existing.map((c) => c.name));
  let name = `${source.name} (copy)`;
  for (let i = 2; names.has(name); i++) name = `${source.name} (copy ${i})`;
  const now = Date.now();
  return { ...source, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
}

export function useCharacters() {
  const [characters, setCharacters] = useState<Character[]>(() => ensureBuiltinCharacters(sync.enabled&&sync.state.characters.length?sync.state.characters:storage.loadCharacters()));

  useEffect(() => {
    if(!sync.enabled)storage.saveCharacters(characters);
    else if(JSON.stringify(characters)!==JSON.stringify(sync.state.characters))void sync.mutate({characters}).catch(()=>{});
  }, [characters]);
  useEffect(()=>sync.subscribe(()=>{if(sync.state.characters.length)setCharacters(ensureBuiltinCharacters(sync.state.characters))}),[]);

  const upsert = useCallback((c: Character) => {
    if(c.id!==ASSISTANT_ID)return;
    setCharacters((list) => {
      const saved = { ...c, updatedAt: Date.now() };
      return list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? saved : x)) : [...list, saved];
    });
  }, []);

  /** Always keeps at least one character. */
  const remove = useCallback((id: string) => {
    setCharacters((list) => {
      const rest = list.filter((c) => c.id !== id);
      return ensureBuiltinCharacters(rest.length ? rest : [{ ...DEFAULT_CHARACTER, id: crypto.randomUUID() }]);
    });
  }, []);

  const byId = useCallback((id?: string) => (id ? characters.find((c) => c.id === id) : undefined), [characters]);

  return { characters, upsert, remove, byId };
}
