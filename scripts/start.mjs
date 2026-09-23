import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
if(existsSync('.env')){for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}}
const win=process.platform==='win32';const bundled=resolve('.tools/go/bin',win?'go.exe':'go');const go=existsSync(bundled)?bundled:'go';
process.env.GOCACHE ||= resolve('.tools/go-cache');mkdirSync(process.env.GOCACHE,{recursive:true});
process.env.GOMODCACHE ||= resolve('.tools/go-mod');
process.env.API_PORT=process.env.PORT||'8080';
const version=spawnSync(go,['version'],{stdio:'inherit'});if(version.status!==0){console.error('Install Go 1.25+ (https://go.dev/dl/) and run npm start again.');process.exit(1);}
if(!existsSync('frontend/node_modules/next')){const install=spawnSync(win?'cmd.exe':'npm',win?['/d','/s','/c','npm install --prefix frontend']:['install','--prefix','frontend'],{stdio:'inherit'});if(install.status!==0)process.exit(1);}
const binary=resolve('backend',win?'careerquest.exe':'careerquest');const build=spawnSync(go,['build','-o',binary,'.'],{cwd:resolve('backend'),stdio:'inherit'});if(build.status!==0)process.exit(1);
const children=[];let stopping=false;function stop(){if(stopping)return;stopping=true;for(const c of children)c.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
const backend=spawn(binary,[],{cwd:root,env:process.env,stdio:'inherit'});children.push(backend);
backend.on('exit',()=>{const lock=resolve(process.env.DATA_DIR||'data','state.lock');try{if(readFileSync(lock,'utf8').trim()===String(backend.pid))unlinkSync(lock);}catch{}});
let ready=false;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${process.env.API_PORT}/api/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
if(!ready){stop();console.error('Backend did not become ready. See output above.');process.exitCode=1;}else{
 const frontend=spawn(process.execPath,[resolve('frontend/node_modules/next/dist/bin/next'),process.env.NODE_ENV==='production'?'start':'dev','--hostname','127.0.0.1','--port','3000'],{cwd:resolve('frontend'),env:process.env,stdio:'inherit'});children.push(frontend);
 console.log(`\nOpen http://localhost:3000 · Storage: ${process.env.STORAGE_BACKEND || (process.env.DATABASE_URL ? 'supabase' : 'csv')} · Existing app logins are preserved\n`);
 for(const c of children)c.on('exit',code=>{if(!stopping){process.exitCode=code||0;stop();}});
}

