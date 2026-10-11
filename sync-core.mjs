import {blankState,validate} from './core.mjs';
export const equal=(a,b)=>stable(a)===stable(b);
function stable(v){if(v===undefined)return 'undefined';if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
// Three-way merge uses the last acknowledged server snapshot, not device clocks.
// A delete versus an edit is a conflict; unchanged records follow the deletion.
export function reconcile(base,local,remote,choice=null){
 [base,local,remote].forEach(validate);const out=blankState(),conflicts=[];
 function pick(b,l,r,label){if(equal(l,r))return l;if(equal(l,b))return r;if(equal(r,b))return l;conflicts.push({label,local:l,remote:r});return choice==='remote'?r:l}
 for(const key of ['documents','applications','courses','answers']){
  const maps=[base,local,remote].map(s=>new Map(s[key].map(v=>[v.id,v])));
  for(const id of new Set(maps.flatMap(m=>[...m.keys()]))){const [b,l,r]=maps.map(m=>m.get(id));const v=pick(b,l,r,`${key}: ${(l||r||b).role||(l||r||b).name||(l||r||b).title||id}`);if(v)out[key].push(structuredClone(v))}
 }
 for(const key of Object.keys(out.profile))out.profile[key]=pick(base.profile[key],local.profile[key],remote.profile[key],`Profile: ${key}`);
 for(const key of ['collegeStart','priorities'])out[key]=structuredClone(pick(base[key],local[key],remote[key],key));
 // Concurrent document deletion versus a newly created reference must never lose bytes.
 for(const a of out.applications)for(const id of a.documentIDs)if(!out.documents.some(d=>d.id===id)){const d=local.documents.find(d=>d.id===id)||remote.documents.find(d=>d.id===id)||base.documents.find(d=>d.id===id);out.documents.push(structuredClone(d))}
 out.priorities=out.priorities.filter(id=>out.applications.some(a=>a.id===id&&!a.archived));
 return {state:validate(out),conflicts};
}
export function checkConfig(url,key){const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Use your project URL: https://your-project.supabase.co');
 if(!key.startsWith('sb_publishable_')){try{const v=JSON.parse(atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/')));if(v.role!=='anon')throw Error()}catch{throw Error('Use a publishable key or legacy anon key. Never use a secret or service-role key.')}}
 return {url:u.origin,key};}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function fromBase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
export function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s)}
