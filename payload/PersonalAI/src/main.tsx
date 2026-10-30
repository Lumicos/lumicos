import {registerInstallWorker} from './pwa/install.mjs';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'highlight.js/styles/github-dark.css';
import './index.css';
import './lumicos.css';
import './theme-clean.css';
import './motion.css';
import './theme-mono.css';
import './touch-fix.css';
import './mobile-header.css';
import App from './App.tsx';
import {VoiceProvider} from './voice/Voice';
import { storage } from './storage/storageService';
import {sync,sharedPreferences} from './services/sync';
import {MOCK_AVAILABLE} from './config/defaults';
import {customTheme} from './theme/customTheme';
import {startI18n} from './i18n';

// Upgrade data saved by older versions before anything reads it.
storage.migrate();
customTheme.applyStored();
startI18n();
const resizeViewport=()=>{if(window.innerWidth<=780)document.documentElement.style.setProperty('--lumicos-viewport',`${window.visualViewport?.height??window.innerHeight}px`);else document.documentElement.style.removeProperty('--lumicos-viewport')};
window.visualViewport?.addEventListener('resize',resizeViewport);window.addEventListener('resize',resizeViewport);resizeViewport();

async function start(){
if(!MOCK_AVAILABLE){
 try{await sync.start({conversations:storage.loadConversations(),characters:storage.loadCharacters(),preferences:sharedPreferences(storage.loadSettings())});}
 catch{const root=document.getElementById('root')!;root.textContent='เชื่อมต่อ Lumicos ไม่สำเร็จ กรุณาเปิดเซิร์ฟเวอร์แล้วลองอีกครั้ง ';const retry=document.createElement('button');retry.textContent='ลองใหม่';retry.onclick=()=>{root.textContent='กำลังเชื่อมต่อ…';void start()};root.append(retry);return;}
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VoiceProvider><App /></VoiceProvider>
  </StrictMode>,
);
}
if(!MOCK_AVAILABLE)void registerInstallWorker(navigator,window.isSecureContext,import.meta.env.BASE_URL);
void start();
