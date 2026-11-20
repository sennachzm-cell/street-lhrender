/* Street Admin — BR Code Pix estático. Sem API bancária ou serviço externo. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.StreetPix=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 function fail(s){throw Error(s);}
 function text(v,max,label){const s=String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 .\-]/g,' ').replace(/\s+/g,' ').trim();if(!s||s.length>max)fail(label+' deve ter de 1 a '+max+' caracteres (sem acentos).');return s;}
 function key(type,value){let k=String(value||'').trim();
  if(type==='cpf'){k=k.replace(/[.\-\s]/g,'');if(!/^\d{11}$/.test(k))fail('CPF Pix deve conter 11 números.');}
  else if(type==='cnpj'){k=k.replace(/[.\/\-\s]/g,'').toUpperCase();if(!/^[A-Z0-9]{12}\d{2}$/.test(k))fail('CNPJ Pix deve conter 14 caracteres, terminando em 2 números.');}
  else if(type==='email'){k=k.toLowerCase();if(!/^[\x21-\x7e]+$/.test(k)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)||k.length>77)fail('Informe um e-mail Pix válido (até 77 caracteres).');}
  else if(type==='phone'){k=k.replace(/[()\s\-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(k))fail('Use telefone com DDI, por exemplo +5566999999999.');}
  else if(type==='random'){k=k.toLowerCase();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(k))fail('Copie a chave aleatória completa do seu banco.');}
  else fail('Selecione o tipo da chave Pix.');return k;
 }
 function normalize(c){if(!c||typeof c!=='object'||Array.isArray(c))fail('Configuração Pix inválida.');if(c.enabled===false)return {enabled:false};return {enabled:true,keyType:c.keyType,key:key(c.keyType,c.key),name:text(c.name,25,'Nome do recebedor'),city:text(c.city,15,'Cidade')};}
 function tlv(id,value){value=String(value);if(value.length>99||/[^\x20-\x7e]/.test(value))fail('Campo Pix fora do padrão.');return id+String(value.length).padStart(2,'0')+value;}
 function crc16(s){let crc=0xffff;for(let i=0;i<s.length;i++){crc^=s.charCodeAt(i)<<8;for(let b=0;b<8;b++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;}return crc.toString(16).toUpperCase().padStart(4,'0');}
 function payload(config,amountCents){const c=normalize(config);if(!c.enabled)fail('Configure a chave Pix da loja.');if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>99999999999)fail('O total para Pix deve ser maior que zero e estar dentro do limite.');
  const s=tlv('00','01')+tlv('26',tlv('00','br.gov.bcb.pix')+tlv('01',c.key))+tlv('52','0000')+tlv('53','986')+tlv('54',(amountCents/100).toFixed(2))+tlv('58','BR')+tlv('59',c.name)+tlv('60',c.city)+tlv('62',tlv('05','***'))+'6304';return s+crc16(s);
 }
 return {normalize,key,crc16,payload};
});
