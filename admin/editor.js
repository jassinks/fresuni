/* FRESUNI Social — editor visual. Credenciais existem apenas no Cloudflare Worker. */
(()=>{'use strict';
const $=(s,root=document)=>root.querySelector(s);const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));
const worker=(window.FRESUNI_ADMIN_CONFIG?.apiUrl||'').replace(/\/$/,'');
const frame=$('#site-frame'),app=$('#app'),login=$('#login-screen');
const state={token:sessionStorage.getItem('fresuni:session')||'',html:'',sha:'',route:'/',selected:null,editable:true,dirty:false,loading:false,undo:[],redo:[],latest:'',lastFocus:null,restoring:false};
let tempPage='',toastTimer,historyTimer,draftTimer,dragged=null;
const DRAFT_KEY='jassinks/fresuni/index.html';
const motionCss=`@media(prefers-reduced-motion:no-preference){.js-motion [data-fresuni-motion]:not([data-fresuni-motion="none"]):not(.is-visible){opacity:0}.js-motion [data-fresuni-motion="slide"]:not(.is-visible){transform:translateY(24px)}.js-motion [data-fresuni-motion="zoom"]:not(.is-visible){transform:scale(.96)}.js-motion [data-fresuni-motion]:not([data-fresuni-motion="none"]){transition:opacity var(--fresuni-motion-duration,650ms) ease,transform var(--fresuni-motion-duration,650ms) ease}.js-motion [data-fresuni-motion].is-visible{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){[data-fresuni-motion]{opacity:1!important;transform:none!important;transition:none!important}}`;

const notify=(s)=>{const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3600);};
const setStatus=(t)=>{$('#save-state').textContent=t;};
const slug=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,70)||'pagina';
const safeUrl=s=>/^https:\/\//i.test(s)||/^#\/[a-z0-9\-/]*$/i.test(s)||/^mailto:/i.test(s);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){
 if(!worker)throw Error('O serviço de autenticação ainda não foi configurado. Abra admin/config.js e siga o guia.');
 const headers={'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{}),...options.headers};
 let response;try{response=await fetch(worker+path,{...options,headers,mode:'cors',cache:'no-store'});}catch{throw Error('Não foi possível conectar ao servidor de autenticação. Confira o endereço do Worker e as configurações CORS.');}
 let data;try{data=await response.json();}catch{throw Error('O servidor retornou uma resposta inválida.');}
 if(!response.ok)throw Object.assign(Error(data.error||'Erro de comunicação ('+response.status+').'),{status:response.status});return data;
}
function showLogin(msg=''){app.hidden=true;login.hidden=false;$('#login-error').textContent=msg;$('#setup-help').hidden=!!worker;sessionStorage.removeItem('fresuni:session');state.token='';}
function showApp(){login.hidden=true;app.hidden=false;}
async function loadSite(){
 state.loading=true;setStatus('Carregando o site…');
 try{
  const {html,sha}=await api('/source');
  if(!html.includes('data-route="/"'))throw Error('Arquivo diferente do site FRESUNI. Confira as configurações do repositório.');
  state.html=html;state.sha=sha;state.undo=[];state.redo=[];state.dirty=false;state.route='/';
  reloadFrame(html,'/');setStatus('Versão publicada carregada');await restoreDraftIfAny();
 }finally{state.loading=false;}
}
async function authenticated(){
 try{await loadSite();showApp();}
 catch(e){showLogin(e.message);}
}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('#login-submit');b.disabled=true;b.textContent='Verificando…';$('#login-error').textContent='';try{
 const data=await api('/login',{method:'POST',body:JSON.stringify({username:$('#admin-user').value.trim(),password:$('#admin-pass').value})});
 state.token=data.token;sessionStorage.setItem('fresuni:session',state.token);$('#admin-pass').value='';await loadSite();showApp();
}catch(err){$('#login-error').textContent=err.message;state.token='';sessionStorage.removeItem('fresuni:session');}finally{b.disabled=false;b.textContent='acessar o editor';}});
$('#show-pass').addEventListener('click',()=>{$('#admin-pass').type=$('#admin-pass').type==='password'?'text':'password';});
$('#logout').addEventListener('click',()=>showLogin('Você saiu do editor.'));
if(state.token && worker)authenticated();else showLogin();
function siteDoc(){return frame.contentDocument;}
function pageNodes(){const d=siteDoc();return d?$$('main > .site-page[data-route]',d):[];}
function pageFor(route){return pageNodes().find(p=>p.dataset.route===route);}
function selectedPage(){return pageFor(state.route);}
function groupFor(page){if(page.dataset.editorGroup)return page.dataset.editorGroup;const route=page.dataset.route||'/';if(route.startsWith('/noticias'))return 'noticias';if(route.startsWith('/artigos'))return 'artigos';if(route.startsWith('/acoes'))return 'acoes';if(route.startsWith('/manifesto'))return 'manifesto';if(route==='/filiacao'||route==='/estatuto')return 'principal';return 'inicio';}
function parentRouteOf(page){
 const route=page?.dataset.route||'/';if(route==='/')return '';
 const explicit=page.dataset.editorParent;if(explicit&&explicit!==route&&pageFor(explicit))return explicit;
 const tokens=route.split('/').filter(Boolean);
 while(tokens.length>1){tokens.pop();const candidate='/'+tokens.join('/');if(pageFor(candidate))return candidate;}
 return '/';
}
function labelPath(page){const parts=[];let p=page;const seen=new Set();while(p&&!seen.has(p.dataset.route)&&parts.length<12){seen.add(p.dataset.route);parts.unshift(titleOf(p));p=pageFor(parentRouteOf(p));}return parts.join(' › ');}
function depthOf(page){const path=page.dataset.route||'/';return path==='/'?0:Math.min(2,path.split('/').length-2);}
function titleOf(page){return page.dataset.title||$('h1',page)?.textContent.trim()||page.dataset.route;}
function dirty(){state.dirty=true;setStatus('Rascunho aguardando salvamento…');if(!state.restoring){clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft().catch(err=>notify('Não foi possível salvar o rascunho: '+err.message)),1500);}}
function openDraftDb(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(Error('O navegador não disponibiliza armazenamento local.'));const req=indexedDB.open('fresuni-editor-drafts-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('drafts');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function draftAction(mode,value){const db=await openDraftDb();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode==='get'?'readonly':'readwrite');const store=tx.objectStore('drafts');const req=mode==='get'?store.get(DRAFT_KEY):mode==='delete'?store.delete(DRAFT_KEY):store.put(value,DRAFT_KEY);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();});}
async function saveDraft(){if(!state.dirty||state.loading||state.restoring)return;const html=serialize();await draftAction('put',{html,sha:state.sha,savedAt:Date.now(),route:state.route});setStatus('Rascunho salvo neste navegador · não publicado');}
async function restoreDraftIfAny(){let draft;try{draft=await draftAction('get');}catch(e){notify('Salvamento local indisponível: '+e.message);return;}if(!draft?.html||draft.html===state.html)return;
 const date=new Date(draft.savedAt).toLocaleString('pt-BR');const conflict=draft.sha!==state.sha;
 if(confirm('Encontramos um rascunho de '+date+'.'+(conflict?' O site foi publicado novamente desde então; revise antes de publicar.':'')+'\n\nRestaurar o trabalho que não foi publicado?')){
   state.restoring=true;state.undo=[];state.redo=[];state.dirty=true;reloadFrame(draft.html,draft.route&&draft.html.includes('data-route="'+draft.route+'"')?draft.route:'/');state.restoring=false;setStatus('Rascunho recuperado · não publicado');notify('Rascunho recuperado neste navegador.');
 }}

function remember(){const html=serialize();if(state.undo[state.undo.length-1]!==html){state.undo.push(html);if(state.undo.length>25)state.undo.shift();state.redo=[];}}
function selectRoute(route){
 if(!pageFor(route))return;
 state.route=route;state.selected=null;clearSelection();
 try{frame.contentWindow.location.hash='#'+route;}catch{}
 const pages=pageNodes();pages.forEach(p=>{p.hidden=p.dataset.route!==route;});
 const d=siteDoc();if(d){d.body.classList.toggle('homepage',route==='/');d.title=titleOf(pageFor(route))+' | FRESUNI';}
 $('#current-page-title').textContent=titleOf(pageFor(route));$('#current-route').textContent='#'+route;
 updatePageSidebar();renderPages();
 const win=frame.contentWindow;try{win.scrollTo(0,0);}catch{}
}
function reloadFrame(html,route=state.route){
 state.selected=null;state.route=route;
 // Google Fonts can block the embedded document parser on slow networks.
 // Load them asynchronously in the editing preview, restoring the regular link when publishing.
 const fonts=[];
 const previewHtml=html.replace(/<link\b[^>]*>/gi,tag=>{
   if(!tag.includes('fonts.googleapis.com')||!tag.includes('stylesheet'))return tag;
   const href=tag.match(/href=["']([^"']+)["']/i)?.[1];
   if(href)fonts.push(href.replace(/&amp;/g,'&'));
   return '';
 });
 const previousDoc=siteDoc();let initialized=false;
 const init=()=>{
  if(initialized)return;
  const current=siteDoc();
  if(!current||current===previousDoc||!current.querySelector('main > .site-page[data-route]'))return;
  initialized=true;clearInterval(poll);

  const d=siteDoc();if(!d)return;
  fonts.forEach(href=>{const link=d.createElement('link');link.rel='stylesheet';link.media='print';link.href=href;link.dataset.fresuniAsyncFont='';link.addEventListener('load',()=>{link.media='all';});d.head.append(link);});
  let effects=d.getElementById('fresuni-extra-effects');if(!effects){effects=d.createElement('style');effects.id='fresuni-extra-effects';d.head.append(effects);}effects.textContent=motionCss;
  const style=d.createElement('style');style.id='fresuni-editor-overlay';style.textContent=`
   [data-fresuni-editable="true"]{cursor:text;min-width:10px;min-height:1em;border-radius:2px;outline:1px solid transparent;outline-offset:3px;}
   [data-fresuni-editable="true"]:hover{outline:1px dashed #af65ed}
   [data-fresuni-selected]{outline:3px solid #8300ea!important;outline-offset:4px;position:relative}
   [data-fresuni-selected]::selection{background:#e2bbff}
   .fresuni-resize-grip{position:absolute;z-index:99999;width:19px;height:19px;border-radius:6px;background:#8300ea;border:3px solid white;box-shadow:0 0 0 2px #8300ea,0 2px 9px #3335;cursor:nwse-resize;touch-action:none}
   .fresuni-resize-grip:focus-visible{outline:3px solid #333;outline-offset:4px}
   .fresuni-resize-label{position:absolute;z-index:99998;background:#2d0c4f;color:white;font:12px Prompt,Arial,sans-serif;padding:3px 8px;border-radius:5px;pointer-events:none}
   body{scroll-behavior:auto!important}
   [data-reveal]{opacity:1!important;transform:none!important;visibility:visible!important}
   @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}`;
  d.head.append(style);
  for(const p of pageNodes())p.dataset.editorGroup=groupFor(p);
  d.addEventListener('click',clickSite,true);
  d.addEventListener('focusin',e=>{if(e.target?.isContentEditable&&state.editable)remember();},true);
  bindDrag(d);setupResizeGrip(d);
  d.addEventListener('input',e=>{if(e.target?.isContentEditable){dirty();requestAnimationFrame(positionResizeGrip);}});
  d.addEventListener('focusout',e=>{if(e.target?.isContentEditable){dirty();}},true);
  $$('a',d).forEach(a=>{if(a.target==='_blank')a.rel='noopener noreferrer';});
  selectRoute(route);setEditable(state.editable);
 };
 frame.onload=init;
 frame.srcdoc=previewHtml;
 const poll=setInterval(()=>{
  const d=siteDoc();if(d && d!==previousDoc && d.querySelector('main > .site-page[data-route]')){
    // A página pode continuar carregando fontes e embeds externos; não esperamos por eles.
    init();
  }
 },150);
 setTimeout(()=>{if(!initialized){clearInterval(poll);notify('A prévia não terminou de carregar. Tente selecionar outra página.');}},25000);
}
function setEditable(on){state.editable=on;$('#preview').setAttribute('aria-pressed',String(!on));$('#preview').textContent=on?'◉ Pré-visualizar':'✎ Voltar à edição';
 const d=siteDoc();if(!d)return;
 const selectors='p,h1,h2,h3,h4,h5,h6,li,summary,blockquote,cite,.card-eyebrow,.card-action,.eyebrow';
 $$(selectors,d).forEach(el=>{
  if(el.closest('header.site-header,.access-panel,.site-footer,.nav-group,.breadcrumbs'))return;
  if(el.closest('iframe'))return;
  // Only visible page; all stored page content gets editable again when selected.
  if(on){el.setAttribute('contenteditable','true');el.dataset.fresuniEditable='true';el.setAttribute('spellcheck','true');}
  else{el.removeAttribute('contenteditable');delete el.dataset.fresuniEditable;}
 });
}
function clickSite(e){
 if(!state.editable)return;
 if(e.target.closest('a,button,summary'))e.preventDefault();
 const summary=e.target.closest('summary');if(summary&&summary.parentElement?.tagName==='DETAILS')summary.parentElement.open=!summary.parentElement.open;
 if(e.target.closest('header.site-header,.site-footer,.access-panel')){e.stopPropagation();return;}
 let el=e.target.closest('p,h1,h2,h3,h4,h5,h6,li,summary,blockquote,cite,img,iframe,a,figure,details,hr,[data-fresuni-block]');
 if(!el||!el.closest('.site-page'))return;
 if(el.closest('.breadcrumbs'))return;
 if(el.closest('[data-fresuni-block="shape"]') && !el.isContentEditable)el=el.closest('[data-fresuni-block="shape"]');
 selectElement(el);
}
function clearSelection(){const d=siteDoc();if(d)$$('[data-fresuni-selected]',d).forEach(x=>x.removeAttribute('data-fresuni-selected'));state.selected=null;hideResizeGrip();$('#selection-name').textContent='Selecione um texto, uma imagem ou um bloco na página.';$('#selection-props').hidden=true;}
function selectElement(el){if(state.selected===el)return;clearSelection();state.selected=el;el.dataset.fresuniSelected='';const blk=el.closest('[data-fresuni-block]');if(blk){blk.draggable=true;blk.dataset.fresuniDrag='';}
 $('#selection-name').textContent=(el.tagName.toLowerCase())+' · '+(el.textContent.trim().slice(0,48)||'elemento visual');$('#selection-props').hidden=false;
 const target=el.matches('img,iframe,a')?el:el.querySelector('img,iframe,a');
 $('#element-url').value=target?.getAttribute('src')?.startsWith('data:')?'':(target?.getAttribute('href')||target?.getAttribute('src')||'');
 $('#element-alt').value=el.matches('img')?el.alt:(el.querySelector('img')?.alt||'');
 $('#font-size').value=Math.round(parseFloat(frame.contentWindow.getComputedStyle(el).fontSize))||16;
 $('#background-color').value=toHex(frame.contentWindow.getComputedStyle(el).backgroundColor,'#ffffff');
 $('#text-color').value=toHex(frame.contentWindow.getComputedStyle(el).color,'#000000');
 const cs=frame.contentWindow.getComputedStyle(el);$('#font-family').value=cs.fontFamily.toLowerCase().includes('merriweather')?'Merriweather':'Prompt';$('#text-preset').value='custom';
 $('#element-width').value=Math.max(10,Math.min(100,Math.round(100*el.getBoundingClientRect().width/(el.parentElement?.getBoundingClientRect().width||el.getBoundingClientRect().width))));
 $('#element-height').value=parseInt(el.style.minHeight)||0;$('#corner-radius').value=parseInt(el.style.borderRadius)||0;$('#border-size').value=parseInt(el.style.borderWidth)||0;
 $('#border-color').value=toHex(cs.borderTopColor,'#8300ea');$('#block-motion').value=el.dataset.fresuniMotion||'none';$('#motion-time').value=parseInt(el.style.getPropertyValue('--fresuni-motion-duration'))||650;
 $('#shape-kind').value=el.dataset.fresuniShape||'box';
 positionResizeGrip();
}
let resizeGrip=null,resizeLabel=null,resizing=false,resizeRaf=0;
function positionResizeGrip(){if(!resizeGrip||!state.selected||!state.selected.isConnected||!state.editable||!state.selected.closest('.site-page:not([hidden])')){hideResizeGrip();return;}
 const el=state.selected,box=el.getBoundingClientRect(),d=siteDoc();const x=box.right+frame.contentWindow.scrollX,y=box.bottom+frame.contentWindow.scrollY;
 resizeGrip.hidden=false;resizeGrip.style.left=(x-10)+'px';resizeGrip.style.top=(y-10)+'px';
 resizeLabel.hidden=false;resizeLabel.style.left=Math.max(5,x-100)+'px';resizeLabel.style.top=(y+14)+'px';
 resizeLabel.textContent=Math.round(box.width)+' × '+Math.round(box.height)+' px';
}
function hideResizeGrip(){if(resizeGrip)resizeGrip.hidden=true;if(resizeLabel)resizeLabel.hidden=true;}
function setupResizeGrip(d){
 resizeGrip=d.createElement('button');resizeGrip.className='fresuni-resize-grip';resizeGrip.type='button';resizeGrip.title='Arraste para ajustar largura e altura do texto';resizeGrip.setAttribute('aria-label','Redimensionar bloco selecionado');resizeGrip.setAttribute('data-editor-internal','');
 resizeLabel=d.createElement('span');resizeLabel.className='fresuni-resize-label';resizeLabel.setAttribute('data-editor-internal','');resizeGrip.hidden=true;resizeLabel.hidden=true;d.body.append(resizeGrip,resizeLabel);
 const update=()=>{if(!resizing)positionResizeGrip();};frame.contentWindow.addEventListener('scroll',update,{passive:true});frame.contentWindow.addEventListener('resize',update,{passive:true});
 resizeGrip.addEventListener('pointerdown',e=>{if(!state.selected)return;e.preventDefault();e.stopPropagation();const el=state.selected;const r=el.getBoundingClientRect();const parent=el.parentElement?.getBoundingClientRect();const parentWidth=Math.max(160,parent?.width||r.width);snapshot();resizing={id:e.pointerId,el,sx:e.clientX,sy:e.clientY,w:r.width,h:r.height,max:parentWidth};resizeGrip.setPointerCapture(e.pointerId);});
 resizeGrip.addEventListener('pointermove',e=>{if(!resizing||e.pointerId!==resizing.id)return;e.preventDefault();const o=resizing;const w=Math.max(75,Math.min(o.max,o.w+e.clientX-o.sx));const h=Math.max(24,Math.min(1800,o.h+e.clientY-o.sy));o.el.style.boxSizing='border-box';o.el.style.display=o.el.matches('span,a')?'inline-block':o.el.style.display||'block';o.el.style.width=w+'px';o.el.style.maxWidth='100%';o.el.style.minHeight=h+'px';o.el.style.height='auto';o.el.style.overflowWrap='anywhere';$('#element-width').value=Math.max(10,Math.min(100,Math.round(w/o.max*100)));$('#element-height').value=Math.round(h);positionResizeGrip();dirty();});
 const stop=e=>{if(!resizing)return;resizing=false;positionResizeGrip();};resizeGrip.addEventListener('pointerup',stop);resizeGrip.addEventListener('pointercancel',stop);
}
function toHex(color,fallback){const m=color.match(/\d+/g);if(!m||m.length<3)return fallback;return '#'+m.slice(0,3).map(x=>Math.max(0,Math.min(255,+x)).toString(16).padStart(2,'0')).join('');}
function stripTransient(root){root.classList.remove('dark-mode','high-contrast','simple-mode','reduce-motion');
 $$('link[data-fresuni-async-font]',root).forEach(link=>{link.removeAttribute('data-fresuni-async-font');link.removeAttribute('media');});$$('#fresuni-editor-overlay',root).forEach(x=>x.remove());$$('[data-fresuni-selected]',root).forEach(x=>x.removeAttribute('data-fresuni-selected'));
 $$('[data-fresuni-editable]',root).forEach(x=>{x.removeAttribute('data-fresuni-editable');x.removeAttribute('contenteditable');x.removeAttribute('spellcheck');x.removeAttribute('draggable')});
 $$('[data-fresuni-drag]',root).forEach(x=>x.removeAttribute('data-fresuni-drag'));
 $$('main > .site-page',root).forEach(p=>{p.hidden=p.dataset.route!=='/';});
 root.querySelector('body')?.classList.add('homepage');
 const d=root.querySelector('title');if(d)d.textContent='Início | FRESUNI';
 root.querySelector('.main-nav')?.classList.remove('nav-open');
 $$('[data-editor-internal]',root).forEach(x=>x.remove());
}
function refreshSearch(root){const scripts=$$('script',root);const script=scripts.find(s=>s.textContent.includes('window.FRESUNI_SEARCH_INDEX='));if(!script)return;
 const match=script.textContent.match(/window\.FRESUNI_SEARCH_INDEX=(\[[^\n]*?\]);/);if(!match)return;
 let original;try{original=JSON.parse(match[1]);}catch{return;}
 const proposalItems=original.filter(x=>x.url?.startsWith('#meta-'));
 const pageEntries=$$('main > .site-page[data-route]',root).map(p=>({title:titleOf(p),description:p.textContent.trim().replace(/\s+/g,' ').slice(0,240),url:'#'+p.dataset.route,type:'Página'}));
 const rep='window.FRESUNI_SEARCH_INDEX='+JSON.stringify([...pageEntries,...proposalItems]).replace(/<\//g,'<\\/')+';';script.textContent=script.textContent.replace(match[0],rep);
}
function serialize(){const d=siteDoc();if(!d)return state.html;
 const root=d.documentElement.cloneNode(true);stripTransient(root);refreshSearch(root);
 const style=root.querySelector('#fresuni-extra-effects')||root.ownerDocument.createElement('style');style.id='fresuni-extra-effects';style.textContent=motionCss;
 if(!style.isConnected)root.querySelector('head').append(style);
 return '<!doctype html>\n'+root.outerHTML;
}
function snapshot(){remember();dirty();}
function insertionParent(){const p=selectedPage();if(!p)return null;const sel=state.selected;
 if(sel?.closest('.site-page')===p){let n=sel;
  if(n.matches('a,img,cite'))n=n.closest('figure,div,section,article,p,li')||n;
  if(n.matches('li')&&n.parentElement)n=n.parentElement;
  if(n===p)n=null;
  if(n)return {parent:n.parentNode,before:n.nextSibling};}
 const block=$('.prose',p)||$('.page-shell',p)||$('.home-wrap',p)||p;
 return {parent:block,before:null};
}
function insertHTML(html){if(!state.editable){notify('Volte ao modo de edição primeiro.');return;}
 snapshot();const d=siteDoc();const tpl=d.createElement('template');tpl.innerHTML=html;const first=tpl.content.firstElementChild;const dest=insertionParent();if(!dest)return;
 dest.parent.insertBefore(tpl.content,dest.before);setEditable(true);if(first)selectElement(first);dirty();
 first?.scrollIntoView({behavior:'smooth',block:'center'});
}
function actionInsert(type){const types={
 text:'<p data-fresuni-block="text">Escreva seu texto aqui. Clique para editar.</p>',
 heading:'<h2 data-fresuni-block="heading" style="font-family:Merriweather,serif;color:#8300ea">Novo título</h2>',
 button:'<p data-fresuni-block="button"><a class="editor-public-button" href="#/filiacao" style="display:inline-block;background:#8300ea;color:white;padding:12px 20px;border-radius:7px;text-decoration:none;font-weight:600">Clique aqui</a></p>',
 accordion:'<details data-fresuni-block="accordion" style="border-bottom:1px solid #ddd;padding:15px 0"><summary style="font-weight:700;cursor:pointer;color:#8300ea">Título do conteúdo recolhível</summary><p>Escreva o conteúdo que será mostrado ao abrir.</p></details>',
 more:'<details data-fresuni-block="more" style="margin:20px 0"><summary style="color:#8300ea;font-weight:600;cursor:pointer;list-style-position:inside">Leia mais…</summary><div style="padding:12px 15px"><p>Conteúdo completo. Clique para editar.</p></div></details>',
 box:'<div data-fresuni-block="shape" data-fresuni-shape="box" style="display:block;box-sizing:border-box;max-width:100%;width:100%;min-height:110px;padding:24px;border:2px solid #8300ea;background:#f4e8ff;border-radius:0"><h3 style="color:#8300ea">Título do quadro</h3><p>Texto dentro da forma, que pode ser editado.</p></div>',
 circle:'<div data-fresuni-block="shape" data-fresuni-shape="circle" style="box-sizing:border-box;max-width:100%;width:260px;min-height:260px;aspect-ratio:1;border-radius:50%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:34px;background:#e9d4ff;border:2px solid #8300ea;overflow-wrap:anywhere"><p>Seu texto dentro do círculo</p></div>',
 pill:'<div data-fresuni-block="shape" data-fresuni-shape="pill" style="box-sizing:border-box;max-width:100%;width:60%;min-height:60px;border-radius:100px;background:#8300ea;color:#fff;text-align:center;padding:16px 24px"><p style="color:inherit">Texto da etiqueta</p></div>',
 divider:'<hr data-fresuni-block="divider" style="border:0;border-top:1px solid #dfd3ec;margin:26px 0">',
 quote:'<blockquote data-fresuni-block="quote" style="border-left:4px solid #8300ea;margin:25px 0;padding:7px 18px"><p>Uma frase que representa o FRESUNI.</p></blockquote>',
 list:'<ul data-fresuni-block="list"><li>Primeiro item</li><li>Segundo item</li></ul>',
 image:'',embed:''};
 if(type==='image'){$('#upload-image').click();return;}
 if(type==='embed'){const url=prompt('Cole o endereço HTTPS a incorporar (ex.: vídeo do YouTube):','https://');if(!url)return;
  if(!/^https:\/\//i.test(url)){notify('Insira um link seguro começando com https://.');return;}
  let safe=url;try{const u=new URL(url);if(u.hostname==='www.youtube.com'&&u.pathname==='/watch')safe='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(u.searchParams.get('v')||'');else if(u.hostname==='youtu.be')safe='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(u.pathname.slice(1));}catch{};
  insertHTML(`<div data-fresuni-block="embed" style="max-width:900px;margin:25px auto"><iframe title="Conteúdo incorporado" loading="lazy" src="${escapeHTML(safe)}" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" referrerpolicy="no-referrer" style="width:100%;min-height:390px;border:0;border-radius:10px"></iframe></div>`);return;}
 insertHTML(types[type]||types.text);
}
$$('[data-insert]').forEach(b=>b.addEventListener('click',()=>actionInsert(b.dataset.insert)));
$('#upload-image').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>8*1024*1024){notify('A imagem deve ter no máximo 8 MB antes da compactação.');return;}
 try{const data=await resizeImage(file);const alt=prompt('Descreva a imagem para leitores de tela (texto alternativo):','')||'';
 if(!alt.trim())notify('Lembre-se de inserir uma descrição da imagem para acessibilidade.');
 insertHTML(`<figure data-fresuni-block="image" style="margin:25px 0;text-align:center"><img alt="${escapeHTML(alt)}" src="${data}" style="max-width:100%;height:auto;border-radius:8px" loading="lazy"></figure>`);
 }catch(err){notify('Não foi possível adicionar a imagem: '+err.message);}
});
function resizeImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Falha ao ler arquivo.'));
 reader.onload=()=>{if(file.type==='image/gif'){resolve(reader.result);return;}
 const im=new Image();im.onerror=()=>reject(Error('Formato inválido.'));im.onload=()=>{const ratio=Math.min(1,1800/Math.max(im.width,im.height));const canvas=document.createElement('canvas');canvas.width=Math.round(im.width*ratio);canvas.height=Math.round(im.height*ratio);canvas.getContext('2d').drawImage(im,0,0,canvas.width,canvas.height);const transparent=file.type==='image/png'&&file.size<650000;resolve(canvas.toDataURL(transparent?'image/png':'image/webp',.85));};im.src=reader.result;
 };reader.readAsDataURL(file);});}
// Formatação WYSIWYG para a seleção atual dentro do site.
function execFormat(command,value){const d=siteDoc();if(!d||!state.editable)return;
 frame.contentWindow.focus();state.selected?.focus();try{d.execCommand(command,false,value);}catch{notify('Não foi possível aplicar a formatação.');return;}dirty();}
$$('[data-format]').forEach(b=>{b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>execFormat(b.dataset.format));});
$$('[data-align]').forEach(b=>{b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>{if(state.selected){snapshot();state.selected.style.textAlign=b.dataset.align;}});});
$('#make-link').addEventListener('click',()=>{const url=prompt('Link HTTPS ou endereço interno (#/pagina):','https://');if(!url)return;if(!safeUrl(url)){notify('Endereço inválido ou não permitido.');return;}snapshot();execFormat('createLink',url);});
$('#text-color').addEventListener('input',e=>{if(!state.selected)return;state.selected.style.color=e.target.value;dirty();});
$('#font-family').addEventListener('change',e=>{if(!state.selected)return;snapshot();state.selected.style.fontFamily=e.target.value+',sans-serif';});
$('#font-size').addEventListener('change',e=>{if(!state.selected)return;snapshot();state.selected.style.fontSize=Math.max(10,Math.min(144,+e.target.value||16))+'px';dirty();});
const presets={'heading-xl':{tag:'H1',size:44,font:'Merriweather'},'heading-md':{tag:'H2',size:30,font:'Merriweather'},'heading-sm':{tag:'H3',size:23,font:'Merriweather'},'body-xl':{tag:'P',size:22,font:'Prompt'},'body-md':{tag:'P',size:16,font:'Prompt'},'body-sm':{tag:'P',size:14,font:'Prompt'}};
$('#text-preset').addEventListener('change',e=>{const el=state.selected;if(!el||!presets[e.target.value])return;const spec=presets[e.target.value];snapshot();let target=el;
 if(el.matches('h1,h2,h3,h4,h5,h6,p')&&el.tagName!==spec.tag){const repl=siteDoc().createElement(spec.tag.toLowerCase());for(const a of [...el.attributes])repl.setAttribute(a.name,a.value);repl.innerHTML=el.innerHTML;el.replaceWith(repl);target=repl;state.selected=repl;}
 target.style.fontSize=spec.size+'px';target.style.fontFamily=spec.font+(spec.font==='Merriweather'?',serif':',sans-serif');$('#font-size').value=spec.size;$('#font-family').value=spec.font;dirty();state.selected=null;selectElement(target);
});
$('#background-color').addEventListener('change',e=>{if(!state.selected)return;snapshot();state.selected.style.backgroundColor=e.target.value;});
$('#element-url').addEventListener('change',e=>{if(!state.selected)return;let target=state.selected.matches('a,img,iframe')?state.selected:state.selected.querySelector('a,img,iframe');if(!target)return;const url=e.target.value.trim();if(!safeUrl(url)){notify('Utilize um link HTTPS ou um link interno.');return;}snapshot();target.setAttribute(target.matches('a')?'href':'src',url);});
$('#element-alt').addEventListener('change',e=>{const im=state.selected?.matches('img')?state.selected:state.selected?.querySelector('img');if(im){snapshot();im.alt=e.target.value;}});
// Alterações de dimensões e estilo utilizam fluxo normal, não posicionamento absoluto.
$('#reset-dimensions').addEventListener('click',()=>{const el=state.selected;if(!el)return;snapshot();for(const prop of ['width','max-width','height','min-height','display','overflow-wrap'])el.style.removeProperty(prop);positionResizeGrip();dirty();});
function useSelected(block=false){const el=state.selected;return block?(el?.closest('[data-fresuni-block]')||el):el;}
for(const [id,apply] of [
 ['element-width',(el,v)=>{el.style.width=Math.max(10,Math.min(100,+v||100))+'%';el.style.maxWidth='100%';}],
 ['element-height',(el,v)=>{el.style.minHeight=Math.max(0,Math.min(1800,+v||0))+'px';el.style.height='auto';}],
 ['corner-radius',(el,v)=>{el.style.borderRadius=Math.max(0,Math.min(160,+v||0))+'px';}],
 ['border-size',(el,v)=>{el.style.borderStyle=(+v?'solid':'none');el.style.borderWidth=Math.max(0,Math.min(20,+v||0))+'px';}],
 ['border-color',(el,v)=>{el.style.borderColor=v;}],
 ['motion-time',(el,v)=>{el.style.setProperty('--fresuni-motion-duration',Math.max(100,Math.min(2400,+v||650))+'ms');}],
 ['block-motion',(el,v)=>{el.dataset.fresuniMotion=v;if(v!=='none')el.setAttribute('data-reveal','');else el.removeAttribute('data-reveal');}],
 ['shape-kind',(el,v)=>{el.dataset.fresuniShape=v;el.style.borderRadius=({box:'0',rounded:'20px',pill:'100px',circle:'50%'})[v]||'0';if(v==='circle'){el.style.aspectRatio='1';el.style.width='min(100%,280px)';el.style.display='flex';el.style.flexDirection='column';el.style.justifyContent='center';el.style.alignItems='center';}else{el.style.aspectRatio='auto';if(el.dataset.fresuniBlock==='shape')el.style.display='block';}}]
]){$('#'+id).addEventListener('change',e=>{const el=useSelected(id==='shape-kind');if(!el)return;snapshot();apply(el,e.target.value);dirty();positionResizeGrip();});}
function bindDrag(d){d.addEventListener('dragstart',e=>{if(!e.altKey||!state.editable)return;const el=e.target.closest('[data-fresuni-block]');if(!el||!el.closest('.site-page'))return;dragged=el;e.dataTransfer.effectAllowed='move';});
 d.addEventListener('dragover',e=>{if(dragged&&e.target.closest('[data-fresuni-block]'))e.preventDefault();});
 d.addEventListener('drop',e=>{const target=e.target.closest('[data-fresuni-block]');if(!dragged||!target||target===dragged||dragged.contains(target)||dragged.parentElement!==target.parentElement)return; e.preventDefault();snapshot();const r=target.getBoundingClientRect();target.parentElement.insertBefore(dragged,e.clientY<r.top+r.height/2?target:target.nextSibling);selectElement(dragged);dirty();dragged=null;});
 d.addEventListener('dragend',()=>{dragged=null;});}
function blockElement(){const el=state.selected;if(!el)return;return el.closest('[data-fresuni-block]')||el;}
function blockMove(direction){const el=blockElement();if(!el||el.closest('header'))return;snapshot();if(direction==='up'&&el.previousElementSibling)el.parentNode.insertBefore(el,el.previousElementSibling);
 if(direction==='down'&&el.nextElementSibling)el.parentNode.insertBefore(el.nextElementSibling,el);dirty();selectElement(el);}
$('#move-block-up').addEventListener('click',()=>blockMove('up'));$('#move-block-down').addEventListener('click',()=>blockMove('down'));$('#move-selection-up').addEventListener('click',()=>blockMove('up'));$('#move-selection-down').addEventListener('click',()=>blockMove('down'));
$('#duplicate-block').addEventListener('click',()=>{const el=blockElement();if(!el)return;snapshot();const n=el.cloneNode(true);el.after(n);setEditable(true);selectElement(n);});
$('#selected-remove').addEventListener('click',()=>{const el=blockElement();if(!el||!state.editable)return;if(!confirm('Remover este elemento da página?'))return;snapshot();el.remove();clearSelection();});
// Páginas e ordem, sem alterar as URLs já publicadas.
const expandedPages=new Set(['/','/noticias','/artigos','/acoes','/manifesto']);
function renderPages(){
 const tree=$('#page-tree');tree.replaceChildren();const query=$('#page-filter').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const pages=pageNodes();const children=new Map();for(const page of pages){const parent=parentRouteOf(page);if(!children.has(parent))children.set(parent,[]);children.get(parent).push(page);}
 const matches=p=>!query||labelPath(p).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query)||titleOf(p).toLowerCase().includes(query);
 function branch(p,level=0){if(level>12)return;const kids=children.get(p.dataset.route)||[];const isMatch=matches(p)||kids.some(k=>matches(k));if(!isMatch)return;
  const row=document.createElement('div');row.className='page-tree-row';row.style.paddingLeft=Math.min(level,8)*13+'px';
  if(kids.length){const toggle=document.createElement('button');toggle.className='tree-toggle';toggle.type='button';const open=expandedPages.has(p.dataset.route)||!!query;toggle.textContent=open?'▾':'▸';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label','Expandir ou recolher '+titleOf(p));toggle.onclick=()=>{if(expandedPages.has(p.dataset.route))expandedPages.delete(p.dataset.route);else expandedPages.add(p.dataset.route);renderPages();};row.append(toggle);}
  else{const space=document.createElement('span');space.className='tree-spacer';space.textContent='•';row.append(space);}
  const b=document.createElement('button');b.className='page-item';b.setAttribute('role','listitem');if(p.dataset.route===state.route)b.setAttribute('aria-current','page');
  b.textContent=(p.dataset.route==='/'?'⌂  ':'▤  ')+titleOf(p);b.title=labelPath(p)+' ('+p.dataset.route+')';b.onclick=()=>{expandedPages.add(parentRouteOf(p));selectRoute(p.dataset.route);};row.append(b);tree.append(row);
  if((expandedPages.has(p.dataset.route)||query)&&kids.length)kids.forEach(child=>branch(child,level+1));
 }
 (children.get('')||[]).forEach(p=>branch(p));
 $('#page-counter').textContent=pages.length+' páginas';
}
$('#page-filter').addEventListener('input',renderPages);
function updatePageSidebar(){const p=selectedPage();if(!p)return;$('#page-title').value=titleOf(p);$('#page-group').value=groupFor(p);$('#page-show').checked=p.dataset.editorNav!=='false';}
function renderNav(){const d=siteDoc(),nav=$('#menu-principal',d);if(!nav)return;
 // Only edit known menus, preserving the original markup and drop-down behaviour.
 const index=new Map(pageNodes().map((p,i)=>[p.dataset.route,i]));
 for(const group of ['inicio','manifesto','acoes']){
  const el=$('#sub-'+group,nav);if(!el)continue;
  $$('a',el).forEach(a=>{const route=a.getAttribute('href')?.slice(1);if(route&&!pageFor(route))a.remove();});
  for(const p of pageNodes()){
   if(groupFor(p)!==group||p.dataset.editorNav==='false'||p.dataset.route==='/'||['noticias','artigos'].includes(groupFor(p)))continue;
   const route=p.dataset.route;if(!$$('a',el).find(x=>x.getAttribute('href')==='#'+route)){
     const a=d.createElement('a');a.href='#'+route;a.textContent=titleOf(p);el.append(a);
   }
  }
  $$('a',el).sort((a,b)=>(index.get(a.getAttribute('href').slice(1))??999)-(index.get(b.getAttribute('href').slice(1))??999)).forEach(a=>el.append(a));
 }
 // Custom principal links appear before Estatuto. Root fixed links retain their original order.
 $$('a[data-fresuni-nav-custom]',nav).forEach(a=>a.remove());
 const before=$$('a.nav-root.solo',nav).find(a=>a.getAttribute('href')==='#/estatuto');
 for(const p of pageNodes()){
  const route=p.dataset.route;if(groupFor(p)!=='principal'||p.dataset.editorNav==='false'||['/filiacao','/estatuto'].includes(route))continue;
  const a=d.createElement('a');a.className='nav-root solo';a.href='#'+route;a.textContent=titleOf(p);a.dataset.fresuniNavCustom='';nav.insertBefore(a,before||null);
 }
 // Nonroot disabled items in existing root navigation should not remain visible.
 for(const p of pageNodes()){
  if(p.dataset.editorNav==='false')$$('a[href="#'+CSS.escape(p.dataset.route)+'"]',nav).filter(a=>a.dataset.fresuniNavCustom===undefined&&a.classList.contains('nav-root')===false).forEach(a=>a.remove());
 }
}
$('#page-title').addEventListener('change',e=>{const p=selectedPage();const name=e.target.value.trim();if(!p||!name)return;snapshot();p.dataset.title=name;const heading=$('h1:not(.sr-only)',p);if(heading)heading.textContent=name;$$('.breadcrumbs [aria-current="page"]',p).forEach(x=>x.textContent=name);
 $$('a[href="#'+p.dataset.route+'"]',siteDoc()).forEach(a=>{if(a.closest('.site-header'))a.textContent=name;});
 $('#current-page-title').textContent=name;renderPages();renderNav();dirty();});
$('#page-group').addEventListener('change',e=>{const p=selectedPage();if(!p)return;snapshot();p.dataset.editorGroup=e.target.value;renderNav();});
$('#page-show').addEventListener('change',e=>{const p=selectedPage();if(!p)return;snapshot();p.dataset.editorNav=String(e.target.checked);renderNav();});
function addCollectionCard(group,route,title){const parent=pageFor('/'+group);const grid=parent?.querySelector('.card-grid');if(!grid)return;const d=siteDoc();const card=d.createElement('a');card.className='content-card';card.setAttribute('data-reveal','');card.href='#'+route;card.innerHTML='<span class="card-eyebrow"></span><h3></h3><p>Apresentação da nova página. Você pode editar este texto.</p><span class="card-action">Leia mais ↗</span>';card.querySelector('.card-eyebrow').textContent=group==='noticias'?'Notícia':group==='artigos'?'Artigo':'Ação';card.querySelector('h3').textContent=title;grid.append(card);}
function removeCollectionCard(route){const d=siteDoc();$$('a.content-card',d).filter(a=>a.getAttribute('href')==='#'+route).forEach(a=>a.remove());}
function openNewPage(parentHint){
 $('#new-page-form').reset();const select=$('#new-page-parent');select.replaceChildren();for(const p of pageNodes()){
  const opt=document.createElement('option');opt.value=p.dataset.route;opt.textContent=labelPath(p);select.append(opt);
 }
 const chosen=parentHint||state.route||'/';select.value=pageFor(chosen)?chosen:'/';
 const group=groupFor(pageFor(select.value)||pageFor('/'));$('#new-page-group').value=group==='oculto'?'inicio':group;
 $('#new-page-slug').value='';$('#new-page-dialog').showModal();$('#new-page-title').focus();
}
$('#new-page-parent').addEventListener('change',e=>{const p=pageFor(e.target.value);if(p){const g=groupFor(p);$('#new-page-group').value=g==='oculto'?'inicio':g;}});
$('#new-page-title').addEventListener('input',e=>{$('#new-page-slug').value=slug(e.target.value);});
$('#cancel-new').addEventListener('click',()=>$('#new-page-dialog').close());
$('#add-page').addEventListener('click',()=>openNewPage('/'));
$('#add-page-secondary').addEventListener('click',()=>openNewPage('/'));
$('#add-subpage').addEventListener('click',()=>openNewPage(state.route));
function ensureChildLinks(parentRoute){
 const parent=pageFor(parentRoute), d=siteDoc();if(!parent)return null;
 let holder=parent.querySelector('[data-fresuni-children]');if(holder)return holder;
 holder=d.createElement('section');holder.dataset.fresuniChildren='';holder.className='fresuni-children';holder.setAttribute('aria-label','Páginas relacionadas');
 holder.innerHTML='<h2>Páginas relacionadas</h2><ul></ul>';
 (parent.querySelector('.page-article')||parent.querySelector('.page-shell')||parent).append(holder);return holder;
}
function attachChildLink(parentRoute,route,title){
 const group=parentRoute==='/noticias'?'noticias':parentRoute==='/artigos'?'artigos':parentRoute==='/acoes'?'acoes':'';
 const parent=pageFor(parentRoute);
 if(group&&parent?.querySelector('.card-grid')){addCollectionCard(group,route,title);return;}
 const holder=ensureChildLinks(parentRoute);if(!holder)return;
 const ul=holder.querySelector('ul');if(ul.querySelector('a[href="#'+route+'"]'))return;
 const li=siteDoc().createElement('li'),a=siteDoc().createElement('a');a.href='#'+route;a.textContent=title;li.append(a);ul.append(li);
}
function removeChildLink(route){removeCollectionCard(route);const d=siteDoc();$$('[data-fresuni-children] li',d).filter(li=>li.querySelector('a')?.getAttribute('href')==='#'+route).forEach(li=>li.remove());}
$('#new-page-form').addEventListener('submit',e=>{
 e.preventDefault();const name=$('#new-page-title').value.trim();if(!name)return;
 const nameSlug=slug($('#new-page-slug').value||name),group=$('#new-page-group').value;
 const parentRoute=$('#new-page-parent').value||'/';if(!pageFor(parentRoute)){notify('Selecione uma página-mãe válida.');return;}
 let route=(parentRoute==='/'?'':parentRoute)+'/'+nameSlug;
 if(parentRoute==='/'&&['acoes','manifesto','noticias','artigos'].includes(group))route='/'+group+'/'+nameSlug;
 if(pageFor(route)){notify('Já existe uma página com este endereço. Escolha outro.');return;}
 snapshot();const d=siteDoc();const main=$('main#conteudo',d);const div=d.createElement('div');div.className='site-page';div.dataset.route=route;div.dataset.title=name;div.dataset.editorGroup=group;div.dataset.editorParent=parentRoute;div.dataset.editorNav=String(group!=='oculto');div.hidden=true;
 const ancestors=[];let walk=parentRoute;for(let i=0;walk&&walk!=='/'&&i<12;i++){const p=pageFor(walk);if(!p)break;ancestors.unshift({route:walk,title:titleOf(p)});walk=parentRouteOf(p);}
 const crumbs='<a href="#/">Início</a>'+ancestors.map(x=>'<span class="breadcrumb-sep" aria-hidden="true"> / </span><a href="#'+escapeHTML(x.route)+'">'+escapeHTML(x.title)+'</a>').join('');
 div.innerHTML=`<div class="container page-shell"><nav class="breadcrumbs" aria-label="Caminho de navegação">${crumbs}<span class="breadcrumb-sep" aria-hidden="true"> / </span><span aria-current="page">${escapeHTML(name)}</span></nav><div class="page-heading"><span class="eyebrow">FRESUNI Social</span><h1>${escapeHTML(name)}</h1><p class="page-lead">Escreva aqui uma apresentação da página.</p></div><article class="prose page-article"><p>Clique neste texto para começar a escrever.</p></article></div>`;
 main.append(div);attachChildLink(parentRoute,route,name);expandedPages.add(parentRoute);renderNav();$('#new-page-dialog').close();const result=serialize();reloadFrame(result,route);dirty();notify('Subpágina criada dentro de '+titleOf(pageFor(parentRoute))+'.');
});
function reorderCollectionCards(group){const grid=pageFor('/'+group)?.querySelector('.card-grid');if(!grid)return;
 const map=new Map([...grid.querySelectorAll('a.content-card')].map(a=>[a.getAttribute('href')?.slice(1),a]));for(const p of pageNodes())if(groupFor(p)===group&&p.dataset.route!=='/'+group){const a=map.get(p.dataset.route);if(a)grid.append(a);}}
function movePage(direction){const p=selectedPage();if(!p||p.dataset.route==='/')return;const sibling=direction==='up'?p.previousElementSibling:p.nextElementSibling;if(!sibling||groupFor(sibling)!==groupFor(p))return;snapshot();if(direction==='up')p.parentNode.insertBefore(p,sibling);else p.parentNode.insertBefore(sibling,p);reorderCollectionCards(groupFor(p));renderPages();renderNav();dirty();}
$('#page-up').addEventListener('click',()=>movePage('up'));$('#page-down').addEventListener('click',()=>movePage('down'));
$('#duplicate-page').addEventListener('click',()=>{const p=selectedPage();if(!p)return;const name=prompt('Nome da cópia:',titleOf(p)+' (cópia)');if(!name)return;
 const parent=parentRouteOf(p)||'/';let route=(parent==='/'?'':parent)+'/'+slug(name);if(pageFor(route)){notify('Já existe uma página com esse endereço.');return;}
 snapshot();const n=p.cloneNode(true);n.dataset.route=route;n.dataset.title=name;n.dataset.editorGroup=groupFor(p);n.dataset.editorParent=parent;n.dataset.editorNav='true';const h=$('h1:not(.sr-only)',n);if(h)h.textContent=name;$$('[id]',n).forEach(x=>x.removeAttribute('id'));
 p.after(n);attachChildLink(parent,route,name);renderNav();reloadFrame(serialize(),route);dirty();notify('Página duplicada.');});
$('#delete-page').addEventListener('click',()=>{const p=selectedPage();if(!p||p.dataset.route==='/'){notify('A página inicial não pode ser excluída.');return;}
 if(!confirm('Excluir permanentemente a página “'+titleOf(p)+'” do site? Os links que apontarem para ela precisarão ser revisados.'))return;
 if(pageNodes().some(x=>parentRouteOf(x)===p.dataset.route)){notify('Esta página possui subpáginas. Exclua ou mova as subpáginas antes de excluí-la.');return;}
 snapshot();removeChildLink(p.dataset.route);p.remove();renderNav();reloadFrame(serialize(),'/');dirty();notify('Página removida do rascunho.');});
// Tema: usa variáveis CSS do site sem remover as regras existentes.
function themeEl(doc){let el=$('#fresuni-custom-theme',doc);if(!el){el=doc.createElement('style');el.id='fresuni-custom-theme';doc.head.append(el);}return el;}
const theme={primary:'#8300ea',text:'#000000',background:'#ffffff',font:'Prompt'};
function applyTheme(){const d=siteDoc();if(!d)return;themeEl(d).textContent=`:root{--primary:${theme.primary};--purple:${theme.primary};--accent:${theme.primary};--ink:${theme.text};--background:${theme.background};--bg:${theme.background}} body{background:${theme.background};color:${theme.text};font-family:${theme.font},Arial,sans-serif} .page-heading h1,.prose h2,.value-section summary{color:${theme.primary}} .brand:focus-visible{outline-color:${theme.primary}}`;
 dirty();}
for(const [id,key] of [['#theme-primary','primary'],['#theme-text','text'],['#theme-bg','background'],['#theme-font','font']])$(id).addEventListener('change',e=>{snapshot();theme[key]=e.target.value;applyTheme();});
$('#reset-theme').addEventListener('click',()=>{snapshot();Object.assign(theme,{primary:'#8300ea',text:'#000000',background:'#ffffff',font:'Prompt'});$$('[id^="theme-"]').forEach(e=>{const key={'theme-primary':'primary','theme-text':'text','theme-bg':'background','theme-font':'font'}[e.id];if(key)e.value=theme[key];});themeEl(siteDoc()).remove();dirty();});
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{$$('[data-tab]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b));});$$('[data-panel]').forEach(x=>x.hidden=x.dataset.panel!==b.dataset.tab);updatePageSidebar();}));
$('#view-desktop').addEventListener('click',()=>{ $('#canvas').classList.remove('mobile');$('#view-desktop').classList.add('active');$('#view-mobile').classList.remove('active');$('#view-desktop').setAttribute('aria-pressed','true');$('#view-mobile').setAttribute('aria-pressed','false');});
$('#view-mobile').addEventListener('click',()=>{ $('#canvas').classList.add('mobile');$('#view-mobile').classList.add('active');$('#view-desktop').classList.remove('active');$('#view-desktop').setAttribute('aria-pressed','false');$('#view-mobile').setAttribute('aria-pressed','true');});
$('#preview').addEventListener('click',()=>{setEditable(!state.editable);notify(state.editable?'Clique nos textos da página para editar.':'Você está vendo a prévia, sem ferramentas de edição.');});
function exportText(content,name){const blob=new Blob([content],{type:'text/html;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2500);}
$('#export').addEventListener('click',()=>{exportText(serialize(),'index.html');notify('HTML exportado. Você pode publicá-lo manualmente no GitHub.');});
$('#backup').addEventListener('click',()=>{exportText(serialize(),'fresuni-backup-'+new Date().toISOString().slice(0,10)+'.html');notify('Backup criado.');});
function doUndo(){if(!state.undo.length){notify('Nada para desfazer.');return;}state.redo.push(serialize());const html=state.undo.pop();reloadFrame(html,state.route);dirty();notify('Alteração desfeita.');}
function doRedo(){if(!state.redo.length){notify('Nada para refazer.');return;}state.undo.push(serialize());const html=state.redo.pop();reloadFrame(html,state.route);dirty();notify('Alteração refeita.');}
$('#undo').addEventListener('click',doUndo);$('#redo').addEventListener('click',doRedo);
$('#draft-save').addEventListener('click',async()=>{try{await saveDraft();notify('Rascunho salvo localmente. Não foi publicado.');}catch(e){notify('Não foi possível salvar: '+e.message);}});
$('#restore-published').addEventListener('click',async()=>{if(!confirm('Descartar todas as mudanças NÃO PUBLICADAS e voltar ao arquivo que está no GitHub?'))return;
 clearTimeout(draftTimer);await draftAction('delete').catch(()=>{});state.undo=[];state.redo=[];state.dirty=false;reloadFrame(state.html,'/');setStatus('Versão publicada restaurada');notify('Voltamos à versão publicada do site.');});
function showPublishError(err){
 const panel=$('#publish-error');panel.hidden=false;
 let msg=String(err.message||err);if(err.status===401)msg+=' Sua sessão pode ter expirado: saia e entre novamente.';
 if(err.status===403||/403|404|Resource not accessible|Not Found/i.test(msg))msg+=' Confira o GITHUB_TOKEN, a permissão Contents: Read and write e o repositório fresuni no Cloudflare Worker.';
 if(err.status===409)msg+=' O arquivo publicado mudou. Faça backup antes de restaurar a versão remota.';
 $('#publish-error-message').textContent=msg;panel.scrollIntoView({block:'nearest',behavior:'smooth'});
 setStatus('Publicação não realizada · rascunho preservado');
}
$('#dismiss-publish-error').addEventListener('click',()=>$('#publish-error').hidden=true);
$('#copy-publish-error').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#publish-error-message').textContent);notify('Detalhes copiados sem dados secretos.');}catch{notify('Selecione e copie a mensagem de erro.');}});
$('#publish').addEventListener('click',async()=>{
 if(!state.dirty){notify('Não há alterações pendentes.');return;}
 const html=serialize();$('#publish-error').hidden=true;if(!confirm('Publicar agora todas as alterações no seu repositório do GitHub?'))return;
 const b=$('#publish');b.disabled=true;b.textContent='Publicando…';setStatus('Publicando no GitHub…');
 try{const r=await api('/publish',{method:'POST',body:JSON.stringify({html,expectedSha:state.sha})});if(!r.ok||!r.sha)throw Error('O servidor não confirmou o envio ao GitHub.');state.sha=r.sha;state.html=html;state.undo=[];state.redo=[];state.dirty=false;clearTimeout(draftTimer);await draftAction('delete').catch(()=>{});setStatus('Publicado no GitHub');notify('Alterações enviadas ao GitHub! O Pages pode demorar a atualizar o site.');}
 catch(e){dirty();showPublishError(e);notify('Publicação não concluída. Veja a mensagem com os detalhes abaixo da prévia.');}
 finally{b.disabled=false;b.textContent='Publicar alterações';}
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state.dirty)saveDraft().catch(()=>{});});
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(app.hidden||!(e.ctrlKey||e.metaKey))return;
 if(e.key.toLowerCase()==='s'){e.preventDefault();$('#draft-save').click();}
 if(e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();e.shiftKey?doRedo():doUndo();}
 if(e.key.toLowerCase()==='y'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();doRedo();}
});
})();