// Cache only public application files. Never cache auth, API or document requests.
const CACHE='campus-shell-1.0.2';
const FILES=['./','./index.html','./style.css','./app.js','./core.mjs','./sync.mjs','./sync-core.mjs','./config.mjs','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('campus-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==location.origin)return;
 const root=new URL('./',location.href),allowed=FILES.some(file=>new URL(file,root).pathname===u.pathname);if(!allowed)return;
 const key=new URL(u.pathname,location.origin).href;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok&&!response.redirected&&new URL(response.url||event.request.url).origin===location.origin){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(key,copy)))}return response}).catch(()=>caches.match(key).then(response=>response||Response.error())));
});
