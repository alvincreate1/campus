import {blankState,validate} from './core.mjs';
import {checkConfig,equal,reconcile,digest,fromBase64,toBase64} from './sync-core.mjs';
const bucket='/storage/v1/object/campus-documents/';
export class SupabaseRemote {
 constructor(storage=localStorage,fetcher=fetch,prefix='campus-sync-v1'){this.storage=storage;this.fetcher=(...args)=>Reflect.apply(fetcher,globalThis,args);this.prefix=prefix}
 get config(){return JSON.parse(this.storage.getItem(this.prefix+'-config')||'null')}
 get session(){return JSON.parse(this.storage.getItem(this.prefix+'-session')||'null')}
 configure(url,key){const c=checkConfig(url.trim(),key.trim());this.storage.setItem(this.prefix+'-config',JSON.stringify(c));return c}
 async request(path,{method='GET',body,token,raw=false}={}){
  const c=this.config;if(!c)throw Error('Set up your Supabase connection first.');
  const headers={apikey:c.key};if(token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']=raw?'application/octet-stream':'application/json';
  let response;try{response=await this.fetcher(c.url+path,{method,headers,body:body?(raw?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(45000),cache:'no-store'})}catch(e){throw Error(e.name==='TimeoutError'?'Supabase took too long to respond. Your local records are safe; try again.':'Could not reach Supabase. Changes are saved on this device; reconnect and try again.')}
  if(!response.ok){let data;try{data=await response.json()}catch{};const error=Error(response.status===401?'Please sign in again. Your local changes are safe.':response.status===403?'Access denied. Check the Campus database and storage policies.':data?.msg||data?.message||data?.error_description||'Supabase request failed ('+response.status+').');error.status=response.status;error.code=data?.error||data?.code;throw error}
  if(raw&&method==='GET')return new Uint8Array(await response.arrayBuffer());
  const text=await response.text();return text?JSON.parse(text):null;
 }
 storeSession(s){if(!s?.access_token||!s?.refresh_token||!s?.user?.id)throw Error('Invalid sign-in response.');s.expires_at=Date.now()/1000+s.expires_in;this.storage.setItem(this.prefix+'-session',JSON.stringify(s));return s}
 async login(email,password){return this.storeSession(await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}))}
 async authorize(){let s=this.session;if(!s)throw Error('Sign in to sync.');if(s.expires_at<Date.now()/1000+90)s=this.storeSession(await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh_token}}));return s}
 async logout(){const s=this.session;this.storage.removeItem(this.prefix+'-session');if(s)try{await this.request('/auth/v1/logout?scope=local',{method:'POST',token:s.access_token})}catch{/* Local sign-out still succeeds offline. */}}
 async load(s,local){
  const rows=await this.request('/rest/v1/campus_planners?select=revision,payload&user_id=eq.'+encodeURIComponent(s.user.id),{token:s.access_token});
  if(!Array.isArray(rows)||rows.length>1)throw Error('Unexpected cloud response. No local records were changed.');
  this.knownPaths=new Set();if(!rows.length)return {revision:0,state:blankState()};const row=rows[0],p=row.payload;
  if(!Number.isSafeInteger(row.revision)||row.revision<1||p?.format!=='campus-sync'||p.version!==1||!Array.isArray(p.state?.documents))throw Error('Unsupported cloud format. Update Campus before syncing.');
  const state=structuredClone(p.state);let total=0;
  for(const d of state.documents){if(typeof d.blob!=='string'||!new RegExp('^'+s.user.id+'/[A-Fa-f0-9-]{36}/[a-f0-9]{64}$').test(d.blob)||!Number.isInteger(d.size)||d.size<1||d.size>20*1024*1024)throw Error('Invalid cloud document.');total+=d.size;if(total>75*1024*1024)throw Error('Cloud documents exceed 75 MB.');
   const cached=local.documents.find(x=>x.id===d.id);let bytes=cached?fromBase64(cached.bytes):null;
   const hash=d.blob.split('/').at(-1);if(!bytes||await digest(bytes)!==hash)bytes=await this.request(bucket+d.blob,{token:s.access_token,raw:true});
   if(bytes.length!==d.size||await digest(bytes)!==hash)throw Error('Cloud document verification failed. No local records were changed.');this.knownPaths.add(d.blob);d.bytes=toBase64(bytes);delete d.blob;delete d.size;
  }
  return {revision:row.revision,state:validate(state)};
 }
 async save(s,revision,state){
  validate(state);const cloud=structuredClone(state);
  for(const d of cloud.documents){const bytes=fromBase64(d.bytes),path=s.user.id+'/'+d.id+'/'+await digest(bytes);
   // Immutable content-addressed uploads can be retried after connection loss.
   try{if(!this.knownPaths?.has(path))await this.request(bucket+path,{method:'POST',body:bytes,token:s.access_token,raw:true})}catch(e){if(!(e.status===409||e.code==='Duplicate'||e.code==='ResourceAlreadyExists'))throw e;
    // Do not accept a duplicate with different bytes (including tampering).
    const existing=await this.request(bucket+path,{token:s.access_token,raw:true});if(await digest(existing)!==path.split('/').at(-1))throw Error('Cloud document conflict. Upload stopped.');}
   d.blob=path;d.size=bytes.length;delete d.bytes;
  }
  return await this.request('/rest/v1/rpc/campus_save',{method:'POST',token:s.access_token,body:{expected_revision:revision,new_payload:{format:'campus-sync',version:1,state:cloud}}});
 }
}
export class SyncEngine {
 constructor({remote,read,write,lock,onStatus=()=>{},onChange=()=>{}}){Object.assign(this,{remote,read,write,lock,onStatus,onChange});this.running=false;this.conflicts=[];this.status='Saved on this device'}
 statusText(text){this.status=text;this.onStatus(text)}
 async run(resolution=null){if(this.running)return;this.running=true;
 try{return await this.lock(async()=>{
  const bundle=await this.read(),session=await this.remote.authorize(),identity=this.remote.config.url+'|'+session.user.id;
  if(!bundle.meta?.identity)throw Error('Choose “Enable sync” to link this planner first.');
  if(bundle.meta.identity!==identity)throw Error('This planner belongs to another account or project. Sign in to the original account; no data was transferred.');
  this.statusText('Syncing…');
  for(let attempt=0;attempt<3;attempt++){
   const latest=await this.remote.load(session,bundle.state),base=bundle.meta.base||blankState();
   let result=reconcile(base,bundle.state,latest.state);
   if(result.conflicts.length){
    const fingerprint=JSON.stringify(result.conflicts);
    if(!resolution||resolution.fingerprint!==fingerprint){this.conflicts=result.conflicts;this.fingerprint=fingerprint;this.statusText('Needs your review');return {conflicts:this.conflicts}}
    result=reconcile(base,bundle.state,latest.state,resolution.choice);
   }
   let revision=latest.revision;
   if(!equal(result.state,latest.state)){revision=await this.remote.save(session,latest.revision,result.state);if(revision===null)continue;if(!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid sync acknowledgement. Your local changes are kept.');}
   const meta={identity,base:structuredClone(result.state),revision,lastSync:Date.now()};
   await this.write(result.state,meta);this.conflicts=[];this.fingerprint=null;this.onChange(result.state);this.statusText('Synced · '+new Date(meta.lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));return {ok:true};
  }
  throw Error('Another device is changing the planner. Retry sync in a moment.');
 })}catch(e){this.statusText(e.message);return {error:e.message}}finally{this.running=false}}
 async link(){return this.lock(async()=>{const b=await this.read(),s=await this.remote.authorize(),identity=this.remote.config.url+'|'+s.user.id;if(b.meta?.identity&&b.meta.identity!==identity)throw Error('This browser planner is already linked to another account. Sign in to that account.');await this.write(b.state,{...b.meta,identity,base:b.meta?.base||blankState()})})}
}
