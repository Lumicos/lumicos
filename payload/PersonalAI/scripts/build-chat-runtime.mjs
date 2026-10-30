import { build } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({configFile:false,root,define:{'import.meta.env.VITE_ENABLE_MOCK':'false'},build:{
  target:'node22',outDir:'.runtime',emptyOutDir:true,minify:false,
  lib:{entry:root+'src/chat/serverEntry.ts',formats:['es'],fileName:()=> 'chat.mjs'},
}});
