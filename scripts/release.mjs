import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run,hash} from '../src/io.mjs';
import {verifyPayload} from '../src/install.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
await verifyPayload(root);
await run(process.execPath,[path.join(root,'scripts/check-docs.mjs')]);
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.mkdir(path.join(root,'.build'),{recursive:true});
const out=path.join(root,'.build/lumicos.package.zip');
const script=String.raw`
import json, pathlib, zipfile, hashlib, sys
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])
names=['Bootstrap.ps1','Install.cmd','Detect Only.cmd','README.md','README.th.md','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md','THIRD-PARTY-NOTICES.md','LICENSE','package.json']
files=[root/n for n in names]+[root/'.build/Lumicos-Setup.exe']
for folder in ['src','scripts','catalog','payload','assets','docs']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and not p.name.endswith('.upstream.json') and '__pycache__' not in p.parts and not p.name.startswith('lumen'))
files.extend([root/'tests/installer.test.mjs',root/'tests/public-tts.test.mjs',root/'tests/pattara-only.test.mjs',root/'tests/nova-only.test.mjs',root/'tests/fixtures/cpu.json',root/'tests/service-smoke.mjs'])
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(files):
        if p.is_symlink(): raise RuntimeError('Symlink: '+str(p))
        z.write(p,'Lumicos-Setup.exe' if p.parent.name=='.build' else p.relative_to(root).as_posix())
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert not any('TTS-Bench/' in n or '/call-fillers/' in n or n.endswith('ref5.wav') or '/public/avatar/' in n or n.endswith('lumicos-master-identity.json') or n.endswith('AvatarPage.tsx') for n in z.namelist())
    for e in json.loads(z.read('catalog/payload.json')):
        data=z.read('payload/'+e['path'])
        assert len(data)==e['bytes'] and hashlib.sha256(data).hexdigest()==e['sha256'],e['path']
print(str(len(files))+' files; ZIP integrity and all payload hashes verified')
`;
console.log(await run('python',['-c',script,root,out],{capture:true,timeout:120000}));
const digest=await hash(out);await fs.writeFile(out+'.sha256',digest+'  '+path.basename(out)+'\n');
console.log(out+'\nSHA256 '+digest+'\n'+((await fs.stat(out)).size/1048576).toFixed(1)+' MiB');

await fs.writeFile(path.join(root,'.build/PackageDigest.cs'),'static class PackageDigest { public const string Value="'+digest+'"; }');
const exe=path.join(root,'dist/Lumicos-Setup.exe');
await run(path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/optimize+','/platform:x64','/target:winexe','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/win32icon:'+path.join(root,'assets/lumicos.ico'),'/resource:'+out+',lumicos.package.zip','/out:'+exe,path.join(root,'src/SingleFileSetup.cs'),path.join(root,'.build/PackageDigest.cs')]);
await fs.writeFile(exe+'.sha256',await hash(exe)+'  Lumicos-Setup.exe\n');
console.log('SINGLE FILE: '+exe+' ('+((await fs.stat(exe)).size/1048576).toFixed(1)+' MiB)');
