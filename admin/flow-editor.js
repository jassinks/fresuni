/* FRESUNI: editor de composição em grade. Apenas para a interface administrativa. */
(()=>{'use strict';
 const bridge=window.FRESUNI_EDITOR_BRIDGE;
 if(!bridge)return;
 const $=s=>document.querySelector(s);
 const zones='.directory-links,.card-grid,.directory-row,.home-opening,.home-directory,.prose,.page-article,.page-shell,.home-wrap,.home-values,.value-section,[data-fresuni-flow-grid]';
 const internal='[data-editor-internal],.sr-only,[data-fresuni-page-meta],.breadcrumbs';
 let enabled=true,handle=null,drag=null,doc=null;
 function children(z){return [...z.children].filter(x=>!x.matches(internal));}
 function sourceFor(el){
  if(!el||!el.isConnected||!el.closest('.site-page:not([hidden])')||el.closest(internal))return null;
  const z=el.closest(zones);if(!z)return null;
  let n=el;while(n.parentElement&&n.parentElement!==z)n=n.parentElement;
  return n.parentElement===z&&!n.matches(internal)?n:null;
 }
 function setSpan(el,n){
  const v=Math.max(2,Math.min(12,Math.round(Number(n)||12)));
  el.dataset.fresuniFlowSpan=String(v);
  el.style.setProperty('--fresuni-flow-span',String(v));
  el.style.minWidth='0';
  return v;
 }
 function activate(zone,moved,near,was){
  zone.classList.add('fresuni-flow-grid');zone.dataset.fresuniFlowGrid='';
  const all=children(zone);
  if(was){if(!moved.dataset.fresuniFlowSpan)setSpan(moved,6);return;}
  if(zone.matches('.directory-links,.card-grid')){
   const width=all.length<=4?Math.max(2,Math.floor(12/Math.max(1,all.length))):4;
   all.forEach(item=>setSpan(item,width));return;
  }
  if(zone.matches('.directory-row')){
   const h=all.find(x=>x.matches('h1,h2,h3,h4,h5,h6'));
   const links=all.find(x=>x.classList.contains('directory-links'));
   const extras=all.filter(x=>x!==h&&x!==links);
   if(h)setSpan(h,2);
   const left=12-(h?2:0);
   const linkWidth=links?Math.max(4,left-3*extras.length):0;
   if(links)setSpan(links,linkWidth);
   extras.forEach(x=>setSpan(x,Math.max(2,Math.floor((left-linkWidth)/extras.length))));
   return;
  }
  all.forEach(x=>setSpan(x,12));
  setSpan(moved,6);
  if(near&&near!==moved&&all.includes(near))setSpan(near,6);
 }
 function compatibleZone(el,src){
  let z=el?.closest?.(zones)||null;
  while(z&&(z===src||src.contains(z)))z=z.parentElement?.closest(zones)||null;
  return z&&z.closest('.site-page')===src.closest('.site-page')?z:null;
 }
 function hit(x,y,src){
  const el=doc?.elementFromPoint(x,y);if(!el)return null;
  const zone=compatibleZone(el,src);if(!zone)return null;
  let near=el;while(near&&near.parentElement!==zone)near=near.parentElement;
  if(!near||near===src||near.matches(internal))near=null;
  let before=null;
  if(near){
   const rect=near.getBoundingClientRect();
   const horizontal=zone.matches('.directory-links,.directory-row,.card-grid,.fresuni-flow-grid');
   const prior=horizontal?x<rect.left+rect.width/2:y<rect.top+rect.height/2;
   before=prior?near:near.nextSibling;
  }
  return {zone,near,before};
 }
 function hide(){if(handle)handle.hidden=true;}
 function position(){
  if(!handle||!handle.isConnected||drag)return;
  const el=enabled&&bridge.state.editable?sourceFor(bridge.state.selected):null;
  if(!el){hide();return;}
  const rect=el.getBoundingClientRect();
  if(!rect.width||!rect.height){hide();return;}
  const w=bridge.frame.contentWindow;
  handle.style.left=Math.max(6,rect.left+w.scrollX)+'px';
  handle.style.top=Math.max(4,rect.top+w.scrollY-33)+'px';
  handle.hidden=false;
  handle.title='Arraste para mover '+(el.textContent||el.tagName).trim().slice(0,80);
 }
 function clear(){
  drag?.drop?.zone?.removeAttribute('data-fresuni-drop-zone');
  drag=null;
  handle?.classList.remove('is-dragging');
  position();
 }
 function updateSlider(el){
  const slider=$('#fs-flow-span'),label=$('#fs-flow-span-label');if(!slider||!label)return;
  const item=sourceFor(el);
  const active=!!item?.parentElement?.classList.contains('fresuni-flow-grid');
  slider.disabled=!active;slider.value=active?Math.max(2,Math.min(12,Number(item.dataset.fresuniFlowSpan)||6)):6;
  label.textContent=active?'Largura: '+slider.value+' de 12 colunas. As outras caixas se encaixam.':'Arraste uma caixa pela alça ✥ para ativar o ajuste de colunas.';
 }
 function resize(item,span){
  const zone=item.parentElement;if(!zone?.classList.contains('fresuni-flow-grid'))return;
  const all=children(zone),n=Math.max(2,Math.min(12,span));
  setSpan(item,n);
  const others=all.filter(x=>x!==item);
  if(others.length&&n<12){
   const partner=others.find(x=>x===item.nextElementSibling)||others.find(x=>x===item.previousElementSibling)||others[0];
   if(partner)setSpan(partner,Math.max(2,12-n));
  }
 }
 function bind(newDoc){
  doc=newDoc;handle=null;drag=null;
  const style=doc.createElement('style');
  style.setAttribute('data-editor-internal','');
  style.textContent='.fresuni-flow-handle{position:absolute;z-index:999999;background:#8300ea;color:#fff;border:2px solid #fff;border-radius:8px;padding:4px 11px;font:600 12px Prompt,Arial,sans-serif;box-shadow:0 2px 12px #24003466;cursor:grab;touch-action:none}.fresuni-flow-handle.is-dragging{cursor:grabbing;opacity:.7}.fresuni-editor-flow-on [data-fresuni-drop-zone]{outline:3px dashed #8300ea!important;outline-offset:-3px;background-image:repeating-linear-gradient(90deg,rgba(131,0,234,.08) 0,rgba(131,0,234,.08) 1px,transparent 1px,transparent 8.333%)!important}.fresuni-editor-flow-on .fresuni-flow-grid{background-image:repeating-linear-gradient(90deg,rgba(131,0,234,.055) 0,rgba(131,0,234,.055) 1px,transparent 1px,transparent 8.333%)}';
  doc.head.append(style);
  const b=doc.createElement('button');b.type='button';b.className='fresuni-flow-handle';b.setAttribute('data-editor-internal','');b.setAttribute('aria-label','Mover caixa selecionada');b.textContent='✥ Mover';b.hidden=true;doc.body.append(b);handle=b;
  doc.body.classList.toggle('fresuni-editor-flow-on',enabled);
  const frameWindow=bridge.frame.contentWindow;
  frameWindow.addEventListener('scroll',position,{passive:true});
  frameWindow.addEventListener('resize',position,{passive:true});
  b.addEventListener('pointerdown',e=>{
   const src=sourceFor(bridge.state.selected);
   if(!enabled||!bridge.state.editable||!src)return;
   e.preventDefault();e.stopPropagation();
   drag={src,id:e.pointerId,drop:null};
   b.setPointerCapture(e.pointerId);b.classList.add('is-dragging');
  });
  b.addEventListener('pointermove',e=>{
   if(!drag||drag.id!==e.pointerId)return;
   const found=hit(e.clientX,e.clientY,drag.src);
   drag.drop?.zone?.removeAttribute('data-fresuni-drop-zone');
   drag.drop=found;
   if(found)found.zone.setAttribute('data-fresuni-drop-zone','');
  });
  b.addEventListener('pointerup',e=>{
   if(!drag||drag.id!==e.pointerId)return;
   const {src,drop}=drag;
   if(drop&&src.isConnected){
    const zone=drop.zone,near=drop.near,ref=drop.before?.parentElement===zone?drop.before:null;
    if(!src.contains(zone)&&(src.parentElement!==zone||src!==ref)){
     bridge.snapshot();
     const was=zone.classList.contains('fresuni-flow-grid');
     src.removeAttribute('draggable');src.removeAttribute('data-fresuni-drag');
     zone.insertBefore(src,ref);
     activate(zone,src,near,was);
     bridge.state.selected=null;
     bridge.clearSelection();bridge.selectElement(src);bridge.dirty();
     bridge.notify('Caixa reposicionada. Ajuste a largura das colunas ou mova outra caixa.');
    }
   }
   clear();
  });
  b.addEventListener('pointercancel',clear);
  position();
 }
 const btn=$('#fs-flow-toggle');
 btn?.addEventListener('click',()=>{
  enabled=!enabled;
  btn.classList.toggle('active',enabled);btn.setAttribute('aria-pressed',String(enabled));
  btn.textContent=enabled?'✥ Organizar caixas':'✥ Ativar organização';
  doc?.body?.classList.toggle('fresuni-editor-flow-on',enabled);
  if(!enabled)hide();else position();
  bridge.notify(enabled?'Selecione uma caixa e arraste pela alça ✥.':'Modo organizar desativado; textos continuam editáveis.');
 });
 $('#fs-flow-span')?.addEventListener('change',e=>{
  const item=sourceFor(bridge.state.selected);
  if(!item?.parentElement?.classList.contains('fresuni-flow-grid'))return;
  bridge.snapshot();resize(item,Number(e.target.value));bridge.dirty();updateSlider(bridge.state.selected);position();bridge.positionResizeGrip();
 });
 $('#fs-flow-equalize')?.addEventListener('click',()=>{
  const item=sourceFor(bridge.state.selected),zone=item?.parentElement;
  if(!zone?.classList.contains('fresuni-flow-grid')){bridge.notify('Selecione uma caixa da grade antes de distribuir.');return;}
  bridge.snapshot();const kids=children(zone),width=kids.length<=4?Math.max(2,Math.floor(12/kids.length)):4;
  kids.forEach(x=>setSpan(x,width));bridge.dirty();updateSlider(bridge.state.selected);bridge.notify('Larguras redistribuídas sem sobreposição.');
 });
 window.FRESUNI_FLOW_EDITOR={bind,onSelect(el){updateSlider(el);position();},onClear:hide,onRoute:position,onMode:position,sync:updateSlider};
})();