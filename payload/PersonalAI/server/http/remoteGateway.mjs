import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pipeline } from 'node:stream/promises';
import {createHmac} from 'node:crypto';

/** Serve only built assets and the application API. Never proxy arbitrary backend paths. */
export function startGateway(config){
 const remote=config.remote??{};
 const origin=remote.origin;
 if(origin&&(!/^https:\/\/[a-z0-9.-]+\.ts\.net$/.test(origin)||!remote.allowedUsers?.length))throw Error('Remote origin must be a Tailscale HTTPS hostname with allowedUsers.');
 const root=path.resolve(config.projectRoot,'dist');
 const server=http.createServer(async(req,res)=>{
  try{
   const forwarded=req.headers['tailscale-user-login'];
   const localHost=['127.0.0.1','localhost','[::1]'].includes(String(req.headers.host).split(':')[0]);
   const remoteRequest=!!forwarded||!localHost;
   if(remoteRequest&&(!origin||!remote.allowedUsers.includes(forwarded))) {res.writeHead(403);return res.end('Tailscale identity is not authorized.');}
   if(req.headers.origin&&!([`http://127.0.0.1:${remote.port??8790}`,`http://localhost:${remote.port??8790}`,origin].includes(req.headers.origin))){res.writeHead(403);return res.end('Origin not allowed');}
   const url=new URL(req.url,'http://localhost');
   // External links may open the app document; API and subresource requests stay protected.
   // Installed-app/service-worker launches may report empty or absent destination.
   // Only the authenticated public app shell is exempt; API/AI/assets are not.
   const destination=req.headers['sec-fetch-dest'];
   const documentNavigation=req.method==='GET'&&['/','/index.html'].includes(url.pathname)&&[undefined,'','empty','document'].includes(destination);
   if(req.headers['sec-fetch-site']==='cross-site'&&!documentNavigation){console.warn('[gateway] blocked cross-site request',JSON.stringify({path:url.pathname,method:req.method,mode:req.headers['sec-fetch-mode'],destination}));res.writeHead(403,{'Cache-Control':'no-store'});return res.end('Cross-site request blocked');}
   if(url.pathname.startsWith('/api/')){
    // Existing Host/Origin/permission checks remain on the API. Only this trusted
    // loopback gateway can assert remote identity; incoming internal headers are discarded.
    const headers={...req.headers,host:`127.0.0.1:${config.port}`,'x-lumicos-internal':undefined,'x-lumicos-remote':undefined};
    delete headers.origin;delete headers['x-lumicos-internal'];delete headers['x-lumicos-remote'];
    headers['x-lumicos-gateway']=config.internalToken;headers['x-lumicos-transport']=remoteRequest?'tailscale':'local';
    if(remoteRequest)headers['x-lumicos-remote']=createHmac('sha256',config.internalToken).update(String(forwarded)).digest('hex');
    const upstream=http.request({hostname:'127.0.0.1',port:config.port,path:req.url,method:req.method,headers},incoming=>{
     res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
    });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Lumicos service unavailable')});res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
   }
   if(/^\/llama\/(health|v1\/models|props)$/.test(url.pathname)&&req.method==='GET'){
    const r=await fetch('http://127.0.0.1:8080'+url.pathname.slice(6),{signal:AbortSignal.timeout(4000)});
    const value=await r.json();const body=url.pathname.endsWith('/props')?{default_generation_settings:{n_ctx:value.default_generation_settings?.n_ctx}}:url.pathname.endsWith('/models')?{data:value.data?.map(m=>({id:path.basename(m.id)}))}:value;
    res.writeHead(r.status,{'Content-Type':'application/json'});return res.end(JSON.stringify(body));
   }
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
   if(url.pathname.startsWith('/llama/')){res.writeHead(404);return res.end();}
   let name=decodeURIComponent(url.pathname);if(name==='/'||!path.extname(name))name='/index.html';
   const file=path.resolve(root,'.'+name);
   if(!file.startsWith(root+path.sep)||name.endsWith('.map')||!fs.existsSync(file)){res.writeHead(404);return res.end();}
   const mime={'.webmanifest':'application/manifest+json; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.mp4':'video/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg','.json':'application/json','.wav':'audio/wav'};
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':['/index.html','/sw.js','/manifest.webmanifest'].includes(name)?'no-cache':'public, max-age=3600','Content-Security-Policy':name.startsWith('/avatar/')?"frame-ancestors 'self'":"frame-ancestors 'none'"});
   if(req.method==='HEAD')return res.end();await pipeline(fs.createReadStream(file),res);
  }catch{if(!res.headersSent)res.writeHead(502);res.end('Lumicos gateway unavailable');}
 });server.on('error',e=>console.error('[gateway]',e.message));server.listen(remote.port??8790,'127.0.0.1');return server;
}
