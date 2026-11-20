/* Street Admin · LH STREET: alternância de tema na entrada e no painel. */
(function(){
 'use strict';
 const KEY='street-admin-visual-theme';
 const root=document.documentElement;
 const toggles=[...document.querySelectorAll('#theme-toggle,#auth-theme-toggle')];
 let saved='dark';
 try{saved=localStorage.getItem(KEY)==='light'?'light':'dark';}catch(e){}
 function apply(mode){
  const theme=mode==='light'?'light':'dark';
  root.dataset.theme=theme;
  for(const toggle of toggles){
   const login=toggle.id==='auth-theme-toggle';
   const icon=toggle.querySelector('.theme-icon');
   const label=toggle.querySelector('.theme-label');
   if(icon)icon.innerHTML=theme==='dark'?'\u003csvg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"\u003e\u003ccircle cx="12" cy="12" r="4"/\u003e\u003cpath d="M12 2v2m0 16v2M4.93 4.93l1.4 1.4m11.34 11.34 1.4 1.4M2 12h2m16 0h2M4.93 19.07l1.4-1.4M17.67 6.33l1.4-1.4"/\u003e\u003c/svg\u003e':'\u003csvg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"\u003e\u003cpath d="M20.5 14.3A9 9 0 0 1 9.7 3.5 9 9 0 1 0 20.5 14.3Z"/\u003e\u003c/svg\u003e';
   if(label)label.textContent=theme==='dark'?'Modo claro':'Modo escuro';
   toggle.setAttribute('aria-label',theme==='dark'?'Ativar modo claro':'Ativar modo escuro');
   toggle.setAttribute('title',theme==='dark'?'Ativar modo claro':'Ativar modo escuro');
   toggle.setAttribute('aria-pressed',String(theme==='light'));
  }
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',theme==='dark'?'#0e0e12':'#faf9fb');
 }
 apply(saved);
 toggles.forEach(button=>button.addEventListener('click',function(){
  const next=root.dataset.theme==='dark'?'light':'dark';
  try{localStorage.setItem(KEY,next);}catch(e){}
  apply(next);
 }));
})();
