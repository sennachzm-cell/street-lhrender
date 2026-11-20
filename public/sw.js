/* Street Admin offline 1.1: somente shell publica no CacheStorage; dados no IndexedDB. */
'use strict';
const VERSION='street-admin-shell-20261119-lhstreet2';
const ASSETS=[
 '/', '/index.html', '/styles.css?v=20261109violet1', '/reference-violet.css?v=20261109reference2', '/studio-signature.css?v=20261109logo3', '/streetadmin-brand.css?v=20261109brand4', '/finance.js?v=20261108mergesafe2', '/cash-update.css?v=20261111cash1', '/studio-shell-v2.css?v=20261115-pix-equipe-mobile1',
 '/app.js?v=20261115-pix-equipe-mobile1', '/theme.js?v=20261109logo3', '/manifest.json?v=20261119lh', '/icon.svg',
 '/pix.js?v=20261115-pix-equipe-mobile1', '/pix-ui.js?v=20261115-pix-equipe-mobile1', '/qrcode.js?v=1.4.4', '/pix-mobile.css?v=20261115-pix-equipe-mobile1', '/release-update.js?v=20261115-pix-equipe-mobile1',
 '/icon-192.png', '/icon-512.png', '/lh-street-logo.webp', '/lh-street-mark.webp', '/lh-street-texture.webp', '/lh-street-identity.css?v=20261119', '/streetadmin-badge.png'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('street-admin-shell-')&&key!==VERSION).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/versao-street-admin.json')return;
 if(req.mode==='navigate'){
  event.respondWith((async()=>{
   // Espera no maximo 3s por um PC indisponivel; usa tela salva se necessario.
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),3000);
   try{
    const online=await fetch(req,{signal:controller.signal});
    if(online.ok){const cache=await caches.open(VERSION);await cache.put('/index.html',online.clone());}
    return online;
   }catch{
    return await caches.match('/index.html')||await caches.match('/')||new Response('Abra o Street Admin uma vez com o servidor conectado para preparar o modo offline.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
   }finally{clearTimeout(timer);}
  })());return;
 }
 event.respondWith((async()=>{
  const cached=await caches.match(req);if(cached)return cached;
  try{const online=await fetch(req);if(online.ok){const cache=await caches.open(VERSION);await cache.put(req,online.clone());}return online;}
  catch{return Response.error();}
 })());
});
