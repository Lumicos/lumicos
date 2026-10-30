/** Energy endpoint detector. Waits for speech first, tolerates short pauses. */
export class SilenceDetector {
 private speechMs=0;private quietMs=0;private elapsedMs=0;private floor=0.003;
 heardSpeech=false;
 update(rms:number,ms:number):'continue'|'finished'|'empty'{
  this.elapsedMs+=ms;
  const speaking=rms>Math.max(0.012,this.floor*3);
  if(!this.heardSpeech&&!speaking)this.floor=this.floor*0.95+Math.min(rms,0.008)*0.05;
  if(speaking){this.speechMs+=ms;this.quietMs=0;if(this.speechMs>=200)this.heardSpeech=true;}
  else {this.quietMs+=ms;if(!this.heardSpeech)this.speechMs=0;}
  if(this.heardSpeech&&this.quietMs>=1200)return 'finished';
  if(!this.heardSpeech&&this.elapsedMs>=10000)return 'empty';
  return 'continue';
 }
}

export async function watchSilence(stream:MediaStream,onEnd:(empty:boolean)=>void){
 const context=new AudioContext();await context.resume();
 const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);
 const samples=new Float32Array(analyser.fftSize),detector=new SilenceDetector();let previous=performance.now(),closed=false;
 const timer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const now=performance.now();const rms=Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length);const result=detector.update(rms,Math.min(200,now-previous));previous=now;if(result!=='continue'){stop();onEnd(result==='empty')}},50);
 function stop(){if(closed)return;closed=true;clearInterval(timer);source.disconnect();void context.close();}
 return stop;
}
