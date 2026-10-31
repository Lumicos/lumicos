import {registerPlayback} from './playbackSignal.mjs';
export class PCMPlayer {
 readonly context=new AudioContext({sampleRate:24000});
 private sources=new Set<AudioBufferSourceNode>();
 private next=0;
 private finished=false;
 private output=this.context.createGain();
 private analyser:AnalyserNode|null=null;
 private samples=new Float32Array(512);
 private schedule=new Map<AudioBufferSourceNode,{start:number;end:number}>();
 private stopped=false;
 private unregister:(interrupted?:boolean)=>void;
 constructor(){
  this.output.connect(this.context.destination);
  this.unregister=registerPlayback({
   attach:()=>{if(this.analyser||this.stopped)return;this.analyser=this.context.createAnalyser();this.analyser.fftSize=512;this.output.connect(this.analyser)},
   detach:()=>{if(!this.analyser)return;this.output.disconnect(this.analyser);this.analyser.disconnect();this.analyser=null;this.samples.fill(0)},
   read:()=>{
    if(!this.analyser||this.context.state!=='running')return 0;
    const time=this.context.currentTime;
    if(!Array.from(this.schedule.values()).some(s=>time>=s.start&&time<s.end))return 0;
    this.analyser.getFloatTimeDomainData(this.samples);let sum=0;for(const sample of this.samples)sum+=sample*sample;
    return Math.sqrt(sum/this.samples.length);
   },
  });
 }
 onEnded=()=>{};
 beginUtterance(_text:string){}
 endUtterance(){}
 async resume(){await this.context.resume()}
 add(encoded:string,rate:number){
  const raw=atob(encoded),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),pcm=new DataView(bytes.buffer);
  const sound=this.context.createBuffer(1,bytes.length/2,rate),samples=sound.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=pcm.getInt16(i*2,true)/32768;
  const source=this.context.createBufferSource();source.buffer=sound;source.connect(this.output);this.sources.add(source);
  source.onended=()=>{source.disconnect();this.sources.delete(source);this.schedule.delete(source);if(this.finished&&!this.sources.size)this.onEnded()};
  this.next=Math.max(this.context.currentTime+0.04,this.next);
  this.schedule.set(source,{start:this.next,end:this.next+sound.duration});source.start(this.next);this.next+=sound.duration;
 }
 done(){this.finished=true;if(!this.sources.size)this.onEnded()}
 drain(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const check=()=>{if(signal.aborted){clearInterval(timer);reject(signal.reason)}else if(!this.sources.size){clearInterval(timer);resolve()}};const timer=setInterval(check,50);check()})}
 stop(){if(this.stopped)return;const naturalEnd=this.finished&&!this.sources.size;this.stopped=true;for(const source of this.sources){source.onended=null;try{source.stop()}catch{}source.disconnect()}this.sources.clear();this.schedule.clear();this.unregister(!naturalEnd);this.output.disconnect();if(this.context.state!=='closed')void this.context.close();}
}
