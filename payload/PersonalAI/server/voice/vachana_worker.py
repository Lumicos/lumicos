"""CPU-only adapter to the installed Vachana kit; PCM stays in memory."""
import sys, os, json, base64, time
wire=sys.stdout
sys.stdout=sys.stderr
root=os.path.abspath(sys.argv[1])
sys.path.insert(0,root)
import numpy as np
import onnxruntime as ort
import talk

def emit(data):
    wire.write(json.dumps(data,ensure_ascii=False)+'\n');wire.flush()

try:
    # Constrain CPU use while other applications are training on the GPU.
    from vachanatts.voice import Voice
    from vachanatts.config import Config
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    # Preserve the kit's phonemizer, normalization and voice configuration.
    class CPUEngine(talk.Engine):
        def set_voice(self,name):
            with open(os.path.join(root,'voices','speaker_config.json'),encoding='utf-8') as f:
                config=Config.from_dict(json.load(f))
            self.voice=Voice(config=config,session=ort.InferenceSession(os.path.join(root,'voices',name+'.onnx'),sess_options=options,providers=['CPUExecutionProvider']))
            self.rate=config.sample_rate
            self.voice_name=name
    engine=CPUEngine('th_f_1',1.0,os.path.join(root,'pronounce.txt'),os.path.join(root,'sfx'))
    if engine.voice.session.get_providers()!=['CPUExecutionProvider']:
        raise RuntimeError('Vachana must use CPUExecutionProvider only')
    emit({'type':'ready'})
except Exception as e:
    emit({'type':'fatal','error':str(e)});sys.exit(1)

for line in sys.stdin:
    req={}
    try:
        req=json.loads(line);text=req.get('text','')
        if req.get('action')!='speak' or not isinstance(text,str) or not 0<len(text.strip())<=1500:
            raise ValueError('Expected speak with 1–1500 characters')
        started=time.perf_counter();samples=0
        for audio in engine.pieces(text):
            if not len(audio):continue
            samples+=len(audio)
            pcm=(np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
            emit({'id':req['id'],'type':'audio','pcm':base64.b64encode(pcm).decode('ascii'),'sampleRate':engine.rate})
        emit({'id':req['id'],'type':'done','metrics':{'device':'cpu','totalMs':(time.perf_counter()-started)*1000,'audioSeconds':samples/engine.rate}})
    except Exception as e:emit({'id':req.get('id'),'type':'error','error':str(e)})
