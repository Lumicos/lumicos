import json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
def info(repo):
    with urllib.request.urlopen(urllib.request.Request('https://huggingface.co/api/models/'+repo+'?blobs=true',headers={'User-Agent':'Lumicos-Installer'}),timeout=60) as r:return json.load(r)
specs=[
 ('call-e2b','google/gemma-4-E2B-it-qat-q4_0-gguf',['gemma-4-E2B_q4_0-it.gguf'],'models/chat','chat'),
 ('chat-e4b','google/gemma-4-E4B-it-qat-q4_0-gguf',['gemma-4-E4B_q4_0-it.gguf'],'models/chat','chat'),
 ('whisper','ggerganov/whisper.cpp',['ggml-large-v3-turbo-q5_0.bin'],'models/whisper','stt'),
 ('image','Comfy-Org/z_image_turbo',None,'ComfyUI-Next/models','image')]
out=[]
for key,repo,wanted,dest,group in specs:
    d=info(repo);files=[]
    for f in d['siblings']:
        n=f['rfilename']
        if wanted is not None and n not in wanted:continue
        if wanted is None and not n.endswith(('.json','.safetensors','.model','.txt','.jinja')):continue
        if key=='image' and n not in ['split_files/diffusion_models/z_image_turbo_bf16.safetensors','split_files/text_encoders/qwen_3_4b.safetensors','split_files/vae/ae.safetensors']:continue
        target=n.removeprefix('split_files/') if key=='image' else n
        url=f'https://huggingface.co/{repo}/resolve/{d["sha"]}/{n}?download=true'
        sha=f.get('lfs',{}).get('sha256')
        if not sha:
            import hashlib
            with urllib.request.urlopen(url,timeout=60) as response:blob=response.read()
            sha=hashlib.sha256(blob).hexdigest()
        files.append({'name':n,'destination':dest+'/'+target,'bytes':f.get('size'),'sha256':sha,'url':url})
    if not files:raise RuntimeError('No matching model files for '+key)
    if wanted and set(wanted)!={f['name'] for f in files}:raise RuntimeError('Missing expected model file '+key)
    out.append({'id':key,'group':group,'repo':repo,'revision':d['sha'],'page':'https://huggingface.co/'+repo,'license':d.get('cardData',{}).get('license','See model card'),'files':files})
    print(key,len(files))
(ROOT/'catalog/models.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
