const listeners=new Set();
export function observeReactions(callback){listeners.add(callback);return()=>{listeners.delete(callback)}}
export function publishReaction(event){for(const f of listeners){try{f(event)}catch{}}}
export function cancelReactions(){publishReaction({cancel:true})}
