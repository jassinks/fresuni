/* FRESUNI Social — editor visual. Credenciais existem apenas no Cloudflare Worker. */
(()=>{'use strict';
const $=(s,root=document)=>root.querySelector(s);const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));
const worker=(window.FRESUNI_ADMIN_CONFIG?.apiUrl||'').replace(/\/$/,'');
const frame=$('#site-frame'),app=$('#app'),login=$('#login-screen');
const state={token:sessionStorage.getItem('fresuni:session')||'',html:'',sha:'',route:'/',selected:null,editable:true,dirty:false,loading:false,undo:[],latest:'',lastFocus:null};
let tempPage='',toastTimer,historyTimer;
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
  state.html=html;state.sha=sha;state.undo=[];state.dirty=false;state.route='/';
  reloadFrame(html,'/');setStatus('Tudo salvo no GitHub');
 }finally{state.loading=false;}
}
async function authenticated(){
 try{await loadSite();showApp();}
 catch(e){showLogin(e.message);}
}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('#login-submit');b.disabled=true;b.textContent='Verificando…';$('#login-error').textContent='';try{
 const data=await api('/login',{method:'POST',body:JSON.stringify({username:$('#admin-user').value.trim(),password:$('#admin-pass').value})});
 state.token=data.token;sessionStorage.setItem('fresuni:session',state.token);$('#admin-pass').value='';await loadSite();showApp();
}catch(err){$('#login-error').textContent=err.message;state.token='';sessionStorage.removeItem('fresuni:session');}finally{b.disabled=false;b.textContent='Entrar no painel';}});
$('#show-pass').addEventListener('click',()=>{$('#admin-pass').type=$('#admin-pass').type==='password'?'text':'password';});
$('#logout').addEventListener('click',()=>showLogin('Você saiu do editor.'));
if(state.token && worker)authenticated();else showLogin();
function siteDoc(){return frame.contentDocument;}
function pageNodes(){const d=siteDoc();return d?$$('main > .site-page[data-route]',d):[];}
function pageFor(route){return pageNodes().find(p=>p.dataset.route===route);}
function selectedPage(){return pageFor(state.route);}
function groupFor(page){if(page.dataset.editorGroup)return page.dataset.editorGroup;const route=page.dataset.route||'/';if(route.startsWith('/acoes'))return 'acoes';if(route.startsWith('/manifesto'))return 'manifesto';if(route==='/filiacao'||route==='/estatuto')return 'principal';return 'inicio';}
function depthOf(page){const path=page.dataset.route||'/';return path==='/'?0:Math.min(2,path.split('/').length-2);}
function titleOf(page){return page.dataset.title||$('h1',page)?.textContent.trim()||page.dataset.route;}
function dirty(){state.dirty=true;setStatus('Alterações não publicadas');}
function remember(){const html=serialize();if(state.undo[state.undo.length-1]!==html){state.undo.push(html);if(state.undo.length>9)state.undo.shift();}}
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
  const style=d.createElement('style');style.id='fresuni-editor-overlay';style.textContent=`
   [data-fresuni-editable="true"]{cursor:text;min-width:10px;min-height:1em;border-radius:2px;outline:1px solid transparent;outline-offset:3px;}
   [data-fresuni-editable="true"]:hover{outline:1px dashed #af65ed}
   [data-fresuni-selected]{outline:3px solid #8300ea!important;outline-offset:4px;position:relative}
   [data-fresuni-selected]::selection{background:#e2bbff}
   body{scroll-behavior:auto!important}
   [data-reveal]{opacity:1!important;transform:none!important;visibility:visible!important}
   @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}`;
  d.head.append(style);
  for(const p of pageNodes())p.dataset.editorGroup=groupFor(p);
  d.addEventListener('click',clickSite,true);
  d.addEventListener('input',e=>{if(e.target?.isContentEditable){dirty();clearTimeout(historyTimer);historyTimer=setTimeout(()=>{},400);}});
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
 selectElement(el);
}
function clearSelection(){const d=siteDoc();if(d)$$('[data-fresuni-selected]',d).forEach(x=>x.removeAttribute('data-fresuni-selected'));state.selected=null;$('#selection-name').textContent='Selecione um texto, uma imagem ou um bloco na página.';$('#selection-props').hidden=true;}
function selectElement(el){if(state.selected===el)return;clearSelection();state.selected=el;el.dataset.fresuniSelected='';
 $('#selection-name').textContent=(el.tagName.toLowerCase())+' · '+(el.textContent.trim().slice(0,48)||'elemento visual');$('#selection-props').hidden=false;
 const target=el.matches('img,iframe,a')?el:el.querySelector('img,iframe,a');
 $('#element-url').value=target?.getAttribute('src')?.startsWith('data:')?'':(target?.getAttribute('href')||target?.getAttribute('src')||'');
 $('#element-alt').value=el.matches('img')?el.alt:(el.querySelector('img')?.alt||'');
 $('#font-size').value=Math.round(parseFloat(frame.contentWindow.getComputedStyle(el).fontSize))||16;
 $('#background-color').value=toHex(frame.contentWindow.getComputedStyle(el).backgroundColor,'#ffffff');
 $('#text-color').value=toHex(frame.contentWindow.getComputedStyle(el).color,'#000000');
}
function toHex(color,fallback){const m=color.match(/\d+/g);if(!m||m.length<3)return fallback;return '#'+m.slice(0,3).map(x=>Math.max(0,Math.min(255,+x)).toString(16).padStart(2,'0')).join('');}
function stripTransient(root){root.classList.remove('dark-mode','high-contrast','simple-mode','reduce-motion');
 $$('link[data-fresuni-async-font]',root).forEach(link=>{link.removeAttribute('data-fresuni-async-font');link.removeAttribute('media');});$$('#fresuni-editor-overlay',root).forEach(x=>x.remove());$$('[data-fresuni-selected]',root).forEach(x=>x.removeAttribute('data-fresuni-selected'));
 $$('[data-fresuni-editable]',root).forEach(x=>{x.removeAttribute('data-fresuni-editable');x.removeAttribute('contenteditable');x.removeAttribute('spellcheck')});
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
$('#font-size').addEventListener('change',e=>{if(!state.selected)return;snapshot();state.selected.style.fontSize=Math.max(10,Math.min(96,+e.target.value||16))+'px';});
$('#background-color').addEventListener('change',e=>{if(!state.selected)return;snapshot();state.selected.style.backgroundColor=e.target.value;});
$('#element-url').addEventListener('change',e=>{if(!state.selected)return;let target=state.selected.matches('a,img,iframe')?state.selected:state.selected.querySelector('a,img,iframe');if(!target)return;const url=e.target.value.trim();if(!safeUrl(url)){notify('Utilize um link HTTPS ou um link interno.');return;}snapshot();target.setAttribute(target.matches('a')?'href':'src',url);});
$('#element-alt').addEventListener('change',e=>{const im=state.selected?.matches('img')?state.selected:state.selected?.querySelector('img');if(im){snapshot();im.alt=e.target.value;}});
function blockElement(){const el=state.selected;if(!el)return;return el.closest('[data-fresuni-block]')||el;}
function blockMove(direction){const el=blockElement();if(!el||el.closest('header'))return;snapshot();if(direction==='up'&&el.previousElementSibling)el.parentNode.insertBefore(el,el.previousElementSibling);
 if(direction==='down'&&el.nextElementSibling)el.parentNode.insertBefore(el.nextElementSibling,el);dirty();selectElement(el);}
$('#move-block-up').addEventListener('click',()=>blockMove('up'));$('#move-block-down').addEventListener('click',()=>blockMove('down'));
$('#duplicate-block').addEventListener('click',()=>{const el=blockElement();if(!el)return;snapshot();const n=el.cloneNode(true);el.after(n);setEditable(true);selectElement(n);});
$('#selected-remove').addEventListener('click',()=>{const el=blockElement();if(!el||!state.editable)return;if(!confirm('Remover este elemento da página?'))return;snapshot();el.remove();clearSelection();});
// Páginas e ordem, sem alterar as URLs já publicadas.
function renderPages(){const tree=$('#page-tree');tree.replaceChildren();const query=$('#page-filter').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const pages=pageNodes();
 pages.filter(p=>titleOf(p).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query)).forEach(p=>{
  const b=document.createElement('button');b.className='page-item';b.dataset.depth=depthOf(p);b.setAttribute('role','listitem');if(p.dataset.route===state.route)b.setAttribute('aria-current','page');
  const label=document.createElement('span');label.className='label';label.textContent=titleOf(p);
  const ico=document.createElement('span');ico.className='page-icon';ico.textContent=p.dataset.route==='/'?'◆':'▤';b.append(ico,label);b.title=p.dataset.route;
  b.onclick=()=>selectRoute(p.dataset.route);tree.append(b);
 });$('#page-counter').textContent=pages.length+' páginas';
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
   if(groupFor(p)!==group||p.dataset.editorNav==='false'||p.dataset.route==='/')continue;
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
function openNewPage(){$('#new-page-form').reset();$('#new-page-dialog').showModal();$('#new-page-title').focus();}
$('#new-page-title').addEventListener('input',e=>{$('#new-page-slug').value=slug(e.target.value);});
$('#new-page-dialog').addEventListener('close',()=>{});
$('#cancel-new').addEventListener('click',()=>$('#new-page-dialog').close());
$('#add-page').addEventListener('click',openNewPage);$('#add-page-secondary').addEventListener('click',openNewPage);
$('#new-page-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#new-page-title').value.trim();const nameSlug=slug($('#new-page-slug').value||name);const group=$('#new-page-group').value;
 const route='/'+(group==='acoes'?'acoes/':group==='manifesto'?'manifesto/':'')+nameSlug;
 if(pageFor(route)){notify('Já existe uma página com este endereço.');return;}
 snapshot();const d=siteDoc();const main=$('main#conteudo',d);const div=d.createElement('div');div.className='site-page';div.dataset.route=route;div.dataset.title=name;div.dataset.editorGroup=group;div.dataset.editorNav=String(group!=='oculto');div.hidden=true;
 div.innerHTML=`<div class="container page-shell"><nav class="breadcrumbs" aria-label="Caminho de navegação"><a href="#/">Início</a><span class="breadcrumb-sep" aria-hidden="true"> / </span><span aria-current="page">${escapeHTML(name)}</span></nav><div class="page-heading"><span class="eyebrow">FRESUNI Social</span><h1>${escapeHTML(name)}</h1><p class="page-lead">Escreva aqui uma apresentação da página.</p></div><article class="prose page-article"><p>Clique neste texto para começar a escrever.</p></article></div>`;
 main.append(div);renderNav();$('#new-page-dialog').close();const html=serialize();reloadFrame(html,route);dirty();notify('Página criada. Agora você pode editar seu conteúdo.');});
function movePage(direction){const p=selectedPage();if(!p||p.dataset.route==='/')return;const sibling=direction==='up'?p.previousElementSibling:p.nextElementSibling;if(!sibling)return;snapshot();if(direction==='up')p.parentNode.insertBefore(p,sibling);else p.parentNode.insertBefore(sibling,p);renderPages();renderNav();dirty();}
$('#page-up').addEventListener('click',()=>movePage('up'));$('#page-down').addEventListener('click',()=>movePage('down'));
$('#duplicate-page').addEventListener('click',()=>{const p=selectedPage();if(!p)return;const name=prompt('Nome da cópia:',titleOf(p)+' (cópia)');if(!name)return;
 let route='/'+slug(name);if(pageFor(route)){notify('Já existe uma página com esse endereço.');return;}
 snapshot();const n=p.cloneNode(true);n.dataset.route=route;n.dataset.title=name;n.dataset.editorGroup=groupFor(p);n.dataset.editorNav='true';const h=$('h1:not(.sr-only)',n);if(h)h.textContent=name;$$('[id]',n).forEach(x=>x.removeAttribute('id'));
 p.after(n);renderNav();reloadFrame(serialize(),route);dirty();notify('Página duplicada.');});
$('#delete-page').addEventListener('click',()=>{const p=selectedPage();if(!p||p.dataset.route==='/'){notify('A página inicial não pode ser excluída.');return;}
 if(!confirm('Excluir permanentemente a página “'+titleOf(p)+'” do site? Os links que apontarem para ela precisarão ser revisados.'))return;
 snapshot();p.remove();renderNav();reloadFrame(serialize(),'/');dirty();notify('Página removida do rascunho.');});
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
$('#undo').addEventListener('click',()=>{if(!state.undo.length){notify('Não há alterações de estrutura para desfazer.');return;}const h=state.undo.pop();reloadFrame(h,state.route);dirty();notify('Última ação desfeita. Para texto digitado, use Ctrl+Z no campo.');});
$('#publish').addEventListener('click',async()=>{
 if(!state.dirty){notify('Não há alterações pendentes.');return;}
 const html=serialize();if(!confirm('Publicar agora todas as alterações no seu repositório do GitHub?'))return;
 const b=$('#publish');b.disabled=true;b.textContent='Publicando…';setStatus('Publicando no GitHub…');
 try{const r=await api('/publish',{method:'POST',body:JSON.stringify({html,expectedSha:state.sha})});state.sha=r.sha;state.html=html;state.undo=[];state.dirty=false;setStatus('Publicado no GitHub');notify('Alterações enviadas ao GitHub! O Pages pode demorar a atualizar o site.');}
 catch(e){dirty();if(e.status===409)notify('Conflito de versão: faça um backup, reabra o editor e revise as alterações.');else notify('Erro ao publicar: '+e.message);}
 finally{b.disabled=false;b.textContent='Publicar alterações';}
});
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'&&!app.hidden){e.preventDefault();$('#publish').click();}});
})();
