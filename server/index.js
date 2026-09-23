import express from 'express';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { ZodError } from 'zod';
import { AppError, requireThat, buildView, act, AS_OF } from './domain.js';
import { store, catalog, events, admin, isSupabase } from './store.js';
import { recommend, coach, MODEL } from './ai.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'8mb'}));
app.use((req,res,next)=>{ res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY'); if(req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store'); next(); });
app.get('/api/config', (req,res)=>res.json({mode:isSupabase?'supabase':'demo',supabaseUrl:isSupabase?process.env.SUPABASE_URL:null,supabaseAnonKey:isSupabase?process.env.SUPABASE_ANON_KEY:null,aiConfigured:!!process.env.GEMINI_API_KEY,model:MODEL,asOf:AS_OF}));
app.get('/api/health',(req,res)=>res.json({ok:true,mode:isSupabase?'supabase':'demo'}));
app.use('/api',async(req,res,next)=>{
  try {
    if(['POST','PUT','DELETE','PATCH'].includes(req.method)) {
      if(req.headers.origin) requireThat(new URL(req.headers.origin).host===req.headers.host,'Cross-origin mutations are not allowed.',403);
      requireThat(req.is('application/json'),'Use application/json.',415);
    }
    if(isSupabase) {
      const token=req.headers.authorization?.replace(/^Bearer /,''); requireThat(token,'Sign in to continue.',401);
      const {data,error}=await admin.auth.getUser(token); requireThat(!error&&data.user,'Session expired. Sign in again.',401);
      const {data:member,error:membershipError}=await admin.from('cq_memberships').select('employee_id,role').eq('user_id',data.user.id).maybeSingle();
      requireThat(!membershipError,'Could not verify your account permissions.',503); requireThat(member,'Your account needs an employee profile. Ask your administrator.',403); req.actor={...member,userId:data.user.id};
    } else req.actor={role:req.headers['x-demo-role']==='hr'?'hr':'employee',employee_id:String(req.headers['x-demo-employee']||'E0028'),userId:'demo'};
    next();
  } catch(error) {next(error);}
});
function hr(req) { requireThat(req.actor.role==='hr','Only HR can access this information.',403); }
function own(req,id) { requireThat(req.actor.role==='hr'||req.actor.employee_id===id,'You can only access your own profile.',403); }
async function viewFor(id) { const row=await store.get(id); return buildView(row.profile,row.history,events,catalog,row.state); }
function publicView(view) { const {candidates,...rest}=view; return rest; }
app.get('/api/session',async(req,res)=>{
  const rows=req.actor.role==='hr'||!isSupabase?await store.list():[await store.get(req.actor.employee_id)];
  res.json({actor:req.actor,employees:rows.map(r=>({id:r.id,name:r.profile.full_name,role:r.profile.role,grade:r.profile.grade,department:r.profile.department})),catalog,counts:{employees:rows.length,events:events.length,skills:catalog.skills.length}});
});
app.get('/api/employees/:id',async(req,res)=>{own(req,req.params.id);res.json(publicView(await viewFor(req.params.id)));});
app.post('/api/employees/:id/actions',async(req,res)=>{own(req,req.params.id);const result=await store.mutate(req.params.id,row=>act(row.profile,row.history,events,catalog,row.state,req.body));res.json({result,view:publicView(await viewFor(req.params.id))});});
const requests=new Map();
function limit(req) { const key=`${req.actor.userId}:${req.actor.employee_id}`;const prior=requests.get(key)||{start:Date.now(),count:0};if(Date.now()-prior.start>60000){prior.start=Date.now();prior.count=0;}requireThat(prior.count++<20,'Please wait a moment before asking again.',429);requests.set(key,prior);if(requests.size>10000)requests.clear(); }
app.post('/api/employees/:id/recommendations',async(req,res)=>{own(req,req.params.id);limit(req);res.json(await recommend(await viewFor(req.params.id),['en','ru','kk'].includes(req.body.language)?req.body.language:'en'));});
app.post('/api/employees/:id/coach',async(req,res)=>{own(req,req.params.id);limit(req);requireThat(typeof req.body.message==='string'&&req.body.message.trim().length>0&&req.body.message.length<=2000,'Ask a question between 1 and 2,000 characters.');res.json(await coach(await viewFor(req.params.id),req.body.message,req.body.language));});
app.get('/api/hr',async(req,res)=>{
  hr(req);const rows=await store.list();const views=rows.map(r=>buildView(r.profile,r.history,events,catalog,r.state));
  const gapCounts=catalog.skills.map(s=>({id:s.skill_id,name:s.name,affected:views.filter(v=>v.gaps.some(g=>g.id===s.skill_id&&g.gap>0)).length,critical:views.filter(v=>v.gaps.some(g=>g.id===s.skill_id&&g.gap>0&&g.critical)).length})).filter(s=>s.affected).sort((a,b)=>b.affected-a.affected);
  const allHistory=views.flatMap(v=>v.history);const voluntary=allHistory.filter(h=>!h.event.mandatory);
  res.json({total:rows.length,historyCount:allHistory.length,completed:voluntary.filter(h=>h.status==='completed').length,participations:voluntary.length,completionRate:voluntary.length?Math.round(voluntary.filter(h=>h.status==='completed').length/voluntary.length*100):0,gaps:gapCounts,blockers:views.filter(v=>!v.recommendations.length).map(v=>({id:v.employee.employee_id,name:v.employee.full_name,role:v.employee.role,target:`${v.target.target_grade} ${v.target.target_role}`,reason:v.gaps.every(g=>g.gap===0)?'Target requirements already covered':v.state.dismissed.length?'Review dismissed options or catalog gaps':'No eligible activity closes a target gap or prerequisite',criticalGaps:v.gaps.filter(g=>g.critical&&g.gap).map(g=>g.name)})),activity:events.map(e=>({id:e.event_id,title:e.title,mandatory:e.mandatory,total:allHistory.filter(h=>h.event_id===e.event_id).length,completed:allHistory.filter(h=>h.event_id===e.event_id&&h.status==='completed').length,missed:allHistory.filter(h=>h.event_id===e.event_id&&['no_show','dropped','declined'].includes(h.status)).length})),asOf:AS_OF});
});
app.post('/api/hr/import',async(req,res)=>{
  hr(req);let employees=[];let history=[];
  if(req.body.employees) { const input=typeof req.body.employees==='string'?JSON.parse(req.body.employees):req.body.employees; employees=Array.isArray(input)?input:input.employees;requireThat(Array.isArray(employees),'Employee JSON must be an array or an object with employees[].'); }
  if(req.body.history) history=typeof req.body.history==='string'?parse(req.body.history,{columns:true,skip_empty_lines:true,bom:true}):req.body.history;
  res.json(await store.import(employees,history));
});
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
app.use((error,req,res,next)=>{ if(!req.path.startsWith('/api/')) return next(error); const validation=error instanceof ZodError; res.status(validation?400:error.status||((error instanceof SyntaxError||String(error.code||'').startsWith('CSV_'))?400:500)).json({error:validation?error.issues.slice(0,5).map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):error instanceof AppError?error.message:error instanceof SyntaxError?'Invalid JSON. Check the uploaded file.':String(error.code||'').startsWith('CSV_')?'Invalid CSV. Check the column headings and quoted fields.':'The request could not be completed. Please try again.'}); });
if(process.argv.includes('--production')) { app.use(express.static(resolve('dist')));app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html'))); }
else { const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares); }
const host=process.env.HOST||'127.0.0.1';if(!isSupabase&&!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('Demo mode must bind to loopback. Set APP_MODE=supabase for network deployment.');
const server=app.listen(Number(process.env.PORT)||3000,host,()=>console.log(`Qadam ready at http://${host}:${Number(process.env.PORT)||3000} · ${isSupabase?'Supabase authentication':'local synthetic demo'}`));
server.on('error',e=>{console.error(e.message);process.exit(1);});
