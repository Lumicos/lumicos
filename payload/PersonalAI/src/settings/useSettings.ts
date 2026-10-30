import { useCallback, useEffect, useState } from 'react';
import { storage } from '../storage/storageService';
import type { Settings } from '../types';
import {sync,sharedPreferences} from '../services/sync';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    const s = {...storage.loadSettings(),...(sync.enabled?sync.state.preferences:{})};
    // On small screens the panels are drawers: start with them closed.
    const w = window.innerWidth;
    return { ...s, sidebarOpen: w <= 780 ? false : s.sidebarOpen, rightPanelOpen: w <= 1100 ? false : s.rightPanelOpen };
  });
  useEffect(()=>sync.subscribe(()=>{if(sync.state.preferences)setSettings(s=>({...s,...sync.state.preferences}))}),[]);

  useEffect(() => {
    storage.saveSettings(settings);
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { root.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme === 'midnight' ? 'dark' : settings.theme;
      const icon=document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if(icon)icon.href='/lumicos-logo.png'; // square tile reads on light and dark tabs
    };
    apply();
    media.addEventListener('change', apply);
    root.dataset.style = settings.appearance?.style ?? 'lumicos';
    root.dataset.glow = String(settings.appearance?.glow ?? true);
    root.dataset.density = settings.appearance?.density ?? 'comfortable';
    root.dataset.fontSize = settings.ui.fontSize;
    root.dataset.chatWidth = settings.ui.chatWidth;
    return () => media.removeEventListener('change', apply);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings(s=>({...s,...patch}));
    if(patch.chatReasoningMode&&sync.enabled)void sync.mutate({preferences:{...sync.state.preferences,chatReasoningMode:patch.chatReasoningMode}}).catch(e=>console.warn('Reasoning preference sync failed',e));
  }, []);
  const replace=useCallback((s:Settings)=>{setSettings(s);if(sync.enabled)void sync.mutate({preferences:sharedPreferences(s)}).catch(()=>{})},[]);

  return { settings, update, replace };
}
