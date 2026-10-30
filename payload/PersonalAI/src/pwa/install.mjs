export function createInstallController(target){
 let deferred=null,installed=!!target?.matchMedia?.('(display-mode: standalone)').matches,working=false;
 const listeners=new Set();let state={available:false,installed,working};
 const notify=()=>{state={available:!!deferred,installed,working};for(const f of listeners)f()};
 const offer=event=>{event.preventDefault();deferred=event;notify()};
 const done=()=>{installed=true;deferred=null;notify()};
 target?.addEventListener('beforeinstallprompt',offer);target?.addEventListener('appinstalled',done);
 return {getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
 async install(){if(installed)return 'installed';if(!deferred)return 'menu';if(working)return 'busy';
  const event=deferred;deferred=null;working=true;notify();
  try{await event.prompt();const choice=await event.userChoice;return choice.outcome==='accepted'?'accepted':'dismissed'}catch{return 'menu'}finally{working=false;notify()}
 },dispose(){target?.removeEventListener('beforeinstallprompt',offer);target?.removeEventListener('appinstalled',done);listeners.clear();deferred=null;}};
}
export const installController=createInstallController(typeof window==='undefined'?null:window);
export async function registerInstallWorker(navigator,secure,base='/'){
 if(!secure||!navigator?.serviceWorker)return false;
 try{await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});return true}catch{return false}
}
