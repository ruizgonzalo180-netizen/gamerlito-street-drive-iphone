const cacheName='street-drive-shell-v2';
const shell=['./','./index.html','./style.css','./app.js','./app.webmanifest','./cover.jpg','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(shell)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('street-drive-shell-') && key!==cacheName).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || !url.href.startsWith(self.registration.scope) || url.pathname.endsWith('.mp4') || event.request.headers.has('Range')) return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./index.html',self.registration.scope).href)));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit || fetch(event.request)));
});
