const cacheName='street-drive-shell-v4';
const shell=['./','./index.html','./style.css?v=4','./app.js?v=4','./app.webmanifest?v=4','./cover.jpg?v=4','./icon-180.png?v=4','./icon-192.png?v=4','./icon-512.png?v=4'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(shell.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('street-drive-shell-') && key!==cacheName).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || !url.href.startsWith(self.registration.scope) || url.pathname.endsWith('.mp4') || event.request.headers.has('Range')) return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request,{cache:'no-cache'}).catch(()=>caches.match(new URL('./index.html',self.registration.scope).href)));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit || fetch(event.request)));
});
