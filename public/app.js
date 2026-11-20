/* STREET ADMIN 1.1 — interface local-first, mesmos dados no PC e iPhone */
'use strict';
let DB_NAME='street-admin-account-unset';const DB_VERSION=1;
let session=null;const SESSION_KEY='street_admin_v03_session';
const baseUrl=()=>location.origin;
const authHeaders=()=>session?{'Authorization':'Bearer '+session.token}:{};
const apiFetch=(url,options={})=>fetch(baseUrl()+url,{...options,signal:options.signal||(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?AbortSignal.timeout(6500):undefined),headers:{...authHeaders(),...(options.headers||{})}});

const F=globalThis.StreetFinance;
const pages={home:'Início',dashboard:'Visão geral',register:'Caixa',sales:'Vendas realizadas',products:'Produtos',customers:'Clientes',expenses:'Financeiro',reports:'Relatórios',backup:'Backup e dados',settings:'Configurações',staff:'Equipe'};
let db,currentPage='home',renderRevision=0,modalType='',editingId='',deleteTarget=null,syncPromise=null,toastTimer;
let productPhotoData='',photoProcessing=false,photoSelectionId=0;

// Studio Signature · logo opcional compartilhada via shopprofile (sem tabelas novas).
let currentShopLogo='',shopLogoDraft=null,shopLogoProcessing=false,shopLogoSelection=0;
const SHOP_BRAND_CACHE='street-admin-last-shop-brand';
const isShopLogo=value=>typeof value==='string'&&value.length<95000&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
function paintShopLogo(logo){
 const source=isShopLogo(logo)?logo:'';
 for(const el of document.querySelectorAll('[data-shop-logo]')){
  let image=el.querySelector('img[data-brand-image]');
  if(source){
   if(!image){image=document.createElement('img');image.dataset.brandImage='true';image.alt='';image.decoding='async';el.appendChild(image);}
   if(image.getAttribute('src')!==source)image.src=source;
  }else if(image){image.remove();}
  el.classList.toggle('has-logo',!!source);
 }

}
function rememberShopLogo(logo){
 if(!session?.shopId)return;
 try{localStorage.setItem(SHOP_BRAND_CACHE,JSON.stringify({shopId:session.shopId,shopName:session.shopName||'',logoData:logo||''}));}
 catch(e){console.warn('Não foi possível guardar a logo para a tela de login.',e);}
}
function applyShopBranding(profile){
 const logo=isShopLogo(profile?.logoData)?profile.logoData:'';
 currentShopLogo=logo;paintShopLogo(logo);rememberShopLogo(logo);
}
function showRememberedShopLogo(){
 let logo='';
 try{const saved=JSON.parse(localStorage.getItem(SHOP_BRAND_CACHE)||'null');if(isShopLogo(saved?.logoData))logo=saved.logoData;}catch{}
 paintShopLogo(logo);
}
function updateShopLogoPreview(note=''){
 const box=document.querySelector('#shop-logo-preview'),status=document.querySelector('#shop-logo-status'),remove=document.querySelector('#shop-logo-remove');
 if(!box)return;
 const logo=shopLogoDraft===null?currentShopLogo:shopLogoDraft;
 box.replaceChildren();
 if(isShopLogo(logo)){
  const image=document.createElement('img');image.src=logo;image.alt='Prévia da logo da sua loja';box.appendChild(image);
 }else{
  const placeholder=document.createElement('span');placeholder.className='shop-logo-empty';
  placeholder.textContent='Sem logo da loja';box.appendChild(placeholder);
 }
 if(remove)remove.disabled=shopLogoProcessing||!isShopLogo(logo);
 if(status)status.textContent=note||(isShopLogo(logo)?'Logo pronta para uso.':'Sem logo da loja. A marca SA permanece fixa.');
 const save=document.querySelector('#shop-logo-save');if(save)save.disabled=shopLogoProcessing;
}
function compressShopLogo(file){
 return new Promise((resolve,reject)=>{
  if(!file)return resolve('');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))return reject(Error('Use uma imagem JPG, PNG ou WebP.'));
  if(file.size>5*1024*1024)return reject(Error('A imagem ultrapassa 5 MB. Escolha um arquivo menor.'));
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{
   URL.revokeObjectURL(url);
   try{
    if(!img.naturalWidth||!img.naturalHeight)throw Error('Não foi possível ler a logo.');
    for(const side of [320,240,180,140]){
     const ratio=Math.min(1,side/Math.max(img.naturalWidth,img.naturalHeight));
     const canvas=document.createElement('canvas');
     canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
     canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
     const context=canvas.getContext('2d');if(!context)throw Error('Canvas indisponível.');
     context.drawImage(img,0,0,canvas.width,canvas.height);
     for(const quality of [.86,.7,.56]){
      // WebP mantém transparência para logos com fundo transparente.
      const data=canvas.toDataURL('image/webp',quality);
      if(isShopLogo(data))return resolve(data);
     }
    }
    throw Error('A logo continua muito grande. Escolha uma imagem mais simples.');
   }catch(error){reject(error);}
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Não foi possível abrir a imagem selecionada.'));};
  img.src=url;
 });
}
async function onShopLogoFileChange(input){
 const file=input.files?.[0];if(!file)return;
 const selection=++shopLogoSelection;shopLogoProcessing=true;
 let status='Preparando imagem…';
 updateShopLogoPreview(status);
 try{
  const logo=await compressShopLogo(file);
  if(selection!==shopLogoSelection||currentPage!=='settings')return;
  shopLogoDraft=logo;status='Logo pronta! Clique em Salvar logo para aplicar.';
 }catch(error){
  if(selection!==shopLogoSelection)return;
  status=error.message||'Não foi possível ler a imagem.';
  toast(status);
 }finally{
  if(selection===shopLogoSelection){shopLogoProcessing=false;input.value='';updateShopLogoPreview(status);}
 }
}
async function submitShopLogo(ev){
 ev.preventDefault();
 if(!isOwner())return toast('Somente o administrador pode alterar a logo da loja.');
 if(shopLogoProcessing)return toast('Finalize a seleção da imagem primeiro.');
 if(shopLogoDraft===null)return toast('Escolha uma logo ou use Remover logo.');
 const form=ev.target,submit=form.querySelector('[type="submit"]');submit.disabled=true;
 try{
  const previous=await getRecord('shopprofile','company');
  const defaults={id:'company',businessName:session.shopName||'Loja',cnpj:'',address:'',city:'',phone:'',email:''};
  const data={...defaults,...(previous||{}),id:'company',logoData:shopLogoDraft};
  const [saved]=await saveBatch([{type:'shopprofile',data}],{refresh:false});
  shopLogoDraft=null;
  applyShopBranding(saved||data);
  updateShopLogoPreview('Logo salva neste aparelho. Ela será enviada na próxima sincronização.');
  toast('Identidade da loja atualizada. Sincronize para compartilhar.');
 }catch(error){
  console.error(error);toast(error.message||'Não foi possível salvar a logo.');
 }finally{submit.disabled=false;}
}

let serverReachable=false,installPrompt=null,staffCache=[],reportKind='sales',reportStart='',reportEnd='',homeSearchValue='',homeCategory='',financeMonth=(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;})(),registerPlan=F.normalizePlan();
const ACCESS={home:'products:read',dashboard:'reports:read',register:'sales:create',sales:'sales:view',products:'products:read',stock:'stock:read',customers:'customers:read',expenses:'expenses:read',reports:'reports:read'};
const EDIT={promotion:'owner:only',shopprofile:'finance:write',financeplan:'finance:write',withdrawal:'finance:write',product:'products:write',stockmove:'stock:write',sale:'sales:create',cashopen:'sales:create',cashclose:'sales:create',customer:'customers:write',expense:'expenses:write'};
const STAFF_PERMISSION_LABELS=[['sales:create','Registrar vendas no caixa'],['sales:view','Consultar vendas realizadas'],['products:read','Consultar produtos e preços'],['products:write','Cadastrar e editar produtos'],['stock:read','Consultar movimentações e estoque'],['stock:write','Registrar entradas e ajustes de estoque'],['customers:read','Consultar clientes'],['customers:write','Cadastrar e editar clientes'],['expenses:read','Consultar despesas'],['expenses:write','Cadastrar e editar despesas'],['reports:read','Consultar visão geral e relatórios (vendas e estoque)']];
function isOwner(){return session?.role==='owner';}
const isLocalWindowsPanel=()=>location.hostname==='127.0.0.1'&&location.protocol==='http:';
let windowsAutostartEnabled=false;
function can(key){return isOwner()||session?.permissions?.[key]===true;}
function canPage(page){if(!session)return false;if(['staff','backup'].includes(page))return isOwner();return !ACCESS[page]||can(ACCESS[page]);}
function defaultPage(){return ['home','dashboard','register','sales','products','customers','expenses','reports','settings'].find(canPage)||'settings';}
async function refreshAccessCache(){
 // Reinicia o histórico de sync quando novas permissões forem liberadas.
 // Limpa do cache local informações antes autorizadas mas agora restritas.
 if(!db)return;
 const all=await request(store('records').getAll());
 const maySee=type=>({sale:can('sales:view')||can('products:read'),stockmove:can('stock:read')||can('products:read'),product:can('products:read'),customer:can('customers:read'),expense:can('expenses:read'),financeplan:isOwner(),withdrawal:isOwner(),promotion:can('products:read')||can('sales:create'),shopprofile:can('sales:view')||can('sales:create'),cashopen:can('sales:view')||can('sales:create'),cashclose:can('sales:view')||can('sales:create')})[type]===true;
 const t=db.transaction('records','readwrite');
 for(const r of all){
  if(r.pending)continue;
  // Vendas/estoque são recarregados com dados reduzidos se houver apenas consulta de produtos.
  if(!maySee(r.type)||(r.type==='sale'&&!can('sales:view'))||(r.type==='stockmove'&&!can('stock:read')))
   t.objectStore('records').delete(r.key);
 }
 await complete(t);await setMeta('cursor',0);
}
function applyAccess(){
 document.querySelectorAll('.nav-item[data-page]').forEach(b=>{b.hidden=!canPage(b.dataset.page);});
 $('#account-label').textContent=(session?.userName||'Usuário')+' · '+(session?.shopName||'Loja');const topAccount=$('#top-account');if(topAccount)topAccount.textContent=(session?.userName||'Usuário')+' · '+(isOwner()?'Administrador':'Funcionário');
 const shopTitle=$('#shop-title');if(shopTitle)shopTitle.textContent=session?.shopName||'Street Admin';
 if(!canPage(currentPage))goto(defaultPage());
}

let checkoutLock=false,cart=new Map(),pos={payment:'Dinheiro',received:'',discount:'0',discountType:'money',promotionId:'',customerId:'',notes:''},registerProducts=[],registerCustomers=[],registerPromotions=[];
const $=s=>document.querySelector(s);
const uid=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const deviceId=localStorage.getItem('street_device_id')||uid();localStorage.setItem('street_device_id',deviceId);
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const brl=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const cents=value=>Math.round((Number(value)||0)*100);
const money=value=>brl(cents(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Foto opcional: miniatura JPEG comprimida, armazenada no próprio registro do produto.
// O IndexedDB e a sincronização/backup existentes preservam o campo sem tabelas novas.
const isProductPhoto=value=>typeof value==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<=180000;
function productThumb(product,cls='product-thumb'){
 const initial=esc((product?.name||'P').trim().charAt(0).toLocaleUpperCase('pt-BR'));
 return `<span class="${cls}">${isProductPhoto(product?.photo)?`<img src="${product.photo}" alt="" loading="lazy" decoding="async">`:initial}</span>`;
}
function productPhotoField(photo){
 return `<div class="product-photo-field">
  <label for="product-photo-input">Foto do produto <span class="muted">(opcional)</span></label>
  <small>Escolha uma imagem, se quiser. Ela será reduzida automaticamente e exibida como miniatura, sem aumentar os cards.</small>
  <div class="product-photo-picker">
   <div id="product-photo-preview" class="product-photo-preview" aria-label="Prévia da imagem"></div>
   <div class="product-photo-buttons">
    <label class="photo-choose" for="product-photo-input">＋ Escolher foto<input id="product-photo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Selecionar foto do produto"></label>
    <button type="button" class="photo-remove" id="product-photo-remove" hidden>Remover foto</button>
   </div>
  </div>
  <span class="product-photo-status" id="product-photo-status" role="status">Você pode deixar sem foto.</span>
 </div>`;
}
function updateProductPhotoPreview(status=''){
 const preview=$('#product-photo-preview'),remove=$('#product-photo-remove'),notice=$('#product-photo-status');
 if(!preview)return;
 preview.innerHTML=isProductPhoto(productPhotoData)?`<img src="${productPhotoData}" alt="Prévia da foto selecionada">`:
  '<div class="product-photo-placeholder"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg><span>Sem foto</span></div>';
 if(remove)remove.hidden=!isProductPhoto(productPhotoData);
 if(notice)notice.textContent=status||(isProductPhoto(productPhotoData)?'Foto pronta. Você pode substituí-la ou remover.':'Você pode deixar sem foto.');
}
function compressProductPhoto(file){
 return new Promise((resolve,reject)=>{
  if(!file)return resolve('');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))return reject(Error('Escolha uma imagem JPG, PNG ou WebP.'));
  if(file.size>8*1024*1024)return reject(Error('A imagem ultrapassa 8 MB. Escolha uma foto menor.'));
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{
   URL.revokeObjectURL(url);
   try{
    if(!img.naturalWidth||!img.naturalHeight)throw Error('Não foi possível ler a imagem.');
    const ratio=Math.min(1,440/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Seu navegador não conseguiu processar a foto.');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let result='';
    for(const quality of [.80,.67,.54,.40]){
     result=canvas.toDataURL('image/jpeg',quality);
     if(result.length<=160000)break;
    }
    if(!isProductPhoto(result))throw Error('A foto continua muito grande. Escolha outra imagem.');
    resolve(result);
   }catch(e){reject(e);}
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Não foi possível abrir a imagem escolhida.'));};
  img.src=url;
 });
}
async function handleProductPhotoChange(input){
 const file=input.files?.[0];if(!file)return;
 const selection=++photoSelectionId;
 photoProcessing=true;const save=$('#form-save');if(save)save.disabled=true;
 const notice=$('#product-photo-status');if(notice)notice.textContent='Preparando miniatura…';
 try{
  const result=await compressProductPhoto(file);
  if(selection!==photoSelectionId||modalType!=='product')return;
  productPhotoData=result;updateProductPhotoPreview('Foto adicionada! Ela será salva junto com o produto.');
 }catch(e){
  if(selection!==photoSelectionId||modalType!=='product')return;
  updateProductPhotoPreview(e.message||'Não foi possível preparar a foto.');
  toast(e.message||'Erro ao ler imagem.');
 }finally{
  if(selection===photoSelectionId){photoProcessing=false;if(save)save.disabled=false;input.value='';}
 }
}

const num=value=>Number(value)||0;
const dateBR=value=>value?new Date(value+'T12:00:00').toLocaleDateString('pt-BR'):'—';
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3800);}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;for(const name of ['records','outbox','meta'])if(!d.objectStoreNames.contains(name)){const s=d.createObjectStore(name,{keyPath:name==='records'?'key':name==='outbox'?'opId':'key'});if(name==='records')s.createIndex('type','type',{unique:false});}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function complete(t){return new Promise((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error||new Error('Erro no banco local'));t.onabort=()=>reject(t.error||new Error('Transação interrompida'));});}
function store(name,mode='readonly'){return db.transaction(name,mode).objectStore(name);}
async function records(){return (await request(store('records').getAll())).filter(r=>!r.deleted);}
async function getRecord(type,id){return request(store('records').get(`${type}:${id}`));}
async function getPending(){return request(store('outbox').getAll());}
async function getMeta(key){return (await request(store('meta').get(key)))?.value;}
async function setMeta(key,value){await request(store('meta','readwrite').put({key,value}));}
function ofType(all,type){return all.filter(x=>x.type===type&&!x.deleted);}
const saleIsCancelled=s=>s?.status==='cancelled';
const onlyActiveSales=sales=>sales.filter(s=>!saleIsCancelled(s));

// Abertura e conferência de caixa: registros da loja sincronizados pelo backend.
// O fundo inicial nunca é contado como faturamento. Todo valor é calculado em centavos.
function cashDayInfo(all,day){
 const opening=ofType(all,'cashopen').find(r=>r.id===day)||null;
 const closing=ofType(all,'cashclose').find(r=>r.id===day)||null;
 const cashSales=onlyActiveSales(ofType(all,'sale')).filter(s=>s.date===day&&s.payment==='Dinheiro'&&!s.syncProblem);
 const saleCents=cashSales.reduce((sum,s)=>sum+cents(s.total),0);
 const openingCents=opening?cents(opening.amount):0;
 const expectedCents=openingCents+saleCents;
 const countedCents=closing?cents(closing.counted):null;
 return {opening,closing,cashSales,saleCents,openingCents,expectedCents,countedCents,
  differenceCents:countedCents===null?null:countedCents-expectedCents};
}
function cashDayPanel(all,day){
 const c=cashDayInfo(all,day),editable=isOwner()&&!c.closing;
 const sumLine=(name,value,cls='')=>`<div class="cash-session-line ${cls}"><span>${name}</span><strong>${brl(value)}</strong></div>`;
 const flagged=[c.opening,c.closing].filter(r=>r?.syncProblem);
 const cashStatus=c.closing?'Fechado':c.opening?`Aberto · ${brl(c.openingCents)} de fundo`:'Ainda não aberto';
 return `<details class="cash-session-drawer" id="cash-session-drawer">
 <summary class="cash-session-summary"><span class="cash-session-summary-icon" aria-hidden="true">▣</span><span class="cash-session-summary-copy"><strong>Abertura e fechamento de caixa</strong><small>Configurar fundo de troco e conferir o dinheiro no fim do dia</small></span><span class="cash-session-status-pill">${cashStatus}</span><span class="cash-session-chevron" aria-hidden="true">⌄</span></summary>
 <section class="panel cash-session" aria-label="Abertura e fechamento do caixa">
  <div class="cash-session-head"><div><span class="eyebrow">CONTROLE DE DINHEIRO</span><h3>Abertura e fundo de troco</h3><p>Dia ${dateBR(day)} · Separado das vendas e do faturamento.</p></div><button class="secondary small" type="button" data-action="refresh-register">↻ Atualizar</button></div>
  ${flagged.length?'<p class="cash-session-warning" role="alert">Há um registro de caixa rejeitado na sincronização. Confira os valores com o administrador.</p>':''}
  ${!c.opening?`<div class="cash-session-open"><div><strong>Caixa ainda não aberto hoje</strong><p>Informe quanto dinheiro ficará na gaveta para dar troco. Se não houver troco inicial, registre R$ 0,00. As vendas existentes continuam disponíveis.</p></div>
   ${can('sales:create')?`<form id="cash-open-form" class="cash-session-form"><label for="cash-opening-amount">Fundo de troco (R$)</label><div class="cash-session-actions"><input id="cash-opening-amount" name="amount" type="number" step="0.01" min="0" max="10000000" value="0.00" inputmode="decimal" required><button class="primary" type="submit">Abrir caixa</button></div><label for="cash-opening-notes">Observação (opcional)</label><input id="cash-opening-notes" name="notes" maxlength="200" placeholder="Ex.: notas e moedas para troco"></form>`:''}
  </div>`:`<div class="cash-session-metrics">
   ${sumLine('Fundo inicial',c.openingCents)}
   ${sumLine('Vendas em dinheiro',c.saleCents)}
   ${sumLine('Dinheiro esperado na gaveta',c.expectedCents,'cash-session-emphasis')}
  </div><div class="cash-session-meta"><span>Aberto por ${esc(c.opening.openedBy||'Usuário da loja')}${c.opening.pending?' · Pendente de sincronização':''}</span>${editable?'<button type="button" class="text-button" data-action="edit-cash-opening">Corrigir fundo inicial</button>':''}</div>
  ${editable?`<form id="cash-edit-form" class="cash-session-form cash-edit-form" hidden><label for="cash-edit-amount">Novo fundo inicial (R$)</label><div class="cash-session-actions"><input id="cash-edit-amount" name="amount" type="number" step="0.01" min="0" max="10000000" required value="${Number(c.opening.amount||0).toFixed(2)}"><button class="secondary" type="submit">Salvar correção</button></div><small>O ajuste ficará registrado no histórico de alterações.</small></form>`:''}
  ${c.closing?`<div class="cash-session-closed"><span class="cash-session-status">Caixa conferido</span>${sumLine('Dinheiro contado',c.countedCents)}${sumLine(c.differenceCents===0?'Diferença (caixa correto)':c.differenceCents>0?'Sobra de caixa':'Falta de caixa',c.differenceCents,'cash-session-difference')}<small>Conferido por ${esc(c.closing.closedBy||'Usuário da loja')}${c.closing.pending?' · Pendente de sincronização':''}. Se houver vendas posteriores ou sincronização pendente, o saldo esperado pode mudar.</small></div>`:
   `${can('sales:create')?`<details class="cash-session-close"><summary>Conferir e fechar caixa do dia</summary><form id="cash-close-form" class="cash-session-form"><p>Conte o dinheiro físico da gaveta e informe abaixo. O sistema calculará a diferença em relação ao fundo inicial e às vendas em dinheiro.</p><label for="cash-counted-amount">Dinheiro contado (R$)</label><div class="cash-session-actions"><input id="cash-counted-amount" name="amount" type="number" step="0.01" min="0" max="10000000" inputmode="decimal" value="${(c.expectedCents/100).toFixed(2)}" required><button class="primary" type="submit">Registrar fechamento</button></div><label for="cash-close-notes">Observação (opcional)</label><input id="cash-close-notes" name="notes" maxlength="200" placeholder="Ex.: conferência após o expediente"><small>Confira as vendas sincronizadas antes de fechar. Este registro não impede novas vendas.</small></form></details>`:''}`}
  `}
  <p class="cash-session-footnote">Valores em dinheiro das vendas válidas, descontado o troco devolvido. Não inclui Pix, cartão, sangrias ou suprimentos extras. O fundo inicial não entra no faturamento.</p>
 </section></details>`;
}
async function submitCashDayForm(event){
 event.preventDefault();
 if(!can('sales:create')||currentPage!=='register')return toast('Sem permissão para controlar o caixa.');
 const form=event.target,kind=form.id;
 if(!['cash-open-form','cash-edit-form','cash-close-form'].includes(kind))return;
 const raw=String(form.elements.namedItem('amount')?.value||'').replace(',','.');
 if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw))return toast('Informe um valor válido, com até duas casas decimais.');
 const amount=Number(raw);if(!Number.isFinite(amount)||amount<0||amount>10000000)return toast('Informe um valor entre R$ 0,00 e R$ 10 milhões.');
 const notes=String(form.elements.namedItem('notes')?.value||'').trim().slice(0,200);
 const today=localDate(),all=await records(),c=cashDayInfo(all,today),now=new Date().toISOString();
 const edit=kind==='cash-edit-form',close=kind==='cash-close-form';
 if(close&&(!c.opening||c.closing))return toast('É necessário abrir o caixa e ele não pode já estar fechado.');
 if(!close&&kind==='cash-open-form'&&c.opening)return toast('O caixa de hoje já está aberto.');
 if(edit&&(!isOwner()||!c.opening||c.closing))return toast('Apenas o administrador pode ajustar um caixa aberto.');
 const button=form.querySelector('[type="submit"]');if(button)button.disabled=true;
 try{
  if(close){
   await saveBatch([{type:'cashclose',data:{id:today,date:today,counted:amount,notes,closedAt:now,closedBy:session.userName||'Usuário',openedId:today}}]);
   toast('Fechamento registrado. Confira a diferença no resumo.');
  }else{
   const old=edit?c.opening:{};
   await saveBatch([{type:'cashopen',data:{...old,id:today,date:today,amount,notes:edit?(old?.notes||''):notes,openedAt:old?.openedAt||now,openedBy:old?.openedBy||session.userName||'Usuário'}}]);
   toast(edit?'Fundo inicial corrigido.':'Abertura de caixa registrada.');
  }
 }catch(error){console.error('Caixa:',error);toast(error.message||'Não foi possível registrar o caixa.');if(button)button.disabled=false;}
}

function inventory(all){
 const result=new Map();
 for(const p of ofType(all,'product'))result.set(p.id,{...p,available:num(p.stock)});
 for(const m of ofType(all,'stockmove'))if(!m.syncProblem&&result.has(m.productId))result.get(m.productId).available+=num(m.quantity);
 for(const sale of ofType(all,'sale'))if(!saleIsCancelled(sale)&&!sale.syncProblem&&Array.isArray(sale.items))for(const item of sale.items)if(result.has(item.productId))result.get(item.productId).available-=num(item.quantity);
 return result;
}
// Intervalos inclusivos (AAAA-MM-DD), sem depender de fuso horário do aparelho.
function inReportRange(date){
 if(!reportStart&&!reportEnd)return true;
 const day=String(date||'').slice(0,10);
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&(!reportStart||day>=reportStart)&&(!reportEnd||day<=reportEnd);
}
function reportData(all){
 const products=ofType(all,'product'),stock=inventory(all),sales=ofType(all,'sale').filter(s=>inReportRange(s.date));
 const moves=ofType(all,'stockmove').filter(m=>inReportRange(m.date));
 const initial=products.filter(p=>num(p.stock)>0).map(p=>({date:p.initialDate||p.createdAt?.slice(0,10)||'',productId:p.id,productName:p.name,quantity:num(p.stock),reason:'Estoque inicial',unitCost:num(p.cost),createdAt:p.createdAt||''})).filter(m=>inReportRange(m.date));
 const entries=[...initial,...moves.filter(m=>num(m.quantity)>0)].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const stockRows=[...stock.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(p=>{
  const arrivals=entries.filter(m=>m.productId===p.id).reduce((a,m)=>a+num(m.quantity),0);
  const adjustments=moves.filter(m=>m.productId===p.id&&num(m.quantity)<0).reduce((a,m)=>a-num(m.quantity),0);
  const sold=onlyActiveSales(sales).reduce((a,s)=>a+(Array.isArray(s.items)?s.items.reduce((t,i)=>t+(i.productId===p.id?num(i.quantity):0),0):0),0);
  return {...p,arrivals,adjustments,sold};
 });
 return {products,sales,entries,stockRows};
}
function reportRangeLabel(){return !reportStart&&!reportEnd?'Todo o histórico':`${reportStart||'Início'} a ${reportEnd||'Hoje'}`;}
function filterHomeProducts(){
 const input=document.querySelector('#home-search'),select=document.querySelector('#home-category');if(!input||!select)return;
 const fold=v=>String(v||'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const q=fold(input.value.trim()),category=select.value;let shown=0;
 document.querySelectorAll('#home-products [data-home-product]').forEach(row=>{
  const match=(!category||row.dataset.category===category)&&(!q||fold(row.dataset.search).includes(q));row.hidden=!match;if(match)shown++;
 });
 const count=document.querySelector('#home-count');if(count)count.textContent=`${shown} produto(s) encontrado(s)`;
 const empty=document.querySelector('#home-empty');if(empty)empty.hidden=shown>0;
}
function transactionItem(type,data,action='upsert',old=null){
 const id=data.id||uid(),now=new Date().toISOString();
 const merged={...(old||{}),...data,id,key:`${type}:${id}`,type,version:old?.version||0,deleted:action==='delete',pending:true,updatedAt:now};
 const op={opId:uid(),entityType:type,entityId:id,action,data:merged,baseVersion:old?.version||0,deviceId,createdAt:now};
 return {record:merged,op};
}
async function saveBatch(entries,{refresh=true}={}){
 // As alterações ficam pendentes localmente até a confirmação do PostgreSQL.
 if(syncPromise)await Promise.race([syncPromise,new Promise(resolve=>setTimeout(resolve,1400))]);
 // Captura os valores antes de abrir a transação, para não deixá-la inativa com um await.
 const prepared=[];
 const queued=await getPending();
 for(const item of entries){
  if(!can(EDIT[item.type]))throw Error('Seu usuário não tem permissão para esta alteração.');
  const old=item.data.id?await getRecord(item.type,item.data.id):null;
  const obj=transactionItem(item.type,item.data,item.action||'upsert',old);
  obj.oldPending=queued.filter(q=>q.entityType===item.type&&q.entityId===obj.record.id);
  // Entidades editáveis agrupam alterações ainda não enviadas.
  if(obj.oldPending.length&&['product','customer','expense','financeplan','cashopen','shopprofile','promotion'].includes(item.type)){
   obj.op.baseVersion=obj.oldPending[0].baseVersion;
  }
  prepared.push(obj);
 }
 const t=db.transaction(['records','outbox'],'readwrite');
 for(const {record,op,oldPending} of prepared){
  for(const previous of oldPending)t.objectStore('outbox').delete(previous.opId);
  t.objectStore('records').put(record);t.objectStore('outbox').put(op);
 }
 await complete(t);
 if(refresh)await renderPage();
 await updateOfflineStatus(serverReachable);
 await syncNow(true);
 const stillQueued=await getPending();
 const outstanding=prepared.filter(x=>stillQueued.some(op=>op.opId===x.op.opId));
 if(outstanding.length){
   const rejected=outstanding.find(x=>stillQueued.some(op=>op.opId===x.op.opId&&op.problem));
   throw Error(rejected?'O servidor recusou a alteração. Revise o registro sinalizado.':'Alteração pendente: o servidor ainda não confirmou o salvamento. Sincronize novamente.');
 }
 return prepared.map(x=>x.record);
}
async function discardRejected(type,id){
 const queued=await getPending();const related=queued.filter(o=>o.entityType===type&&o.entityId===id&&o.problem);
 if(!related.length)throw Error('Somente pendências rejeitadas podem ser descartadas.');
 const t=db.transaction(['records','outbox'],'readwrite');
 related.forEach(x=>t.objectStore('outbox').delete(x.opId));t.objectStore('records').delete(`${type}:${id}`);await complete(t);
 await setMeta('cursor',0);await syncNow(true);await renderPage();toast('Pendência rejeitada descartada deste dispositivo.');
}
async function updateOfflineStatus(connected){
 if(!session||!db)return;
 const pending=await getPending().catch(()=>[]);
 const failed=pending.filter(x=>x.problem).length;
 const waiting=pending.length-failed;
 const reachable=connected&&navigator.onLine!==false;
 const title=$('#offline-title'),message=$('#offline-message'),banner=$('#offline-banner');
 if(!banner)return;
 const display=!reachable||pending.length>0;
 banner.hidden=!display;
 banner.classList.toggle('is-warning',failed>0);
 if(failed){title.textContent=`${failed} alteração(ões) não sincronizada(s)`;message.textContent='Alguns lançamentos foram recusados pelo servidor. Confira os registros com aviso antes de sair da conta.';}
 else if(!reachable){title.textContent='Modo offline · dados no iPhone';message.textContent=`${waiting} alteração(ões) aguardando envio. Sem o PC, estoque e vendas podem estar desatualizados. Verifique a internet para sincronizar com o Street Admin online.`;}
 else if(waiting){title.textContent=`${waiting} alteração(ões) aguardando envio`;message.textContent='Dados salvos neste aparelho. Toque em Sincronizar para enviar ao servidor.';}
 if(!reachable){$('#sync-state').textContent=`● Offline${waiting?' · '+waiting+' pendente(s)':''}`;$('#connection-label').textContent='Dados armazenados neste aparelho';}
}

async function syncNow(silent=false,maxRounds=5){
 if(!session||!db)return;
 if(syncPromise)return syncPromise;
 syncPromise=(async()=>{
  let changed=false,identityChanged=false;
  const remote=baseUrl();
  $('#sync-state').textContent='● Sincronizando';
  try{
   if(!/^https?:\/\//.test(remote))throw Error('Configure o servidor online');
   // Atualiza permissões do servidor antes de enviar novos lançamentos.
   const identityResponse=await apiFetch('/api/auth/me',{cache:'no-store'});
   if(identityResponse.status===401)throw Error('Sessão expirada');
   if(identityResponse.ok){
    const identity=await identityResponse.json();
    if(identity.role!==session.role||identity.shopName!==session.shopName||identity.userName!==session.userName||JSON.stringify(identity.permissions)!==JSON.stringify(session.permissions)){
      session={...session,...identity};identityChanged=true;localStorage.setItem(SESSION_KEY,JSON.stringify(session));await refreshAccessCache();applyAccess();
    }
   }
   const pending=(await getPending()).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
   const toSend=pending.filter(o=>!o.problem).slice(0,100);
   if(toSend.length){
    const response=await apiFetch('/api/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operations:toSend})});
    if(response.status===401)throw Error('Sessão expirada. Entre novamente com sua conta.');if(!response.ok)throw Error('Falha no envio');
    const answer=await response.json();
    for(const item of answer.results||[]){
     const op=toSend.find(o=>o.opId===item.opId);if(!op)continue;
     if(item.status==='accepted'||item.status==='duplicate'){
      const record=await getRecord(op.entityType,op.entityId);
      const t=db.transaction(['outbox','records'],'readwrite');
      t.objectStore('outbox').delete(op.opId);
      if(record?.updatedAt===op.data.updatedAt){record.version=item.version||record.version;record.pending=false;t.objectStore('records').put(record);}
      await complete(t);
     }else{
      op.problem=item.status;tellSyncProblem(op);
      const old=await getRecord(op.entityType,op.entityId);
      const t=db.transaction(['outbox','records'],'readwrite');
      t.objectStore('outbox').put(op);
      if(old){old.syncProblem=item.status;t.objectStore('records').put(old);changed=true;}
      await complete(t);
     }
    }
   }
   let cursor=Number(await getMeta('cursor')||0);
   for(let round=0;round<maxRounds;round++){
    const result=await apiFetch(`/api/sync/pull?since=${cursor}`,{cache:'no-store'});
    if(result.status===401)throw Error('Sessão expirada. Entre novamente com sua conta.');if(!result.ok)throw Error('Falha ao receber');
    const payload=await result.json();
    const stillPending=await getPending();
    for(const op of payload.operations||[]){
     const key=`${op.entityType}:${op.entityId}`;
     if(stillPending.some(q=>q.entityType===op.entityType&&q.entityId===op.entityId))continue;
     const old=await request(store('records').get(key));
     if(old&&num(old.version)>num(op.version))continue;
     if(old&&old.version===op.version&&!old.pending&&old.deleted===(op.action==='delete'))continue;
     const record={...(op.data||{}),id:op.entityId,type:op.entityType,key,version:op.version,deleted:op.action==='delete',pending:false,updatedAt:op.createdAt};
     await request(store('records','readwrite').put(record));changed=true;
    }
    cursor=Number(payload.cursor??cursor);await setMeta('cursor',cursor);
    if(!payload.hasMore)break;
   }
   serverReachable=true;$('#sync-state').textContent='● Sincronizado';$('#connection-label').textContent='Servidor da conta acessível';
   if(!silent)toast('Sincronização concluída.');
   const failures=(await getPending()).filter(o=>o.problem);
   if(failures.length){$('#sync-state').textContent=`● ${failures.length} pendência(s)`;if(!silent)toast('Existem lançamentos rejeitados. Consulte a seção correspondente.');}
   await updateOfflineStatus(true);
   if(changed){const newest=await getRecord('shopprofile','company');if(newest&&!newest.deleted){applyShopBranding(newest);registerPixConfig=newest.pix||null;if(currentPage==='register')refreshPix(totals());}}
   if((changed||identityChanged)&&currentPage!=='register'&&!$('#modal').classList.contains('open')&&document.activeElement?.tagName!=='INPUT'&&document.activeElement?.tagName!=='SELECT')renderPage();
  }catch(e){
   console.warn('Sincronização indisponível:',e);
   serverReachable=false;await updateOfflineStatus(false);
   if(!silent)toast('Sem conexão com o servidor. Seus dados continuam neste aparelho.');
  }
 })();
 try{return await syncPromise;}finally{syncPromise=null;}
}
function tellSyncProblem(op){console.warn('Operação não sincronizada:',op.problem,op.entityType,op.entityId);}
function closeMenu(){$('#sidebar').classList.remove('open');document.body.classList.remove('menu-open');$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').setAttribute('aria-label','Abrir menu');}
function goto(page){
 if(page==='finance')page='expenses'; // compatibilidade com versões anteriores
 if(['stock','install'].includes(page))page='products';
 if(page==='audit')page='settings';
 if(!Object.hasOwn(pages,page)||!canPage(page))return;
 window.StreetUpdate?.navigated();
 currentPage=page;closeMenu();
 document.querySelectorAll('.nav-item').forEach(btn=>{const active=btn.dataset.page===page;btn.classList.toggle('active',active);if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');});
 $('#page-title').textContent=pages[page];document.title=`STREET ADMIN — ${pages[page]}`;
 $('#content').innerHTML='<div class="page-loading">Carregando…</div>';
 renderPage();
}
const stat=(title,value,hint)=>`<article class="stat-card"><span>${title}</span><strong>${value}</strong><small>${hint}</small></article>`;
const intro=(title,subtitle,buttons='')=>`<div class="page-intro"><div><span class="eyebrow">STREET ADMIN</span><h2>${title}</h2><p>${subtitle}</p></div>${buttons?`<div class="intro-actions">${buttons}</div>`:''}</div>`;
const button=(title,action,kind='primary')=>`<button type="button" class="${kind}" data-action="${action}">${title}</button>`;
function empty(title,description,action=null,actionText='Adicionar'){return `<div class="empty-state"><div class="empty-symbol">□</div><strong>${title}</strong><p>${description}</p>${action?button(actionText,action,'secondary'):''}</div>`;}
function list(all,render,type,extraButtons=()=>'',pending=[]){
 const rows=[...all].sort((a,b)=>(b.createdAt||b.updatedAt||'').localeCompare(a.createdAt||a.updatedAt||''));
 return `<div class="record-list">${rows.length?rows.map(x=>{
  const problems=pending.filter(p=>p.entityType===type&&p.entityId===x.id&&p.problem);
  return `<article class="record-row" data-searchable><div class="record-details">${render(x)}${problems.length?`<small class="record-error">Não sincronizado: ${problems[0].problem==='insufficient_stock'?'estoque insuficiente no servidor':problems[0].problem==='forbidden'?'sem permissão para esta alteração':problems[0].problem==='price_conflict'?'preço desatualizado no servidor':'conflito ou dados inválidos'}</small>`:(x.pending?'<small class="record-pending">● Aguardando sincronização</small>':'')}</div><div class="row-actions">${extraButtons(x,problems)}</div></article>`;
 }).join(''):empty('Nenhum registro ainda','Use o botão acima para começar.')}</div>`;
}
function activePromotion(p,day=localDate()){return p&&p.active===true&&p.startDate<=day&&p.endDate>=day;}
function promoStatus(p,day=localDate()){return !p.active?'Pausada':p.endDate<day?'Encerrada':p.startDate>day?'Agendada':'Em vigor';}
function panels(items){return `<div class="stats-grid">${items.map(i=>stat(...i)).join('')}</div>`;}
async function renderPage(){
 const page=currentPage,sequence=++renderRevision;
 const [all,pending]=await Promise.all([records(),getPending()]);
 if(sequence!==renderRevision||page!==currentPage)return;
 const shopProfile=ofType(all,'shopprofile').find(x=>x.id==='company');
 registerPixConfig=shopProfile?.pix||null;
 if(shopProfile)applyShopBranding(shopProfile);
 const products=ofType(all,'product'),allSales=ofType(all,'sale'),sales=onlyActiveSales(allSales),expenses=ofType(all,'expense'),customers=ofType(all,'customer'),moves=ofType(all,'stockmove');
 const stock=inventory(all),month=localDate().slice(0,7),today=localDate();
 const thisMonth=(rows)=>rows.filter(x=>(x.date||'').startsWith(month));
 let html='';
 if(page==='home'){
  const categories=[...new Set(products.map(p=>String(p.category||'Sem categoria')))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const rows=[...stock.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR'));
  const promotions=ofType(all,'promotion').sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||''));
  const visiblePromotions=promotions.filter(p=>isOwner()||activePromotion(p));
  const homeActions=[
    can('sales:create')?button('▣ Fazer venda','open-register','secondary'):'',
    can('products:write')?button('＋ Adicionar produto','add-product','secondary'):'',
    canPage('products')?button('▦ Produtos e estoque','go-products','secondary'):'',
    can('expenses:write')?button('− Nova despesa','add-expense','secondary'):''
  ].filter(Boolean).join('');
  html=`<div class="home-heading"><div><span class="eyebrow">CENTRAL DA LOJA</span><h2>Início</h2><p>Suas ações principais e os produtos da loja, em um só lugar.</p></div><span class="home-shop home-shop-branded"><span class="home-shop-logo shop-logo-slot" data-shop-logo aria-hidden="true"><span class="logo-fallback" aria-hidden="true">▣</span></span>${esc(session.shopName||'Sua loja')}</span></div>
   <section class="violet-welcome"><div class="violet-welcome-content"><span class="violet-welcome-kicker">LH STREET / INÍCIO</span><h3>Tudo que importa para a sua operação.</h3><p>Consulte seus produtos, acompanhe movimentações e acesse as ferramentas da loja sem perder tempo.</p></div><div class="violet-welcome-art" aria-hidden="true"><span class="violet-welcome-star">LH</span></div></section>
   ${homeActions?`<section class="quick-section home-actions" aria-label="Ações rápidas"><div><span class="eyebrow">ACESSO RÁPIDO</span><h3>O que deseja fazer?</h3></div><div class="quick-buttons">${homeActions}</div></section>`:''}
   ${isOwner()||visiblePromotions.length?`<details class="panel promo-disclosure"><summary>Promoções <span class="promo-summary-count">${promotions.filter(p=>activePromotion(p)).length} ativa(s)</span></summary><div class="promo-panel-body"><div class="promo-panel-header"><p>Campanhas especiais, como Black Friday. O desconto só será aplicado quando selecionado no Caixa.</p>${isOwner()?button('＋ Nova promoção','new-promotion','secondary'):''}</div><div class="promo-list">${visiblePromotions.map(p=>`<div class="promo-row"><div><strong>${esc(p.name)}</strong><small>${num(p.percent)}% de desconto · ${dateBR(p.startDate)} até ${dateBR(p.endDate)} · ${promoStatus(p)}</small></div>${isOwner()?`<div class="promo-actions"><button type="button" data-promo-edit="${esc(p.id)}" class="secondary">Editar</button><button type="button" data-delete="promotion" data-id="${esc(p.id)}" class="danger-soft">Excluir</button></div>`:''}</div>`).join('')||'<p class="muted">Nenhuma promoção cadastrada.</p>'}</div></div></details>`:''}
   <section class="panel home-filters"><label class="home-search-label" for="home-search">Pesquisar produto<input id="home-search" class="home-search" type="search" autocomplete="off" placeholder="Nome, código, tamanho ou cor..." value="${esc(homeSearchValue)}"></label><label for="home-category">Categoria<select id="home-category"><option value="">Todas as categorias</option>${categories.map(c=>`<option value="${esc(c)}" ${c===homeCategory?'selected':''}>${esc(c)}</option>`).join('')}</select></label><small id="home-count" class="home-count">${rows.length} produto(s)</small></section>
   <div class="home-list-head"><h3>Produtos da loja</h3></div>
   <div id="home-products" class="home-product-grid">${rows.map(p=>`<article class="home-product" data-home-product data-category="${esc(p.category||'Sem categoria')}" data-search="${esc([p.name,p.category,p.size,p.color,p.sku,p.code,p.barcode].filter(Boolean).join(' '))}"><div class="home-product-title">${productThumb(p,'home-product-mark')}<div><strong>${esc(p.name)}</strong><small>${esc([p.category||'Sem categoria',p.size&&'Tam. '+p.size,p.color].filter(Boolean).join(' · '))}</small></div></div><div class="home-product-info"><span class="home-stock ${p.available<=0?'is-out':p.available<=3?'is-low':''}">${p.available<=0?'Esgotado':p.available<=3?'Estoque baixo':'Em estoque'} <b>${p.available} un.</b></span><strong>${money(p.price)}</strong></div></article>`).join('')}</div>
   <div id="home-empty" class="panel home-empty" hidden>Nenhum produto encontrado. Tente outro nome ou categoria.</div>
   ${!rows.length?`<div class="notice">Ainda não há produtos cadastrados. ${can('products:write')?'Use o botão Novo produto para começar.':'Peça ao administrador para cadastrar produtos.'}</div>`:''}`;
 }
 if(page==='dashboard'){
  const monthSales=thisMonth(sales),monthExpenses=thisMonth(expenses);
  const total=monthSales.reduce((a,s)=>a+cents(s.total),0),spending=monthExpenses.reduce((a,e)=>a+cents(e.amount),0);
  const onHand=[...stock.values()].reduce((a,p)=>a+p.available,0),low=[...stock.values()].filter(p=>p.available<=3),avg=monthSales.length?Math.round(total/monthSales.length):0;
  const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-6+i);const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return{label:d.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''),value:sales.filter(x=>x.date===iso).reduce((a,s)=>a+cents(s.total),0)};});
  const maxDay=Math.max(1,...days.map(d=>d.value));
  const events=[...allSales.map(s=>({...s,kind:saleIsCancelled(s)?'Venda cancelada':'Venda',amount:saleIsCancelled(s)?0:s.total})),...expenses.map(e=>({...e,kind:'Despesa',amount:e.amount}))].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,6);
  html=`<div class="dashboard-welcome"><div><span class="eyebrow">PAINEL DE CONTROLE</span><h2>${esc(session.shopName||'Sua loja')}</h2><p>Seu painel de vendas, produtos e resultados em um só lugar.</p></div><span class="date-chip">${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</span></div>
   <section class="violet-welcome"><div class="violet-welcome-content"><span class="violet-welcome-kicker">LH STREET / RESULTADOS</span><h3>Resultados da sua loja, sem ruído.</h3><p>Vendas e indicadores calculados a partir dos registros sincronizados da loja.</p></div><div class="violet-welcome-art" aria-hidden="true"><span class="violet-welcome-star">LH</span></div></section>
   ${panels([['Vendas neste mês',brl(total),`${monthSales.length} venda(s) realizada(s)`],['Despesas neste mês',brl(spending),`${monthExpenses.length} lançamento(s)`],['Produtos cadastrados',products.length,`${onHand} unidade(s) disponíveis`],['Clientes',customers.length,'Contatos cadastrados']])}
   <div class="dashboard-grid">
     <section class="panel chart-panel"><div class="section-heading"><div><span class="eyebrow">DESEMPENHO</span><h3>Vendas nos últimos 7 dias</h3></div><span class="muted">${brl(days.reduce((a,d)=>a+d.value,0))} na semana</span></div><div class="chart-bars">${days.map(d=>`<div class="chart-column"><div class="chart-rail"><div class="chart-bar" style="height:${d.value?Math.max(4,Math.round(d.value/maxDay*100)):2}%" title="${brl(d.value)}"></div></div><b>${d.label}</b><small class="chart-value-long">${d.value?brl(d.value):'—'}</small><small class="chart-value-mobile" aria-hidden="true">${d.value?'R$ '+new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(d.value/100):'—'}</small></div>`).join('')}</div></section>
     <section class="panel finance-panel"><div class="section-heading"><div><span class="eyebrow">FINANCEIRO</span><h3>Resumo do mês</h3></div></div><span class="muted">Vendas menos despesas registradas</span><strong class="balance-value">${brl(total-spending)}</strong><div class="finance-row"><span>Vendas</span><b>${brl(total)}</b></div><div class="meter"><i style="width:${total+spending?total/(total+spending)*100:0}%"></i></div><div class="finance-row"><span>Despesas</span><b>${brl(spending)}</b></div><div class="meter secondary-meter"><i style="width:${total+spending?spending/(total+spending)*100:0}%"></i></div><div class="average-box"><span>Ticket médio</span><b>${brl(avg)}</b></div><p class="fine-print">Indicador simplificado, não é lucro contábil.</p></section>
   </div>
   <div class="dashboard-grid">
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">MOVIMENTAÇÕES</span><h3>Atividades recentes</h3></div><button class="text-button" data-page="sales">Ver vendas →</button></div><div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Data</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>${events.length?events.map(e=>`<tr><td>${esc(e.description||e.customer||e.kind)}</td><td>${dateBR(e.date)}</td><td>${esc(e.kind)}</td><td>${money(e.amount)}</td></tr>`).join(''):'<tr><td colspan="4" class="table-empty">Sem movimentações por enquanto.</td></tr>'}</tbody></table></div></section>
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">ATENÇÃO</span><h3>Estoque baixo</h3></div><button class="text-button" data-page="products">Ver produtos →</button></div>${low.length?`<div class="low-stock-list">${low.slice(0,5).map(p=>`<div class="low-stock-row"><span><strong>${esc(p.name)}</strong><small>${esc(p.category||'Sem categoria')}</small></span><b>${p.available} un.</b></div>`).join('')}</div>`:empty('Estoque sem alertas','Produtos com 3 unidades ou menos aparecerão aqui.')}</section>
   </div>
   <div class="notice">Os dados são salvos neste aparelho e sincronizados com o servidor da loja quando houver conexão. Faça backups regularmente.</div>`;
 }
 if(page==='products'){
  const low=[...stock.values()].filter(p=>p.available<=3).length,units=[...stock.values()].reduce((a,p)=>a+p.available,0),value=[...stock.values()].reduce((a,p)=>a+cents(p.cost)*p.available,0);
  html=intro('Produtos e estoque','Cadastre produtos, informe o estoque inicial e faça reposições diretamente aqui.',(can('products:write')?button('＋ Novo produto','add-product'):'')+(can('stock:write')?button('⇧ Entrada','add-stock','secondary'):''))+
   panels([['Produtos',products.length,'Itens cadastrados'],['Unidades disponíveis',units,'Saldo calculado'],['Estoque baixo',low,'Até 3 unidades'],['Valor em custo',brl(value),'Custo cadastrado × saldo']])+
   `<div class="list-toolbar"><input id="list-search" placeholder="Buscar produto, categoria, tamanho..." aria-label="Buscar produtos"><span>${products.length} produto(s)</span></div>`+
   list(products,p=>`<div class="product-row-heading">${productThumb(p)}<span><strong>${esc(p.name)}</strong><small>${esc([p.category,p.size&&'Tam. '+p.size,p.color].filter(Boolean).join(' · ')||'Sem categoria')}</small></span></div><div class="record-metrics"><span>Estoque: <b>${stock.get(p.id)?.available??0}</b></span><span>Venda: <b>${money(p.price)}</b></span><span>Custo: <b>${money(p.cost)}</b></span></div>`,'product',p=>`${can('stock:write')?`<button data-entry="${esc(p.id)}" class="row-primary">Entrada</button>`:''}${can('products:write')?`<button data-edit="product" data-id="${esc(p.id)}">Editar</button>`:''}${pending.some(o=>o.entityType==='product'&&o.entityId===p.id&&o.problem)?`<button data-discard="product" data-id="${esc(p.id)}">Descartar rejeitado</button>`:can('products:write')?`<button data-delete="product" data-id="${esc(p.id)}">Excluir</button>`:''}`,pending);
 }
 if(page==='register'){
  registerPlan=F.normalizePlan(ofType(all,'financeplan').find(x=>x.month===month)||{});
  registerProducts=[...stock.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||''));registerCustomers=customers;registerPromotions=ofType(all,'promotion').filter(p=>activePromotion(p));if(!registerPromotions.some(p=>p.id===pos.promotionId))pos.promotionId='';
  const cashToday=sales.filter(s=>s.date===today&&s.payment==='Dinheiro');
  html=intro('Caixa de vendas','Selecione os produtos, informe a forma de pagamento e finalize. Para dinheiro, o troco é calculado automaticamente.',button('Ver histórico','go-sales','secondary'))+
   `<div class="register-grid"><section class="panel register-catalog"><div class="section-heading"><div><span class="eyebrow">CATÁLOGO</span><h3>Escolher produtos</h3></div><span class="muted">${products.length} produtos</span></div><input id="catalog-search" class="search-field" placeholder="Buscar produto, categoria ou tamanho..." aria-label="Buscar produto no caixa"><div id="catalog-items" class="catalog-list">${catalogHtml(registerProducts)}</div></section>
     <section class="panel register-checkout"><div class="section-heading"><div><span class="eyebrow">VENDA ATUAL</span><h3>Carrinho</h3></div><button class="text-button" type="button" data-action="clear-cart">Limpar</button></div><div id="cart-items" class="cart-items"></div><div class="checkout-fields">${registerPromotions.length?`<div class="form-field promo-checkout-field"><label for="cash-promotion">Promoção (opcional)</label><select id="cash-promotion"><option value="">Sem promoção — desconto manual</option>${registerPromotions.map(p=>`<option value="${esc(p.id)}" ${pos.promotionId===p.id?'selected':''}>${esc(p.name)} · ${num(p.percent)}%</option>`).join('')}</select><small class="form-hint">Escolha para preencher o desconto em porcentagem. A estimativa de margem aparece abaixo do total.</small></div>`:''}<div class="form-field"><label for="cash-customer">Cliente (opcional)</label><select id="cash-customer"><option value="">Consumidor final</option>${customers.map(c=>`<option value="${esc(c.id)}" ${pos.customerId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field-pair"><div class="form-field"><label for="cash-payment">Pagamento</label><select id="cash-payment">${['Dinheiro','Pix','Cartão de débito','Cartão de crédito','Outro'].map(x=>`<option ${pos.payment===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-field"><label for="cash-discount">Desconto</label><div class="discount-entry"><select id="cash-discount-type" aria-label="Tipo do desconto"><option value="money" ${pos.discountType==='money'?'selected':''}>R$</option><option value="percent" ${pos.discountType==='percent'?'selected':''}>%</option></select><input id="cash-discount" aria-label="Valor do desconto" type="number" inputmode="decimal" min="0" max="${pos.discountType==='percent'?'100':'10000000'}" step="0.01" value="${esc(pos.discount)}"></div><small class="form-hint">Escolha valor em reais ou porcentagem. O caixa calcula o desconto em R$.</small></div></div><div id="received-field" class="form-field"><label for="cash-received">Dinheiro recebido (R$)</label><input id="cash-received" type="number" min="0" step="0.01" placeholder="0,00" value="${esc(pos.received)}"></div><div class="form-field"><label for="cash-notes">Observação (opcional)</label><input id="cash-notes" maxlength="200" placeholder="Ex.: pedido para retirada" value="${esc(pos.notes)}"></div></div><div id="cash-summary"></div><section id="pix-checkout" class="pix-checkout" hidden aria-label="Pagamento por Pix"></section><div id="discount-risk" class="discount-risk" role="status" aria-live="polite"></div><button id="finish-sale" class="primary finish-sale" data-action="finish-sale">Finalizar venda</button><p class="fine-print">Vendas concluídas são lançadas no histórico e dão baixa nas quantidades do carrinho.</p></section></div>
   <div class="panel daily-cash"><div><span class="eyebrow">HOJE</span><h3>Dinheiro recebido em vendas</h3><p>O fundo de troco e a conferência do caixa ficam na seção recolhida abaixo das vendas.</p></div><strong>${money(cashToday.reduce((a,s)=>a+num(s.total),0))}</strong></div>`+cashDayPanel(all,today);
 }
 if(page==='sales'){
  const monthly=thisMonth(sales),revenue=monthly.reduce((a,s)=>a+cents(s.total),0),cashSales=monthly.filter(s=>s.payment==='Dinheiro');
  const cancelledMonth=thisMonth(allSales).filter(saleIsCancelled);
  html=intro('Vendas realizadas','Vendas canceladas permanecem no histórico, mas não entram no faturamento. O cancelamento devolve as unidades ao estoque do sistema.',button('▣ Ir ao caixa','open-register'))+
   panels([['Vendas válidas no mês',monthly.length,'Sem cancelamentos'],['Faturamento do mês',brl(revenue),'Só vendas válidas'],['Vendas canceladas',cancelledMonth.length,'No mês, sem impacto no total'],['Ticket médio',brl(monthly.length?Math.round(revenue/monthly.length):0),'Vendas válidas']])+
   `<div class="list-toolbar"><input id="list-search" placeholder="Buscar venda, cliente, vendedor ou cancelamento..." aria-label="Buscar vendas"><span>${allSales.length} registro(s)</span></div>`+
   list(allSales,s=>`<strong>${esc(s.description||'Venda no caixa')}</strong>${saleIsCancelled(s)?'<span class="sale-cancelled-label">VENDA CANCELADA · fora do faturamento</span>':''}<small>${dateBR(s.date)} · ${esc(s.payment||'Forma não informada')} · ${esc(s.customer||'Consumidor final')} · Vendido por: ${esc(s.soldByName||'Não identificado (venda antiga)')}${s.promotionName?' · Promoção: '+esc(s.promotionName):''}</small><div class="record-metrics"><span>${saleIsCancelled(s)?'Valor original (cancelado)':'Total'}: <b class="${saleIsCancelled(s)?'cancelled-value':''}">${money(s.total)}</b></span>${s.payment==='Dinheiro'&&!saleIsCancelled(s)?`<span>Recebido: ${money(s.received)}</span><span>Troco: ${money(s.change)}</span>`:''}${Array.isArray(s.items)?`<span>${s.items.reduce((n,i)=>n+num(i.quantity),0)} item(ns)</span>`:'<span>Registro antigo sem itens</span>'}</div>${saleIsCancelled(s)?`<small class="sale-cancel-reason">Cancelada em ${esc(new Date(s.cancelledAt||s.createdAt).toLocaleString('pt-BR'))} por ${esc(s.cancelledByName||'Administrador')} · Motivo: ${esc(s.cancelReason||'Não informado')}</small>`:''}`,'sale',(s,problems)=>problems.length?`<button class="danger-soft" data-discard="sale" data-id="${esc(s.id)}">Descartar rejeitada</button>`:`<button data-receipt="${esc(s.id)}">${saleIsCancelled(s)?'Ver comprovante cancelado':'Comprovante detalhado'}</button>${isOwner()&&!saleIsCancelled(s)&&!s.pending?`<button type="button" class="danger-soft" data-cancel-sale="${esc(s.id)}">Cancelar venda</button>`:''}`,pending);
 }
 if(page==='reports'){
  const {sales:selectedSales,entries,stockRows:levels}=reportData(all);
  const range=reportRangeLabel();
  const switcher=`<section class="report-toolbar" aria-label="Filtros do relatório"><div class="report-type"><span class="report-form-label">Tipo de relatório</span><div class="report-tabs" role="group" aria-label="Tipo de relatório"><button type="button" data-report-kind="sales" class="${reportKind==='sales'?'active':''}">Vendas</button><button type="button" data-report-kind="stock" class="${reportKind==='stock'?'active':''}">Estoque</button><button type="button" data-report-kind="entries" class="${reportKind==='entries'?'active':''}">Entradas</button></div></div>
   <div class="report-dates"><label for="report-start">De<input type="date" id="report-start" value="${esc(reportStart)}"></label><label for="report-end">Até<input type="date" id="report-end" value="${esc(reportEnd)}"></label></div>
   <div class="report-extra"><label for="report-month">Ou selecione um mês<input type="month" id="report-month" aria-label="Selecionar mês do relatório"></label><button class="secondary" type="button" data-action="report-apply-month">Aplicar mês</button><button class="secondary" type="button" data-action="report-clear">Todo o período</button></div>
   <div class="report-bottom"><span class="report-selected">Período: <b>${esc(range)}</b></span>${button('↓ Exportar CSV','export-report','secondary')}</div></section>`;
  html=intro('Relatórios','Escolha o tipo e as datas para consultar e exportar os registros da loja.')+switcher;
  if(reportKind==='sales'){
   const validSales=onlyActiveSales(selectedSales),cancelledSales=selectedSales.filter(saleIsCancelled);
   const total=validSales.reduce((a,x)=>a+cents(x.total),0);
   html+=panels([['Vendas válidas',validSales.length,'No período selecionado'],['Faturamento',brl(total),'Cancelamentos excluídos'],['Vendas canceladas',cancelledSales.length,'Preservadas para auditoria'],['Ticket médio',brl(validSales.length?Math.round(total/validSales.length):0),'Por venda válida']]);
   const openedDays=ofType(all,'cashopen').filter(c=>inReportRange(c.date)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
   if(openedDays.length){
    html+=`<section class="panel cash-report"><div class="section-heading"><div><span class="eyebrow">DINHEIRO EM CAIXA</span><h3>Aberturas e fechamentos</h3></div></div><p class="fine-print">O fundo inicial não é venda. Os valores esperados consideram as vendas em dinheiro válidas disponíveis neste dispositivo; dados pendentes podem alterar o resultado.</p><div class="table-wrap"><table><thead><tr><th>Dia</th><th>Fundo inicial</th><th>Vendas em dinheiro</th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead><tbody>${openedDays.map(day=>{const c=cashDayInfo(all,day.date);return `<tr><td>${dateBR(day.date)}</td><td>${brl(c.openingCents)}</td><td>${brl(c.saleCents)}</td><td><strong>${brl(c.expectedCents)}</strong></td><td>${c.closing?brl(c.countedCents):'Em aberto'}</td><td>${c.closing?brl(c.differenceCents):'—'}${c.opening?.pending||c.closing?.pending?' <small>· aguardando sincronização</small>':''}</td></tr>`;}).join('')}</tbody></table></div></section>`;
   }

   html+=`<section class="panel"><div class="section-heading"><h3>Vendas por usuário</h3></div><div class="table-wrap"><table><thead><tr><th>Funcionário</th><th>Vendas</th><th>Total</th></tr></thead><tbody>${Array.from(validSales.reduce((m,s)=>{const key=s.soldByName||'Venda antiga (sem identificação)';const item=m.get(key)||{count:0,total:0};item.count++;item.total+=cents(s.total);m.set(key,item);return m;},new Map())).map(([name,data])=>`<tr><td>${esc(name)}</td><td>${data.count}</td><td>${brl(data.total)}</td></tr>`).join('')||'<tr><td colspan="3">Sem vendas no período.</td></tr>'}</tbody></table></div></section>`;
   html+=`<section class="panel"><div class="section-heading"><h3>Detalhamento das vendas</h3></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Responsável</th><th>Itens</th><th>Pagamento</th><th>Desconto</th><th>Valor original</th><th>Status / motivo</th></tr></thead><tbody>${selectedSales.map(s=>`<tr><td>${dateBR(s.date)}</td><td>${esc(s.soldByName||'Não identificado')}</td><td>${esc(s.description||'Venda')}</td><td>${esc(s.payment||'—')}</td><td>${money(s.discount)}</td><td>${money(s.total)}</td><td>${saleIsCancelled(s)?`<b class="cancelled-report">Cancelada</b><small>${esc(s.cancelReason||'Sem motivo')} · por ${esc(s.cancelledByName||'Administrador')} em ${esc(s.cancelledAt?new Date(s.cancelledAt).toLocaleString('pt-BR'):'data não informada')}</small>`:'Concluída'}</td></tr>`).join('')||'<tr><td colspan="7">Nenhuma venda no período.</td></tr>'}</tbody></table></div></section>`;
  }else if(reportKind==='stock'){
   const inQty=levels.reduce((a,p)=>a+p.arrivals,0),outQty=levels.reduce((a,p)=>a+p.sold,0),adjustQty=levels.reduce((a,p)=>a+p.adjustments,0);
   html+=panels([['Entradas',inQty,'Unidades no período'],['Vendidas',outQty,'Unidades no período'],['Saídas/ajustes',adjustQty,'Unidades no período'],['Saldo atual',levels.reduce((a,p)=>a+p.available,0),'Não é saldo histórico']]);
   html+=`<section class="panel"><h3>Movimentação de estoque</h3><p class="fine-print">Entradas, vendas e ajustes consideram as datas selecionadas. O saldo disponível é o <b>atual</b>, não o saldo que existia naquela data. Operações offline ainda não sincronizadas podem alterar o resultado.</p><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Entradas</th><th>Vendidas</th><th>Saídas/ajustes</th><th>Saldo atual</th></tr></thead><tbody>${levels.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category||'—')}</td><td>+${p.arrivals}</td><td>${p.sold}</td><td>${p.adjustments}</td><td><b>${p.available}</b></td></tr>`).join('')||'<tr><td colspan="6">Nenhum produto cadastrado.</td></tr>'}</tbody></table></div></section>`;
  }else{
   html+=panels([['Entradas registradas',entries.length,'Inclui estoque inicial'],['Unidades recebidas',entries.reduce((a,x)=>a+num(x.quantity),0),'No período'],['Itens diferentes',new Set(entries.map(x=>x.productId)).size,'Produtos movimentados']]);
   html+=`<section class="panel"><h3>Histórico de entradas</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Produto</th><th>Quantidade</th><th>Motivo</th><th>Custo por unidade</th></tr></thead><tbody>${entries.map(m=>`<tr><td>${dateBR(m.date)}</td><td>${esc(products.find(p=>p.id===m.productId)?.name||m.productName||'Produto removido')}</td><td>+${num(m.quantity)}</td><td>${esc(m.reason||'Reposição')}</td><td>${money(m.unitCost)}</td></tr>`).join('')||'<tr><td colspan="5">Nenhuma entrada registrada.</td></tr>'}</tbody></table></div></section>`;
  }
  if(pending.length)html+='<div class="notice">Há alterações locais pendentes. Os relatórios poderão mudar após a sincronização.</div>';
 }
 if(page==='customers'){
  html=intro('Clientes','Mantenha os contatos organizados para associá-los às vendas.',can('customers:write')?button('＋ Novo cliente','add-customer'):'')+panels([['Clientes cadastrados',customers.length,'Contatos disponíveis']])+
   `<div class="list-toolbar"><input id="list-search" placeholder="Buscar cliente ou telefone..." aria-label="Buscar clientes"><span>${customers.length} contato(s)</span></div>`+
   list(customers,c=>`<strong>${esc(c.name)}</strong><small>${esc(c.phone||'Sem telefone')}${c.email?' · '+esc(c.email):''}</small>`,'customer',c=>`${can('customers:write')?`<button data-edit="customer" data-id="${esc(c.id)}">Editar</button>`:''}${pending.some(o=>o.entityType==='customer'&&o.entityId===c.id&&o.problem)?`<button data-discard="customer" data-id="${esc(c.id)}">Descartar rejeitado</button>`:can('customers:write')?`<button data-delete="customer" data-id="${esc(c.id)}">Excluir</button>`:''}`,pending);
 }
 if(page==='expenses'&&!isOwner()){
  const monthly=thisMonth(expenses),sum=monthly.reduce((a,e)=>a+cents(e.amount),0);
  html=intro('Despesas','Registre pagamentos, contas e gastos da loja.',can('expenses:write')?button('＋ Nova despesa','add-expense'):'')+
   panels([['Despesas do mês',brl(sum),`${monthly.length} lançamento(s)`],['Despesas registradas',expenses.length,'No histórico'],['Total do histórico',brl(expenses.reduce((a,e)=>a+cents(e.amount),0)),'Soma das despesas']])+
   `<div class="list-toolbar"><input id="list-search" placeholder="Buscar despesa ou categoria..." aria-label="Buscar despesas"><span>${expenses.length} despesa(s)</span></div>`+
   list(expenses,e=>`<strong>${esc(e.description)}</strong><small>${dateBR(e.date)} · ${esc(e.category||'Geral')}</small><div class="record-metrics"><span>Valor: <b>${money(e.amount)}</b></span></div>`,'expense',e=>`${can('expenses:write')?`<button data-edit="expense" data-id="${esc(e.id)}">Editar</button>`:''}${pending.some(o=>o.entityType==='expense'&&o.entityId===e.id&&o.problem)?`<button data-discard="expense" data-id="${esc(e.id)}">Descartar rejeitado</button>`:can('expenses:write')?`<button data-delete="expense" data-id="${esc(e.id)}">Excluir</button>`:''}`,pending);
 }
 if(page==='expenses'&&isOwner()){
  const chosen=financeMonth;
  const selected=ofType(all,'financeplan').find(x=>x.month===chosen);
  const plan=F.normalizePlan(selected||{});
  const monthlySales=sales.filter(x=>(x.date||'').slice(0,7)===chosen);
  const monthlyExpenses=expenses.filter(x=>(x.date||'').slice(0,7)===chosen);
  const monthWithdrawals=ofType(all,'withdrawal').filter(x=>(x.date||'').slice(0,7)===chosen);
  const f=F.monthly({sales:monthlySales,expenses:monthlyExpenses,withdrawals:monthWithdrawals,products,plan});
  const financeInput=(name,label,value,step='0.01')=>`<div class="form-field"><label for="finance-${name}">${label}</label><input id="finance-${name}" name="${name}" inputmode="decimal" type="number" min="0" max="${name.endsWith('Percent')?'100':'1000000000'}" step="${step}" value="${esc(value)}" required></div>`;
  const request=cents(plan.desiredSalary),remaining=f.profit-f.spent-request;
  const hasPendingFinancials=pending.some(x=>['sale','expense','product','financeplan','withdrawal'].includes(x.entityType));
  let salaryMessage='',salaryClass='risk-warning';
  if(f.missingCost){salaryMessage='Não é seguro avaliar a retirada: complete os custos dos produtos vendidos.';salaryClass='risk-danger';}
  else if(hasPendingFinancials){salaryMessage='Há alterações financeiras não sincronizadas. Confirme os dados antes de retirar.';salaryClass='risk-warning';}
  else if(request<=0){salaryMessage='Informe o valor que quer retirar e salve para consultar o limite.';}
  else if(request>f.canWithdraw){salaryMessage=`Retirada não recomendada. ${brl(request)} supera o limite estimado de ${brl(f.canWithdraw)}.`;salaryClass='risk-danger';}
  else{salaryMessage=`Retirada dentro do limite estimado. Confira também o dinheiro disponível e as contas futuras.`;salaryClass='risk-ok';}
  html=intro('Financeiro','Despesas, impostos e retirada de salário em uma tela simples.')+
   `<div class="panel finance-month-panel"><label for="finance-month">Mês</label><input id="finance-month" type="month" value="${esc(chosen)}"></div>`+
   panels([['Vendas',brl(f.revenue),'No mês'],['Despesas',brl(f.operating),'Registradas'],['Lucro estimado',brl(f.profit),'Após custos e impostos informados']])+
   `<div class="settings-grid finance-simple-grid"><section class="panel"><div class="section-heading"><div><span class="eyebrow">PLANEJAMENTO</span><h3>Impostos e salário</h3></div></div>
     <form id="finance-config"><div class="finance-config-grid">
       ${financeInput('taxPercent','Imposto sobre vendas (%)',plan.taxPercent,'0.1')}
       ${financeInput('reserve','Reserva da loja (R$)',plan.reserve)}
       ${financeInput('desiredSalary','Quanto quero retirar (R$)',plan.desiredSalary)}
     </div>
     <div class="finance-config-grid finance-secondary-fields">
       ${financeInput('feePercent','Taxas de venda / cartão (%)',plan.feePercent,'0.1')}
       ${financeInput('takePercent','Limite do lucro para salário (%)',plan.takePercent,'1')}
     </div><p class="fine-print">Taxas e limites usados no cálculo e nos descontos.</p>
     <button type="submit" class="primary">Salvar e calcular</button></form>
     <p class="fine-print">É uma simulação de retirada, não movimenta dinheiro.</p></section>
     <section class="panel"><div class="section-heading"><div><span class="eyebrow">SALÁRIO</span><h3>Posso retirar?</h3></div></div>
       <div class="finance-salary-values"><div><span>Limite estimado</span><strong>${brl(f.canWithdraw)}</strong></div><div><span>Retirada desejada</span><strong>${brl(request)}</strong></div></div>
       <div class="discount-risk ${salaryClass}" role="status">${salaryMessage}</div>
       <div class="finance-breakdown-inline">
       <div class="finance-breakdown"><div><span>Restaria para a loja</span><b>${brl(remaining)}</b></div><div><span>Custos dos produtos</span><b>${brl(f.cost)}</b></div><div><span>Taxas e impostos</span><b>${brl(f.fees)}</b></div><div><span>Reserva</span><b>${brl(f.reserve)}</b></div><div><span>Já retirado no mês</span><b>${brl(f.spent)}</b></div></div></div>
       <p class="fine-print">Estimativa, não saldo do banco. Verifique contas futuras e recebimentos.</p>
       ${button('＋ Registrar retirada','add-withdrawal')}</section></div>`+
   `<section class="panel"><div class="section-heading"><div><span class="eyebrow">DESPESAS</span><h3>Gastos da loja</h3></div>${can('expenses:write')?button('＋ Nova despesa','add-expense'):''}</div><div class="list-toolbar"><input id="list-search" placeholder="Buscar despesas..." aria-label="Buscar despesas"><span>${expenses.length} registro(s)</span></div>${list(expenses,e=>`<strong>${esc(e.description)}</strong><small>${dateBR(e.date)} · ${esc(e.category||'Geral')}</small><div class="record-metrics"><span>Valor: <b>${money(e.amount)}</b></span></div>`,'expense',e=>`${can('expenses:write')?`<button data-edit="expense" data-id="${esc(e.id)}">Editar</button><button data-delete="expense" data-id="${esc(e.id)}">Excluir</button>`:''}`,pending)}</section>`+
   `<section class="panel finance-withdrawals"><h3>Retiradas registradas no mês (${monthWithdrawals.length})</h3><div>${list(monthWithdrawals,w=>`<strong>${money(w.amount)}</strong><small>${dateBR(w.date)} · ${esc(w.notes||'Salário / retirada')}</small>`,'withdrawal',w=>`<button data-delete="withdrawal" data-id="${esc(w.id)}">Excluir</button>`,pending)}</div></section>`;
 }
 if(page==='backup'){
  html=intro('Backup e dados','Recupere os registros de um backup sem mudar a identidade da loja atual.')+
   `<div class="settings-grid"><section class="panel settings-card"><h3>Backup portável da loja</h3><p>Salva produtos, estoque, vendas e movimentações em JSON. Mesmo após excluir a loja antiga, você pode importar os registros para sua loja atual.</p>${button('Baixar backup da loja','export-server')}</section>
    <section class="panel settings-card"><h3>Importar dados do backup</h3><p>Como administrador, importe os dados da loja antiga para a sua loja atual, sem alterar o nome, as contas nem os dados do comprovante. Registros existentes não serão substituídos; registros já importados serão ignorados.</p>
    <label class="form-field" for="backup-file">Arquivo JSON da loja</label><input type="file" id="backup-file" accept=".json,application/json">
    <label class="form-field" for="backup-password">Sua senha atual de administrador</label><input type="password" id="backup-password" autocomplete="current-password" placeholder="Confirme sua senha">
    ${button('Importar dados para esta loja','import-server','secondary')}
    <p class="fine-print">Faça um backup da loja atual antes. A importação acrescenta registros ausentes e não atualiza cadastros existentes. Não substitui o backup do banco SQLite do Windows.</p></section>
    <section class="panel settings-card"><h3>Backup offline deste aparelho</h3><div><p>Guarda registros deste celular e lançamentos não sincronizados. É uma cópia de emergência, não o arquivo para restaurar a loja no servidor.</p>${button('Baixar backup do aparelho','export-local','secondary')}</div></section></div>`;
 }
 if(page==='staff'){
  try{
   const response=await apiFetch('/api/staff',{cache:'no-store'});
   if(!response.ok)throw Error('Não foi possível consultar a equipe. Precisa de conexão com o servidor.');
   staffCache=(await response.json()).staff||[];
   html=intro('Equipe da loja','Cada pessoa entra com seu próprio e-mail e senha em qualquer celular ou PC. Todos usam a mesma loja e as ações ficam identificadas.',button('＋ Nova conta','new-staff'))+
    panels([['Contas cadastradas',staffCache.length,'Administradores e funcionários'],['Contas ativas',staffCache.filter(x=>x.active).length,'Podem entrar na loja'],['Desativadas',staffCache.filter(x=>!x.active).length,'Acesso bloqueado']])+
    `<div class="record-list">${staffCache.length?staffCache.map(v=>`<article class="record-row"><div class="record-details"><strong>${esc(v.name)}</strong><small>${esc(v.email)} · ${v.role==='owner'?'Administrador':'Funcionário'} · ${v.active?'Ativo':'Desativado'}</small><small>${v.role==='owner'?'Acesso completo':Object.values(v.permissions||{}).filter(Boolean).length+' permissões concedidas'}</small></div><div class="row-actions"><button type="button" data-staff-edit="${esc(v.id)}">Editar / Permissões</button>${v.id!==session.userId?`<button type="button" class="danger-soft" data-staff-delete="${esc(v.id)}">Excluir conta</button>`:''}</div></article>`).join(''):empty('Nenhuma conta adicional','Crie uma conta para um administrador ou funcionário.')}</div>`;
  }catch(e){html=intro('Equipe','O cadastro e as permissões precisam de conexão com o servidor.')+`<div class="panel error-screen"><p>${esc(e.message)}</p></div>`;}
 }
 if(page==='settings'){
  html=intro('Configurações','Dados da loja e contas, compartilhados pelo mesmo servidor do PC.')+
  `<div class="settings-grid"><section class="panel settings-card"><h3>Identificação da loja</h3><p><b>${esc(session.shopName||'Loja')}</b></p><p>Código da loja: <code class="tiny-code">${esc(session.shopId)}</code></p>
  ${isOwner()?`<form id="shop-form"><div class="form-field"><label for="shop-name">Nome da loja</label><input id="shop-name" name="name" maxlength="100" required value="${esc(session.shopName||'')}"></div><button type="submit" class="secondary">Atualizar nome da loja</button></form>`:'<p>Somente um administrador pode alterar o nome da loja.</p>'}</section>
  ${isOwner()?`<section class="panel settings-card logo-settings-card">
    <div class="settings-logo-heading"><span class="settings-logo-icon">✧</span><div><span class="eyebrow">IDENTIDADE VISUAL</span><h3>Logo da sua loja</h3></div></div>
    <p>Personalize o site com a sua marca. Ela aparece no painel, no menu, na tela de acesso deste aparelho e nos comprovantes. É opcional.</p>
    <form id="shop-logo-form">
      <div class="shop-logo-picker"><div id="shop-logo-preview" class="shop-logo-preview" aria-label="Prévia da logo"><span class="shop-logo-empty">Sem logo da loja</span></div>
        <div class="shop-logo-picker-actions"><label class="shop-logo-upload" for="shop-logo-input">Escolher imagem<input id="shop-logo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Selecionar logo da loja"></label>
          <button class="secondary small" type="button" id="shop-logo-remove">Remover logo</button>
          <small>JPG, PNG ou WebP · até 5 MB · reduzida automaticamente.</small>
        </div>
      </div>
      <p class="fine-print" id="shop-logo-status" role="status">Sem logo da loja. A marca SA permanece fixa.</p>
      <button class="primary" type="submit" id="shop-logo-save">Salvar logo</button>
    </form>
   </section>`:''}
  ${isOwner()?(()=>{const c=ofType(all,'shopprofile').find(v=>v.id==='company')||{};return `<section class="panel settings-card"><h3>Dados do comprovante</h3><div><p>Dados compartilhados entre PC e iPhone.</p><form id="receipt-shop-form"><div class="form-field"><label for="receipt-business-name">Nome da loja</label><input id="receipt-business-name" name="businessName" maxlength="100" value="${esc(c.businessName||session.shopName||'')}" required></div><div class="field-pair"><div class="form-field"><label for="receipt-cnpj">CNPJ (opcional)</label><input id="receipt-cnpj" name="cnpj" inputmode="numeric" maxlength="18" placeholder="Somente números" value="${esc(c.cnpj||'')}"></div><div class="form-field"><label for="receipt-phone">Telefone (opcional)</label><input id="receipt-phone" name="phone" maxlength="35" value="${esc(c.phone||'')}"></div></div><div class="form-field"><label for="receipt-address">Endereço (opcional)</label><input id="receipt-address" name="address" maxlength="160" value="${esc(c.address||'')}"></div><div class="field-pair"><div class="form-field"><label for="receipt-city">Cidade / UF (opcional)</label><input id="receipt-city" name="city" maxlength="90" value="${esc(c.city||'')}"></div><div class="form-field"><label for="receipt-email">E-mail (opcional)</label><input id="receipt-email" name="email" type="email" maxlength="100" value="${esc(c.email||'')}"></div></div><button class="secondary" type="submit">Salvar dados do comprovante</button></form><p class="fine-print">Comprovante não fiscal.</p></div></section>`})():''}
  ${isOwner()?pixSettingsHtml(shopProfile):''}
  <section class="panel settings-card"><h3>Meu acesso</h3><p>${esc(session.email)} · ${isOwner()?'Administrador':'Funcionário'}</p><form id="profile-form"><div class="form-field"><label for="profile-name">Nome exibido</label><input id="profile-name" name="name" value="${esc(session.userName||'')}" maxlength="100" required></div><div class="form-field"><label for="profile-old">Senha atual (para trocar a senha)</label><input id="profile-old" name="currentPassword" type="password" autocomplete="current-password"></div><div class="form-field"><label for="profile-new">Nova senha (opcional, mínimo 10 caracteres)</label><input id="profile-new" name="newPassword" type="password" autocomplete="new-password" minlength="10"></div><button type="submit" class="secondary">Salvar meu perfil</button></form>${button('Sair da conta','logout','secondary')}<div class="account-danger-zone"><h4>Excluir minha conta</h4><p>Exclui somente este usuário e encerra suas sessões. A loja, as vendas e o histórico são preservados. Se você for o último administrador, crie outro antes.</p>${button('Excluir minha conta de usuário','delete-account','danger-soft')}</div></section>
  ${isOwner()&&isLocalWindowsPanel()?`<section class="panel settings-card"><h3>Servidor do Windows</h3><p>Controle disponível somente neste PC e para administradores. O iPhone continuará usando o mesmo banco.</p><p id="windows-autostart-state">Verificando inicialização automática...</p><button class="secondary" type="button" data-action="toggle-windows-autostart" id="windows-autostart-button">Configurar inicialização automática</button><p class="fine-print">Ao entrar no Windows, o Street Admin aguardará o NetBird e iniciará o servidor. Para desligar, as vendas do iPhone devem estar sincronizadas.</p><button class="danger-button" type="button" data-action="stop-windows-server">Desligar servidor agora</button></section>`:''}
  ${isOwner()?`<details class="panel settings-card audit-settings compact-details"><summary>Histórico de alterações</summary><div class="compact-details-body"><p>Alterações feitas pelos usuários da loja.</p><button type="button" class="secondary" data-action="load-audit">Carregar histórico</button><div id="audit-settings-content"></div></div></details>`:''}
  ${isOwner()?`<details class="panel settings-card shop-danger-zone compact-details"><summary>Gerenciar conta</summary><div class="compact-details-body"><p>Esta opção apaga <b>a loja inteira</b>: funcionários, contas, produtos, estoque, vendas, relatórios e histórico de alterações. Todos perdem acesso, inclusive em outros celulares.</p><p class="fine-print">Faça um backup antes de continuar. O backup dos dados não recria automaticamente as contas. Alterações offline em outros aparelhos podem não ter sido enviadas. O servidor não pode apagar instantaneamente cópias já armazenadas offline nesses aparelhos.</p><div class="row-actions"><button type="button" class="secondary" data-action="export-server">Baixar backup dos dados</button>${button('Excluir esta loja definitivamente','delete-shop','danger-soft')}</div></div></details>`:''}</div>`;
 }
 if(sequence!==renderRevision||page!==currentPage)return;
 $('#content').innerHTML=html;
 paintShopLogo(currentShopLogo);
 if(page==='settings'){shopLogoDraft=null;updateShopLogoPreview();}
 if(page==='home')filterHomeProducts();
 if(page==='settings'&&isOwner()&&isLocalWindowsPanel())refreshWindowsStartup();
 if(page==='register'){
  $('#cash-payment').value=pos.payment;
  $('#received-field').hidden=pos.payment!=='Dinheiro';
  refreshCart();
 }
}
function catalogHtml(products){return products.length?products.map(p=>`<button type="button" class="catalog-product" data-add-cart="${esc(p.id)}" ${p.available<=0?'disabled':''} data-searchable><div class="catalog-product-details">${productThumb(p,'catalog-thumb')}<span><strong>${esc(p.name)}</strong><small>${esc([p.category,p.size&&'Tam. '+p.size,p.color].filter(Boolean).join(' · ')||'Produto')} · ${p.available} disponível(is)</small></span></div><span>${money(p.price)} <b>${p.available>0?'＋':'—'}</b></span></button>`).join(''):empty('Nenhum produto disponível','Cadastre um produto e informe seu estoque inicial.','add-product','Novo produto');}
function totals(){
 let subtotal=0;const lines=[];
 for(const [id,quantity] of cart){const product=registerProducts.find(p=>p.id===id);if(!product)continue;const price=cents(product.price);subtotal+=price*quantity;lines.push({product,quantity,price});}
 const discount=pos.discountType==='percent'?Math.max(0,Math.round(subtotal*Math.min(100,Math.max(0,num(pos.discount)))/100)):Math.max(0,cents(pos.discount)),total=Math.max(0,subtotal-discount);
 const received=cents(pos.received),change=pos.payment==='Dinheiro'?Math.max(0,received-total):0;
 return {lines,subtotal,discount,total,received,change,discountType:pos.discountType,discountInput:num(pos.discount)};
}
function refreshCart(){
 if(currentPage!=='register'||!$('#cart-items'))return;
 const t=totals();
 $('#cart-items').innerHTML=t.lines.length?t.lines.map(({product,quantity,price})=>`<div class="cart-line"><div><strong>${esc(product.name)}</strong><small>${brl(price)} / un. · em estoque: ${product.available}</small></div><div class="cart-controls"><button type="button" aria-label="Remover uma unidade" data-cart-change="-1" data-id="${esc(product.id)}">−</button><span>${quantity}</span><button type="button" aria-label="Adicionar uma unidade" data-cart-change="1" data-id="${esc(product.id)}">＋</button><button type="button" class="cart-delete" data-cart-remove="${esc(product.id)}" aria-label="Tirar produto do carrinho">×</button></div><strong class="cart-line-price">${brl(price*quantity)}</strong></div>`).join(''):empty('Carrinho vazio','Toque em um produto à esquerda para começar.');
 const cash=pos.payment==='Dinheiro';
 $('#cash-summary').innerHTML=`<div class="checkout-total-row"><span>Subtotal</span><strong>${brl(t.subtotal)}</strong></div><div class="checkout-total-row"><span>Desconto</span><strong>− ${brl(t.discount)}</strong></div><div class="checkout-total-row grand-total"><span>Total da venda</span><strong>${brl(t.total)}</strong></div>${cash?`<div class="change-row"><span>Troco a devolver</span><strong>${brl(t.change)}</strong></div>${t.lines.length&&t.received<t.total?'<p class="form-hint">Valor recebido ainda é menor que o total.</p>':''}`:''}`;
 refreshPix(t);
 const risk=F.discountRisk({lines:t.lines,subtotal:t.subtotal,discount:t.discount,plan:registerPlan});
 const el=$('#discount-risk');if(el){el.className='discount-risk risk-'+risk.level;el.textContent=risk.message+(risk.suggestedMax!==null&&t.lines.length?' Limite conservador de desconto: '+brl(risk.suggestedMax)+'.':'');}
 const discountField=$('#cash-discount');if(discountField)discountField.classList.toggle('loss-input',risk.level==='danger'||risk.level==='warning');
 $('#finish-sale').disabled=!t.lines.length||t.discount>t.subtotal||(pos.discountType==='percent'&&num(pos.discount)>100);
}
let lastModalFocus=null;
function modal(title,body,type='',id=''){
 lastModalFocus=document.activeElement;
 modalType=type;editingId=id;
 $('#modal-title').textContent=title;$('#form-fields').innerHTML=body;$('#modal').classList.add('open');
 $('#form-save').disabled=false;
 $('#modal').querySelector('input:not([type=hidden]),select')?.focus();
}
function closeModal(){$('#modal').classList.remove('open');modalType='';editingId='';$('#form-save').textContent='Salvar';if(lastModalFocus?.isConnected)lastModalFocus.focus();lastModalFocus=null;}
function input(name,label,value='',type='text',required=false,attrs=''){return `<div class="form-field"><label for="form-${name}">${label}</label><input id="form-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${attrs}></div>`;}
async function openCancelSale(id){
 if(!isOwner())return toast('Somente administradores podem cancelar vendas.');
 const sale=await getRecord('sale',id);
 if(!sale)return toast('Venda não encontrada. Sincronize e tente novamente.');
 if(sale.pending||sale.syncProblem)return toast('Sincronize a venda com o servidor antes de cancelar.');
 if(saleIsCancelled(sale))return toast('Esta venda já está cancelada.');
 modal('Cancelar venda',`<div class="form-note"><b>Venda:</b> ${esc(sale.description||sale.id)}<br><b>Valor original:</b> ${money(sale.total)}<p>O cancelamento retirará esta venda dos totais e devolverá as unidades ao estoque do sistema. A venda ficará no relatório como cancelada. <b>Não faz estorno bancário, Pix ou cartão.</b></p></div>`+input('reason','Motivo do cancelamento','','text',true,'minlength="5" maxlength="240" placeholder="Ex.: Cliente desistiu antes da entrega"'),'cancel-sale',id);
 $('#form-save').textContent='Cancelar venda';
}
async function openDeleteAccount(){
 const pending=await getPending();
 if(pending.length)return toast('Sincronize ou resolva as pendências antes de excluir sua conta.');
 if(!serverReachable)return toast('Conecte ao servidor para excluir sua conta.');
 modal('Excluir minha conta',`<div class="form-note"><b>Esta ação encerra o acesso deste usuário em todos os aparelhos.</b> A loja, o histórico das vendas e os dados ficam preservados. Você não poderá recuperar o acesso sem uma nova conta. A última conta de administrador não pode ser excluída.</div>`+input('password','Digite sua senha atual','','password',true,'autocomplete="current-password"'),'delete-account',session.userId);
 $('#form-save').textContent='Excluir minha conta';
}
async function openDeleteShop(){
 if(!isOwner())return toast('Somente administradores podem excluir a loja inteira.');
 const pending=await getPending();
 if(pending.length)return toast('Existem alterações pendentes neste aparelho. Sincronize ou resolva antes de excluir a loja.');
 if(!serverReachable||navigator.onLine===false)return toast('Conecte ao servidor para excluir a loja.');
 const shop=esc(session.shopName||'');
 modal('Excluir loja definitivamente',`<div class="form-note"><b>Atenção: esta operação é irreversível no servidor.</b><p>Você excluirá a loja <b>${shop}</b> e todos os produtos, vendas, funcionários, relatórios e registros. Todas as contas desta loja serão desconectadas. Nenhuma outra loja será afetada.</p><p>Baixe um backup primeiro em <b>Configurações → Excluir loja definitivamente</b>. Os dados guardados offline em outros celulares não podem ser apagados remotamente e podem conter alterações ainda não sincronizadas.</p></div>`+
 input('password','Senha de administrador','','password',true,'autocomplete="current-password"'),'delete-shop',session.shopId);
 $('#form-save').textContent='Excluir loja definitivamente';
}
async function finishShopRemoval(shopId){
 // Nenhum acesso deve permanecer neste aparelho após a exclusão bem-sucedida.
 const previousName=DB_NAME;
 session=null;if(db){db.close();db=null;}cart.clear();
 localStorage.removeItem(SESSION_KEY);
 // Limpa também caches de outros administradores/funcionários desta loja, se o navegador os expuser.
 try{
  const names=typeof indexedDB.databases==='function'?(await indexedDB.databases()).map(x=>x.name):[previousName];
  for(const name of new Set([...names,previousName].filter(n=>typeof n==='string'&&n.startsWith('street-admin-shop-'+shopId)))){
   try{indexedDB.deleteDatabase(name);}catch(e){console.warn('Não foi possível limpar cache local:',name,e);}
  }
 }catch(e){console.warn('Não foi possível listar caches da loja:',e);}
 showAuth();setAuthMode('login');
 $('#content').innerHTML='<div class="page-loading">Loja excluída do servidor. Para começar outra, cadastre uma nova loja.</div>';
 toast('Loja excluída. Contas e dados removidos do servidor.');
}
async function finishAccountRemoval(){
 const current=session;session=null;if(db){db.close();db=null;}cart.clear();
 localStorage.removeItem(SESSION_KEY);showAuth();setAuthMode('login');
 $('#content').innerHTML='<div class="page-loading">Sua conta foi excluída. A loja e as vendas permanecem no servidor.</div>';
 toast('Conta excluída. O histórico e a loja foram preservados.');
}
async function deleteStaff(staff){
 if(!isOwner())return toast('Somente o administrador pode excluir contas.');
 if(staff.id===session.userId)return toast('Não é possível excluir sua própria conta.');
 if(navigator.onLine===false)return toast('Conecte-se ao servidor para excluir esta conta.');
 const res=await apiFetch('/api/staff/'+encodeURIComponent(staff.id),{method:'DELETE'});
 const answer=await res.json().catch(()=>({}));if(!res.ok)throw Error(answer.error||'Não foi possível excluir esta conta.');
 toast('Conta excluída. Vendas e histórico preservados.');await renderPage();
}
function openStaffForm(staff={}){
 if(!isOwner())return toast('Apenas o administrador pode gerenciar funcionários.');
 const creating=!staff.id;
 const defaultPerms={'sales:create':true,'sales:view':true,'products:read':true,'stock:read':true,'customers:read':true};
 const permissions=creating?defaultPerms:(staff.permissions||{});
 const fields=`<div class="form-field"><label for="form-role">Tipo de acesso</label><select id="form-role" name="role"><option value="staff" ${staff.role!=='owner'?'selected':''}>Funcionário — permissões personalizadas</option><option value="owner" ${staff.role==='owner'?'selected':''}>Administrador — acesso completo</option></select></div>`+input('name','Nome da pessoa',staff.name||'','text',true,'maxlength="100"')+
  (creating?input('email','E-mail de login',staff.email||'','email',true,'maxlength="180"'):`<div class="form-note"><b>Login:</b> ${esc(staff.email)}<p>O e-mail de login não pode ser alterado aqui.</p></div>`)+
  input('password',creating?'Senha inicial (mínimo 10 caracteres)':'Nova senha (deixe em branco para manter)','', 'password',creating,'minlength="10" maxlength="200" autocomplete="new-password"')+
  `<div class="form-note">Cada funcionário acessa a mesma loja com este e-mail e senha em qualquer aparelho. Não compartilhe o login do administrador. Para administradores, todas as permissões são concedidas automaticamente. Para funcionários, use as opções abaixo. Permissões individuais deste funcionário. Consultar indicadores concede também acesso de leitura às vendas e despesas. A alteração depende de conexão.</div>`+
  `<div class="permissions-grid">${STAFF_PERMISSION_LABELS.map(([id,label])=>`<label class="permission-option"><input type="checkbox" name="perm-${esc(id)}" ${permissions[id]?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div>`+
  (creating?'':`<label class="permission-option active-permission"><input type="checkbox" name="active" ${staff.active?'checked':''}><span>Conta ativa — pode fazer login</span></label>`);
 modal(creating?'Cadastrar usuário':'Editar usuário e permissões',fields,'staff',staff.id||'');
}
async function saveStaff(form,raw){
 if(!isOwner())throw Error('Acesso permitido apenas ao administrador.');
 const p=Object.fromEntries(STAFF_PERMISSION_LABELS.map(([k])=>[k,new FormData(form).has('perm-'+k)]));
 const creating=!editingId;
 const payload={name:raw.name?.trim()||'',role:raw.role==='owner'?'owner':'staff',permissions:p,...(creating?{email:raw.email?.trim(),password:raw.password}:{active:new FormData(form).has('active'),...(raw.password?{password:raw.password}:{})})};
 const route=creating?'/api/staff':'/api/staff/'+encodeURIComponent(editingId);
 const response=await apiFetch(route,{method:creating?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Não foi possível salvar o funcionário.');
 closeModal();toast(creating?'Conta cadastrada.':'Conta atualizada.');await renderPage();
}

async function openForm(type,record={}){
 if(!can(EDIT[type])){toast('Seu usuário não tem permissão para esta operação.');return;}
 let html='',title='';
 if(type==='promotion'){
  if(!isOwner()){toast('Somente o administrador pode criar promoções.');return;}
  title=record.id?'Editar promoção':'Nova promoção';
  html=input('name','Nome da promoção',record.name||'Black Friday','text',true,'maxlength="100"')+
   input('percent','Desconto (%)',record.percent??'','number',true,'min="0.01" max="100" step="0.01"')+
   `<div class="field-pair">${input('startDate','Início',record.startDate||localDate(),'date',true)}${input('endDate','Término',record.endDate||localDate(),'date',true)}</div>`+
   `<label class="permission-option promo-active-label"><input type="checkbox" name="active" ${record.active!==false?'checked':''}><span>Promoção ativada</span></label><div class="form-note">Aplica uma porcentagem sobre o valor da venda quando alguém escolher esta campanha no Caixa. Descontos elevados podem causar prejuízo.</div>`;
 }
 if(type==='product'){
  photoSelectionId++;photoProcessing=false;productPhotoData=isProductPhoto(record.photo)?record.photo:'';
  title=record.id?'Editar produto':'Novo produto';
  html=input('name','Nome do produto',record.name,'text',true,'maxlength="110"')+input('category','Categoria',record.category,'text',false,'maxlength="65"')+
   `<div class="field-pair">${input('size','Tamanho',record.size)}${input('color','Cor',record.color)}</div>`+
   `<div class="field-pair">${input('cost','Preço de custo (R$)',record.cost??'', 'number',false,'min="0" step="0.01"')}${input('price','Preço de venda (R$)',record.price??'', 'number',true,'min="0" step="0.01"')}</div>`+
   (record.id?`<div class="form-note">O estoque permanece igual ao editar o cadastro. Para repor unidades, use <b>Entrada</b> ao lado do produto.</div>`:can('stock:write')?input('starting','Estoque inicial (unidades)',0,'number',false,'min="0" step="1"')+'<div class="form-note">A quantidade inicial já fica disponível ao salvar o produto, sem precisar registrar outra entrada. Ela também aparece no relatório de entradas.</div>':'<div class="form-note">Você pode cadastrar o produto, mas precisa da permissão de estoque para informar unidades iniciais.</div>')+productPhotoField(productPhotoData);
 }
 if(type==='customer'){
  title=record.id?'Editar cliente':'Novo cliente';html=input('name','Nome completo',record.name,'text',true,'maxlength="100"')+input('phone','Telefone',record.phone,'tel')+input('email','E-mail',record.email,'email');
 }
 if(type==='withdrawal'){
  title='Registrar retirada / pró-labore';
  html=input('amount','Valor retirado (R$)',record.amount??'','number',true,'min="0.01" step="0.01"')+input('date','Data',record.date||localDate(),'date',true)+input('notes','Observação (opcional)',record.notes||'','text',false,'maxlength="200"')+'<div class="form-note">Retirada reduz o valor de pró-labore ainda disponível, mas não é contabilizada duas vezes como despesa operacional.</div>';
 }
 if(type==='expense'){
  title=record.id?'Editar despesa':'Nova despesa';html=input('description','Descrição',record.description,'text',true)+input('category','Categoria',record.category)+input('amount','Valor (R$)',record.amount??'','number',true,'min="0.01" step="0.01"')+input('date','Data',record.date||localDate(),'date',true);
 }
 if(type==='stockmove'){
  title='Entrada ou ajuste de estoque';
  const p=[...inventory(await records()).values()].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(!p.length){toast('Cadastre um produto antes de registrar uma entrada.');return;}
  html=`<div class="form-field"><label for="form-productId">Produto</label><select id="form-productId" name="productId" required>${p.map(x=>`<option value="${esc(x.id)}" ${x.id===record.productId?'selected':''}>${esc(x.name)} — ${x.available} un.</option>`).join('')}</select></div>`+
   `<div class="form-field"><label for="form-direction">Tipo de movimentação</label><select id="form-direction" name="direction"><option value="in">Entrada de mercadoria (+)</option><option value="out">Ajuste de saída (−)</option></select></div>`+
   `<div class="field-pair">${input('quantity','Quantidade',1,'number',true,'min="1" step="1"')}${input('date','Data',localDate(),'date',true)}</div>`+
   input('unitCost','Custo por unidade (opcional)','', 'number',false,'min="0" step="0.01"')+
   input('reason','Motivo / observação','Reposição de estoque','text',true,'maxlength="200"')+
   `<div class="form-note">Cada movimentação é permanente no histórico. Em caso de erro, faça outro ajuste para corrigir.</div>`;
 }
 modal(title,html,type,record.id||'');
 if(type==='product')updateProductPhotoPreview();
}
async function submitForm(ev){
 ev.preventDefault();const form=ev.currentTarget;const raw=Object.fromEntries(new FormData(form));const type=modalType,id=editingId;
 const save=$('#form-save');save.disabled=true;
 try{
  if(type==='staff'){await saveStaff(form,raw);return;}
  if(type==='cancel-sale'){
   const response=await apiFetch('/api/sales/'+encodeURIComponent(id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:raw.reason})});
   const answer=await response.json().catch(()=>({}));if(!response.ok)throw Error(answer.error||'Não foi possível cancelar a venda.');
   closeModal();await syncNow(true);await renderPage();toast('Venda cancelada, valor retirado dos totais e estoque devolvido.');return;
  }
  if(type==='delete-shop'){
   if(!isOwner())throw Error('Somente administradores podem excluir lojas.');
   if((await getPending()).length)throw Error('Sincronize as alterações deste aparelho primeiro.');
   const shopId=session.shopId;
   const response=await apiFetch('/api/shop',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({shopName:session.shopName,confirmPhrase:'EXCLUIR LOJA',password:raw.password})});
   const answer=await response.json().catch(()=>({}));if(!response.ok)throw Error(answer.error||'Falha ao excluir loja.');
   closeModal();await finishShopRemoval(shopId);return;
  }
  if(type==='delete-account'){
   const response=await apiFetch('/api/auth/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmEmail:session.email,password:raw.password})});
   const answer=await response.json().catch(()=>({}));if(!response.ok)throw Error(answer.error||'Não foi possível excluir sua conta.');
   closeModal();await finishAccountRemoval();return;
  }
  if(!can(EDIT[type]))throw Error('Operação não autorizada para este usuário.');
  if(type==='promotion'){
   const percent=Number(raw.percent);
   if(!String(raw.name||'').trim()||!Number.isFinite(percent)||percent<=0||percent>100||!/^\d{4}-\d{2}-\d{2}$/.test(raw.startDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(raw.endDate||'')||raw.startDate>raw.endDate)throw Error('Informe nome, porcentagem de 0,01% a 100% e datas válidas.');
   closeModal();await saveBatch([{type:'promotion',data:{id:id||uid(),name:raw.name.trim().slice(0,100),percent,startDate:raw.startDate,endDate:raw.endDate,active:new FormData(form).has('active')}}]);toast('Promoção salva. Selecione-a no Caixa para aplicar.');
  }else if(type==='product'){
   if(photoProcessing)throw Error('Aguarde a foto terminar de carregar.');
   if(!raw.name?.trim())throw Error('Informe o nome do produto.');
   const price=Number(raw.price),cost=Number(raw.cost||0),starting=Number(raw.starting||0);
   if(!Number.isFinite(price)||price<0||cost<0||!Number.isInteger(starting)||starting<0)throw Error('Verifique os preços e a quantidade.');
   const product={id:id||uid(),name:raw.name.trim(),category:raw.category?.trim()||'',size:raw.size?.trim()||'',color:raw.color?.trim()||'',price,cost,photo:isProductPhoto(productPhotoData)?productPhotoData:'',stock:starting,initialDate:localDate()};
   if(id){const old=await getRecord('product',id);product.stock=num(old?.stock);product.initialDate=old?.initialDate||old?.createdAt?.slice(0,10)||localDate();}
   closeModal();await saveBatch([{type:'product',data:product}]);toast(id?'Produto atualizado.':'Produto criado com estoque disponível.');
  }else if(type==='stockmove'){
   const q=Number(raw.quantity),signed=raw.direction==='out'?-q:q;
   if(!Number.isInteger(q)||q<=0)throw Error('A quantidade deve ser um número inteiro positivo.');
   const current=inventory(await records()).get(raw.productId);
   if(!current)throw Error('Produto não encontrado.');
   if(current.available+signed<0)throw Error('O ajuste deixaria o estoque negativo.');
   if(!raw.reason?.trim())throw Error('Informe o motivo da movimentação.');
   closeModal();await saveBatch([{type:'stockmove',data:{id:uid(),productId:current.id,productName:current.name,date:raw.date||localDate(),quantity:signed,reason:raw.reason.trim(),unitCost:Number(raw.unitCost||0)}}]);toast('Movimentação de estoque registrada.');
  }else if(type==='customer'){
   if(!raw.name?.trim())throw Error('Informe o nome do cliente.');
   closeModal();await saveBatch([{type:'customer',data:{...raw,id:id||uid(),name:raw.name.trim()}}]);toast('Cliente salvo.');
  }else if(type==='withdrawal'){
   if(!Number.isFinite(Number(raw.amount))||Number(raw.amount)<=0||!raw.date)throw Error('Informe valor e data válidos.');
   closeModal();await saveBatch([{type:'withdrawal',data:{id:id||uid(),amount:Number(raw.amount),date:raw.date,notes:String(raw.notes||'').slice(0,200)}}]);toast('Retirada registrada.');
  }else if(type==='expense'){
   if(!raw.description?.trim()||!Number.isFinite(Number(raw.amount))||Number(raw.amount)<=0)throw Error('Descrição e valor devem ser preenchidos.');
   closeModal();await saveBatch([{type:'expense',data:{...raw,id:id||uid(),amount:Number(raw.amount)}}]);toast('Despesa salva.');
  }
 }catch(e){console.error(e);toast(e.message||'Não foi possível salvar.');if(!$('#modal').classList.contains('open'))await renderPage();}
 finally{save.disabled=false;}
}
async function finishSale(){
 if(!can('sales:create')){toast('Seu usuário não pode registrar vendas.');return;}
 if(checkoutLock)return;checkoutLock=true;
 try{
 const t=totals();if(!t.lines.length){toast('Adicione produtos ao carrinho.');return;}
 if(!Number.isFinite(t.discountInput)||t.discountInput<0||(t.discountType==='percent'&&t.discountInput>100)||t.discount>t.subtotal){toast('Revise o desconto: máximo de 100% ou o valor total da venda.');return;}
 if(pos.payment==='Dinheiro'&&t.received<t.total){toast('O valor recebido é menor que o total da venda.');return;}
 if(t.lines.some(x=>x.quantity>x.product.available)){toast('Uma quantidade supera o estoque disponível.');return;}
 // Consulta novamente o banco antes de lançar para impedir vendas sobre estoque local já alterado.
 const currentStock=inventory(await records());
 if(t.lines.some(x=>!currentStock.get(x.product.id)||currentStock.get(x.product.id).available<x.quantity)){toast('O estoque mudou. Revise o carrinho.');await renderPage();return;}
 const customer=registerCustomers.find(x=>x.id===pos.customerId);
 const appliedPromo=registerPromotions.find(p=>p.id===pos.promotionId);
 const sale={promotionId:appliedPromo?.id||'',promotionName:appliedPromo?.name||'',id:uid(),date:localDate(),createdAt:new Date().toISOString(),description:t.lines.map(x=>`${x.quantity}× ${x.product.name}`).join(', ').slice(0,200),customerId:customer?.id||'',customer:customer?.name||'',items:t.lines.map(x=>({productId:x.product.id,name:x.product.name,quantity:x.quantity,price:x.price/100,cost:Number(x.product.cost)||0})),subtotal:t.subtotal/100,discount:t.discount/100,discountType:t.discountType,discountInput:t.discountInput,total:t.total/100,soldByUserId:session.userId,soldByName:session.userName,payment:pos.payment,received:pos.payment==='Dinheiro'?t.received/100:0,change:pos.payment==='Dinheiro'?t.change/100:0,notes:pos.notes};
 const finish=$('#finish-sale');if(finish)finish.disabled=true;
 try{
  await saveBatch([{type:'sale',data:sale}],{refresh:false});
  cart.clear();pos={payment:'Dinheiro',received:'',discount:'0',discountType:'money',promotionId:'',customerId:'',notes:''};
  await renderPage();toast(`Venda registrada: ${money(sale.total)}${sale.payment==='Dinheiro'?' · Troco: '+money(sale.change):''}`);
 }catch(e){console.error(e);toast('Falha ao registrar a venda. Tente novamente.');if(finish)finish.disabled=false;}
 }finally{checkoutLock=false;}
}
async function receipt(sale,win){
 if(!win){toast('Permita abrir uma janela para imprimir o comprovante.');return;}
 let profile={},client={};
 try{const all=await records();profile=ofType(all,'shopprofile').find(p=>p.id==='company')||{};client=ofType(all,'customer').find(c=>c.id===sale.customerId)||{};}catch(e){console.warn('Dados extras do recibo indisponíveis',e);}
 const shop=profile.businessName||session?.shopName||'Street Admin';
 const issued=sale.createdAt?new Date(sale.createdAt):null;
 const when=issued&&!Number.isNaN(issued.getTime())?issued.toLocaleString('pt-BR'):(dateBR(sale.date)+' · Horário não registrado');
 const items=Array.isArray(sale.items)?sale.items:[];
 const hasItems=items.length>0;
 const gross=hasItems?items.reduce((n,i)=>n+cents(i.price)*num(i.quantity),0)/100:Number(sale.subtotal??sale.total??0)+Number(sale.discount||0);
 const total=Number(sale.total||0),discount=Math.max(0,Number(sale.discount||0));
 const percent=gross>0?Math.round(discount/gross*10000)/100:0;
 const label=(title,value)=>value?`<div class="pair"><span>${esc(title)}</span><b>${esc(value)}</b></div>`:'';
 const products=hasItems?items.map((i,n)=>`<tr><td class="item-desc"><b>${n+1}. ${esc(i.name||'Produto')}</b><small>${esc(num(i.quantity))} un. × ${money(i.price)}</small></td><td class="price">${money(num(i.price)*num(i.quantity))}</td></tr>`).join(''):`<tr><td class="item-desc">${esc(sale.description||'Venda sem itens detalhados (registro antigo)')}</td><td class="price">${money(total)}</td></tr>`;
 const pending=Boolean(sale.pending||sale.syncProblem);
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comprovante de venda - ${esc(shop)}</title><style>
 *{box-sizing:border-box}body{font:13px/1.55 Arial,Helvetica,sans-serif;color:#25222a;background:#f5f5f6;margin:0;padding:24px 12px}
 .receipt{background:#fff;border:1px solid #ded8df;max-width:470px;margin:auto;padding:23px;border-radius:14px;box-shadow:0 7px 25px #2420280a}
 .stripe{height:4px;background:linear-gradient(90deg,#57545d 0%,#57545d 55%,#c65b8b 55%,#c65b8b 100%);border-radius:4px;margin-bottom:20px}
 h1{font-size:21px;letter-spacing:-.5px;margin:0;overflow-wrap:anywhere}h2{font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8c526d;margin:18px 0 9px}
 .sub{color:#6e6771}.store{padding:0 0 18px;border-bottom:1px solid #e7e2e8}.store p{margin:5px 0 0;color:#665f69;font-size:11px;overflow-wrap:anywhere}
  .receipt-brand-image{display:block;max-width:65px;max-height:65px;object-fit:contain;margin-bottom:9px;border-radius:11px}
 .tag{display:inline-block;background:#f8e9f0;color:#9b456d;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:700;margin:9px 0 0}
 .pair{display:flex;justify-content:space-between;gap:12px;margin:5px 0;font-size:12px}.pair span{color:#706872}.pair b{font-weight:600;text-align:right;overflow-wrap:anywhere;max-width:66%}
 table{width:100%;border-collapse:collapse}td{padding:11px 0;border-bottom:1px dashed #ddd7de;vertical-align:top}.item-desc{padding-right:8px}.item-desc b{display:block;font-size:12px;overflow-wrap:anywhere}.item-desc small{display:block;font-size:11px;color:#726b72;margin-top:2px}.price{text-align:right;white-space:nowrap;font-weight:700;font-size:12px}
 .totals{margin-top:14px}.total{border-top:2px solid #454049;padding-top:11px;margin-top:10px;font-size:18px}.total b{color:#ab3e70}
 .notice{padding:10px;border:1px solid #e7c0d0;border-radius:8px;background:#fff2f6;color:#83334d;font-size:11px;margin-top:16px}
 .footer{margin-top:18px;border-top:1px solid #e7e2e8;padding-top:12px;text-align:center;color:#746c76;font-size:11px}
 .actions{max-width:470px;margin:14px auto;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.actions button{border:0;background:#b74778;color:#fff;border-radius:9px;padding:12px 17px;font-weight:700;font-size:13px;cursor:pointer}.actions button:last-child{background:#5c5860}
 .notes{white-space:pre-wrap;overflow-wrap:anywhere;color:#514b53;background:#f8f7f8;padding:9px;border-radius:8px}
 @media print{@page{margin:10mm}body{background:#fff;padding:0}.receipt{border:0;padding:0;max-width:none;box-shadow:none}.actions{display:none}.tag,.notice{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
 </style></head><body><div class="receipt"><div class="stripe"></div><header class="store">${isShopLogo(profile.logoData)?`<img class="receipt-brand-image" src="${profile.logoData}" alt="Logo da loja">`:''}<h1>${esc(shop)}</h1><div class="tag">COMPROVANTE DE VENDA · NÃO FISCAL</div>${profile.cnpj?`<p>CNPJ informado: ${esc(profile.cnpj)}</p>`:''}${profile.address?`<p>${esc(profile.address)}</p>`:''}${profile.city?`<p>${esc(profile.city)}</p>`:''}${profile.phone?`<p>Contato: ${esc(profile.phone)}</p>`:''}${profile.email?`<p>${esc(profile.email)}</p>`:''}</header>
 <section><h2>Identificação da venda</h2>${label('Código',sale.id)}${label('Data e hora',when)}${label('Atendente',sale.soldByName||'Não identificado (venda antiga)')}${label('Cliente',sale.customer||'Consumidor final')}${client.phone?label('Telefone do cliente',client.phone):''}${client.email?label('E-mail do cliente',client.email):''}${pending?'<p class="notice">Esta venda ainda não está confirmada no servidor. Confira a sincronização antes de entregar como comprovante final.</p>':''}${saleIsCancelled(sale)?`<p class="notice"><b>VENDA CANCELADA — SEM VALOR PARA FATURAMENTO.</b> Cancelada em ${esc(sale.cancelledAt?new Date(sale.cancelledAt).toLocaleString('pt-BR'):'data não registrada')} por ${esc(sale.cancelledByName||'Administrador')}. Motivo: ${esc(sale.cancelReason||'Não informado')}. Este documento é apenas histórico.</p>`:''}</section>
 <section><h2>Produtos / serviços</h2><table aria-label="Itens da venda"><tbody>${products}</tbody></table></section>
 <section class="totals"><h2>Resumo e pagamento</h2>${label('Subtotal',money(gross))}${label('Desconto',discount?`${money(discount)} (${percent.toLocaleString('pt-BR')}%)`:money(0))}${sale.promotionName?label('Promoção aplicada',sale.promotionName):''}<div class="pair total"><span>Total da venda</span><b>${money(total)}</b></div>${label('Forma de pagamento',sale.payment||'Não informada')}${sale.payment==='Dinheiro'?label('Valor recebido',money(sale.received))+label('Troco',money(sale.change)):''}${sale.notes?`<h2>Observações da venda</h2><div class="notes">${esc(sale.notes)}</div>`:''}</section>
 <div class="footer">Documento de controle comercial gerado pelo Street Admin.<br><strong>Não é nota fiscal, NFC-e ou NF-e e não substitui documento fiscal.</strong></div></div>
 <div class="actions"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button><button type="button" onclick="window.close()">Fechar</button></div></body></html>`;
 win.document.open();win.document.write(html);win.document.close();
}

async function loadAuditSettings(){
 const target=$('#audit-settings-content');if(!target||!isOwner())return;
 target.innerHTML='<p class="muted">Carregando alterações…</p>';
 try{
  const response=await apiFetch('/api/audit?limit=75',{cache:'no-store'});
  if(!response.ok)throw Error('Histórico indisponível. Conecte o NetBird e o servidor.');
  const events=(await response.json()).events||[];
  target.innerHTML=events.length?`<div class="audit-settings-list">${events.map(e=>`<details class="audit-item"><summary><strong>${esc(e.user_name)}</strong> · ${esc(e.entity_type)} · ${esc(e.action)}<small>${esc(new Date(e.created_at).toLocaleString('pt-BR'))}</small></summary><div class="audit-diff"><div><b>Antes</b><pre>${esc(JSON.stringify(e.before??null,null,2))}</pre></div><div><b>Depois</b><pre>${esc(JSON.stringify(e.after??null,null,2))}</pre></div></div></details>`).join('')}</div>`:'<p>Nenhuma alteração registrada.</p>';
 }catch(e){target.innerHTML=`<p class="record-error">${esc(e.message)}</p>`;}
}
function csvDownload(rows,filename){
 const safe=v=>{let text=String(v??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
 const csv='\ufeff'+rows.map(row=>row.map(safe).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportReport(){
 if(!can('reports:read'))return toast('Sem permissão para exportar relatórios.');
 const all=await records(),{products,sales,entries,stockRows}=reportData(all);
 let rows=[];
 if(reportKind==='sales')rows=[['Data','ID venda','Usuário','ID do usuário','Descrição','Pagamento','Subtotal original R$','Desconto original R$','Valor original R$','Status','Valor no faturamento R$','Motivo do cancelamento','Cancelada em','Cancelada por'],...sales.map(s=>[s.date,s.id,s.soldByName||'Não identificado',s.soldByUserId||'',s.description,s.payment,s.subtotal,s.discount,s.total,saleIsCancelled(s)?'Cancelada':'Concluída',saleIsCancelled(s)?0:s.total,s.cancelReason||'',s.cancelledAt||'',s.cancelledByName||''])];
 else if(reportKind==='stock')rows=[['Produto','Categoria','Tamanho','Entradas no período','Vendidas no período','Saídas/ajustes no período','Saldo atual','Custo R$','Venda R$'],...stockRows.map(p=>[p.name,p.category,p.size,p.arrivals,p.sold,p.adjustments,p.available,p.cost,p.price])];
 else rows=[['Data','Produto','Unidades','Motivo','Custo unitário R$'],...entries.map(m=>[m.date,products.find(p=>p.id===m.productId)?.name||m.productName,m.quantity,m.reason,m.unitCost])];
 csvDownload(rows,`street-admin-relatorio-${reportKind}-${reportStart||'inicio'}_a_${reportEnd||'atual'}.csv`);
}
function download(data,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function refreshWindowsStartup(){
 const state=$('#windows-autostart-state'),btn=$('#windows-autostart-button');
 if(!state||!btn)return;
 try{
  const response=await apiFetch('/api/windows/status',{cache:'no-store'});
  const info=await response.json();
  if(!response.ok)throw Error(info.error||'Não foi possível consultar o Windows.');
  windowsAutostartEnabled=!!info.enabled;
  state.textContent=info.enabled?'✓ Iniciar automaticamente ao entrar no Windows.':info.otherLocation?'O início automático aponta para outra pasta. Atualize o endereço aqui.':'Início automático desativado.';
  btn.textContent=info.enabled?'Desativar inicialização automática':'Ativar inicialização automática';
 }catch(e){state.textContent=e.message;btn.disabled=true;}
}
async function updateWindowsStartup(){
 if(!isOwner()||!isLocalWindowsPanel())return;
 const res=await apiFetch('/api/windows/autostart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!windowsAutostartEnabled})});
 const result=await res.json();if(!res.ok)throw Error(result.error||'Não foi possível configurar o Windows.');
 toast(result.enabled?'Início automático ativado.':'Início automático desativado.');
 await refreshWindowsStartup();
}
async function stopWindowsServer(){
 if(!isOwner()||!isLocalWindowsPanel())return;
 const pending=await getPending();
 const res=await apiFetch('/api/windows/shutdown',{method:'POST'});
 const result=await res.json();if(!res.ok)throw Error(result.error||'Não foi possível desligar.');
 toast('Servidor desligado. Seus dados foram preservados.');
 $('#content').innerHTML='<div class="panel"><h2>Servidor desligado</h2><p>Para usá-lo novamente, abra o iniciador do Street Admin no Windows.</p></div>';
}
async function doAction(action){
 if(action==='refresh-register'){await syncNow(false);await renderPage();return;}
 if(action==='edit-cash-opening'){const f=$('#cash-edit-form');if(f){f.hidden=!f.hidden;if(!f.hidden)f.querySelector('input')?.focus();}return;}
 if(action==='toggle-windows-autostart'){await updateWindowsStartup();return;}
 if(action==='stop-windows-server'){await stopWindowsServer();return;}
 if(action==='add-withdrawal'){await openForm('withdrawal');return;}
 if(action==='new-staff'){openStaffForm();return;}
 if(action==='delete-account'){await openDeleteAccount();return;}
 if(action==='delete-shop'){await openDeleteShop();return;}
 if(action==='new-promotion'){await openForm('promotion');return;}
 if(action==='load-audit'){await loadAuditSettings();return;}
 if(action==='export-report'){await exportReport();return;}
 if(action==='report-clear'){reportStart='';reportEnd='';renderPage();return;}
 if(action==='report-apply-month'){
  const value=$('#report-month')?.value||'';
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){toast('Selecione um mês válido para o relatório.');return;}
  const [year,month]=value.split('-').map(Number);
  reportStart=`${value}-01`;reportEnd=`${value}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`;
  renderPage();return;
 }

 if(action==='open-register'){goto('register');return;}
 if(action==='go-sales'){goto('sales');return;}
 if(action==='go-products'){goto('products');return;}
 if(action==='add-product'){await openForm('product');return;}
 if(action==='add-stock'){await openForm('stockmove');return;}
 if(action==='add-expense'){await openForm('expense');return;}
 if(action==='add-customer'){await openForm('customer');return;}
 if(action==='finish-sale'){await finishSale();return;}
 if(action==='clear-cart'){cart.clear();refreshCart();return;}
 if(action==='sync'){await syncNow(false);return;}
 if(action==='logout'){await logout();return;}
 if(action==='export-server'){
  try{
   if((await getPending()).length){toast('Há alterações pendentes. Sincronize tudo antes de baixar o backup completo da loja.');return;}
   const r=await apiFetch('/api/export');if(!r.ok)throw Error('Servidor indisponível. Conecte o PC e o NetBird.');
   download(await r.json(),'street-admin-backup-dados.json');
   toast('Backup salvo. Guarde o arquivo em local seguro.');
  }catch(e){toast(e.message||'Não foi possível gerar backup.');}
  return;
 }
 if(action==='export-local'){download({format:'street-admin-device-backup-v2',exportedAt:new Date().toISOString(),records:await request(store('records').getAll()),outbox:await getPending(),cursor:await getMeta('cursor')},'street-admin-backup-aparelho.json');return;}
 if(action==='import-server'){
  const file=$('#backup-file')?.files?.[0],password=$('#backup-password')?.value||'';
  if(!file){toast('Selecione o arquivo JSON da loja.');return;}
  if(!password){toast('Informe a senha atual de administrador.');return;}
  try{
   if((await getPending()).length)throw Error('Sincronize ou resolva os lançamentos pendentes antes de restaurar um backup.');
   if(file.size>25*1024*1024)throw Error('Arquivo maior que 25 MB.');
   const data=JSON.parse(await file.text());
   if(!['street-admin-backup-dados-v5','street-admin-backup-portavel-v4','street-admin-backup-conta-v3','street-admin-backup-v1'].includes(data.format))
    throw Error('Selecione um backup da loja, não um backup offline do aparelho.');
   const payload={...data,restorePassword:password,confirmTargetShopName:session.shopName,confirmPhrase:'IMPORTAR DADOS'};
   const res=await apiFetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:typeof AbortSignal!=='undefined'&&AbortSignal.timeout?AbortSignal.timeout(60000):undefined});
   const result=await res.json();
   if(!res.ok)throw Error(result.error||'Não foi possível restaurar os dados.');
   await setMeta('cursor',0);
   $('#backup-password').value='';
   toast(`${result.imported} registro(s) importado(s); ${result.skipped} já existente(s). Loja preservada.`);
   await syncNow(true,60);await renderPage();
  }catch(e){toast(e.message||'Falha na restauração.');}
  return;

 }
}
async function askDelete(type,id){if(!can(EDIT[type])){toast('Sem permissão para excluir.');return;}deleteTarget={type,id};await confirmDelete();}
async function confirmDelete(){const x=deleteTarget;if(!x)return;deleteTarget=null;$('#confirm-modal').classList.remove('open');try{if(x.type==='product'){const all=await records();const used=ofType(all,'stockmove').some(m=>m.productId===x.id)||ofType(all,'sale').some(s=>Array.isArray(s.items)&&s.items.some(i=>i.productId===x.id));if(used){toast('Produto com histórico não pode ser excluído. Preserve as movimentações.');return;}}const old=await getRecord(x.type,x.id);if(!old)return;await saveBatch([{type:x.type,action:'delete',data:old}]);toast('Registro excluído.');}catch(e){console.error(e);toast('Erro ao excluir registro.');}}
function filterRows(value){const q=value.toLocaleLowerCase('pt-BR').trim();document.querySelectorAll('#content [data-searchable]').forEach(el=>{el.hidden=!el.textContent.toLocaleLowerCase('pt-BR').includes(q);});}
async function saveFinancePlan(ev){
 ev.preventDefault();if(!isOwner())return;
 const form=ev.target,values=Object.fromEntries(new FormData(form));
 for(const [key,val] of Object.entries(values))if(!Number.isFinite(Number(val))||Number(val)<0||Number(val)>(key.endsWith('Percent')?100:1e9)){toast('Revise os números do planejamento.');return;}
 const previous=ofType(await records(),'financeplan').find(x=>x.month===financeMonth)||{};
 const plan={...F.normalizePlan({...previous,...values}),month:financeMonth,id:financeMonth};
 const button=form.querySelector('[type="submit"]');button.disabled=true;
 try{await saveBatch([{type:'financeplan',data:plan}]);toast('Planejamento salvo e pronto para sincronizar.');}
 catch(e){console.error(e);toast(e.message||'Não foi possível salvar o planejamento.');button.disabled=false;}
}
async function saveReceiptShop(ev){
 ev.preventDefault();if(!isOwner())return toast('Somente o administrador pode editar os dados da loja.');
 const form=ev.target,raw=Object.fromEntries(new FormData(form));
 const cnpj=String(raw.cnpj||'').replace(/\D/g,'');
 if(cnpj&&cnpj.length!==14)return toast('CNPJ deve conter 14 números.');
 if(!String(raw.businessName||'').trim())return toast('Informe o nome da loja.');
 const data={id:'company',businessName:String(raw.businessName).trim().slice(0,100),cnpj,phone:String(raw.phone||'').trim().slice(0,35),address:String(raw.address||'').trim().slice(0,160),city:String(raw.city||'').trim().slice(0,90),email:String(raw.email||'').trim().slice(0,100)};
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{await saveBatch([{type:'shopprofile',data}],{refresh:false});toast('Dados do comprovante salvos; sincronize para compartilhar.');}
 catch(error){console.error(error);toast('Falha ao salvar: '+error.message);}
 finally{button.disabled=false;}
}
async function submitAccountForm(ev){
 ev.preventDefault();const form=ev.target,id=form.id;
 const values=Object.fromEntries(new FormData(form)),button=form.querySelector('[type="submit"]');button.disabled=true;
 try{
  const response=await apiFetch(id==='shop-form'?'/api/shop':'/api/auth/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Falha ao atualizar.');
  session={...session,...result};localStorage.setItem(SESSION_KEY,JSON.stringify(session));applyAccess();await renderPage();toast('Informações atualizadas.');
 }catch(e){toast(e.message||'Sem conexão com o servidor.');button.disabled=false;}
}
function onDocumentClick(ev){
 if(ev.target.closest('#shop-logo-remove')){shopLogoSelection++;shopLogoDraft='';shopLogoProcessing=false;const input=$('#shop-logo-input');if(input)input.value='';updateShopLogoPreview('Logo removida da prévia. Clique em Salvar logo para confirmar.');return;}
 if(ev.target.closest('#product-photo-remove')){productPhotoData='';photoSelectionId++;photoProcessing=false;const save=$('#form-save');if(save)save.disabled=false;const file=$('#product-photo-input');if(file)file.value='';updateProductPhotoPreview('Foto removida. O produto será salvo sem imagem.');return;}
 const saleCancel=ev.target.closest('[data-cancel-sale]');if(saleCancel){openCancelSale(saleCancel.dataset.cancelSale).catch(e=>toast(e.message||'Falha ao abrir cancelamento.'));return;}
 const staffDelete=ev.target.closest('[data-staff-delete]');if(staffDelete){const staff=staffCache.find(x=>x.id===staffDelete.dataset.staffDelete);if(staff)deleteStaff(staff).catch(e=>toast(e.message||'Erro ao excluir.'));return;}
 const promoEdit=ev.target.closest('[data-promo-edit]');if(promoEdit){getRecord('promotion',promoEdit.dataset.promoEdit).then(p=>p&&openForm('promotion',p)).catch(e=>toast(e.message));return;}
 const staffEdit=ev.target.closest('[data-staff-edit]');if(staffEdit){const staff=staffCache.find(x=>x.id===staffEdit.dataset.staffEdit);if(staff)openStaffForm(staff);return;}
 const reportChoice=ev.target.closest('[data-report-kind]');if(reportChoice){reportKind=reportChoice.dataset.reportKind;renderPage();return;}
 const go=ev.target.closest('[data-page]');if(go){goto(go.dataset.page);return;}
 const act=ev.target.closest('[data-action]');if(act){doAction(act.dataset.action).catch(e=>{console.error(e);toast('Ocorreu um erro. Tente novamente.');});return;}
 const entry=ev.target.closest('[data-entry]');if(entry){openForm('stockmove',{productId:entry.dataset.entry});return;}
 const edit=ev.target.closest('[data-edit]');if(edit){getRecord(edit.dataset.edit,edit.dataset.id).then(x=>x&&openForm(edit.dataset.edit,x));return;}
 const del=ev.target.closest('[data-delete]');if(del){askDelete(del.dataset.delete,del.dataset.id);return;}
 const discard=ev.target.closest('[data-discard]');if(discard){discardRejected(discard.dataset.discard,discard.dataset.id).catch(e=>toast(e.message));return;}
 const rec=ev.target.closest('[data-receipt]');if(rec){const printWindow=window.open('','_blank','width=430,height=660');getRecord('sale',rec.dataset.receipt).then(s=>s?receipt(s,printWindow):printWindow?.close()).catch(()=>printWindow?.close());return;}
 const add=ev.target.closest('[data-add-cart]');if(add){const p=registerProducts.find(x=>x.id===add.dataset.addCart);if(!p)return;const q=cart.get(p.id)||0;if(q>=p.available){toast('Não há mais unidades disponíveis.');return;}cart.set(p.id,q+1);refreshCart();return;}
 const adjust=ev.target.closest('[data-cart-change]');if(adjust){const id=adjust.dataset.id,p=registerProducts.find(x=>x.id===id),n=(cart.get(id)||0)+Number(adjust.dataset.cartChange);if(n<=0)cart.delete(id);else if(p&&n<=p.available)cart.set(id,n);else toast('Estoque insuficiente.');refreshCart();return;}
 const remove=ev.target.closest('[data-cart-remove]');if(remove){cart.delete(remove.dataset.cartRemove);refreshCart();}
}
function onInput(ev){
 const el=ev.target;
 if(el.id==='list-search'||el.id==='catalog-search')filterRows(el.value);
 if(el.id==='home-search'){homeSearchValue=el.value;filterHomeProducts();}
 if(el.id==='cash-received'){pos.received=el.value;refreshCart();}
 if(el.id==='cash-discount'){pos.discount=el.value;pos.promotionId='';const chosen=$('#cash-promotion');if(chosen)chosen.value='';refreshCart();}
 if(el.id==='cash-notes')pos.notes=el.value;
}
function onChange(ev){
 if(ev.target.id==='shop-logo-input'){onShopLogoFileChange(ev.target);return;}
 if(ev.target.id==='product-photo-input'){handleProductPhotoChange(ev.target);return;}
 if(ev.target.id==='finance-month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(ev.target.value)){financeMonth=ev.target.value;renderPage();}
 if(ev.target.id==='cash-promotion'){
  const selected=registerPromotions.find(p=>p.id===ev.target.value);pos.promotionId=selected?.id||'';
  if(selected){pos.discountType='percent';pos.discount=String(selected.percent);const kind=$('#cash-discount-type'),field=$('#cash-discount');if(kind)kind.value='percent';if(field){field.max='100';field.value=pos.discount;}toast('Promoção aplicada. Confira o alerta de margem.');}
  else{pos.discountType='money';pos.discount='0';const kind=$('#cash-discount-type'),field=$('#cash-discount');if(kind)kind.value='money';if(field){field.max='10000000';field.value='0';}}refreshCart();
 }
 if(ev.target.id==='cash-discount-type'){pos.promotionId='';const promo=$('#cash-promotion');if(promo)promo.value='';pos.discountType=ev.target.value==='percent'?'percent':'money';pos.discount='0';const field=$('#cash-discount');if(field){field.value='0';field.max=pos.discountType==='percent'?'100':'10000000';}refreshCart();}
 if(ev.target.id==='home-category'){homeCategory=ev.target.value;filterHomeProducts();}
 if(ev.target.id==='report-start'||ev.target.id==='report-end'){
  const start=ev.target.id==='report-start'?ev.target.value:reportStart;
  const end=ev.target.id==='report-end'?ev.target.value:reportEnd;
  if(start&&end&&start>end){toast('A data inicial não pode ser depois da data final.');ev.target.value=ev.target.id==='report-start'?reportStart:reportEnd;return;}
  reportStart=start;reportEnd=end;renderPage();
 }

 if(ev.target.id==='cash-payment'){pos.payment=ev.target.value;$('#received-field').hidden=pos.payment!=='Dinheiro';refreshCart();}
 if(ev.target.id==='cash-customer')pos.customerId=ev.target.value;
}

function messageAuth(text){const el=$('#auth-error');el.textContent=text;el.hidden=!text;}
function showAuth(){if(!session)showRememberedShopLogo();document.body.classList.add('locked');$('#auth-screen').hidden=false;}
function hideAuth(){document.body.classList.remove('locked');$('#auth-screen').hidden=true;}
function setAuthMode(mode){
 const register=mode==='register';
 $('#auth-register-fields').hidden=!register;
 $('#auth-submit').innerHTML=register?'Criar minha loja <span aria-hidden="true">↗</span>':'Entrar na plataforma <span aria-hidden="true">↗</span>';
 $('#auth-switch').textContent=register?'Já tenho conta — entrar':'Criar uma nova loja';
 const heading=$('#auth-heading');if(heading)heading.innerHTML=register?'Crie sua loja<span class="brand-dot">.</span>':'Bem-vindo ao seu espaço<span class="brand-dot">.</span>';
 const label=$('#auth-switch-label');if(label)label.textContent=register?'Já tem uma loja?':'Ainda não tem uma loja?';
 const subtitle=document.querySelector('.auth-subtitle');if(subtitle)subtitle.textContent=register?'Organize seu negócio e comece com tudo no mesmo lugar.':'Tudo pronto para continuar cuidando da sua loja.';
 $('#auth-password').setAttribute('autocomplete',register?'new-password':'current-password');
 $('#auth-screen').dataset.mode=mode;messageAuth('');
}
async function acceptSession(obj){
 if(db)db.close();
 session={...obj,role:obj.role||'owner',savedAt:obj.savedAt||Date.now()};
 // Cada loja tem o mesmo banco no servidor; o cache IndexedDB é separado por conta.
 DB_NAME='street-admin-shop-'+session.shopId+(session.role==='owner'?'':'-user-'+session.userId);
 localStorage.setItem(SESSION_KEY,JSON.stringify(session));
 db=await openDB();applyShopBranding(await getRecord('shopprofile','company'));hideAuth();
 applyAccess();goto(defaultPage());await syncNow(true);
}
async function loginWithForm(e){
 e.preventDefault();const button=$('#auth-submit');button.disabled=true;messageAuth('');
 try{
  const creating=$('#auth-screen').dataset.mode==='register';
  const email=$('#auth-email').value.trim(),password=$('#auth-password').value;
  const payload={email,password,...(creating?{shopName:$('#auth-shop').value.trim()}:{})};
  const response=await fetch('/api/auth/'+(creating?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const json=await response.json();if(!response.ok)throw Error(json.error||'Não foi possível entrar');
  $('#auth-password').value='';await acceptSession(json);
 }catch(e){messageAuth(e.message||'Erro de conexão. Precisa de internet para entrar pela primeira vez.');}
 finally{button.disabled=false;}
}
async function logout(){
 const current=session;
 if(syncPromise)await syncPromise;
 session=null;if(db){db.close();db=null;}cart.clear();
 localStorage.removeItem(SESSION_KEY);showAuth();setAuthMode('login');
 $('#content').innerHTML='<div class="page-loading">Entre para acessar a loja.</div>';
 if(current)fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+current.token}}).catch(()=>{});
}
async function restoreSession(){
 const raw=localStorage.getItem(SESSION_KEY);if(!raw)return;
 try{const saved=JSON.parse(raw);if(!saved.token||!saved.shopId||Date.now()-saved.savedAt>29*86400000)throw Error();await acceptSession(saved);}catch{localStorage.removeItem(SESSION_KEY);showAuth();}
}
async function init(){
 showAuth();
 // Public feature configuration is intentionally non-sensitive; if offline,
 // keep the registration entry hidden until the server can confirm it.
 const switchButton=document.querySelector('#auth-switch');
 const switchLabel=document.querySelector('#auth-switch-label');
 if(switchButton)switchButton.hidden=true;
 if(switchLabel)switchLabel.hidden=true;
 fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(7000)})
  .then(response=>response.ok?response.json():null)
  .then(settings=>{if(settings){if(switchButton)switchButton.hidden=!settings.registrationEnabled;if(switchLabel)switchLabel.hidden=!settings.registrationEnabled;}})
  .catch(()=>{});
 $('#device-label').textContent=/iPhone|iPad/i.test(navigator.userAgent)?'iPhone / iPad':'Windows / computador';
 $('#menu-toggle').onclick=()=>{const open=$('#sidebar').classList.toggle('open');document.body.classList.toggle('menu-open',open);$('#menu-toggle').setAttribute('aria-expanded',String(open));$('#menu-toggle').setAttribute('aria-label',open?'Fechar menu':'Abrir menu');};
 window.addEventListener('resize',()=>{if(window.innerWidth>820)closeMenu();});
 $('#sidebar-shade').onclick=closeMenu;
 $('#sidebar-close').onclick=closeMenu;
 $('#sync-now').onclick=()=>syncNow(false);
 $('#offline-retry').onclick=()=>syncNow(false);
 $('#modal-close').onclick=$('#modal-cancel').onclick=closeModal;
 $('#confirm-close').onclick=$('#confirm-cancel').onclick=()=>{$('#confirm-modal').classList.remove('open');deleteTarget=null;};
 $('#confirm-yes').onclick=confirmDelete;
 $('#record-form').addEventListener('submit',submitForm);
 document.addEventListener('click',onDocumentClick);
 document.addEventListener('submit',event=>{if(['cash-open-form','cash-edit-form','cash-close-form'].includes(event.target?.id))submitCashDayForm(event);else if(event.target?.id==='finance-config')saveFinancePlan(event);else if(['shop-form','profile-form'].includes(event.target?.id))submitAccountForm(event);else if(event.target?.id==='receipt-shop-form')saveReceiptShop(event);else if(event.target?.id==='pix-settings-form')savePixSettings(event);else if(event.target?.id==='shop-logo-form')submitShopLogo(event);});
 document.addEventListener('input',onInput);
 document.addEventListener('change',onChange);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
   if($('#confirm-modal').classList.contains('open')){
    $('#confirm-modal').classList.remove('open');deleteTarget=null;
    if(lastModalFocus?.isConnected)lastModalFocus.focus();lastModalFocus=null;
   }else if($('#modal').classList.contains('open'))closeModal();
   else closeMenu();
  }
  if(e.key==='Tab'){
   const dialog=document.querySelector('.modal-backdrop.open');
   if(!dialog)return;
   const choices=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')]
      .filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
   if(!choices.length){e.preventDefault();return;}
   const first=choices[0],last=choices.at(-1);
   if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus();}
  }
 });
 if('serviceWorker' in navigator && location.protocol!=='file:' && window.isSecureContext)navigator.serviceWorker.register('/sw.js?v=20261119-lhstreet2',{updateViaCache:'none'}).then(r=>r.update()).catch(e=>console.warn('Cache offline indisponível:',e));
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
 if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
 $('#auth-form').addEventListener('submit',loginWithForm);
 $('#auth-switch').addEventListener('click',()=>setAuthMode($('#auth-screen').dataset.mode==='register'?'login':'register'));
 $('#auth-password-toggle').addEventListener('click',()=>{
  const field=$('#auth-password'),button=$('#auth-password-toggle'),show=field.type==='password';
  field.type=show?'text':'password';button.textContent=show?'Ocultar':'Mostrar';
  button.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');
  button.setAttribute('aria-pressed',String(show));
 });
 $('#auth-year').textContent=String(new Date().getFullYear());
 financeMonth=localDate().slice(0,7);setAuthMode('login');await restoreSession();
 setInterval(()=>{if(session&&document.visibilityState==='visible'&&!$('#modal').classList.contains('open'))syncNow(true);},40000);
 window.addEventListener('online',()=>syncNow(true));
 window.addEventListener('offline',()=>{serverReachable=false;updateOfflineStatus(false).catch(()=>{});});
}
init().catch(e=>{console.error('Falha ao iniciar',e);$('#content').innerHTML='<div class="panel error-screen"><h2>Não foi possível iniciar os dados locais.</h2><p>Não limpe os dados do navegador. Verifique se o modo privado está desativado e abra o sistema novamente.</p></div>';});
