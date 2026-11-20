/* Street Admin - calculos financeiros em centavos, usados pela interface e pelos testes. */
'use strict';
(function (root, factory) {
 const value=factory();
 if(typeof module==='object'&&module.exports)module.exports=value;
 root.StreetFinance=value;
})(typeof globalThis==='object'?globalThis:this,function(){
 const cents=value=>Math.round(Number(value||0)*100);
 const finite=value=>Number.isFinite(Number(value))&&Number(value)>=0;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const defaultPlan={otherIncome:0,otherCost:0,reserve:0,takePercent:30,feePercent:0,minMarginPercent:25,taxPercent:0,overheadPercent:0,fixedPerItem:0,maxDiscountPercent:5,desiredSalary:0};
 function normalizePlan(plan={}){
  const clean={};
  for(const key of ['otherIncome','otherCost','reserve','fixedPerItem','desiredSalary'])clean[key]=finite(plan[key])?Math.max(0,Number(plan[key])):0;
  for(const key of ['takePercent','feePercent','minMarginPercent','taxPercent','overheadPercent','maxDiscountPercent'])clean[key]=finite(plan[key])?clamp(Number(plan[key]),0,100):defaultPlan[key];
  return clean;
 }
 function saleCost(sale,products=[]){
  const byId=new Map(products.map(p=>[p.id,p]));let cost=0,missing=0;
  for(const i of sale.items||[]){
   let price=i.cost;
   if(!finite(price)||Number(price)===0)price=byId.get(i.productId)?.cost;
   if(!finite(price)||Number(price)===0){missing+=Number(i.quantity)||1;continue;}
   cost+=cents(price)*Number(i.quantity||0);
  }
  if(!Array.isArray(sale.items)||!sale.items.length)missing+=1;
  return {cost,missing};
 }
 function monthly({sales=[],expenses=[],withdrawals=[],products=[],plan={}}={}){
  const cfg=normalizePlan(plan);
  sales=sales.filter(s=>s.status!=='cancelled');
  const revenue=sales.reduce((sum,x)=>sum+cents(x.total),0);
  const operating=expenses.reduce((sum,x)=>sum+cents(x.amount),0);
  const spent=withdrawals.reduce((sum,x)=>sum+cents(x.amount),0);
  const sold=sales.reduce((s,x)=>{const r=saleCost(x,products);return{cost:s.cost+r.cost,missing:s.missing+r.missing};},{cost:0,missing:0});
  const extras=cents(cfg.otherIncome),otherCost=cents(cfg.otherCost),reserve=cents(cfg.reserve);
  const fees=Math.round(revenue*(cfg.feePercent+cfg.taxPercent+cfg.overheadPercent)/100);
  const itemCount=sales.reduce((sum,s)=>sum+(s.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0),0);
  const fixedItemCost=cents(cfg.fixedPerItem)*itemCount;
  const profit=revenue-sold.cost-operating-fees-fixedItemCost+extras-otherCost;
  const capacity=Math.max(0,profit-reserve-spent);
  const pctLimit=Math.max(0,Math.floor(Math.max(0,profit)*cfg.takePercent/100)-spent);
  const canWithdraw=sold.missing>0?0:Math.min(capacity,pctLimit);
  return {revenue,cost:sold.cost,missingCost:sold.missing,operating,fees,fixedItemCost,extras,otherCost,profit,reserve,spent,canWithdraw,plan:cfg};
 }
 function discountRisk({lines=[],subtotal=0,discount=0,plan={}}={}){
  const cfg=normalizePlan(plan);let cost=0,missingCost=0,units=0;
  for(const line of lines){const c=line.product?.cost;const q=Number(line.quantity||0);units+=q;
   if(!finite(c)||Number(c)<=0){missingCost++;continue;}cost+=cents(c)*q;}
  const fixedCost=cents(cfg.fixedPerItem)*units;
  const rate=(cfg.feePercent+cfg.taxPercent+cfg.overheadPercent)/100;
  const total=Math.max(0,subtotal-discount),fees=Math.round(total*rate);
  const margin=total-cost-fixedCost-fees;
  const pct=total>0?100*margin/total:0;
  // Exigir custo conhecido, margem minima, limite de desconto e cobertura de custos extras.
  const threshold=cfg.minMarginPercent/100+rate;
  const minimumTotal=threshold>=1?Infinity:Math.ceil((cost+fixedCost)/(1-threshold));
  const byMargin=Math.max(0,subtotal-minimumTotal);
  const byPolicy=Math.floor(subtotal*cfg.maxDiscountPercent/100);
  const suggestedMax=!lines.length||missingCost||threshold>=1?null:Math.min(byMargin,byPolicy);
  let level='ok',message='Venda dentro dos limites configurados.';
  if(!lines.length){level='empty';message='Adicione produtos para avaliar o desconto.';}
  else if(discount>subtotal){level='danger';message='Desconto maior que o valor da venda.';}
  else if(missingCost){level='unknown';message='SEM DESCONTO RECOMENDADO: informe o custo de todos os produtos antes de avaliar a venda.';}
  else if(margin<0){level='danger';message='PREJUÍZO estimado: o valor não cobre mercadorias, impostos, taxas e custos adicionais.';}
  else if(suggestedMax===0&&discount>0){level='danger';message='Nenhum desconto é seguro com os custos e a margem configurados.';}
  else if(discount>suggestedMax){level='warning';message='Desconto acima do limite conservador configurado. Pode comprometer o lucro e a reposição do estoque.';}
  else if(discount>0){level='ok';message='Desconto dentro do limite conservador estimado, sujeito aos custos cadastrados.';}
  return {level,message,total,cost,fixedCost,fees,margin,marginPercent:pct,missingCost,suggestedMax};
 }

 return {cents,normalizePlan,saleCost,monthly,discountRisk};
});
