/* UI Pix: estado do carrinho continua pertencendo ao app.js. */
let registerPixConfig=null;
function pixSettingsHtml(profile){
 const c=profile?.pix||{};
 const types=[['random','Chave aleatória'],['cpf','CPF'],['cnpj','CNPJ'],['email','E-mail'],['phone','Telefone com DDI']];
 return `<section class="panel settings-card"><h3>Pix da loja</h3><p>Configure uma vez para usar no Windows, iPhone e Android conectados a esta loja.</p><form id="pix-settings-form"><label class="pix-enabled"><input name="enabled" type="checkbox" ${c.enabled?'checked':''}> Exibir QR Code ao selecionar Pix</label><div class="form-field"><label for="pix-key-type">Tipo de chave</label><select id="pix-key-type" name="keyType">${types.map(([v,label])=>`<option value="${v}" ${c.keyType===v?'selected':''}>${label}</option>`).join('')}</select></div><div class="form-field"><label for="pix-key">Chave Pix cadastrada no banco</label><input id="pix-key" name="key" maxlength="100" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(c.key||'')}" placeholder="Cole aqui a chave Pix da loja"></div><div class="form-field"><label for="pix-name">Nome do recebedor</label><input id="pix-name" name="name" maxlength="25" value="${esc(c.name||'')}" placeholder="Nome do titular da chave"><small>Até 25 caracteres. Confira o titular no aplicativo do banco.</small></div><div class="form-field"><label for="pix-city">Cidade do recebedor</label><input id="pix-city" name="city" maxlength="15" value="${esc(c.city||'')}" placeholder="Cidade, sem UF"><small>Até 15 caracteres. Acentos serão removidos.</small></div><button type="submit" class="primary">Salvar Pix da loja</button><p class="fine-print">O sistema verifica o formato da chave, mas não consulta seu cadastro no banco. Confira a chave e o titular antes de cobrar.</p></form></section>`;
}
async function savePixSettings(event){event.preventDefault();if(!isOwner())return toast('Apenas o administrador pode configurar o Pix.');const form=event.target,button=form.querySelector('[type="submit"]');button.disabled=true;
 try{const raw=Object.fromEntries(new FormData(form));const pix=StreetPix.normalize({...raw,enabled:form.elements.namedItem('enabled').checked});const previous=await getRecord('shopprofile','company');const data={businessName:session.shopName,cnpj:'',address:'',city:'',phone:'',email:'',...previous,id:'company',pix};await saveBatch([{type:'shopprofile',data}],{refresh:false});registerPixConfig=pix;form.querySelector('#pix-key').value=pix.key||'';form.querySelector('#pix-name').value=pix.name||'';form.querySelector('#pix-city').value=pix.city||'';window.StreetUpdate?.formSaved();toast('Pix salvo neste aparelho. A sincronização compartilha com os demais.');}
 catch(e){toast(e.message||'Não foi possível salvar o Pix.');}finally{button.disabled=false;}
}
function refreshPix(t){const box=$('#pix-checkout');if(!box)return;box.hidden=pos.payment!=='Pix';if(box.hidden){box.replaceChildren();return;}
 box.innerHTML='<h3>Pagar com Pix</h3>';
 const notice=message=>{const p=document.createElement('p');p.className='form-hint';p.textContent=message;box.appendChild(p);};
 if(!registerPixConfig?.enabled){notice(isOwner()?'Cadastre sua chave em Configurações → Pix da loja.':'Peça ao administrador para configurar a chave Pix da loja.');return;}
 if(!t.lines.length||t.total<=0||t.discount>t.subtotal||(pos.discountType==='percent'&&num(pos.discount)>100)){notice('Adicione produtos e confira o total para gerar o QR Code.');return;}
 try{const payload=StreetPix.payload(registerPixConfig,t.total),qr=qrcode(0,'M');qr.addData(payload,'Byte');qr.make();
 const wrapper=document.createElement('div');wrapper.className='pix-qr';wrapper.innerHTML=qr.createSvgTag({cellSize:6,margin:24,scalable:true});wrapper.querySelector('svg').setAttribute('role','img');wrapper.querySelector('svg').setAttribute('aria-label','QR Code Pix no valor de '+brl(t.total));box.appendChild(wrapper);
 const total=document.createElement('strong');total.className='pix-value';total.textContent=brl(t.total);box.appendChild(total);
 notice(registerPixConfig.name+' · '+registerPixConfig.city);
 const label=document.createElement('label');label.htmlFor='pix-copy-code';label.textContent='Pix Copia e Cola';box.appendChild(label);
 const area=document.createElement('textarea');area.id='pix-copy-code';area.readOnly=true;area.rows=3;area.value=payload;area.setAttribute('aria-label','Código Pix Copia e Cola');box.appendChild(area);
 const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='Copiar código Pix';copy.onclick=async()=>{try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(payload);else{area.focus();area.select();if(!document.execCommand('copy'))throw Error();}toast('Código Pix copiado.');}catch{area.focus();area.select();toast('Selecione e copie o código acima.');}};box.appendChild(copy);
 notice('O QR Code acompanha o total e o desconto. Confira o recebimento no banco antes de finalizar a venda.');
 }catch(e){notice(e.message||'Não foi possível gerar o QR Code.');}
}
