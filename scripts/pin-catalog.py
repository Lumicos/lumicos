import urllib.request,json,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Lumicos-Installer/0.1'}),timeout=120) as r:return r.read()
def asset(key,name):
    data=json.loads((ROOT/'catalog'/f'{key}.upstream.json').read_text())
    a=next(x for x in data['assets'] if x['name']==name)
    return {'url':a['browser_download_url'],'sha256':a['digest'].split(':')[1],'bytes':a['size'],'version':data['tag_name']}
def pinned(url,version):
    b=fetch(url)
    return {'url':url,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'version':version}
items={
 'uv':asset('uv','uv-x86_64-pc-windows-msvc.zip'),
 'llama-cuda12':asset('llama','llama-b11723-bin-win-cuda-12.4-x64.zip'),
 'llama-cuda13':asset('llama','llama-b11723-bin-win-cuda-13.4-x64.zip'),
 'cudart12':asset('llama','cudart-llama-bin-win-cuda-12.4-x64.zip'),
 'cudart13':asset('llama','cudart-llama-bin-win-cuda-13.4-x64.zip'),
 'llama-rocm':asset('llama','llama-b11723-bin-win-rocm-10.0-x64.zip'),
 'llama-vulkan':asset('llama','llama-b11723-bin-win-vulkan-x64.zip'),
 'llama-cpu':asset('llama','llama-b11723-bin-win-cpu-x64.zip'),
 'whisper-cuda':asset('whisper','whisper-bin-win-cuda-12.4.0-x64.zip'),
 'whisper-cpu':asset('whisper','whisper-bin-x64.zip'),
}
node='v24.21.0';name=f'node-{node}-win-x64.zip'
sums=fetch(f'https://nodejs.org/dist/{node}/SHASUMS256.txt').decode()
sha=next(x.split()[0] for x in sums.splitlines() if x.split()[-1]==name)
items['node']={'url':f'https://nodejs.org/dist/{node}/{name}','sha256':sha,'version':node}
for key,repo,commit in [('comfy','Comfy-Org/ComfyUI','5cc4b870094c89090db54bd8d12649dcaf89f2ba'),('gguf','city96/ComfyUI-GGUF','6ea2651e7df66d7585f6ffee804b20e92fb38b8a')]:
    items[key]=pinned(f'https://codeload.github.com/{repo}/zip/{commit}',commit)
items['python-embed']=pinned('https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-amd64.zip','3.13.9')
(ROOT/'catalog'/'downloads.json').write_text(json.dumps(items,indent=2),encoding='utf8')
print('Pinned',len(items),'downloads')
