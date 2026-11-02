/* FRESUNI — arraste livre com encaixe responsivo e reorganização do conteúdo. */
(()=>{'use strict';
 const bridge=window.FRESUNI_EDITOR_BRIDGE;if(!bridge)return;
 const $=s=>document.querySelector(s);
 const ZONES='.directory-links,.card-grid,.home-opening,.home-directory,.home-values,.value-section,.page-heading,.prose,.page-article,.reading-layout,.directory-row,.page-shell,.home-wrap,[data-fresuni-flow-grid]';
 const LOCKED='[data-editor-internal],.breadcrumbs,.sr-only,.site-header,.site-footer,.fresuni-quick-add';
 let enabled=true,doc=null,handle=null,marker=null,ghost=null,drag=null,animation=0;
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 const visiblePage=()=>doc?.querySelector('main > .site-page:not([hidden])');
 const rootArea=page=>page?.querySelector('.home-wrap,.container.page-shell,.page-shell')||page;
 const children=parent=>[...parent.children].filter(el=>!el.matches('[data-editor-internal],.fresuni-quick-add,.sr-only'));
 function sourceFor(el){
  const page=visiblePage();
  if(!el?.isConnected||!page?.contains(el)||el.closest(LOCKED))return null;
  const metadata=el.closest('[data-fresuni-page-meta]');if(metadata)return metadata;
  const whole=el.closest('[data-fresuni-block],.fresuni-info-box,.content-card');
  if(whole&&page.contains(whole)&&!whole.closest(LOCKED))return whole;
  const zone=el.closest(ZONES);if(!zone)return null;
  let block=el;while(block.parentElement&&block.parentElement!==zone)block=block.parentElement;
  return block.parentElement===zone&&!block.matches(LOCKED)?block:null;
 }
 function zoneFor(hovered,src,outer){
  const page=visiblePage();if(!page||!src||!page.contains(src))return null;
  let zone=hovered?.closest?.(ZONES)||null;
  if(outer&&zone)zone=zone.parentElement?.closest(ZONES)||rootArea(page);
  while(zone&&(zone===src||src.contains(zone)))zone=zone.parentElement?.closest(ZONES)||null;
  if(!zone||!page.contains(zone))zone=rootArea(page);
  return zone&&page.contains(zone)&&zone!==src&&!src.contains(zone)?zone:null;
 }
 function span(node,n){
  const count=clamp(Math.round(Number(n)||12),2,12);
  node.dataset.fresuniFlowSpan=String(count);
  node.style.setProperty('--fresuni-flow-span',String(count));
  node.style.minWidth='0';
 }
 function makeGrid(zone){
  if(zone.hasAttribute('data-fresuni-flow-grid'))return;
  zone.classList.add('fresuni-flow-grid');zone.dataset.fresuniFlowGrid='';
  const parts=children(zone);
  if(zone.matches('.directory-row')){
   const heading=parts.find(el=>el.matches('h1,h2,h3,h4,h5,h6'));
   const links=parts.find(el=>el.classList.contains('directory-links'));
   if(heading)span(heading,2);if(links)span(links,10);
   parts.filter(el=>el!==heading&&el!==links).forEach(el=>span(el,12));
  }else if(zone.matches('.directory-links,.card-grid')){
   parts.forEach(el=>span(el,zone.matches('.directory-links')?4:6));
  }else parts.forEach(el=>span(el,12));
 }
 function hit(x,y,outer=false){
  if(!drag||!doc)return null;
  const src=drag.source,page=visiblePage();if(!page)return null;
  // Use all layers under the cursor. The helper controls themselves never become targets.
  const hovered=doc.elementsFromPoint(x,y).find(el=>el!==handle&&el!==marker&&el!==ghost&&!el.closest?.('[data-editor-internal]')&&!src.contains(el));
  const zone=zoneFor(hovered,src,outer);if(!zone)return null;
  const parts=children(zone).filter(el=>el!==src&&el.getBoundingClientRect().height>0);
  let near=null,position='bottom',side=false;
  if(parts.length){
   const closest=parts.map(el=>{
    const r=el.getBoundingClientRect();
    const vertical=y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;
    const horizontal=x<r.left?r.left-x:x>r.right?x-r.right:0;
    return {el,r,score:vertical*2+horizontal*.35};
   }).sort((a,b)=>a.score-b.score)[0];
   near=closest.el;const r=closest.r;
   const center=y>r.top+r.height*.28&&y<r.bottom-r.height*.28;
   const fits=zone.getBoundingClientRect().width>=430&&r.width>=185;
   if(fits&&center&&x<r.left+r.width*.3){position='left';side=true;}
   else if(fits&&center&&x>r.right-r.width*.3){position='right';side=true;}
   else position=y<r.top+r.height/2?'top':'bottom';
  }
  let before=near&&['top','left'].includes(position)?near:near?.nextSibling||null;
  const breadcrumb=zone.querySelector(':scope > .breadcrumbs');
  if(breadcrumb&&(before===breadcrumb||(near===breadcrumb&&position==='bottom')))before=breadcrumb.nextSibling;
  if(before?.parentElement!==zone)before=null;
  return {zone,near,position,side,before};
 }
 function draw(drop){
  if(!marker||!drag)return;
  if(drag.lastZone&&drag.lastZone!==drop?.zone)drag.lastZone.removeAttribute('data-fresuni-drop-zone');
  if(!drop){marker.hidden=true;return;}
  drag.lastZone=drop.zone;drop.zone.dataset.fresuniDropZone='';
  const r=drop.near?.getBoundingClientRect()||drop.zone.getBoundingClientRect();
  const side=drop.side;
  marker.hidden=false;
  marker.style.left=(side?(drop.position==='left'?r.left:r.right):r.left+4)+'px';
  marker.style.top=(side?r.top+4:(drop.position==='top'?r.top:r.bottom))+'px';
  marker.style.width=(side?4:Math.max(45,r.width-8))+'px';
  marker.style.height=(side?Math.max(35,r.height-8):4)+'px';
 }
 function update(x,y,outer=false){
  if(!drag)return;
  drag.x=x;drag.y=y;drag.outer=outer;
  if(ghost){
   const width=doc.documentElement.clientWidth,height=doc.documentElement.clientHeight;
   ghost.hidden=false;ghost.style.left=clamp(x+13,4,Math.max(4,width-215))+'px';
   ghost.style.top=clamp(y+12,4,Math.max(4,height-49))+'px';
  }
  drag.drop=hit(x,y,outer);draw(drag.drop);
 }
 function scrollStep(){
  if(!drag){animation=0;return;}
  const height=bridge.frame.contentWindow.innerHeight,y=drag.y;
  const speed=y<70?-Math.ceil((70-y)/3):y>height-78?Math.ceil((y-height+78)/3):0;
  if(speed){
   bridge.frame.contentWindow.scrollBy(0,clamp(speed,-28,28));
   update(drag.x,drag.y,drag.outer);
  }
  animation=bridge.frame.contentWindow.requestAnimationFrame(scrollStep);
 }
 function hide(){if(handle)handle.hidden=true;}
 function positionHandle(){
  if(!handle||drag)return;
  const item=enabled&&bridge.editable?sourceFor(bridge.selected):null;
  if(!item){hide();return;}
  const r=item.getBoundingClientRect();if(r.width<2||r.height<2){hide();return;}
  const win=bridge.frame.contentWindow;
  handle.style.left=Math.max(4,r.left+win.scrollX)+'px';
  handle.style.top=Math.max(4,r.top+win.scrollY-32)+'px';
  handle.hidden=false;handle.title='Arrastar '+(item.textContent||item.tagName).trim().slice(0,90);
 }
 function stop(){
  if(animation)bridge.frame.contentWindow.cancelAnimationFrame(animation);animation=0;
  drag?.lastZone?.removeAttribute('data-fresuni-drop-zone');
  if(ghost)ghost.hidden=true;if(marker)marker.hidden=true;
  if(handle){handle.classList.remove('is-dragging');handle.style.pointerEvents='';}
  drag=null;positionHandle();
 }
 function finishDrop(src,drop){
  if(!drop||!src?.isConnected)return false;
  const {zone,near,before,side}=drop;
  if(!zone||src===zone||src.contains(zone)||src.closest('.site-page')!==zone.closest('.site-page'))return false;
  if(src.parentElement===zone&&(before===src||before===src.nextSibling)&&!side)return false;
  bridge.snapshot();
  zone.insertBefore(src,before===src?src.nextSibling:before);
  makeGrid(zone);
  if(side&&near&&near!==src&&near.parentElement===zone){span(src,6);span(near,6);}
  else if(!src.dataset.fresuniFlowSpan)span(src,zone.matches('.directory-links')?4:zone.matches('.card-grid')?6:12);
  src.removeAttribute('draggable');src.removeAttribute('data-fresuni-drag');
  bridge.selected=null;bridge.clearSelection();bridge.selectElement(src);bridge.dirty();
  bridge.notify(side?'Encaixado lado a lado; as caixas se reorganizam sem sobreposição.':'Bloco encaixado na posição escolhida; os demais elementos se reorganizam.');
  return true;
 }
 function sync(el){
  const slider=$('#fs-flow-span'),label=$('#fs-flow-span-label');if(!slider)return;
  const node=sourceFor(el),active=!!node?.parentElement?.hasAttribute('data-fresuni-flow-grid');
  slider.disabled=!active;slider.value=active?clamp(+node.dataset.fresuniFlowSpan||12,2,12):12;
  label.textContent=active?'Largura: '+slider.value+' de 12 colunas. Os elementos vizinhos se acomodam.':'Arraste um bloco para uma grade. Em seguida, ajuste a largura de suas colunas.';
 }
 function insertionSpot(page,selected,placement='after'){
  if(!page)return null;
  const root=rootArea(page),block=sourceFor(selected);
  if((placement==='before'||placement==='after')&&block&&page.contains(block)){
   if(block.parentElement===page&&block.matches('[data-fresuni-page-meta]'))return {parent:root,before:placement==='before'?root.firstElementChild:null};
   return {parent:block.parentElement,before:placement==='before'?block:block.nextSibling};
  }
  if(placement==='top'){
   const breadcrumbs=root.querySelector(':scope > .breadcrumbs');
   return {parent:root,before:breadcrumbs?breadcrumbs.nextSibling:root.firstElementChild};
  }
  if(placement==='bottom'){
   const returnNav=root.querySelector(':scope > .return-links');
   return {parent:root,before:returnNav||null};
  }
  const article=root.querySelector('.prose.page-article,.reading-layout > .prose');
  return article?{parent:article,before:null}:{parent:root,before:null};
 }
 function bind(newDoc){
  doc=newDoc;handle=null;marker=null;ghost=null;drag=null;
  const style=doc.createElement('style');style.dataset.editorInternal='';
  style.textContent=
   '.fresuni-flow-handle{position:absolute;z-index:2147483000;background:#8300ea;color:white;border:2px solid #fff;border-radius:7px;padding:5px 12px;font:700 12px Prompt,Arial,sans-serif;box-shadow:0 3px 14px #35005666;cursor:grab;touch-action:none;user-select:none}' +
   '.fresuni-flow-handle.is-dragging{cursor:grabbing;opacity:.8}' +
   '.fresuni-flow-drop-line{position:fixed;z-index:2147483001;background:#8300ea;box-shadow:0 0 0 2px #fff,0 0 0 4px #8300ea;pointer-events:none;border-radius:5px}' +
   '.fresuni-flow-drag-ghost{position:fixed;z-index:2147483002;width:190px;max-width:50vw;padding:9px 12px;border:1px solid #8300ea;border-radius:8px;background:#fff;color:#340050;font:600 12px/1.35 Prompt,Arial,sans-serif;box-shadow:0 7px 25px #23003935;pointer-events:none;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}' +
   '.fresuni-editor-flow-on [data-fresuni-drop-zone]{outline:3px dashed #8300ea!important;outline-offset:2px;background-image:repeating-linear-gradient(90deg,rgba(131,0,234,.07) 0,rgba(131,0,234,.07) 1px,transparent 1px,transparent 8.333%)!important}' +
   '.fresuni-editor-flow-on .fresuni-flow-grid{background-image:repeating-linear-gradient(90deg,rgba(131,0,234,.04) 0,rgba(131,0,234,.04) 1px,transparent 1px,transparent 8.333%)}';
  doc.head.append(style);
  handle=doc.createElement('button');handle.type='button';handle.dataset.editorInternal='';handle.className='fresuni-flow-handle';handle.textContent='✥ Arrastar';handle.hidden=true;handle.setAttribute('aria-label','Mover bloco selecionado para qualquer posição nesta página');
  marker=doc.createElement('div');marker.dataset.editorInternal='';marker.className='fresuni-flow-drop-line';marker.hidden=true;
  ghost=doc.createElement('div');ghost.dataset.editorInternal='';ghost.className='fresuni-flow-drag-ghost';ghost.hidden=true;
  doc.body.append(handle,marker,ghost);doc.body.classList.toggle('fresuni-editor-flow-on',enabled);
  const win=bridge.frame.contentWindow;
  win.addEventListener('scroll',positionHandle,{passive:true});
  win.addEventListener('resize',positionHandle,{passive:true});
  handle.addEventListener('pointerdown',e=>{
   const source=sourceFor(bridge.selected);if(!enabled||!bridge.editable||!source)return;
   e.preventDefault();e.stopPropagation();
   drag={source,id:e.pointerId,drop:null,lastZone:null,x:e.clientX,y:e.clientY,outer:false};
   ghost.textContent=(source.textContent||source.tagName).trim().slice(0,95)||'Bloco selecionado';
   handle.setPointerCapture(e.pointerId);handle.classList.add('is-dragging');handle.style.pointerEvents='none';
   update(e.clientX,e.clientY,e.shiftKey);
   animation=win.requestAnimationFrame(scrollStep);
  });
  handle.addEventListener('pointermove',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   e.preventDefault();update(e.clientX,e.clientY,e.shiftKey);
  });
  handle.addEventListener('pointerup',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const {source,drop}=drag;
   try{if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);}catch{}
   stop();
   if(!finishDrop(source,drop))bridge.notify('Passe sobre uma região da página e solte onde aparecer o indicador de encaixe.');
  });
  handle.addEventListener('pointercancel',stop);
  positionHandle();
 }
 const toggle=$('#fs-flow-toggle');
 toggle?.addEventListener('click',()=>{
  enabled=!enabled;
  toggle.classList.toggle('active',enabled);toggle.setAttribute('aria-pressed',String(enabled));
  toggle.textContent=enabled?'✥ Organizar caixas':'✥ Ativar organização';
  doc?.body?.classList.toggle('fresuni-editor-flow-on',enabled);
  positionHandle();if(!enabled)hide();
  bridge.notify(enabled?'Selecione um bloco e arraste. Segure Shift para encaixar na seção externa.':'Organização desativada. Os textos permanecem editáveis.');
 });
 $('#fs-flow-span')?.addEventListener('change',e=>{
  const block=sourceFor(bridge.selected),zone=block?.parentElement;
  if(!zone?.hasAttribute('data-fresuni-flow-grid'))return;
  bridge.snapshot();span(block,Number(e.target.value));bridge.dirty();sync(bridge.selected);positionHandle();bridge.positionResizeGrip();
 });
 $('#fs-flow-equalize')?.addEventListener('click',()=>{
  const block=sourceFor(bridge.selected),zone=block?.parentElement;
  if(!zone?.hasAttribute('data-fresuni-flow-grid')){bridge.notify('Selecione um bloco dentro de uma grade.');return;}
  const blocks=children(zone),width=blocks.length<=4?clamp(Math.floor(12/blocks.length),2,12):4;
  bridge.snapshot();blocks.forEach(el=>span(el,width));bridge.dirty();sync(bridge.selected);
  bridge.notify('Blocos distribuídos na grade sem sobreposição.');
 });

 function moveEdge(edge){
  const src=sourceFor(bridge.selected),page=visiblePage();
  if(!src||!page){bridge.notify('Selecione primeiro uma caixa ou texto da página.');return;}
  const root=rootArea(page);
  if(src===root||src.contains(root)){bridge.notify('Selecione uma caixa ou texto, não a página inteira.');return;}
  const breadcrumb=root.querySelector(':scope > .breadcrumbs');
  const returnNav=root.querySelector(':scope > .return-links');
  let target=edge==='top'?(breadcrumb?breadcrumb.nextSibling:root.firstElementChild):(returnNav||null);
  if(target===src)target=src.nextSibling;
  if(src.parentElement===root&&(edge==='top'&&src===target||edge==='bottom'&&src.nextSibling===target))return;
  bridge.snapshot();root.insertBefore(src,target);makeGrid(root);span(src,12);
  bridge.selected=null;bridge.clearSelection();bridge.selectElement(src);bridge.dirty();
  src.scrollIntoView({behavior:'smooth',block:'center'});
  bridge.notify(edge==='top'?'Bloco movido para a parte superior da página.':'Bloco movido para a parte inferior da página.');
 }
 $('#fs-move-page-top')?.addEventListener('click',()=>moveEdge('top'));
 $('#fs-move-page-bottom')?.addEventListener('click',()=>moveEdge('bottom'));
 window.FRESUNI_FLOW_EDITOR={bind,insertionSpot,onSelect(el){sync(el);positionHandle();},onClear:hide,onRoute:positionHandle,onMode:positionHandle,sync};
})();