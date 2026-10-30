import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const files=['README.md','README.th.md','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md'];
for(const name of await fs.readdir(path.join(root,'docs')))if(name.endsWith('.md'))files.push('docs/'+name);
const failures=[];let links=0;
for(const file of files){
 const text=await fs.readFile(path.join(root,file),'utf8');
 for(const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(?:src|href)="([^"]+)"/g)){
  const url=match[1]??match[2];if(/^(?:https?:|mailto:|#)/.test(url))continue;
  const target=decodeURIComponent(url.split('#')[0]);if(!target)continue;links++;
  const resolved=path.resolve(root,path.dirname(file),target);
  if(!resolved.startsWith(root+path.sep)){failures.push(`${file}: path leaves repository`);continue;}
  try{await fs.access(resolved);}catch{failures.push(`${file}: missing ${target}`);}
 }
 if(file.startsWith('README')){
  for(const token of ['Your AI. Your Machine. Your Control.','assets/lumicos-logo.png','0.2.3','46.4','22.9','Microsoft Pattara','docs/FEATURE_STATUS.md','docs/INSTALLATION.md','docs/BENCHMARKS.md','SECURITY.md','LICENSE'])if(!text.includes(token))failures.push(`${file}: missing bilingual factual marker ${token}`);
  if(/github\/actions\/workflow\/status|github\/v\/release/i.test(text))failures.push(`${file}: unverified status badge`);
 }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(`PASS: ${files.length} Markdown documents; ${links} local links/images; bilingual factual markers. External URLs, rendered layout and factual meaning need human review.`);
