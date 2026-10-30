import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pythonLaunch } from '../server/util/hiddenPython.mjs';
import { setTimeout as delay } from 'node:timers/promises';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeConfig = () => JSON.parse(fs.readFileSync(path.join(root, 'lumicos-launcher.json'), 'utf8').replace(/^\uFEFF/, ''));
export async function probe(url, validate, json = true) {
  try {
    const r = await fetch(url, { headers: { 'X-PersonalAI': '1' }, signal: AbortSignal.timeout(2000) });
    return r.ok && validate(json ? await r.json() : await r.text());
  } catch { return false; }
}
export async function occupied(port) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port });
    const end = value => { s.destroy(); resolve(value); };
    s.setTimeout(1000, () => end(true));
    s.once('connect', () => end(true));
    s.once('error', e => end(e.code !== 'ECONNREFUSED'));
  });
}
export async function ensure({ name, port, url, validate, json = true, command, args, cwd = root, env = {}, files = [], timeout = 180000, onSpawn, detached = true }, report = console.log) {
  if (await probe(url, validate, json)) { report(name + ': already ready'); return { reused: true }; }
  let child;
  if (await occupied(port)) {
    report(name + ': port is busy; waiting for service readiness...');
    timeout = Math.min(timeout, 60000);
  } else {
    for (const file of files) if (!fs.existsSync(file)) throw new Error(name + ': missing file ' + file);
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    const log = path.join(root, 'logs', name + '.log');
    const fd = fs.openSync(log, 'a');
    fs.writeSync(fd, '\n--- ' + new Date().toISOString() + ' ---\n');
    try { child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached, windowsHide: true, stdio: ['ignore', fd, fd], shell: false }); }
    finally { fs.closeSync(fd); }
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    onSpawn?.(child);
    child.unref();
    report(name + ': starting; log: ' + log);
  }
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await probe(url, validate, json)) { report(name + ': ready'); return { reused: !child, pid: child?.pid }; }
    if (child && child.exitCode !== null) throw new Error(name + ' exited (' + child.exitCode + '). Check logs/' + name + '.log');
    await delay(1000);
  }
  throw new Error(name + ' did not become ready on port ' + port + '. Check logs and other applications using this port. No existing process was stopped.');
}
let comfyStarting, comfyChild;
/**
 * A ComfyUI that a previous Lumicos service started survives a service restart (Stop-Process does not
 * stop children on Windows), so the new service no longer has its child handle. Recognise it by an
 * exact fingerprint of how ensureComfy() launches it: the venv launcher in comfyDir running
 * `main.py --listen 127.0.0.1 --port 8188`. Returns the launcher PID, or null (unknown/external → untouched).
 */
function findLumicosComfyPid(){
  if(process.platform!=='win32')return null;
  let comfyDir;try{comfyDir=runtimeConfig().comfyDir}catch{return null}
  const launcher=path.join(comfyDir,'.venv','Scripts','python.exe').replace(/'/g,"''");
  const ps=`$ErrorActionPreference='Stop';$c=Get-NetTCPConnection -LocalPort 8188 -State Listen|Select-Object -First 1;`+
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)";`+
    `$q=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)";`+
    `@($p,$q)|ForEach-Object{[pscustomobject]@{pid=$_.ProcessId;exe=$_.ExecutablePath;cmd=$_.CommandLine}}|ConvertTo-Json -Compress`;
  try{
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,encoding:'utf8',timeout:8000});
    if(r.status!==0||!r.stdout.trim())return null;
    const rows=[].concat(JSON.parse(r.stdout));
    const args=/main\.py\s+--listen\s+127\.0\.0\.1\s+--port\s+8188\s*$/i;
    const exes=new Set([launcher.replace(/''/g,"'"),pythonLaunch(launcher.replace(/''/g,"'")).command].map(p=>path.resolve(p).toLowerCase()));
    const match=rows.find(x=>x?.exe&&exes.has(path.resolve(x.exe).toLowerCase())&&args.test(String(x.cmd??'').trim()));
    return match?Number(match.pid):null;
  }catch{return null}
}
export function stopOwnedComfy(){
  if(comfyChild && comfyChild.exitCode===null && comfyChild.signalCode===null){
    // Windows venv Python uses a redirector child; stop the owned process tree.
    if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(comfyChild.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else comfyChild.kill();
    comfyChild=undefined;
    return true;
  }
  comfyChild=undefined;
  // Left over from an earlier Lumicos service (same launcher + exact args): still ours to stop.
  const orphan=findLumicosComfyPid();
  if(orphan){spawnSync('taskkill.exe',['/PID',String(orphan),'/T','/F'],{windowsHide:true,stdio:'ignore'});console.log(`[comfy] stopped ComfyUI left by an earlier Lumicos service (pid ${orphan})`);return true;}
  return false;
}
export function ensureComfy(report = console.log) {
  if (!comfyStarting) comfyStarting = (async () => {
    const { comfyDir } = runtimeConfig();
    const python = path.join(comfyDir, '.venv', 'Scripts', 'python.exe');
    const launch = pythonLaunch(python); // base interpreter directly: no venv-launcher console window
    return ensure({ name: 'comfy', port: 8188, url: 'http://127.0.0.1:8188/system_stats',
      validate: d => Array.isArray(d.devices) && d.devices.length > 0, command: launch.command,
      args: ['main.py', '--listen', '127.0.0.1', '--port', '8188'],
      cwd: comfyDir, files: [python, path.join(comfyDir, 'main.py')], timeout: 240000, detached: false,
      onSpawn: child => { comfyChild=child; }, env: { ROCM_INT8_KITCHEN_PATCH: 'force', ...launch.env } }, report);
  })().finally(() => { comfyStarting = undefined; });
  return comfyStarting;
}

