/* FRESUNI Social — editor visual. Credenciais existem apenas no Cloudflare Worker. */
(()=>{'use strict';
const $=(s,root=document)=>root.querySelector(s);const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));
const worker=(window.FRESUNI_ADMIN_CONFIG?.apiUrl||'').replace(/\/$/,'');
const frame=$('#site-frame'),app=$('#app'),login=$('#login-screen');
const state={token:sessionStorage.getItem('fresuni:session')||'',html:'',sha:'',route:'/',selected:null,editable:true,dirty:false,loading:false,undo:[],redo:[],latest:'',lastFocus:null,restoring:false};
let tempPage='',toastTimer,historyTimer,draftTimer,dragged=null;
const DRAFT_KEY='jassinks/fresuni/index.html';

const COMPLETE_FONTS='https://fonts.googleapis.com/css2?family=Prompt:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Merriweather:ital,wght@0,300..900;1,300..900&display=swap';
function ensureCompleteFonts(d){
 const links=Array.from(d.querySelectorAll('link[rel="stylesheet"]'));
 for(const el of links){if((el.getAttribute('href')||'').includes('fonts.googleapis.com/css2')){el.remove();}}
 let l=d.createElement('link');l.rel='stylesheet';l.href=COMPLETE_FONTS;l.dataset.fresuniFontCatalog='';l.media='print';l.addEventListener('load',()=>l.media='all');d.head.append(l);
}
const motionCss=`.directory-links > [data-fresuni-block="quick-item"],.directory-links > [data-fresuni-block="text"]{min-width:0;max-width:100%;overflow-wrap:anywhere} @media(prefers-reduced-motion:no-preference){.js-motion [data-fresuni-motion]:not([data-fresuni-motion="none"]):not(.is-visible){opacity:0}.js-motion [data-fresuni-motion="slide"]:not(.is-visible){transform:translateY(24px)}.js-motion [data-fresuni-motion="zoom"]:not(.is-visible){transform:scale(.96)}.js-motion [data-fresuni-motion="left"]:not(.is-visible){transform:translateX(-24px)}.js-motion [data-fresuni-motion="right"]:not(.is-visible){transform:translateX(24px)}.js-motion [data-fresuni-motion]:not([data-fresuni-motion="none"]){transition:opacity var(--fresuni-motion-duration,650ms) ease,transform var(--fresuni-motion-duration,650ms) ease}.js-motion [data-fresuni-motion].is-visible{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){[data-fresuni-motion]{opacity:1!important;transform:none!important;transition:none!important}}`;

const notify=(s)=>{const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3600);};
const setStatus=(t)=>{$('#save-state').textContent=t;};
const slug=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,70)||'pagina';
const safeUrl=s=>/^(https?:\/\/[^\s<>]+|#\/[a-z0-9\-/]*|#[A-Za-z][\w:.-]*|mailto:[^\s<>@]+@[^\s<>@]+|tel:[+0-9() .-]+)$/i.test(String(s).trim());
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
  const recovered=await restoreDraftIfAny();if(!recovered){reloadFrame(html,'/');setStatus('Versão publicada carregada');}
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
// Salvamento real: IndexedDB com alternativa local e indicação visível de sucesso.
let fsDraftRevision=0,fsLastSavedRevision=0,fsSaveQueue=Promise.resolve(),fsDraftLastSuccess=0;
const FS_DRAFT_FALLBACK='fresuni-editor-draft-backup-v2';
function fsAutosaveStatus(message,kind='info'){
 const el=$('#autosave-state');if(!el)return;
 el.textContent=message;el.dataset.status=kind;el.title=kind==='ok'?'Salvo somente neste navegador; clique em Publicar para atualizar o site.':'Salvamento automático do rascunho';
}
function dirty(){
 state.dirty=true;fsDraftRevision++;
 setStatus('Alterações no rascunho · não publicadas');
 fsAutosaveStatus('◌ Salvando automaticamente…','saving');
 if(!state.restoring){
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>saveDraft().catch(e=>fsDraftFailed(e)),950);
 }
}
function fsDraftFailed(error){
 fsAutosaveStatus('⚠ Erro ao salvar; use Backup','error');
 setStatus('Falha no salvamento local · use Backup para preservar seu trabalho');
 notify('Salvamento automático não concluído: '+(error?.message||'armazenamento indisponível'));
}
function openDraftDb(){return new Promise((resolve,reject)=>{
 if(!window.indexedDB)return reject(Error('IndexedDB indisponível.'));
 const req=indexedDB.open('fresuni-editor-drafts-v1',1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('drafts'))req.result.createObjectStore('drafts');};
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error||Error('Falha ao abrir armazenamento do navegador.'));
 req.onblocked=()=>reject(Error('O armazenamento está ocupado por outra aba.'));
});}
function fsIndexedDraftAction(mode,value){
 return openDraftDb().then(db=>new Promise((resolve,reject)=>{
  let result,settled=false;
  try{
   const tx=db.transaction('drafts',mode==='get'?'readonly':'readwrite');
   const store=tx.objectStore('drafts');
   const req=mode==='get'?store.get(DRAFT_KEY):mode==='delete'?store.delete(DRAFT_KEY):store.put(value,DRAFT_KEY);
   req.onsuccess=()=>{result=req.result;};
   req.onerror=()=>{if(!settled){settled=true;db.close();reject(req.error||Error('Falha na gravação do rascunho.'));}};
   tx.oncomplete=()=>{if(!settled){settled=true;db.close();resolve(result);}};
   tx.onabort=()=>{if(!settled){settled=true;db.close();reject(tx.error||Error('Armazenamento cancelou a operação.'));}};
   tx.onerror=()=>{if(!settled){settled=true;db.close();reject(tx.error||Error('Falha na transação de armazenamento.'));}};
  }catch(e){try{db.close();}catch{}reject(e);}
 }));
}
function fsFallbackDraftAction(mode,value){
 if(mode==='get'){
  const json=localStorage.getItem(FS_DRAFT_FALLBACK);
  return json?JSON.parse(json):null;
 }
 if(mode==='delete'){localStorage.removeItem(FS_DRAFT_FALLBACK);return null;}
 localStorage.setItem(FS_DRAFT_FALLBACK,JSON.stringify(value));return true;
}
async function draftAction(mode,value){
 if(mode==='get'){
  let indexed=null,fallback=null;
  try{indexed=await fsIndexedDraftAction('get');}catch(e){}
  try{fallback=fsFallbackDraftAction('get');}catch(e){}
  if(indexed||fallback)return !indexed?fallback:!fallback?indexed:
   (Number(indexed.savedAt)||0)>=(Number(fallback.savedAt)||0)?indexed:fallback;
  return null;
 }
 if(mode==='delete'){
  try{await fsIndexedDraftAction('delete');}catch(e){}
  try{fsFallbackDraftAction('delete');}catch(e){}
  return true;
 }
 try{
  await fsIndexedDraftAction('put',value);
  // O arquivo foi gravado e a transação foi concluída.
  try{localStorage.removeItem(FS_DRAFT_FALLBACK);}catch(e){}
  return true;
 }catch(err){
  try{return fsFallbackDraftAction('put',value);}
  catch(localErr){throw Error('IndexedDB: '+err.message+'. Armazenamento local: '+localErr.message);}
 }
}
async function saveDraft(){
 if(!state.dirty||state.restoring||state.loading)return false;
 const revision=fsDraftRevision,html=serialize();
 const value={html,sha:state.sha,savedAt:Date.now(),route:state.route};
 const work=async()=>{
  if(!state.dirty)return;
  await draftAction('put',value);
  fsLastSavedRevision=Math.max(fsLastSavedRevision,revision);
  fsDraftLastSuccess=Date.now();
  if(fsLastSavedRevision>=fsDraftRevision){
   const date=new Date(fsDraftLastSuccess).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
   fsAutosaveStatus('✓ Salvo automaticamente às '+date,'ok');
   setStatus('Rascunho salvo neste navegador · ainda não publicado');
  }else fsAutosaveStatus('◌ Registrando últimas alterações…','saving');
 };
 fsSaveQueue=fsSaveQueue.catch(()=>{}).then(work);
 await fsSaveQueue;
 return true;
}
async function restoreDraftIfAny(){let draft;try{draft=await draftAction('get');}catch(e){notify('Salvamento local indisponível: '+e.message);return false;}if(!draft?.html||draft.html===state.html)return false;
 const date=new Date(draft.savedAt).toLocaleString('pt-BR');const conflict=draft.sha!==state.sha;
 if(conflict){
  if(confirm('Este rascunho foi criado sobre uma versão antiga do site. Restaurá-lo integralmente poderia apagar melhorias mais recentes.\n\nDeseja baixar uma cópia de segurança do rascunho antigo? A versão atual será carregada sem sobrescrever nada.')){
   exportText(draft.html,'fresuni-rascunho-antigo-'+new Date(draft.savedAt).toISOString().slice(0,10)+'.html');
  }
  fsAutosaveStatus('⚠ Rascunho antigo não aplicado para proteger o site','error');
  notify('Versão publicada preservada. Rascunho antigo não substituiu o site.');
  return false;
 }

 if(confirm('Encontramos um rascunho de '+date+'.'+(conflict?' O site foi publicado novamente desde então; revise antes de publicar.':'')+'\n\nRestaurar o trabalho que não foi publicado?')){
   state.restoring=true;state.undo=[];state.redo=[];state.dirty=true;fsDraftRevision++;fsLastSavedRevision=fsDraftRevision;fsAutosaveStatus('✓ Rascunho recuperado do navegador','ok');reloadFrame(draft.html,draft.route&&draft.html.includes('data-route="'+draft.route+'"')?draft.route:'/');state.restoring=false;setStatus('Rascunho recuperado · não publicado');notify('Rascunho recuperado neste navegador.');return true;
 }return false;}


 // Metadados editoriais automáticos: mudar somente na publicação, jamais em visitas.
 function fsPageDate(value){
  const date=new Date(value);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).map(x=>[x.type,x.value]));
  return parts.day+'/'+parts.month+'/'+parts.year+' às '+parts.hour+':'+parts.minute;
 }
 function fsKeepDateStyle(old,next){
  for(const attr of [...old.attributes]){
   if(attr.name==='style'||attr.name==='class'||(attr.name.startsWith('data-fresuni-')&&!/date|created|updated|manual|selected/i.test(attr.name)))next.setAttribute(attr.name,attr.value);
  }
 }
 function fsPageDateElement(doc,created,updated){
  const div=doc.createElement('div');div.className='fresuni-page-meta';div.setAttribute('data-fresuni-page-meta','');div.setAttribute('data-created-at',created);div.setAttribute('data-updated-at',updated);div.setAttribute('role','note');div.setAttribute('aria-label','Histórico desta página');
  for(const [label,value] of [['Criado em:',created],['Última atualização:',updated]]){
   const span=doc.createElement('span'),strong=doc.createElement('strong'),time=doc.createElement('time');
   strong.textContent=label;time.dateTime=value;time.textContent=fsPageDate(value);span.append(strong,doc.createTextNode(' '),time);div.append(span);
  }
  return div;
 }
 function fsComparePageForDates(page){
  if(!page)return '';
  const copy=page.cloneNode(true);copy.removeAttribute('hidden');copy.removeAttribute('data-editor-group');
  copy.querySelectorAll('[data-fresuni-page-meta]').forEach(el=>el.remove());
  copy.querySelectorAll('.is-visible,.fresuni-enter,.fresuni-activated').forEach(el=>el.classList.remove('is-visible','fresuni-enter','fresuni-activated'));
  return copy.outerHTML;
 }
 function fsPreparePublishDates(html){
  const next=new DOMParser().parseFromString(html,'text/html');
  const original=new DOMParser().parseFromString(state.html,'text/html');
  const oldPages=new Map([...original.querySelectorAll('main > .site-page[data-route]')].map(p=>[p.dataset.route,p]));
  const now=new Date().toISOString();
  const sharedChanged=(original.querySelector('.site-header')?.outerHTML||'')!==(next.querySelector('.site-header')?.outerHTML||'')||(original.querySelector('.site-footer')?.outerHTML||'')!==(next.querySelector('.site-footer')?.outerHTML||'');
  for(const page of next.querySelectorAll('main > .site-page[data-route]')){
   const previous=oldPages.get(page.dataset.route);
   const priorMeta=previous?.querySelector('[data-fresuni-page-meta]');
   const pendingMeta=page.querySelector('[data-fresuni-page-meta]');
   if(page.dataset.fresuniDates==='off'){page.querySelectorAll('[data-fresuni-page-meta]').forEach(x=>x.remove());continue;}
   const created=pendingMeta?.hasAttribute('data-fresuni-created-manual')?(pendingMeta.dataset.createdAt||now):previous?(priorMeta?.dataset.createdAt||now):now;
   const updated=pendingMeta?.hasAttribute('data-fresuni-updated-manual')?(pendingMeta.dataset.updatedAt||now):previous&&fsComparePageForDates(previous)===fsComparePageForDates(page)&&!sharedChanged?(priorMeta?.dataset.updatedAt||now):now;
   // A posição e a formatação da caixa de datas são preservadas.
   // Impede duplicação da data manual antiga ao recuperar rascunhos anteriores.
   if(page.dataset.route==='/noticias/um-novo-site-fresuni')page.querySelectorAll('p[data-fresuni-block="text"]').forEach(p=>{if(p.textContent.trim().startsWith('Úlitma atualização 01/11/2026'))p.remove();});
   const fresh=fsPageDateElement(next,created,updated);
   if(pendingMeta){fsKeepDateStyle(pendingMeta,fresh);pendingMeta.replaceWith(fresh);page.querySelectorAll('[data-fresuni-page-meta]').forEach(el=>{if(el!==fresh)el.remove();});}else page.append(fresh);
  }
  if(!next.getElementById('fresuni-page-meta-style')){
   const publishedStyle=original.getElementById('fresuni-page-meta-style');
   if(publishedStyle)next.head.append(publishedStyle.cloneNode(true));
  }
  return '<!doctype html>\n'+next.documentElement.outerHTML;
 }


 function fsDateInput(iso){
  if(!iso)return '';
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
 }
 function fsSyncPageDates(){
  const page=selectedPage(),meta=page?.querySelector('[data-fresuni-page-meta]');
  $('#fs-date-created').value=fsDateInput(meta?.dataset.createdAt);
  $('#fs-date-updated').value=fsDateInput(meta?.dataset.updatedAt);
  $('#fs-date-status').textContent=page?.dataset.fresuniDates==='off'?'Bloco removido desta página. Você pode adicioná-lo ou restaurá-lo.':meta?'Datas ativas: você pode ajustá-las manualmente ou deixar a atualização automática.':'Esta página não possui datas: use Adicionar bloco.';
  $('#fs-date-add').disabled=!!meta;
  $('#fs-date-remove').disabled=!meta;
 }
 function fsPublishedDates(page){
  const published=new DOMParser().parseFromString(state.html,'text/html');
  return [...published.querySelectorAll('main > .site-page[data-route]')].find(p=>p.dataset.route===page.dataset.route)?.querySelector('[data-fresuni-page-meta]')||null;
 }
 function fsAddDates(page,restore){
  if(!page)return null;
  const existing=page.querySelector('[data-fresuni-page-meta]');if(existing){delete page.dataset.fresuniDates;return existing;}
  const previous=fsPublishedDates(page),now=new Date().toISOString();
  const el=fsPageDateElement(siteDoc(),previous?.dataset.createdAt||now,restore?(previous?.dataset.updatedAt||now):now);
  if(previous)fsKeepDateStyle(previous,el);
  page.append(el);delete page.dataset.fresuniDates;return el;
 }
 $('#fs-date-add').addEventListener('click',()=>{const page=selectedPage();if(!page)return;snapshot();fsAddDates(page,true);fsSyncPageDates();dirty();notify('Bloco de datas adicionado a esta página.');});
 $('#fs-date-remove').addEventListener('click',()=>{const page=selectedPage(),el=page?.querySelector('[data-fresuni-page-meta]');if(!el)return;
  if(!confirm('Remover as datas desta página? Você poderá restaurá-las depois.'))return;
  snapshot();page.dataset.fresuniDates='off';el.remove();clearSelection();fsSyncPageDates();dirty();notify('Datas removidas somente desta página.');
 });
 $('#fs-date-restore').addEventListener('click',()=>{const page=selectedPage();if(!page)return;const previous=fsPublishedDates(page);
  if(!previous){notify('Ainda não há datas salvas na versão publicada. Use Adicionar bloco.');return;}
  snapshot();page.querySelectorAll('[data-fresuni-page-meta]').forEach(x=>x.remove());
  page.append(siteDoc().importNode(previous,true));delete page.dataset.fresuniDates;clearSelection();fsSyncPageDates();dirty();
  notify('Bloco original de datas restaurado no rascunho.');
 });
 function fsUpdateDateMeta(created,updated,manualCreated,manualUpdated){
  const page=selectedPage();if(!page)return;
  const old=fsAddDates(page,true);
  const next=fsPageDateElement(siteDoc(),created,updated);fsKeepDateStyle(old,next);
  if(manualCreated)next.setAttribute('data-fresuni-created-manual','');
  if(manualUpdated)next.setAttribute('data-fresuni-updated-manual','');
  old.replaceWith(next);if(state.selected===old){state.selected=null;selectElement(next);}
  fsSyncPageDates();dirty();
 }
 $('#fs-date-apply').addEventListener('click',()=>{
  const a=$('#fs-date-created').value,b=$('#fs-date-updated').value;
  if(!a||!b){notify('Preencha ambas as datas e horários.');return;}
  const created=new Date(a+':00-03:00'),updated=new Date(b+':00-03:00');
  if(!Number.isFinite(created.getTime())||!Number.isFinite(updated.getTime())||updated<created){notify('Confira as datas: a atualização não pode anteceder a criação.');return;}
  snapshot();fsUpdateDateMeta(created.toISOString(),updated.toISOString(),true,true);
  notify('Datas corrigidas no rascunho. Publique para atualizar o site.');
 });
 $('#fs-date-reset').addEventListener('click',()=>{
  const page=selectedPage();if(!page)return;
  snapshot();const el=fsAddDates(page,true),old=fsPublishedDates(page);
  fsUpdateDateMeta(old?.dataset.createdAt||el.dataset.createdAt,el.dataset.updatedAt,false,false);
  notify('Modo automático reativado. A data será renovada quando a página mudar e for publicada.');
 });


 // Matérias são arquivadas pela data de publicação original, nunca pela última atualização.
 function fsNewsCurrentMonth(){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month;
 }
 function fsIsNewsStory(page){
  return !!page?.dataset?.route && page.dataset.route.startsWith('/noticias/') &&
   !page.hasAttribute('data-fresuni-news-archive') && !/^\/noticias\/\d{4}$/.test(page.dataset.route);
 }
 function fsSyncNewsMonth(){
  const p=selectedPage(),panel=$('#fs-news-publication'),input=$('#fs-news-month');
  if(!panel||!input)return;
  panel.hidden=!fsIsNewsStory(p);input.value=fsIsNewsStory(p)?(p.dataset.publishedMonth||''):'';
  $('#fs-news-month-status').textContent=!panel.hidden
   ?(input.value?'Arquivo baseado na publicação original: '+input.value.slice(5,7)+'/'+input.value.slice(0,4):'Informe o mês e o ano originais para arquivar corretamente.'):'';
 }
 function fsRefreshNewsArchives(root){
  const main=root.querySelector('main#conteudo'),collection=main?.querySelector('.site-page[data-route="/noticias"]');
  if(!collection)return;
  const doc=root.nodeType===9?root:root.ownerDocument;
  const yearNow=Number(fsNewsCurrentMonth().slice(0,4));
  const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const stories=[...main.querySelectorAll('.site-page[data-route]')].filter(fsIsNewsStory).map(page=>{
   const month=page.dataset.publishedMonth||'';
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return null;
   return {route:page.dataset.route,title:page.dataset.title||page.querySelector('h1')?.textContent.trim()||'Notícia',
    intro:page.querySelector('.page-lead')?.textContent.trim()||page.querySelector('article p')?.textContent.trim()||'',
    month,year:Number(month.slice(0,4))};
  }).filter(Boolean);
  function card(story){
   const a=doc.createElement('a');a.href='#'+story.route;a.className='content-card';a.dataset.fresuniMotion='zoom';a.setAttribute('data-reveal','');
   const eye=doc.createElement('span');eye.className='card-eyebrow';eye.textContent='Notícia · '+months[Number(story.month.slice(5))-1]+' de '+story.year;
   const name=doc.createElement('h3');name.textContent=story.title;
   const text=doc.createElement('p');text.textContent=story.intro;
   const link=doc.createElement('span');link.className='card-action';link.textContent='Ler notícia ↗';
   a.append(eye,name,text,link);return a;
  }
  const latest=collection.querySelector('.container.page-shell > .card-grid');
  if(latest){
   for(const a of [...latest.querySelectorAll(':scope > a.content-card')]){
    const s=stories.find(v=>'#'+v.route===a.getAttribute('href'));
    if(s&&s.year<yearNow)a.remove();
   }
   for(const s of stories.filter(v=>v.year>=yearNow)){
    if(![...latest.querySelectorAll(':scope > a.content-card')].some(a=>a.getAttribute('href')==='#'+s.route))latest.append(card(s));
   }
  }
  const archiveStories=stories.filter(s=>s.year<yearNow);
  const years=[...new Set(archiveStories.map(s=>s.year))].sort((a,b)=>b-a);
  let index=collection.querySelector('[data-fresuni-year-index]');
  if(!index){
   index=doc.createElement('section');index.className='fresuni-year-index';index.dataset.fresuniYearIndex='';
   index.innerHTML='<h2>Notícias de anos anteriores</h2><p>Arquivo por ano de publicação original.</p><nav aria-label="Arquivo de notícias por ano"></nav>';
   collection.querySelector('.container.page-shell')?.append(index);
  }
  index.hidden=!years.length;
  let nav=index.querySelector('nav');if(!nav){nav=doc.createElement('nav');nav.setAttribute('aria-label','Arquivo de notícias por ano');index.append(nav);}
  nav.replaceChildren();
  for(const year of years){
   let p=main.querySelector('.site-page[data-fresuni-news-archive="'+year+'"]');
   if(!p){
    p=doc.createElement('div');p.className='site-page';p.hidden=true;p.dataset.route='/noticias/'+year;p.dataset.title='Arquivo de notícias — '+year;
    p.dataset.editorGroup='noticias';p.dataset.editorParent='/noticias';p.dataset.editorNav='false';p.dataset.fresuniNewsArchive=String(year);
    p.innerHTML='<div class="container page-shell"><nav class="breadcrumbs" aria-label="Caminho de navegação"><a href="#/">Início</a> / <a href="#/noticias">Notícias</a> / <span aria-current="page"></span></nav><div class="page-heading"><span class="eyebrow">Memória do FRESUNI</span><h1></h1><p class="page-lead">Arquivo por ano da publicação original.</p></div><nav aria-label="Voltar à seção" class="return-links"><a href="#/noticias">← Voltar para Notícias</a></nav></div>';
    main.append(p);
   }
   const shell=p.querySelector('.container.page-shell');p.dataset.title='Arquivo de notícias — '+year;
   p.querySelector('[aria-current="page"]').textContent=String(year);
   p.querySelector('.page-heading h1').textContent='Arquivo de notícias de '+year;
   shell.querySelectorAll('.fresuni-archive-month').forEach(n=>n.remove());
   const list=archiveStories.filter(s=>s.year===year).sort((a,b)=>b.month.localeCompare(a.month)||a.title.localeCompare(b.title,'pt-BR'));
   for(const month of [...new Set(list.map(s=>s.month))]){
    const sec=doc.createElement('section');sec.className='fresuni-archive-month';sec.dataset.fresuniMonth=month;
    const title=doc.createElement('h2');title.textContent=months[Number(month.slice(5))-1]+' de '+year;
    const grid=doc.createElement('div');grid.className='card-grid';
    list.filter(s=>s.month===month).forEach(s=>grid.append(card(s)));
    sec.append(title,grid);shell.insertBefore(sec,shell.querySelector('.return-links'));
   }
   const a=doc.createElement('a');a.href='#/noticias/'+year;a.className='fresuni-year-link';
   const strong=doc.createElement('strong');strong.textContent=String(year);
   const detail=doc.createElement('span');detail.textContent=list.length+(list.length===1?' matéria':' matérias');
   a.append(strong,detail);nav.append(a);
  }
 }
 $('#fs-news-month').addEventListener('change',event=>{
  const p=selectedPage();if(!fsIsNewsStory(p))return;
  const month=event.target.value;
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){notify('Informe um mês e ano válidos.');return;}
  snapshot();
  if(month)p.dataset.publishedMonth=month;else delete p.dataset.publishedMonth;
  fsRefreshNewsArchives(siteDoc());fsSyncNewsMonth();renderPages();dirty();
  notify('Data original atualizada no rascunho; o arquivo será reorganizado quando publicar.');
 });


 // Boxes próprios, editáveis como bloco com título e texto independentes.
 function fsCurrentInfoBox(){return state.selected?.closest?.('.fresuni-info-box')||null;}
 function fsSyncInfoBox(){
  const box=fsCurrentInfoBox(),panel=$('#fs-info-box-controls');
  if(!panel)return;
  panel.hidden=!box;if(!box)return;
  const style=frame.contentWindow.getComputedStyle(box);
  $('#fs-info-box-theme').value=box.dataset.fresuniBoxTheme||'soft';
  $('#fs-info-box-background').value=toHex(style.backgroundColor,'#faf6ff');
  $('#fs-info-box-border').value=toHex(style.borderTopColor,'#c8a5e8');
  $('#fs-info-box-radius').value=parseInt(style.borderTopLeftRadius)||0;
  $('#fs-info-box-padding').value=parseInt(style.paddingTop)||24;
 }
 $('#fs-info-box-select').addEventListener('click',()=>{
  const box=fsCurrentInfoBox();if(!box)return;
  state.selected=null;selectElement(box);
  notify('Box inteiro selecionado. Ajuste suas dimensões ou arraste-o pela grade.');
 });
 $('#fs-info-box-theme').addEventListener('change',e=>{
  const box=fsCurrentInfoBox();if(!box)return;
  snapshot();box.dataset.fresuniBoxTheme=e.target.value;
  for(const prop of ['background-color','border-color','border-width','border-style'])box.style.removeProperty(prop);
  fsSyncInfoBox();dirty();
 });
 for(const [id,prop,convert] of [
  ['fs-info-box-background','backgroundColor',v=>v],
  ['fs-info-box-border','borderColor',v=>v],
  ['fs-info-box-radius','borderRadius',v=>Math.max(0,Math.min(60,+v||0))+'px'],
  ['fs-info-box-padding','padding',v=>Math.max(4,Math.min(100,+v||24))+'px']
 ]){
  $('#'+id).addEventListener('change',e=>{
   const box=fsCurrentInfoBox();if(!box)return;
   snapshot();box.style[prop]=convert(e.target.value);dirty();positionResizeGrip();
  });
 }

function remember(){const html=serialize();if(state.undo[state.undo.length-1]!==html){state.undo.push(html);if(state.undo.length>25)state.undo.shift();state.redo=[];}}
function selectRoute(route){
 if(!pageFor(route))return;
 state.route=route;state.selected=null;clearSelection();
 try{frame.contentWindow.location.hash='#'+route;}catch{}
 const pages=pageNodes();pages.forEach(p=>{p.hidden=p.dataset.route!==route;});
 const d=siteDoc();if(d){d.body.classList.toggle('homepage',route==='/');d.title=titleOf(pageFor(route))+' | FRESUNI';}
 $('#current-page-title').textContent=titleOf(pageFor(route));$('#current-route').textContent='#'+route;
 updatePageSidebar();renderPages();updateHomeQuickTargets();refreshHomeQuickButtons();fsSyncPageDates();fsSyncNewsMonth();window.FRESUNI_FLOW_EDITOR?.onRoute?.();
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
  ensureCompleteFonts(d);
  let effects=d.getElementById('fresuni-extra-effects');if(!effects){effects=d.createElement('style');effects.id='fresuni-extra-effects';d.head.append(effects);}effects.textContent=motionCss;
  const style=d.createElement('style');style.id='fresuni-editor-overlay';style.textContent=`
   [data-fresuni-editable="true"]{cursor:text;min-width:10px;min-height:1em;border-radius:2px;outline:1px solid transparent;outline-offset:3px;}
   [data-fresuni-editable="true"]:hover{outline:1px dashed #af65ed}
   [data-fresuni-selected]{outline:3px solid #214ECF!important;outline-offset:4px;position:relative}
   [data-fresuni-selected]::selection{background:#e2bbff}
   .fresuni-resize-grip{position:absolute;z-index:99999;width:19px;height:19px;border-radius:6px;background:#214ECF;border:3px solid white;box-shadow:0 0 0 2px #214ECF,0 2px 9px #3335;cursor:nwse-resize;touch-action:none}
   .fresuni-resize-grip:focus-visible{outline:3px solid #333;outline-offset:4px}
   .fresuni-resize-label{position:absolute;z-index:99998;background:#2d0c4f;color:white;font:12px Prompt,Arial,sans-serif;padding:3px 8px;border-radius:5px;pointer-events:none}
   body{scroll-behavior:auto!important}
   [data-reveal]:not(.fresuni-previewing){opacity:1!important;transform:none!important;visibility:visible!important}
   @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}`;
  style.textContent+=`
.fresuni-quick-add{font:600 13px Prompt,Arial,sans-serif!important;color:#214ECF!important;background:#fbf7ff!important;border:1px dashed #9c3bdf!important;padding:12px!important;border-radius:8px!important;cursor:pointer!important;min-height:44px!important;text-align:left!important;max-width:100%!important;min-width:0!important}.fresuni-quick-add:hover,.fresuni-quick-add:focus-visible{background:#f0ddff!important;outline:2px solid #214ECF!important}`;
  d.head.append(style);
  for(const p of pageNodes())p.dataset.editorGroup=groupFor(p);
  d.addEventListener('click',clickSite,true);
  // O iframe não encaminha teclas ao documento do painel: registrar também nele.
  d.addEventListener('keydown',fsKeyboardHandler,true);
  d.addEventListener('focusin',fsKeyboardFocus,true);
  d.addEventListener('focusin',e=>{if(e.target?.isContentEditable&&state.editable)remember();},true);
  bindDrag(d);setupResizeGrip(d);setupFloatingToolbar(d);setupGoogleFormsHandles(d);window.FRESUNI_FLOW_EDITOR?.bind?.(d);
  d.addEventListener('input',e=>{if(e.target?.isContentEditable){dirty();if(e.target===state.selected)updateTextInspector(e.target);requestAnimationFrame(positionResizeGrip);}});
  d.addEventListener('focusout',e=>{if(e.target?.isContentEditable){dirty();}},true);
  d.addEventListener('selectionchange',()=>{captureTextSelection();requestAnimationFrame(positionFloatingToolbar);});
  d.addEventListener('mouseup',()=>{captureTextSelection();positionFloatingToolbar();});
  d.addEventListener('keyup',()=>{captureTextSelection();positionFloatingToolbar();});
  $$('a',d).forEach(a=>{if(a.target==='_blank')a.rel='noopener noreferrer';});
  fsRefreshNewsArchives(d);selectRoute(route);setEditable(state.editable);renderStructurePanel();
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
// Edição de qualquer texto visível, sem tornar o contêiner de uma página editável.
const editTextSelectors='h1,h2,h3,h4,h5,h6,p,li,summary,blockquote,cite,figcaption,dt,dd,th,td,small,caption,span,strong,em,b,i,mark,code,label,a,button,div,section,article,[data-fresuni-editor-text]';
function editableTextElement(el){
 if(!el?.closest?.('.site-page,.site-header,.site-footer'))return false;
 if(el.closest('script,style,svg,iframe,.access-panel,.header-actions,.breadcrumbs,[data-editor-internal],.fresuni-quick-add,[data-fresuni-page-meta]'))return false;
 if(!el.matches(editTextSelectors))return false;
 // O título dentro de <summary> é um texto independente: não transformar seu
 // contêiner em editor de texto, pois isso capturava o clique e impedia a cor do h2.
 if(el.matches('summary')&&el.querySelector('h1,h2,h3,h4,h5,h6'))return false;
 if(el.matches('div,section,article')){
  if(el.matches('.site-page,.page-shell,.container,.home-wrap,.directory-row,.directory-links,.card-grid,.site-header,.site-footer,[data-fresuni-block="google-forms"]'))return false;
  if(el.querySelector('p,h1,h2,h3,h4,h5,h6,a,button,img,iframe,svg,div,section,article'))return false;
  if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return false;
 }
 if(el.matches('a')&&(el.querySelector('img,iframe')||el.classList.contains('content-card')))return false;
 if(el.matches('button')&&(el.closest('.header-actions,.accessibility,.mobile-toggle')||el.hasAttribute('data-menu-toggle')))return false;
 if(el.closest('[data-fresuni-block="google-forms"]'))return el.classList.contains('fresuni-google-forms-title')||el.classList.contains('fresuni-google-form-link');
 if(!el.textContent.trim()&&!el.matches('[data-fresuni-editor-text]'))return false;
 return true;
}
function setEditable(on){
 state.editable=on;if(!on)hideFloatingToolbar();
 $('#preview').setAttribute('aria-pressed',String(!on));
 $('#preview').textContent=on?'◉ Pré-visualizar':'✎ Voltar à edição';
 const d=siteDoc();if(!d)return;
 // Limpar primeiro: evita editores aninhados e interferência nas páginas diferentes.
 $$('[data-fresuni-editable]',d).forEach(el=>{
  el.removeAttribute('contenteditable');el.removeAttribute('data-fresuni-editable');el.removeAttribute('spellcheck');
 });
 if(on){
  const candidates=$$(editTextSelectors,d).filter(editableTextElement);
  candidates.forEach(el=>{
   if(el.closest('[data-fresuni-editable]'))return;
   if(el.matches('span,strong,em,b,i,mark,code')&&el.parentElement?.closest('[data-fresuni-editable]'))return;
   el.setAttribute('contenteditable','true');el.dataset.fresuniEditable='true';el.setAttribute('spellcheck','true');
  });
 }
 fsKeyboardUpdateTabStops(d,on);
 fsEditorActionsUpdate();
 refreshHomeQuickButtons();window.FRESUNI_FLOW_EDITOR?.onMode?.();
}

/* FRESUNI | navegação e edição por teclado.
   A digitação nativa prevalece. Mover usa o fluxo do documento para não sobrepor caixas.
   Excluir exige ação explícita e confirmação; operações podem ser desfeitas. */
let fsKeyboardMode=false;
function fsKeyboardFeedback(message){
 const target=$('#fs-keyboard-status');if(target)target.textContent=message;
 const actions=$('#fs-element-actions-status');if(actions)actions.textContent=message;
}
function fsKeyboardTyping(target){
 return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="combobox"]');
}
function fsKeyboardUpdateTabStops(d,on){
 if(!d)return;
 // O Editor pode habilitar/desabilitar digitação sem recarregar a prévia.
 d.querySelectorAll('[data-fresuni-keynav]').forEach(el=>{
  const old=el.getAttribute('data-fresuni-keynav');
  if(old==='__absent__')el.removeAttribute('tabindex');
  else el.setAttribute('tabindex',old);
  el.removeAttribute('data-fresuni-keynav');
 });
 if(!on)return;
 const selectors='main > .site-page:not([hidden]) [data-fresuni-editable],main > .site-page:not([hidden]) [data-fresuni-block],main > .site-page:not([hidden]) img,main > .site-page:not([hidden]) .fresuni-info-box';
 for(const el of d.querySelectorAll(selectors)){
  if(el.closest('.sr-only,[data-editor-internal]')||el.closest('a[href]')&&!el.matches('a')||el.closest('[hidden]'))continue;
  if(el.hasAttribute('tabindex'))continue;
  el.setAttribute('data-fresuni-keynav','__absent__');
  el.setAttribute('tabindex','0');
 }
}
function fsKeyboardFocus(event){
 if(!state.editable)return;
 const target=event.target;
 if(!target?.closest||!target.closest('main > .site-page:not([hidden])'))return;
 const candidate=target.closest('[data-fresuni-editable],[data-fresuni-block],.fresuni-info-box,img,a[href]');
 if(candidate&&candidate!==state.selected)selectElement(candidate);
}
function fsKeyboardCandidate(){
 const el=state.selected,page=selectedPage();
 if(!el?.isConnected)return null;
 const shared=el.closest('.site-header,.site-footer');
 if(!shared&&!page?.contains(el))return null;
 if(el.closest('[data-editor-internal],.breadcrumbs,.return-links,[data-fresuni-page-meta],.access-panel,.accessibility,.header-actions,.mobile-toggle,.fresuni-quick-add'))return null;
 if(shared){
  // No rodapé e no menu, permitir selecionar cada texto, imagem ou link
  // sem desmontar os contêineres responsáveis pela navegação.
  if(el.matches('.site-header,.site-footer,.header-inner,.footer-inner,.main-nav,.header-actions,nav,.subnav,.nav-group'))return null;
  if(el.closest('.site-header .main-nav')){
   const nav=el.closest('.main-nav');let item=el;
   while(item.parentElement&&item.parentElement!==nav)item=item.parentElement;
   return item.parentElement===nav&&!item.matches('.main-nav,.header-actions')?item:null;
  }
  if(el.closest('.site-footer nav')){
   const nav=el.closest('.site-footer nav');let item=el;
   while(item.parentElement&&item.parentElement!==nav)item=item.parentElement;
   return item.parentElement===nav?item:null;
  }
  if(el.closest('.site-footer .footer-inner')){
   const parent=el.closest('.footer-inner');let item=el;
   while(item.parentElement&&item.parentElement!==parent)item=item.parentElement;
   return item.parentElement===parent&&!item.matches('nav')?item:null;
  }
  if(el.closest('.site-header .header-inner')){
   const parent=el.closest('.header-inner');let item=el;
   while(item.parentElement&&item.parentElement!==parent)item=item.parentElement;
   return item.parentElement===parent&&!item.matches('.main-nav,.header-actions')?item:null;
  }
  if(el.parentElement===shared&&!el.matches('nav,.header-inner,.footer-inner'))return el;
  return null;
 }
 if(el.closest('#fresuni-home-highlights,.fresuni-highlights-track,.fresuni-home-highlights'))return null;
 // Mover a linha expansível ou o grupo da grade preserva texto e acessibilidade.
 if(el.closest('.home-values .value-summary'))return el.closest('.value-section');
 if(el.closest('.home-directory .directory-row')&&el.matches('h1,h2,h3,h4,h5,h6')&&!el.closest('.directory-links'))
  return el.closest('.directory-row');
 if(el.closest('.directory-links')){
  const zone=el.closest('.directory-links');let node=el;
  while(node.parentElement&&node.parentElement!==zone)node=node.parentElement;
  return node.parentElement===zone?node:null;
 }
 const block=el.closest('[data-fresuni-block],.fresuni-info-box,.fresuni-program-card,.content-card');
 if(block&&page.contains(block))return block;
 if(el.closest('.page-heading')&&el.matches('h1,h2,h3,h4,h5,h6'))return null;
 if(el.matches('.site-page,.home-wrap,.page-shell,.container,main,.home-values,.home-directory,.value-disclosure,.value-summary'))return null;
 return el;
}
function fsKeyboardMove(key,large=false){
 const el=fsKeyboardCandidate();
 if(!el||!el.parentElement){fsKeyboardFeedback('Selecione uma caixa ou texto da página. Os elementos institucionais protegidos não podem ser movidos por atalho.');return;}
 const parent=el.parentElement;
 if(parent.matches('.value-summary,.page-heading,.fresuni-highlight,.fresuni-highlights-track,.fresuni-highlight-content')){
  fsKeyboardFeedback('Selecione a caixa completa ou use a ferramenta de organização para este elemento.');return;
 }
 const grid=parent.matches('.directory-links,.card-grid,.fresuni-gallery-grid,.fresuni-programs,[data-fresuni-grid],[data-fresuni-flow-grid],.fresuni-flow-grid');
 if(key==='ArrowLeft'||key==='ArrowRight'){
  if(!grid){
   // Recuo em fluxo, sem position:absolute nem transform que encubram textos.
   if(el.matches('img,iframe')){fsKeyboardFeedback('Para imagens, use a alça de organização ou o controle de alinhamento.');return;}
   const current=Number.parseFloat(el.style.paddingInlineStart)||0;
   const step=large?24:8,next=Math.max(0,Math.min(160,current+(key==='ArrowRight'?step:-step)));
   if(next===current){fsKeyboardFeedback('Limite de recuo alcançado.');return;}
   snapshot();el.style.boxSizing='border-box';
   if(next)el.style.paddingInlineStart=next+'px';else el.style.removeProperty('padding-inline-start');
   dirty();positionResizeGrip();
   fsKeyboardFeedback('Recuo horizontal: '+next+' px. A disposição continua responsiva.');
   return;
  }
 }
 const parts=[...parent.children].filter(node=>!node.matches('[data-editor-internal],.fresuni-quick-add')&&!node.hasAttribute('hidden'));
 const index=parts.indexOf(el),forward=key==='ArrowRight'||key==='ArrowDown';
 const other=parts[index+(forward?1:-1)];
 if(index<0||!other){fsKeyboardFeedback('Não há outro elemento nesta direção, dentro da mesma área.');return;}
 snapshot();
 if(forward)parent.insertBefore(other,el);else parent.insertBefore(el,other);
 dirty();selectElement(el);positionResizeGrip();
 fsKeyboardFeedback('Elemento movido '+(forward?'para frente':'para trás')+' na ordem da área; sem sobreposição.');
}
function fsCannotDelete(block){
 if(!block?.isConnected)return 'Selecione um elemento antes de excluir.';
 const locked='.value-section,.directory-row,.page-heading,.home-opening,.home-values,.home-directory,.fresuni-program-card,.fresuni-programs,.site-page,.container,.page-shell,.fresuni-action-tile-grid,.fresuni-action-find,.site-header,.site-footer,.header-inner,.footer-inner,.main-nav,nav,.nav-group,.fresuni-highlights-track';
 if(block.matches(locked)||block.matches('h1')||block.closest('[data-fresuni-page-meta]'))
  return 'Este contêiner mantém a estrutura ou a navegação do site. Edite seus elementos internos, sem apagar a estrutura.';
 if(block.closest('.site-header .main-nav')&&block.matches('.nav-root,.nav-group'))
  return 'Edite ou remova o link principal na aba Cabeçalho e Rodapé para preservar o menu.';
 if(block.matches('section,nav,div')&&block.id)
  return 'Este elemento tem uma identificação usada por recursos do site. Edite seu conteúdo interno.';
 if(block.matches('h1,h2,h3,h4,h5,h6')&&block.id){
  const id=block.id,d=siteDoc();
  if(d?.querySelector('[aria-labelledby~="'+CSS.escape(id)+'"],[aria-describedby~="'+CSS.escape(id)+'"]'))
   return 'Este título identifica uma seção para leitores de tela. Edite o texto ou remova o bloco pelo gerenciador.';
 }
 return '';
}
function fsKeyboardDelete(){
 const block=fsKeyboardCandidate();
 const reason=fsCannotDelete(block);
 if(reason){fsKeyboardFeedback(reason);notify(reason);return;}
 const label=(block.textContent||block.getAttribute('alt')||block.tagName).trim().replace(/\s+/g,' ').slice(0,95);
 if(!confirm('Excluir do RASCUNHO o elemento "'+label+'"?\n\nO site publicado não será alterado até você clicar em Publicar. Use Ctrl+Z para recuperar.'))return;
 snapshot();block.remove();clearSelection();dirty();
 fsKeyboardFeedback('Elemento excluído do rascunho. Use Ctrl+Z para recuperar.');
 notify('Item excluído apenas no rascunho.');
}
function fsKeyboardDuplicate(){
 const block=fsKeyboardCandidate();
 const reason=fsCannotDelete(block);
 if(reason){fsKeyboardFeedback('Este elemento estrutural não pode ser duplicado. Selecione o texto ou imagem dentro dele.');return;}
 if(!block?.parentElement)return;
 if(block.closest('.site-header .main-nav')||block.matches('.footer-logo,.brand,.fresuni-menu-logo')){
  fsKeyboardFeedback('Para duplicar logomarcas ou itens de menu, use os controles próprios dessas áreas.');return;
 }
 snapshot();
 const clone=block.cloneNode(true);
 clone.removeAttribute('id');clone.removeAttribute('data-fresuni-selected');
 clone.querySelectorAll('[id],[data-fresuni-selected]').forEach(el=>{el.removeAttribute('id');el.removeAttribute('data-fresuni-selected');});
 clone.removeAttribute('data-fresuni-home-banner');
 if(clone.hasAttribute('data-fresuni-block')&&clone.dataset.fresuniBlock==='banner')clone.removeAttribute('data-fresuni-home-banner');
 block.after(clone);dirty();selectElement(clone);
 fsKeyboardFeedback('Elemento duplicado no rascunho. Publique somente após revisar a nova cópia.');
 notify('Elemento duplicado. Use Desfazer se não gostar.');
}
function fsEditorActionsUpdate(){
 const enabled=state.editable&&!!state.selected?.isConnected;
 const candidate=enabled?fsKeyboardCandidate():null;
 const movable=!!candidate;
 const deletion=movable&&!fsCannotDelete(candidate);
 for(const id of ['fs-element-up','fs-element-down','fs-element-left','fs-element-right','fs-element-parent']){
  const el=$('#'+id);if(el)el.disabled=!movable;
 }
 for(const id of ['fs-element-duplicate','fs-element-delete']){
  const el=$('#'+id);if(el)el.disabled=!deletion;
 }
 const msg=$('#fs-element-actions-status');
 if(msg&&!movable)msg.textContent=state.selected?
  'Esta área preserva estrutura ou navegação. Selecione um elemento interno, como texto, imagem ou link.':
  'Selecione um item na prévia para editar, mover, duplicar ou excluir.';
}
for(const [id,key] of [['fs-element-up','ArrowUp'],['fs-element-down','ArrowDown'],['fs-element-left','ArrowLeft'],['fs-element-right','ArrowRight']]){
 $('#'+id)?.addEventListener('click',()=>fsKeyboardMove(key));
}
$('#fs-element-delete')?.addEventListener('click',()=>fsKeyboardDelete());
$('#fs-element-duplicate')?.addEventListener('click',()=>fsKeyboardDuplicate());
$('#fs-element-parent')?.addEventListener('click',()=>{
 const block=fsKeyboardCandidate();
 if(block&&block!==state.selected){selectElement(block);fsKeyboardFeedback('Caixa completa selecionada; agora você pode organizá-la.');}
 else if(block)fsKeyboardFeedback('O item já está selecionado por completo.');
 else fsKeyboardFeedback('Selecione primeiro um texto, imagem ou botão da página.');
});
function fsKeyboardHandler(event){
 if(!state.editable||app.hidden||event.defaultPrevented)return;
 const key=event.key,isArrow=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key);
 const target=event.target,typing=fsKeyboardTyping(target);
 const fromFrame=event.currentTarget===siteDoc();
 if(fromFrame&&(event.ctrlKey||event.metaKey)&&!typing&&!event.altKey){
  const lower=key.toLowerCase();
  if(lower==='s'){event.preventDefault();$('#draft-save').click();return;}
  if(lower==='z'){event.preventDefault();event.shiftKey?doRedo():doUndo();return;}
  if(lower==='y'){event.preventDefault();doRedo();return;}
 }
 if(key==='Escape'&&state.selected){
  if(typing&&!event.altKey){
   event.preventDefault();
   if(typeof target.blur==='function')target.blur();
   const toggle=$('#fs-keyboard-mode');
   toggle?.focus();
   fsKeyboardFeedback('Digitação encerrada. Use as setas no botão “Mover com teclado” ou Alt+setas para movimentar.');
  }else{
   event.preventDefault();clearSelection();
   fsKeyboardFeedback('Seleção desfeita. Use Tab ou clique em um elemento para selecionar outro.');
  }
  return;
 }
 if(!isArrow&&key!=='Delete'&&key!=='Backspace')return;
 if(event.ctrlKey||event.metaKey)return;
 if(!fsKeyboardMode&&!event.altKey)return;
 // Backspace e as setas nunca podem sequestrar a digitação normal.
 if(typing&&!event.altKey)return;
 if(target?.closest?.('input,textarea,select,[role="combobox"]'))return;
 if(!state.selected?.isConnected)return;
 if((key==='Delete'||key==='Backspace')&&(fsKeyboardMode||event.altKey)){
  event.preventDefault();fsKeyboardDelete();return;
 }
 if(isArrow){
  event.preventDefault();fsKeyboardMove(key,event.shiftKey);
 }
}
$('#fs-keyboard-mode')?.addEventListener('click',()=>{
 fsKeyboardMode=!fsKeyboardMode;
 const button=$('#fs-keyboard-mode');
 button.setAttribute('aria-pressed',String(fsKeyboardMode));
 button.classList.toggle('active',fsKeyboardMode);
 button.textContent=fsKeyboardMode?'⌨ Teclado ativo':'⌨ Mover com teclado';
 fsKeyboardFeedback(fsKeyboardMode?
  'Modo teclado ativo. Selecione um bloco e pressione as setas; Delete e Backspace pedem confirmação.':
  'Modo teclado desligado. Alt+setas ainda permite mover um elemento selecionado.');
});
document.addEventListener('keydown',fsKeyboardHandler,true);

function clickSite(e){
 if(!state.editable)return;
 const target=e.target?.nodeType===1?e.target:e.target?.parentElement;
 if(!target||target.closest('[data-editor-internal]'))return;
 if(target.closest('a,button,summary'))e.preventDefault();
 const summary=target.closest('summary');
 const accordionHeading=summary?.querySelector('h1,h2,h3,h4,h5,h6')||null;
 const clickOnHeading=!!target.closest('h1,h2,h3,h4,h5,h6');
 // No modo Editor, tocar nas letras seleciona o título para formatá-lo.
 // Tocar na seta ou no restante da linha continua expandindo/recolhendo.
 if(summary&&summary.parentElement?.tagName==='DETAILS'&&!clickOnHeading)
  summary.parentElement.open=!summary.parentElement.open;
 if(target.closest('.access-panel,.header-actions'))return;
  const pageDates=target.closest('[data-fresuni-page-meta]');if(pageDates){selectElement(pageDates);$('#fs-date-editor')?.scrollIntoView({block:'nearest'});return;}
 const currentEditable=target.closest('[data-fresuni-editable]');
 let el=accordionHeading||currentEditable||target.closest('p,h1,h2,h3,h4,h5,h6,li,summary,blockquote,cite,figcaption,dt,dd,th,td,small,label,button,img,iframe,a,figure,details,hr,span,strong,em,b,i,mark,code,div,section,article,[data-fresuni-block]');
 if(!el||!el.closest('.site-page,.site-header,.site-footer')){
  const area=target.closest('.site-header,.site-footer');if(area)selectElement(area);return;
 }
 if(el.closest('.breadcrumbs'))return;
 if(el.closest('[data-fresuni-block="shape"]')&&!el.isContentEditable)el=el.closest('[data-fresuni-block="shape"]');
 selectElement(el);
}
function clearSelection(){window.FRESUNI_FLOW_EDITOR?.onClear?.();$('#fs-info-box-controls')?.setAttribute('hidden','');savedTextRange=null;hideFloatingToolbar();const d=siteDoc();if(d)$$('[data-fresuni-selected]',d).forEach(x=>x.removeAttribute('data-fresuni-selected'));state.selected=null;hideResizeGrip();$('#selection-name').textContent='Selecione texto, imagem, cabeçalho ou rodapé na prévia.';$('#selection-props').hidden=true;const media=$('#fs-selected-media');if(media)media.hidden=true;const help=$('#selection-instructions');if(help)help.hidden=false;fsEditorActionsUpdate();}
function selectElement(el){if(state.selected===el)return;clearSelection();state.selected=el;el.dataset.fresuniSelected='';const blk=el.closest('[data-fresuni-block]');if(blk){blk.draggable=true;blk.dataset.fresuniDrag='';}
 $('#selection-name').textContent=(el.tagName.toLowerCase())+' · '+(el.textContent.trim().slice(0,48)||'elemento visual');$('#selection-props').hidden=false;
 updateTextInspector(el);
 const help=$('#selection-instructions');if(help)help.hidden=true;
 if(el.matches('[data-fresuni-page-meta]')){fsSyncPageDates();$('#selection-name').textContent='Caixa de datas · valores em Criação e atualização; estilo e tamanho abaixo';}
 const target=el.matches('img,iframe,a')?el:el.querySelector('img,iframe,a');
 $('#element-url').value=findLinkFor(el)?.getAttribute('href')||'';
 $('#element-alt').value=el.matches('img')?el.alt:(el.querySelector('img')?.alt||'');
 $('#font-size').value=Math.round(parseFloat(frame.contentWindow.getComputedStyle(el).fontSize))||16;
 $('#background-color').value=toHex(frame.contentWindow.getComputedStyle(el).backgroundColor,'#ffffff');
 $('#text-color').value=toHex(frame.contentWindow.getComputedStyle(el).color,'#000000');
 const cs=frame.contentWindow.getComputedStyle(el);$('#font-family').value=cs.fontFamily.toLowerCase().includes('merriweather')?'Merriweather':'Prompt';setWeightOptions($('#font-family').value,Math.round(parseInt(cs.fontWeight)||400));$('#text-preset').value='custom';
 $('#element-width').value=Math.max(10,Math.min(100,Math.round(100*el.getBoundingClientRect().width/(el.parentElement?.getBoundingClientRect().width||el.getBoundingClientRect().width))));
 $('#element-height').value=parseInt(el.style.minHeight)||0;$('#corner-radius').value=parseInt(el.style.borderRadius)||0;$('#border-size').value=parseInt(el.style.borderWidth)||0;
 $('#border-color').value=toHex(cs.borderTopColor,'#214ECF');$('#block-motion').value=el.dataset.fresuniMotion||'none';$('#motion-time').value=parseInt(el.style.getPropertyValue('--fresuni-motion-duration'))||650;
 $('#shape-kind').value=el.dataset.fresuniShape||'box';
 fsSyncControls(el);fsSyncInfoBox();fsMediaRefreshSelected(el);
 const gridItem=fsWholeGridItem(el);
 if(gridItem&&state.editable){gridItem.draggable=true;gridItem.dataset.fresuniDrag='';}
 positionResizeGrip();positionFloatingToolbar();window.FRESUNI_FLOW_EDITOR?.onSelect?.(el);
 fsEditorActionsUpdate();
}
let resizeGrip=null,resizeLabel=null,resizing=false,resizeRaf=0;
function positionResizeGrip(){if(!resizeGrip||!state.selected||!state.selected.isConnected||!state.editable||!state.selected.closest('.site-page:not([hidden]),.site-header,.site-footer')){hideResizeGrip();return;}
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
function isTextEditable(el){
 if(!el||!el.closest('.site-page,.site-header,.site-footer')||el.closest('[data-fresuni-page-meta]'))return false;
 if(el.closest('script,style,svg,iframe,[data-editor-internal]'))return false;
 if(editableTextElement(el))return true;
 // Outras caixas apenas com texto direto (ex.: painéis, elementos de resumo).
 return el.matches('div,section,article')&&![...el.children].some(child=>child.matches('p,h1,h2,h3,h4,h5,h6,a,button,div,section,article,img,iframe,svg'))&&
 [...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim());
}
function updateTextInspector(el){
 const panel=$('#selected-text-panel'),input=$('#selected-text-content');if(!panel||!input)return;
 const enabled=isTextEditable(el);panel.hidden=!enabled;
 const colorPanel=$('#fs-text-own-color-panel');
 if(colorPanel)colorPanel.hidden=!enabled;
 if(!enabled)return;
 fsIndividualColorRead(el);
 input.value=el.innerText??el.textContent??'';
 const complex=!!el.querySelector('a,strong,b,em,i,u,span[style]');
 $('#text-inspector-warning').hidden=!complex;
}

/* Edição de cor por elemento, sem mudar o tema ou os demais textos. */
function fsIndividualColorRead(element){
 const picker=$('#fs-text-own-picker'),hex=$('#fs-text-own-hex'),status=$('#fs-text-own-status');
 if(!picker||!hex||!element)return;
 const computed=frame.contentWindow.getComputedStyle(element).color;
 const value=toHex(computed,'#214ECF').toUpperCase();
 picker.value=value;hex.value=value;
 if(status)status.textContent=element.style.getPropertyValue('color')?
  'Esta cor foi definida apenas neste elemento. Use Restaurar para seguir a identidade da página.':
  'A cor atual vem do estilo da página. Você pode definir uma cor exclusiva para este elemento.';
}
$('#fs-text-own-picker')?.addEventListener('input',e=>{
 $('#fs-text-own-hex').value=e.target.value.toUpperCase();
});
$('#fs-text-own-hex')?.addEventListener('change',e=>{
 const value=e.target.value.trim();
 if(/^#[0-9a-f]{6}$/i.test(value))$('#fs-text-own-picker').value=value;
 else $('#fs-text-own-status').textContent='Informe a cor no formato #214ECF, com seis caracteres hexadecimais.';
});
$('#fs-text-own-apply')?.addEventListener('click',()=>{
 const element=state.selected,color=$('#fs-text-own-hex').value.trim().toUpperCase();
 if(!state.editable||!isTextEditable(element)){notify('Selecione um elemento de texto no modo de edição.');return;}
 if(!/^#[0-9A-F]{6}$/.test(color)){
  $('#fs-text-own-status').textContent='Cor inválida. Use seis caracteres: por exemplo, #214ECF.';return;
 }
 snapshot();
 // Important vence regras institucionais com !important, sem afetar outros elementos.
 element.style.setProperty('color',color,'important');
 element.dataset.fresuniTextColor='individual';
 dirty();updateTextInspector(element);
 $('#fs-text-own-status').textContent='Cor '+color+' aplicada apenas ao texto selecionado, no rascunho.';
 notify('Cor individual aplicada ao texto selecionado.');
});
$('#fs-text-own-reset')?.addEventListener('click',()=>{
 const element=state.selected;
 if(!state.editable||!isTextEditable(element))return;
 snapshot();element.style.removeProperty('color');element.removeAttribute('data-fresuni-text-color');
 dirty();updateTextInspector(element);
 $('#fs-text-own-status').textContent='Cor original retomada apenas neste elemento.';
 notify('Cor original do texto restaurada no rascunho.');
});

$('#selected-text-apply').addEventListener('click',()=>{
 const el=state.selected;if(!isTextEditable(el)){notify('Selecione um título, parágrafo ou link de texto.');return;}
 const input=$('#selected-text-content');
 if(el.querySelector('a,strong,b,em,i,u,span[style]')&&!confirm('Substituir o texto retirará a formatação interna desse bloco. Deseja continuar?'))return;
 snapshot();el.textContent=input.value;dirty();updateTextInspector(el);
 // Se o título da matéria for alterado, seu link na lista de Notícias ou Artigos permanece atualizado.
 if(el.matches('h1')&&el.closest('.site-page')){
  const p=el.closest('.site-page');p.dataset.title=input.value.trim()||p.dataset.title;
  syncStoryReferences(p.dataset.route,p.dataset.title);renderPages();updatePageSidebar();
 }
 notify('Texto alterado no rascunho; clique em Publicar quando estiver pronto.');
});
$('#selected-text-clear').addEventListener('click',()=>{
 const el=state.selected;if(!isTextEditable(el)||!confirm('Apagar somente o conteúdo deste texto? O bloco poderá ser reutilizado.'))return;
 snapshot();el.textContent='';$('#selected-text-content').value='';dirty();notify('Texto apagado apenas no rascunho.');
});
function toHex(color,fallback){const m=color.match(/\d+/g);if(!m||m.length<3)return fallback;return '#'+m.slice(0,3).map(x=>Math.max(0,Math.min(255,+x)).toString(16).padStart(2,'0')).join('');}
function stripTransient(root){
 // Nunca publicar os tabindex usados apenas pelo editor; preservar os originais.
 root.querySelectorAll('[data-fresuni-keynav]').forEach(el=>{
  const before=el.getAttribute('data-fresuni-keynav');
  if(before==='__absent__')el.removeAttribute('tabindex');
  else el.setAttribute('tabindex',before);
  el.removeAttribute('data-fresuni-keynav');
 });
 root.querySelector('body')?.classList.remove('fresuni-editor-flow-on');root.querySelectorAll('[data-fresuni-drop-zone]').forEach(x=>x.removeAttribute('data-fresuni-drop-zone'));root.classList.remove('dark-mode','high-contrast','simple-mode','reduce-motion');
 $$('link[data-fresuni-async-font],link[data-fresuni-font-catalog]',root).forEach(link=>{link.removeAttribute('data-fresuni-async-font');link.removeAttribute('media');});$$('#fresuni-editor-overlay',root).forEach(x=>x.remove());$$('[data-fresuni-selected]',root).forEach(x=>x.removeAttribute('data-fresuni-selected'));
 $$('[data-fresuni-editable]',root).forEach(x=>{x.removeAttribute('data-fresuni-editable');x.removeAttribute('contenteditable');x.removeAttribute('spellcheck');x.removeAttribute('draggable')});
 $$('[data-fresuni-drag]',root).forEach(x=>{x.removeAttribute('data-fresuni-drag');x.removeAttribute('draggable');});
 $$('main > .site-page',root).forEach(p=>{p.hidden=p.dataset.route!=='/';});
 root.querySelector('body')?.classList.add('homepage');
 const d=root.querySelector('title');if(d)d.textContent='Início | FRESUNI';
 root.querySelector('.main-nav')?.classList.remove('nav-open');
 // Limpar somente estados efêmeros; preservar configurações dos efeitos.
 $$('[data-fresuni-counted]',root).forEach(el=>el.removeAttribute('data-fresuni-counted'));
 $$('[data-fresuni-counter]',root).forEach(el=>{
  const v=Math.max(0,Math.min(1000000,Number(el.dataset.fresuniCounter)||0));
  const formatted=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(v);
  el.textContent=formatted+(el.dataset.fresuniCounterSuffix||'');
 });
 $$('.fresuni-activated,.fresuni-enter,.fresuni-previewing',root).forEach(el=>el.classList.remove('fresuni-activated','fresuni-enter','fresuni-previewing'));
 $$('[data-editor-internal]',root).forEach(x=>x.remove());
}
function refreshSearch(root){const scripts=$$('script',root);const script=scripts.find(s=>s.textContent.includes('window.FRESUNI_SEARCH_INDEX='));if(!script)return;
 const match=script.textContent.match(/window\.FRESUNI_SEARCH_INDEX=(\[[^\n]*?\]);/);if(!match)return;
 let original;try{original=JSON.parse(match[1]);}catch{return;}
 const proposalItems=original.filter(x=>x.url?.startsWith('#meta-'));
 const pageEntries=$$('main > .site-page[data-route]',root).map(p=>({title:titleOf(p),description:p.textContent.trim().replace(/\s+/g,' ').slice(0,240),url:'#'+p.dataset.route,type:'Página'}));
 const rep='window.FRESUNI_SEARCH_INDEX='+JSON.stringify([...pageEntries,...proposalItems]).replace(/<\//g,'<\\/')+';';script.textContent=script.textContent.replace(match[0],rep);
}

 // Limpa apenas campos duplicados de introdução e parágrafos realmente vazios.
 function fsCleanupRepeats(root){
  for(const page of root.querySelectorAll('main > .site-page')){
   const lead=page.querySelector('.page-heading .page-lead');
   const norm=v=>(v||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
   page.querySelectorAll('.collection-intro').forEach(p=>{
    if(!norm(p.textContent)||(lead&&norm(lead.textContent)===norm(p.textContent)))p.remove();
   });
   page.querySelectorAll('article p').forEach(p=>{
    if(p.hasAttribute('data-fresuni-block')||p.closest('[contenteditable]'))return;
    if(!p.textContent.trim()&&!p.querySelector('img,iframe,svg,video,audio,input'))p.remove();
   });
  }
 }

// Publicações devem preservar infraestrutura não editável e alertar sobre exclusões.
function fsPrepareSafePublish(html){
 const published=new DOMParser().parseFromString(state.html,'text/html');
 const next=new DOMParser().parseFromString(html,'text/html');
 const oldPages=[...published.querySelectorAll('main > .site-page[data-route]')];
 const nextRoutes=new Set([...next.querySelectorAll('main > .site-page[data-route]')].map(p=>p.dataset.route));
 const missingPages=oldPages.filter(p=>!nextRoutes.has(p.dataset.route)).map(p=>p.dataset.route);
 if(missingPages.length)throw Error('Publicação bloqueada: estas páginas desapareceram da prévia: '+missingPages.join(', ')+'. Recarregue a versão publicada, confira seu rascunho e tente novamente.');
 // Os três destaques originais permanecem recuperáveis mesmo quando substituídos por banners.
 const originalSlides=['acoes','frentes','escuta'];
 const missingSlides=originalSlides.filter(id=>!next.querySelector('#fresuni-home-highlights [data-fresuni-slide="'+id+'"]'));
 if(missingSlides.length)throw Error('Publicação bloqueada: slides originais foram removidos ('+missingSlides.join(', ')+'). Restaure-os antes de publicar.');
 // Recursos técnicos injetados por publicações anteriores não devem sumir ao editar textos.
 const requiredAssets=['fresuni-motion-2026','fresuni-motion-runtime-2026',
  'fresuni-interactive-effects-2026','fresuni-interactive-effects-runtime-2026',
  'fresuni-flow-grid-style','fresuni-page-meta-style','fresuni-archive-styles',
  'fresuni-layout-polish-v2','fresuni-custom-box-style',
  'fresuni-mobile-pdf-and-navigation-2026','fresuni-media-styles','fresuni-media-runtime','fresuni-program-integration-style','fresuni-ux-navigation-2026','fresuni-ux-navigation-runtime','fresuni-blue-brand-2026','fresuni-home-banner-style-2026','fresuni-logo-layout-style-2026','fresuni-carousel-fullslide-style-2026'];
 for(const id of requiredAssets){
  const source=published.getElementById(id);
  if(!source)continue;
  const existing=next.getElementById(id);
  if(existing){
   // A identidade técnica azul de 03/11 é restaurada em rascunhos antigos.
   // Mudanças deliberadas nas cores do editor continuam no tema personalizado.
   if(id==='fresuni-blue-brand-2026'&&existing.textContent!==source.textContent)
    existing.textContent=source.textContent;
   continue;
  }
  const destination=source.tagName==='SCRIPT'&&source.closest('body')?next.body:next.head;
  destination?.append(source.cloneNode(true));
 }



 // Migração suave de rascunhos antigos: corrige apenas o título original "PALESTRAS",
 // sem alterar títulos ou conteúdos que o administrador tenha personalizado.
 const schoolSection=next.querySelector('.site-page[data-route="/"] #palestras-label');
 if(schoolSection?.textContent.trim()==='PALESTRAS')
  schoolSection.textContent='AÇÕES NAS COMUNIDADES ESCOLARES';

 // Preserva ícones sociais mesmo após uma edição textual no painel,
 // sem reconstruir links removidos intencionalmente nem substituir seus textos.
 for(const originalLink of published.querySelectorAll('.site-footer nav a.fresuni-social-link[href]')){
  const href=originalLink.getAttribute('href');
  const draftLink=[...next.querySelectorAll('.site-footer nav a[href]')]
   .find(a=>a.getAttribute('href')===href);
  const icon=originalLink.querySelector('svg.fresuni-social-icon');
  if(draftLink&&icon&&!draftLink.querySelector('svg.fresuni-social-icon')){
   draftLink.classList.add('fresuni-social-link');
   draftLink.prepend(icon.cloneNode(true));
  }
 }

 // Preservar região de banners ao publicar um rascunho criado antes desta ferramenta.
 // Alterações feitas no gerenciador de banners seguem normalmente o rascunho.
 const publishedBanners=published.getElementById('fresuni-home-banner-list');
 if(publishedBanners&&!next.getElementById('fresuni-home-banner-list')){
  const home=next.querySelector('.site-page[data-route="/"] .home-wrap');
  if(!home)throw Error('Não foi possível recuperar a região dos banners da página inicial.');
  home.insertBefore(publishedBanners.cloneNode(true),home.querySelector('.home-directory')||null);
 }

 // Atalhos escolhidos no submenu Ações devem sobreviver a edições comuns
 // de páginas (inclusive textos, títulos e mudança de categoria).
 // A edição deliberada do menu no painel é a única exceção.
 const originalShortcuts=published.querySelector('#sub-acoes[data-fresuni-menu-policy]');
 const draftShortcuts=next.getElementById('sub-acoes');
 if(originalShortcuts&&!fsActionsMenuExplicitEdit){
  if(draftShortcuts)draftShortcuts.replaceWith(originalShortcuts.cloneNode(true));
  else{
   const root=next.querySelector('#menu-principal .nav-group > a.nav-root[href="#/acoes"]');
   if(!root)throw Error('O submenu de Ações desapareceu. Publicação bloqueada para preservar os atalhos.');
   root.closest('.nav-group')?.append(originalShortcuts.cloneNode(true));
  }
 }
 const originalActionsButton=published.querySelector('[data-fresuni-action-directory]');
 const draftActionsButton=next.querySelector('[data-fresuni-action-directory]');
 if(originalActionsButton&&!draftActionsButton){
  const target=next.querySelector('.site-page[data-route="/"] .directory-row[aria-labelledby="conheca-label"] .directory-links');
  if(target)target.prepend(originalActionsButton.cloneNode(true));
  else throw Error('O atalho da página inicial para todas as ações desapareceu. Publicação interrompida.');
 }


 // O carrossel, a busca e a ligação Frentes/Ações são estruturas editoriais.
 // Uma alteração casual em textos não deve excluir estes pontos de navegação.
 const beforeHighlights=published.querySelector('#fresuni-home-highlights[data-fresuni-highlights]');
 const afterHighlights=next.getElementById('fresuni-home-highlights');
 if(beforeHighlights&&!afterHighlights){
  const home=next.querySelector('.site-page[data-route="/"] .home-wrap');
  if(!home)throw Error('A página inicial perdeu sua estrutura; destaques não podem ser preservados.');
  home.insertBefore(beforeHighlights.cloneNode(true),home.querySelector('.home-directory')||null);
 }
 const beforeFronts=published.querySelector('.site-page[data-route="/manifesto/frentes"]');
 const afterFronts=next.querySelector('.site-page[data-route="/manifesto/frentes"]');
 if(beforeFronts&&afterFronts){
  for(const before of beforeFronts.querySelectorAll('.front-list p')){
   const links=before.querySelector('.fresuni-front-related');
   if(!links)continue;
   const key=before.querySelector('strong')?.textContent?.trim();
   const target=[...afterFronts.querySelectorAll('.front-list p')].find(p=>p.querySelector('strong')?.textContent?.trim()===key);
   if(target&&!target.querySelector('.fresuni-front-related'))target.append(links.cloneNode(true));
  }
 }
 const beforeActions=published.querySelector('.site-page[data-route="/acoes"]');
 const afterActions=next.querySelector('.site-page[data-route="/acoes"]');
 if(beforeActions&&afterActions){
  for(const id of ['fresuni-action-search']){
   const missing=afterActions.querySelector('#'+id);
   const original=beforeActions.querySelector('#'+id);
   if(original&&!missing){
    const wrap=original.closest('.fresuni-action-find');
    const framework=afterActions.querySelector('#fresuni-initiative-framework');
    if(wrap&&framework)framework.insertBefore(wrap.cloneNode(true),framework.querySelector('.fresuni-programs')||null);
   }
  }
 }
 // Links "Ver todas" levam à listagem completa; preservar se forem
 // removidos por uma atualização sem intenção de alterar o menu inicial.
 const originalHome=published.querySelector('.site-page[data-route="/"]');
 const nextHome=next.querySelector('.site-page[data-route="/"]');
 if(originalHome&&nextHome){
  for(const id of ['noticias','artigos']){
   const before=originalHome.querySelector('.directory-row[aria-labelledby="'+id+'-label"] .fresuni-directory-see-all');
   const current=nextHome.querySelector('.directory-row[aria-labelledby="'+id+'-label"] .directory-links');
   if(before&&current&&!current.querySelector('.fresuni-directory-see-all'))current.append(before.cloneNode(true));
  }
 }

 // Proteção da organização de iniciativas: editar outra página não pode recriar
 // o antigo catálogo fragmentado nem apagar as relações entre os programas.
 const oldActions=published.querySelector('.site-page[data-route="/acoes"]');
 const newActions=next.querySelector('.site-page[data-route="/acoes"]');
 const oldFramework=oldActions?.querySelector('#fresuni-initiative-framework[data-fresuni-initiative-framework]');
 if(oldActions&&newActions&&oldFramework){
  let framework=newActions.querySelector('#fresuni-initiative-framework');
  if(!framework){
   const shell=newActions.querySelector('.page-shell');
   if(!shell)throw Error('A página Ações perdeu sua estrutura. Publicação interrompida para evitar perda dos programas.');
   framework=oldFramework.cloneNode(true);shell.append(framework);
  }else{
   const grid=framework.querySelector('.fresuni-programs');
   if(!grid)throw Error('A grade de programas integrados foi alterada. Confira a página Ações antes de publicar.');
   for(const oldGroup of oldFramework.querySelectorAll('[data-fresuni-program]')){
    const id=oldGroup.getAttribute('data-fresuni-program');
    let group=[...grid.querySelectorAll('[data-fresuni-program]')].find(g=>g.getAttribute('data-fresuni-program')===id);
    if(!group){grid.append(oldGroup.cloneNode(true));continue;}
    const oldGrid=oldGroup.querySelector('.fresuni-action-tile-grid');
    if(oldGrid){
     let newGrid=group.querySelector('.fresuni-action-tile-grid');
     if(!newGrid){newGrid=oldGrid.cloneNode(true);group.append(newGrid);}
     else{
      const present=new Set([...newGrid.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')));
      for(const tile of oldGrid.querySelectorAll('a.fresuni-action-tile[href]')){
       const href=tile.getAttribute('href');
       if(!present.has(href)){newGrid.append(tile.cloneNode(true));present.add(href);}
      }
     }
    }
    const oldLinks=[...oldGroup.querySelectorAll('a[href^="#/acoes/"]')];
    const actual=new Set([...group.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')));
    for(const a of oldLinks){
     const href=a.getAttribute('href');if(actual.has(href))continue;
     const oldLi=a.closest('li');
     if(oldLi){
      let ul=group.querySelector('ul');if(!ul){ul=next.createElement('ul');group.append(ul);}
      ul.append(oldLi.cloneNode(true));
     }else if(a.classList.contains('fresuni-program-lead')){
      group.insertBefore(a.cloneNode(true),group.querySelector('ul')||null);
     }
     actual.add(href);
    }
   }
  }
  const oldNotice=oldActions.querySelector('[data-fresuni-long-term-notice]');
  if(oldNotice&&!newActions.querySelector('[data-fresuni-long-term-notice]'))
   framework.before(oldNotice.cloneNode(true));
  // Quando um submenu é reprocessado, preservar os destinos dos programas.
  const oldMenu=published.getElementById('sub-acoes'),newMenu=next.getElementById('sub-acoes');
  if(oldMenu&&newMenu&&!fsActionsMenuExplicitEdit){
   const known=new Set([...newMenu.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')));
   for(const a of oldMenu.querySelectorAll('a[href^="#/acoes"]')){
    if(!known.has(a.getAttribute('href'))){newMenu.append(a.cloneNode(true));known.add(a.getAttribute('href'));}
   }
  }
  for(const oldPage of published.querySelectorAll('main > .site-page[data-fresuni-program-role],main > .site-page[data-fresuni-program-member]')){
   const route=oldPage.dataset.route;
   const page=[...next.querySelectorAll('main > .site-page[data-route]')].find(p=>p.dataset.route===route);
   if(!page)continue;
   for(const key of ['fresuniProgramRole','fresuniProgramMember','editorParent','editorNav']){
    if(oldPage.dataset[key]&&!page.dataset[key])page.dataset[key]=oldPage.dataset[key];
   }
   const oldOverview=oldPage.querySelector('[data-fresuni-program-overview]');
   if(oldOverview&&!page.querySelector('[data-fresuni-program-overview]'))
    (page.querySelector('.page-shell')||page).append(oldOverview.cloneNode(true));
   const oldMembership=oldPage.querySelector('[data-fresuni-program-membership]');
   if(oldMembership&&!page.querySelector('[data-fresuni-program-membership]'))
    (page.querySelector('.page-article')||page.querySelector('.page-shell')||page).prepend(oldMembership.cloneNode(true));
  }
 }
 // O Estatuto deve sempre apontar para o PDF real, jamais ao antigo base64 incorporado.
 const sourceStat=published.querySelector('.site-page[data-route="/estatuto"]');
 const nextStat=next.querySelector('.site-page[data-route="/estatuto"]');
 const sourceActions=sourceStat?.querySelector('.fresuni-file-actions');
 if(nextStat&&sourceActions){
  const actions=nextStat.querySelector('.fresuni-file-actions');
  if(!actions){
   const obsolete=[...nextStat.querySelectorAll('a[href^="data:application/pdf"]')][0]
    ||nextStat.querySelector('a[download="Estatuto-da-Associacao-FRESUNI.pdf"]');
   if(obsolete)obsolete.replaceWith(sourceActions.cloneNode(true));
   else nextStat.querySelector('.page-article')?.prepend(sourceActions.cloneNode(true));
  }else{
   const canonicalLinks=[...sourceActions.querySelectorAll('a')];
   for(const link of [...actions.querySelectorAll('a')]){
    if((link.getAttribute('href')||'').startsWith('data:application/pdf')){
     const canonical=canonicalLinks.find(a=>a.hasAttribute('download')===link.hasAttribute('download'));
     if(canonical)link.replaceWith(canonical.cloneNode(true));
    }
   }
  }
 }
 const distinctEyebrow={
  '/acoes':'PROJETOS E INICIATIVAS','/noticias':'INFORMAÇÃO E MOBILIZAÇÃO',
  '/artigos':'IDEIAS E REFLEXÕES','/acessibilidade':'INCLUSÃO PARA TODOS',
  '/estatuto':'NOSSOS PRINCÍPIOS E DIRETRIZES'
 };
 const norm=t=>(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
 for(const page of next.querySelectorAll('main > .site-page[data-route]')){
  const eye=page.querySelector('.page-heading .eyebrow');
  const heading=page.querySelector('.page-heading h1');
  if(eye&&heading&&norm(eye.textContent)===norm(heading.textContent))
   eye.textContent=distinctEyebrow[page.dataset.route]||'CONHEÇA MAIS SOBRE O FRESUNI';
 }
 return '<!doctype html>\n'+next.documentElement.outerHTML;
}
function fsPublicationWarnings(html){
 const before=new DOMParser().parseFromString(state.html,'text/html');
 const after=new DOMParser().parseFromString(html,'text/html');
 const oldMenu=[...before.querySelectorAll('.site-header .main-nav > a.nav-root[href]')];
 const newMenu=new Set([...after.querySelectorAll('.site-header .main-nav > a.nav-root[href]')].map(x=>x.getAttribute('href')));
 const removed=oldMenu.filter(a=>!newMenu.has(a.getAttribute('href'))).map(a=>a.textContent.trim());
 const warnings=[];
 if(removed.length)warnings.push('Links removidos do menu principal: '+removed.join(', '));
 const oldForms=before.querySelectorAll('.fresuni-google-forms').length;
 const newForms=after.querySelectorAll('.fresuni-google-forms').length;
 if(newForms<oldForms)warnings.push('Formulários Google removidos: '+(oldForms-newForms));
 const oldFramework=before.querySelector('#fresuni-initiative-framework');
 const newFramework=after.querySelector('#fresuni-initiative-framework');
 if(oldFramework&&!newFramework)warnings.push('Organização de programas não encontrada na nova versão.');
 const oldIntegrated=[...before.querySelectorAll('main > .site-page[data-fresuni-program-role],main > .site-page[data-fresuni-program-member]')];
 const nextPages=new Map([...after.querySelectorAll('main > .site-page[data-route]')].map(p=>[p.dataset.route,p]));
 const moved=oldIntegrated.filter(p=>{const nextPage=nextPages.get(p.dataset.route);return nextPage&&p.dataset.editorParent!==nextPage.dataset.editorParent;});
 if(moved.length)warnings.push('Páginas de programas com hierarquia alterada: '+moved.map(p=>p.dataset.title||p.dataset.route).slice(0,9).join(', '));
 return warnings;
}

function serialize(){const d=siteDoc();if(!d)return state.html;
 const root=d.documentElement.cloneNode(true);stripTransient(root);root.querySelectorAll('[data-fresuni-children]').forEach(el=>el.remove());fsCleanupRepeats(root);fsRefreshNewsArchives(root);refreshSearch(root);
 const head=root.querySelector('head');if(head){for(const el of Array.from(head.querySelectorAll('link[rel=stylesheet]'))){if((el.getAttribute('href')||'').includes('fonts.googleapis.com/css2'))el.remove();}const fontLink=root.ownerDocument.createElement('link');fontLink.rel='stylesheet';fontLink.href=COMPLETE_FONTS;head.append(fontLink);}
 for(const id of ['fresuni-layout-polish-v2','fresuni-custom-box-style']){
  if(!root.querySelector('#'+id)){
   const fromPublished=new DOMParser().parseFromString(state.html,'text/html').getElementById(id);
   if(fromPublished)root.querySelector('head')?.append(fromPublished.cloneNode(true));
  }
 }
 if(!root.querySelector('#fresuni-flow-grid-style')){const canonical=new DOMParser().parseFromString(state.html,'text/html').getElementById('fresuni-flow-grid-style');if(canonical)root.querySelector('head')?.append(canonical.cloneNode(true));}
 const style=root.querySelector('#fresuni-extra-effects')||root.ownerDocument.createElement('style');style.id='fresuni-extra-effects';style.textContent=motionCss;
 if(!style.isConnected)root.querySelector('head').append(style);
 // Ao recuperar um rascunho anterior, preservar os mecanismos de animação
 // já publicados: eles não são conteúdo editável pelo visitante.
 try{
  const published=new DOMParser().parseFromString(state.html,'text/html');
  for(const id of ['fresuni-motion-2026','fresuni-motion-runtime-2026',
                   'fresuni-interactive-effects-2026','fresuni-interactive-effects-runtime-2026']){
   const canonical=published.getElementById(id);
   if(!canonical)continue;
   let saved=root.querySelector('#'+id);
   if(!saved){
    saved=canonical.cloneNode(true);
    (canonical.tagName==='STYLE'?root.querySelector('head'):root.querySelector('body'))?.append(saved);
   }else if(saved.textContent!==canonical.textContent)saved.textContent=canonical.textContent;
  }
 }catch(e){/* Preservamos o restante do rascunho se não for possível analisar a base. */}
 return '<!doctype html>\n'+root.outerHTML;
}
function snapshot(){remember();dirty();}

 // Aplicar formatos a conteúdo EXISTENTE, sem criar uma segunda caixa de texto.
 function fsTextTransformTarget(){
  const selected=state.selected;
  if(!selected||!state.editable||selected.closest('.site-header,.site-footer,.breadcrumbs,[data-fresuni-page-meta]'))return null;
  const page=selectedPage();if(!page||!page.contains(selected))return null;
  // Os textos de cartões existentes também podem receber novos formatos.
  const wrapper=selected.closest('.fresuni-info-box,blockquote,[data-fresuni-block="shape"]');
  if(wrapper)return wrapper;
  const li=selected.closest('li');
  if(li?.parentElement?.matches('ul,ol')&&!li.closest('.main-nav'))return li.parentElement;
  const text=selected.closest('p,h1,h2,h3,h4,h5,h6,ul,ol');
  if(text)return text;
  const link=selected.closest('a');
  return link?.parentElement?.matches('.directory-links')?link:null;
 }

 // Transformar apenas a frase marcada em citação, preservando o restante do parágrafo.
 function fsQuoteSelection(old){
  const r=activeTextRange();if(!r||!old.matches('p'))return false;
  const a=closestElement(r.startContainer),b=closestElement(r.endContainer);
  if(!old.contains(a)||!old.contains(b))return false;
  if(!String(r).trim()||String(r).trim()===old.textContent.trim())return false;
  const d=siteDoc(),prefix=d.createRange(),suffix=d.createRange();
  prefix.selectNodeContents(old);prefix.setEnd(r.startContainer,r.startOffset);
  suffix.selectNodeContents(old);suffix.setStart(r.endContainer,r.endOffset);
  const before=old.cloneNode(false),after=old.cloneNode(false);
  for(const node of [before,after]){node.removeAttribute('id');node.removeAttribute('data-fresuni-selected');}
  before.append(prefix.cloneContents());after.append(suffix.cloneContents());
  const quote=d.createElement('blockquote');quote.dataset.fresuniBlock='quote';
  quote.style.cssText='border-left:4px solid #214ECF;margin:25px 0;padding:10px 20px;max-width:100%;overflow-wrap:anywhere';
  const p=d.createElement('p');p.append(r.cloneContents());quote.append(p);
  snapshot();
  if(before.textContent.trim())old.before(before);
  old.before(quote);if(after.textContent.trim())old.before(after);
  old.remove();savedTextRange=null;
  state.selected=null;setEditable(true);selectElement(quote);dirty();
  notify('A frase selecionada virou citação. O restante do texto foi preservado.');
  return true;
 }

 function fsConvertSelected(type){
  const old=fsTextTransformTarget();
  if(!old)return false;
  if(!['text','heading','quote','info-box','box','list'].includes(type))return false;
  if(type==='quote'&&fsQuoteSelection(old))return true;
  const doc=siteDoc(),replacement=doc.createElement(
    type==='quote'?'blockquote':type==='info-box'?'aside':type==='heading'?'h2':type==='list'?'ul':type==='box'?'div':'p');
  const content=old.matches('p,h1,h2,h3,h4,h5,h6')?old.innerHTML:old.innerHTML;
  if(type==='quote'){
   replacement.dataset.fresuniBlock='quote';
   replacement.style.cssText='border-left:4px solid #214ECF;margin:25px 0;padding:10px 20px;max-width:100%;overflow-wrap:anywhere';
   if(old.matches('p,h1,h2,h3,h4,h5,h6,a')){const p=doc.createElement('p');if(old.matches('a'))p.append(old.cloneNode(true));else p.innerHTML=content;replacement.append(p);}
   else replacement.innerHTML=content;
  }else if(type==='info-box'||type==='box'){
   replacement.dataset.fresuniBlock=type==='info-box'?'info-box':'shape';
   if(type==='info-box'){replacement.className='fresuni-info-box';replacement.dataset.fresuniBoxTheme='accent';}
   else{replacement.dataset.fresuniShape='box';replacement.style.cssText='box-sizing:border-box;width:100%;min-height:70px;padding:20px;border:2px solid #214ECF;background:#EAF0FF'}
   if(old.matches('p,h1,h2,h3,h4,h5,h6,a')){const p=doc.createElement('p');if(old.matches('a'))p.append(old.cloneNode(true));else p.innerHTML=content;replacement.append(p);}
   else replacement.innerHTML=content;
  }else if(type==='heading'){replacement.dataset.fresuniBlock='heading';replacement.innerHTML=old.matches('p,h1,h2,h3,h4,h5,h6')?content:old.textContent;replacement.style.cssText='font-family:Merriweather,serif;color:#214ECF';}
  else if(type==='list'){
   replacement.dataset.fresuniBlock='list';
   if(old.matches('ul,ol'))replacement.innerHTML=old.innerHTML;
   else {const li=doc.createElement('li');li.innerHTML=old.matches('p,h1,h2,h3,h4,h5,h6')?content:old.textContent;replacement.append(li);}
  }else{replacement.dataset.fresuniBlock='text';replacement.innerHTML=old.matches('p,h1,h2,h3,h4,h5,h6')?content:old.textContent;}
  for(const name of ['data-fresuni-motion','data-fresuni-flow-span','data-fresuni-h-align']){
   if(old.hasAttribute(name))replacement.setAttribute(name,old.getAttribute(name));
  }
  if(old.style.getPropertyValue('--fresuni-flow-span'))replacement.style.setProperty('--fresuni-flow-span',old.style.getPropertyValue('--fresuni-flow-span'));
  snapshot();old.replaceWith(replacement);
  state.selected=null;setEditable(true);selectElement(replacement);dirty();
  notify('Formato aplicado ao texto existente, sem duplicar seu conteúdo.');
  return true;
 }

function insertionParent(){const p=selectedPage();if(!p)return null;const sel=state.selected;
 // Shared header and footer keep their dedicated editing routes.
 if(sel?.closest('.site-header')){const header=siteDoc().querySelector('.site-header');return {parent:header,before:null};}
 if(sel?.closest('.site-footer')){const footer=siteDoc().querySelector('.site-footer .footer-inner');return {parent:footer,before:null};}
 const placement=$('#fs-insert-position')?.value||'after';
 const flowDest=window.FRESUNI_FLOW_EDITOR?.insertionSpot?.(p,sel,placement);
 if(flowDest?.parent)return flowDest;
 if(sel?.closest('.site-page')===p){
  // The landing-page headings are labels in a two-column grid. New content belongs
  // inside the second column (.directory-links), never next to the row heading.
  const row=sel.closest('.directory-row');
  if(row && sel.matches('h2,section.directory-row')){
   const holder=row.querySelector('.directory-links');
   if(holder)return {parent:holder,before:holder.querySelector('[data-editor-internal].fresuni-quick-add')};
  }
  let n=sel;
  if(n.matches('a,img,cite')&&!n.parentElement?.classList.contains('directory-links'))n=n.closest('figure,div,section,article,p,li')||n;
  if(n.matches('li')&&n.parentElement)n=n.parentElement;
  if(n===p)n=null;
  if(n)return {parent:n.parentNode,before:n.nextSibling};}
 const block=$('.prose',p)||$('.page-shell',p)||$('.home-wrap',p)||p;
 return {parent:block,before:null};
}
function insertHTML(html){if(!state.editable){notify('Volte ao modo de edição primeiro.');return;}
 snapshot();const d=siteDoc();const tpl=d.createElement('template');tpl.innerHTML=html;const first=tpl.content.firstElementChild;const dest=insertionParent();if(!dest)return;
 if(dest.parent.classList.contains('directory-links')&&first){first.dataset.fresuniBlock=first.dataset.fresuniBlock||'quick-item';first.style.margin='0';first.style.maxWidth='100%';first.style.minWidth='0';first.style.overflowWrap='anywhere';}
 dest.parent.insertBefore(tpl.content,dest.before);setEditable(true);if(first)selectElement(first);dirty();
 first?.scrollIntoView({behavior:'smooth',block:'center'});
}
function actionInsert(type){
 if(type==='gallery'){fsOpenGallery();return;}
 if(type==='banner'){fsOpenBanner();return;}
 if(type==='google-forms'){fsOpenGoogleForms();return;}
 if($('#fs-insert-behavior')?.value!=='new'&&fsConvertSelected(type))return;
 const types={
 text:'<p data-fresuni-block="text">Escreva seu texto aqui. Clique para editar.</p>',
 heading:'<h2 data-fresuni-block="heading" style="font-family:Merriweather,serif;color:#214ECF">Novo título</h2>',
 button:'<p data-fresuni-block="button"><a class="editor-public-button" href="#/filiacao" style="display:inline-block;background:#214ECF;color:white;padding:12px 20px;border-radius:7px;text-decoration:none;font-weight:600">Clique aqui</a></p>',
 accordion:'<details data-fresuni-block="accordion" style="border-bottom:1px solid #ddd;padding:15px 0"><summary style="font-weight:700;cursor:pointer;color:#214ECF">Título do conteúdo recolhível</summary><p>Escreva o conteúdo que será mostrado ao abrir.</p></details>',
 more:'<details data-fresuni-block="more" style="margin:20px 0"><summary style="color:#214ECF;font-weight:600;cursor:pointer;list-style-position:inside">Leia mais…</summary><div style="padding:12px 15px"><p>Conteúdo completo. Clique para editar.</p></div></details>',
 'info-box':'<aside class="fresuni-info-box" data-fresuni-block="info-box" data-fresuni-box-theme="soft"><h3>Título do box</h3><p>Escreva seu texto aqui. Altere livremente o conteúdo, as cores, o tamanho, a borda e o formato.</p></aside>',
 box:'<div data-fresuni-block="shape" data-fresuni-shape="box" style="display:block;box-sizing:border-box;max-width:100%;width:100%;min-height:110px;padding:24px;border:2px solid #214ECF;background:#EAF0FF;border-radius:0"><h3 style="color:#214ECF">Título do quadro</h3><p>Texto dentro da forma, que pode ser editado.</p></div>',
 circle:'<div data-fresuni-block="shape" data-fresuni-shape="circle" style="box-sizing:border-box;max-width:100%;width:260px;min-height:260px;aspect-ratio:1;border-radius:50%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:34px;background:#DCE8FF;border:2px solid #214ECF;overflow-wrap:anywhere"><p>Seu texto dentro do círculo</p></div>',
 pill:'<div data-fresuni-block="shape" data-fresuni-shape="pill" style="box-sizing:border-box;max-width:100%;width:60%;min-height:60px;border-radius:100px;background:#214ECF;color:#fff;text-align:center;padding:16px 24px"><p style="color:inherit">Texto da etiqueta</p></div>',
 divider:'<hr data-fresuni-block="divider" style="border:0;border-top:1px solid #dfd3ec;margin:26px 0">',
 quote:'<blockquote data-fresuni-block="quote" style="border-left:4px solid #214ECF;margin:25px 0;padding:7px 18px"><p>Uma frase que representa o FRESUNI.</p></blockquote>',
 list:'<ul data-fresuni-block="list"><li>Primeiro item</li><li>Segundo item</li></ul>',
 image:'',embed:''};
 if(type==='image'){$('#upload-image').click();return;}
 if(type==='embed'){const url=prompt('Cole o endereço HTTPS a incorporar (ex.: vídeo do YouTube):','https://');if(!url)return;
  if(!/^https:\/\//i.test(url)){notify('Insira um link seguro começando com https://.');return;}
  let safe=url;try{const u=new URL(url);if(u.hostname==='www.youtube.com'&&u.pathname==='/watch')safe='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(u.searchParams.get('v')||'');else if(u.hostname==='youtu.be')safe='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(u.pathname.slice(1));}catch{};
  insertHTML(`<div data-fresuni-block="embed" style="max-width:900px;margin:25px auto"><iframe title="Conteúdo incorporado" loading="lazy" src="${escapeHTML(safe)}" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" referrerpolicy="no-referrer" style="width:100%;min-height:390px;border:0;border-radius:10px"></iframe></div>`);return;}
 insertHTML(types[type]||types.text);
}

/* GALERIA E BANNERS — uploads locais compactados antes de integrar ao HTML.
   Limites conservadores porque o site é publicado como um único index.html. */
const FS_MEDIA_INPUT_LIMIT=5*1024*1024;
const FS_MEDIA_SITE_LIMIT=6*1024*1024;
const FS_MEDIA_MAX_GALLERY=12;
const FS_MEDIA_TYPES=['image/jpeg','image/png','image/webp'];
let fsGalleryEditing=null,fsGalleryItems=[],fsGalleryBusy=false;
let fsBannerEditing=null,fsBannerSource='',fsBannerBusy=false;
const fsBytes=text=>new TextEncoder().encode(text).length;
function fsMediaStatus(id,text){const el=$('#'+id);if(el)el.textContent=text;}
function fsMediaErrorText(err){return err?.message||String(err||'Falha ao tratar a imagem.');}
function fsMediaSrcAllowed(src){return /^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(src)||/^https:\/\//i.test(src);}
function fsMediaLinkAllowed(link){
 if(!link)return true;
 if(/^#\/[a-z0-9/_-]*$/i.test(link))return true;
 try{const u=new URL(link);return u.protocol==='https:'&&!!u.hostname&&u.username===''&&u.password==='';}catch{return false;}
}
function fsMediaCheckBudget(markup,existing=null){
 const current=serialize();
 const projected=fsBytes(current)-fsBytes(existing?.outerHTML||'')+fsBytes(markup)+16384;
 if(projected>FS_MEDIA_SITE_LIMIT)
  throw Error('Limite de 6 MB para o HTML atingido. Remova ou substitua algumas imagens antes de adicionar mais.');
}
function fsValidateMediaPublish(html){
 if(fsBytes(html)>FS_MEDIA_SITE_LIMIT)throw Error('Publicação bloqueada: o site ultrapassou 6 MB. Reduza a quantidade de imagens ou seus tamanhos.');
 const doc=new DOMParser().parseFromString(html,'text/html');
 for(const gallery of doc.querySelectorAll('[data-fresuni-block="gallery"]')){
  const images=gallery.querySelectorAll('.fresuni-gallery-grid img');
  if(!images.length||images.length>FS_MEDIA_MAX_GALLERY)throw Error('Galeria inválida: são permitidas de 1 a 12 fotografias por bloco.');
  for(const img of images)if(!fsMediaSrcAllowed(img.getAttribute('src')||''))throw Error('Imagem com formato ou endereço inválido na galeria.');
 }
 for(const banner of doc.querySelectorAll('#fresuni-home-highlights .fresuni-highlight[data-fresuni-carousel-mode="full-image"]')){
  const image=banner.querySelector(':scope > a.fresuni-highlight-full-link img');
  const link=banner.querySelector(':scope > a.fresuni-highlight-full-link');
  const src=image?.getAttribute('src')||'',href=link?.getAttribute('href')||'';
  if(!fsMediaSrcAllowed(src))throw Error('Slide com banner sem uma imagem válida.');
  if(!image?.getAttribute('alt')?.trim())throw Error('O banner do carrossel precisa de descrição acessível.');
  if(!href||!fsMediaLinkAllowed(href)||(href.startsWith('#/')&&!doc.querySelector('.site-page[data-route="'+href.slice(1)+'"]')))
   throw Error('Banner do carrossel apontando para endereço interno ou externo inválido.');
 }
 const fullSlides=doc.querySelectorAll('#fresuni-home-highlights .fresuni-highlights-track > .fresuni-highlight');
 if(fullSlides.length>15)throw Error('O carrossel aceita até 15 slides para manter a navegação acessível.');
 
 for(const banner of doc.querySelectorAll('[data-fresuni-block="banner"]')){
  const img=banner.querySelector('.fresuni-banner-image img');
  if(!img||!fsMediaSrcAllowed(img.getAttribute('src')||''))throw Error('Banner sem imagem válida.');
  const href=banner.querySelector('.fresuni-banner-image a')?.getAttribute('href')||'';
  if(!fsMediaLinkAllowed(href))throw Error('Link inválido em um banner.');
  if(banner.hasAttribute('data-fresuni-home-banner')){
   if(!href)throw Error('Um banner da página inicial precisa apontar para uma página interna ou HTTPS.');
   if(href.startsWith('#/')&&!doc.querySelector('.site-page[data-route="'+href.slice(1)+'"]'))
    throw Error('Banner apontando para página interna inexistente.');
   if(!img.getAttribute('alt')?.trim())throw Error('Descreva o banner para leitores de tela.');
   if(banner.querySelector('.fresuni-banner-text'))throw Error('Banner integral não deve conter legenda sobreposta.');
  }
 }
}
async function fsCompressMedia(file,kind){
 if(!FS_MEDIA_TYPES.includes(file.type))throw Error('Formato não aceito. Use JPG, PNG ou WebP.');
 if(!file.size||file.size>FS_MEDIA_INPUT_LIMIT)throw Error('Imagem recusada: máximo de 5 MB por arquivo original.');
 const url=URL.createObjectURL(file);
 try{
  const image=await new Promise((resolve,reject)=>{
   const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('O navegador não conseguiu abrir esta imagem.'));
   im.src=url;
  });
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>55000000)throw Error('Resolução inválida ou alta demais.');
  const target=kind==='carousel-banner'?500*1024:kind==='banner'?300*1024:200*1024;
  const maxDimension=kind==='carousel-banner'?2048:kind==='banner'?1920:1600;
  for(const scale of [1,.82,.68,.54,.42,.32]){
   const factor=Math.min(1,maxDimension/Math.max(image.naturalWidth,image.naturalHeight))*scale;
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));
   canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
   const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('O navegador não conseguiu preparar a compactação.');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.70,.58,.46,.35]){
    let data=canvas.toDataURL('image/webp',quality);
    if(!data.startsWith('data:image/webp;'))data=canvas.toDataURL('image/jpeg',quality);
    const bytes=Math.ceil((data.length-data.indexOf(',')-1)*.75);
    if(bytes<=target)return {src:data,bytes,width:canvas.width,height:canvas.height};
   }
  }
  throw Error('Não foi possível comprimir esta imagem dentro do limite. Tente outro arquivo.');
 }finally{URL.revokeObjectURL(url);}
}
function fsMediaSelectedBlock(type){
 const selected=state.selected;
 return selected?.closest?.('[data-fresuni-block="'+type+'"]')||null;
}
function fsMediaRefreshSelected(el){
 const block=el?.closest?.('[data-fresuni-block="gallery"],[data-fresuni-block="banner"]');
 const panel=$('#fs-selected-media');if(!panel)return;
 panel.hidden=!block;$('#fs-selected-media-title').textContent=block?.dataset.fresuniBlock==='banner'?'Banner selecionado':'Galeria selecionada';
}
$('#fs-edit-selected-media').addEventListener('click',()=>{
 const selected=state.selected?.closest?.('[data-fresuni-block="gallery"],[data-fresuni-block="banner"]');
 if(!selected)return;
 if(selected.hasAttribute('data-fresuni-home-banner')){
  $('#fs-home-banner-choice').value=selected.dataset.fresuniHomeBanner;
  fsHomeBannerRead(selected.dataset.fresuniHomeBanner);
  $('#fs-home-banner-editor').scrollIntoView({block:'start',behavior:'smooth'});
 }else if(selected.dataset.fresuniBlock==='banner')fsOpenBanner(selected);else fsOpenGallery(selected);
});
function fsMediaApply(markup,existing){
 fsMediaCheckBudget(markup,existing);
 if(!existing){
  if(state.selected?.closest('.site-header,.site-footer,.directory-links'))clearSelection();
  insertHTML(markup);fsMediaRefreshSelected(state.selected);return;
 }
 snapshot();
 const d=siteDoc(),template=d.createElement('template');template.innerHTML=markup;
 const block=template.content.firstElementChild;existing.replaceWith(block);
 state.selected=null;setEditable(true);selectElement(block);dirty();
 block.scrollIntoView({behavior:'smooth',block:'center'});
}

/* Editor dos destaques: imagem compactada e texto editáveis no painel. */
const FS_HOME_SHOWCASE_LOGO='https://jassinks.github.io/fresuni/admin/logo.png';
let fsHomeShowcaseReset=false,fsHomeShowcaseSaving=false;
function fsHomeShowcaseCurrent(){
 const id=$('#fs-home-showcase-select')?.value||'acoes';
 return siteDoc()?.querySelector('#fresuni-home-highlights [data-fresuni-slide="'+id+'"]')||null;
}
function fsHomeShowcaseStatus(msg){
 const label=$('#fs-home-showcase-status');if(label)label.textContent=msg;
}

/* Links dos destaques e banners: todas as páginas reais do site, inclusive
   notícias, artigos, subpáginas, Estatuto, Filiação e projetos. */
function fsInternalPageSelect(id,preferred=''){
 const input=$('#'+id);if(!input)return;
 const current=preferred||input.value,items=pageNodes();
 input.replaceChildren();
 for(const page of items){
  const route=page.dataset.route;if(!route)continue;
  const option=document.createElement('option');option.value='#'+route;
  option.textContent=labelPath(page);
  input.append(option);
 }
 if([...input.options].some(x=>x.value===current))input.value=current;
 else if(input.options.length)input.selectedIndex=0;
}
function fsHomeLinkToggle(prefix){
 const external=$('#'+prefix+'-link-mode')?.value==='external';
 $('#'+prefix+'-internal-wrap').hidden=external;
 $('#'+prefix+'-external-wrap').hidden=!external;
}
function fsHomeLinkRead(prefix,href){
 const internal=String(href||'').startsWith('#/');
 $('#'+prefix+'-link-mode').value=internal?'internal':'external';
 fsInternalPageSelect(prefix+'-internal',internal?href:'#/');
 $('#'+prefix+'-external').value=internal?'':String(href||'');
 fsHomeLinkToggle(prefix);
}
function fsHomeLinkValue(prefix){
 return $('#'+prefix+'-link-mode').value==='external'
  ?$('#'+prefix+'-external').value.trim()
  :$('#'+prefix+'-internal').value.trim();
}
for(const prefix of ['fs-home-showcase','fs-home-banner','fs-carousel-banner']){
 $('#'+prefix+'-link-mode')?.addEventListener('change',()=>fsHomeLinkToggle(prefix));
 $('#'+prefix+'-internal')?.addEventListener('focus',()=>{
  const input=$('#'+prefix+'-internal');fsInternalPageSelect(prefix+'-internal',input.value);
 });
}


/* Os dois painéis de destaques usam a mesma lista REAL de slides; os três
   primeiros são sempre preservados, os demais surgem automaticamente. */
const FS_CAROUSEL_MAX_SLIDES=15;
function fsCarouselSlides(){
 const track=pageFor('/')?.querySelector('#fresuni-home-highlights .fresuni-highlights-track');
 return Array.from(track?.children||[]).filter(el=>el.matches('.fresuni-highlight[data-fresuni-slide]'));
}
function fsCarouselSlideLabel(slide,index){
 const imageOnly=slide.dataset.fresuniCarouselMode==='full-image';
 const title=imageOnly
  ?slide.querySelector('.fresuni-highlight-full-link img')?.getAttribute('alt')
  :slide.querySelector('.fresuni-highlight-content h3')?.textContent?.trim();
 const name=String(title||slide.dataset.fresuniSlide||'Destaque').slice(0,64);
 return (index+1)+' · '+name+(imageOnly?' (banner inteiro)':' (texto + imagem)');
}
function fsCarouselSyncSelectors(preferredShowcase='',preferredBanner=''){
 const slides=fsCarouselSlides();
 const textSelect=$('#fs-home-showcase-select'),bannerSelect=$('#fs-carousel-banner-choice');
 if(textSelect){
  const chosen=preferredShowcase||textSelect.value||'acoes';
  textSelect.replaceChildren();
  slides.forEach((slide,index)=>{
   const option=document.createElement('option');
   option.value=slide.dataset.fresuniSlide;option.textContent=fsCarouselSlideLabel(slide,index);
   textSelect.append(option);
  });
  if([...textSelect.options].some(op=>op.value===chosen))textSelect.value=chosen;
  else if(textSelect.options.length)textSelect.selectedIndex=0;
 }
 if(bannerSelect){
  const chosen=preferredBanner||bannerSelect.value||'new';
  bannerSelect.replaceChildren();
  const empty=document.createElement('option');empty.value='new';
  empty.textContent='＋ Adicionar novo slide com banner';bannerSelect.append(empty);
  slides.forEach((slide,index)=>{
   const option=document.createElement('option');
   option.value=slide.dataset.fresuniSlide;option.textContent=fsCarouselSlideLabel(slide,index);
   bannerSelect.append(option);
  });
  bannerSelect.value=[...bannerSelect.options].some(op=>op.value===chosen)?chosen:'new';
 }
}

function fsHomeShowcaseRead(){
 const slide=fsHomeShowcaseCurrent();if(!slide){
  fsHomeShowcaseStatus('Abra o site no editor para carregar os destaques da página inicial.');return;
 }
 const get=(selector)=>slide.querySelector(selector)?.textContent?.trim()||'';
 $('#fs-home-showcase-kicker').value=get('.fresuni-highlight-kicker');
 $('#fs-home-showcase-headline').value=get('.fresuni-highlight-content h3');
 $('#fs-home-showcase-description').value=get('.fresuni-highlight-content p');
 const link=slide.querySelector('.fresuni-highlight-link');
 $('#fs-home-showcase-cta').value=link?.firstChild?.textContent?.trim()||'';
 fsHomeLinkRead('fs-home-showcase',link?.getAttribute('href')||'#/');
 const picture=slide.querySelector('.fresuni-highlight-picture img');
 $('#fs-home-showcase-alt').value=picture?.getAttribute('alt')||'';
 $('#fs-home-showcase-image').src=picture?.getAttribute('src')||FS_HOME_SHOWCASE_LOGO;
 $('#fs-home-showcase-file').value='';
 fsHomeShowcaseReset=false;
 fsHomeShowcaseStatus(slide.dataset.fresuniCarouselMode==='full-image'
  ?'Este slide está como banner inteiro. Se clicar em Aplicar aqui, ele voltará ao formato de texto + imagem, sem perder os textos originais.'
  :'Destaque carregado. Altere os campos e clique em Aplicar; publique depois para atualizar o site.');
}
$('#fs-home-showcase-select')?.addEventListener('change',fsHomeShowcaseRead);
frame.addEventListener('load',()=>{
 fsCarouselSyncSelectors();
 if($('#fs-home-showcase-select'))fsHomeShowcaseRead();
});
$('#fs-home-showcase-file')?.addEventListener('change',e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!FS_MEDIA_TYPES.includes(file.type)||file.size>FS_MEDIA_INPUT_LIMIT){
  e.target.value='';fsHomeShowcaseStatus('Arquivo recusado. Use JPG, PNG ou WebP de até 5 MB.');return;
 }
 fsHomeShowcaseReset=false;
 fsHomeShowcaseStatus('Foto selecionada. A compressão acontecerá ao clicar em Aplicar.');
 const preview=$('#fs-home-showcase-image');
 if(preview.dataset.fsObjectUrl)URL.revokeObjectURL(preview.dataset.fsObjectUrl);
 const url=URL.createObjectURL(file);preview.dataset.fsObjectUrl=url;preview.src=url;
});
$('#fs-home-showcase-default')?.addEventListener('click',()=>{
 const preview=$('#fs-home-showcase-image');
 if(preview.dataset.fsObjectUrl)URL.revokeObjectURL(preview.dataset.fsObjectUrl);
 delete preview.dataset.fsObjectUrl;
 $('#fs-home-showcase-file').value='';preview.src=FS_HOME_SHOWCASE_LOGO;
 fsHomeShowcaseReset=true;fsHomeShowcaseStatus('A imagem original da marca será usada ao aplicar.');
});
$('#fs-home-showcase-save')?.addEventListener('click',async()=>{
 if(fsHomeShowcaseSaving)return;
 if(!state.editable){fsHomeShowcaseStatus('Volte ao modo de edição antes de atualizar o destaque.');return;}
 const slide=fsHomeShowcaseCurrent();
 if(!slide){fsHomeShowcaseStatus('Destaque não encontrado. Recarregue a prévia.');return;}
 const kicker=$('#fs-home-showcase-kicker').value.trim();
 const title=$('#fs-home-showcase-headline').value.trim();
 const description=$('#fs-home-showcase-description').value.trim();
 const label=$('#fs-home-showcase-cta').value.trim();
 const href=fsHomeLinkValue('fs-home-showcase');
 const alt=$('#fs-home-showcase-alt').value.trim();
 if(!title||!label||!href){fsHomeShowcaseStatus('Preencha título, texto do botão e página de destino.');return;}
 if(!fsMediaLinkAllowed(href)||(href.startsWith('#/')&&!pageFor(href.slice(1)))){
  fsHomeShowcaseStatus('Escolha uma página existente (#/caminho) ou um link seguro HTTPS.');return;
 }
 const button=$('#fs-home-showcase-save');button.disabled=true;
 fsHomeShowcaseSaving=true;fsHomeShowcaseStatus('Validando e compactando imagem...');
 try{
  const picture=slide.querySelector('.fresuni-highlight-picture img');
  let src=picture?.getAttribute('src')||FS_HOME_SHOWCASE_LOGO;
  const file=$('#fs-home-showcase-file').files?.[0];
  if(fsHomeShowcaseReset)src=FS_HOME_SHOWCASE_LOGO;
  else if(file){const data=await fsCompressMedia(file,'banner');src=data.src;}
  if(!/^data:image\/(?:webp|png|jpeg);base64,/i.test(src)&&!/^https:\/\//i.test(src)&&!/^\.\/admin\/logo\.png$/.test(src))throw Error('Imagem inválida.');
  const clone=slide.cloneNode(true);
  // Aplicar no painel original reativa o formato tradicional e preserva
  // a edição de texto, sem apagar slides adicionados pelo terceiro painel.
  clone.removeAttribute('data-fresuni-carousel-mode');
  clone.querySelector('.fresuni-highlight-full-link')?.remove();
  clone.querySelector('.fresuni-highlight-kicker').textContent=kicker;
  clone.querySelector('.fresuni-highlight-content h3').textContent=title;
  clone.querySelector('.fresuni-highlight-content p').textContent=description;
  const anchor=clone.querySelector('.fresuni-highlight-link');
  anchor.setAttribute('href',href);
  if(/^https:\/\//i.test(href)){anchor.target='_blank';anchor.rel='noopener noreferrer';}
  else{anchor.removeAttribute('target');anchor.removeAttribute('rel');}
  anchor.replaceChildren(siteDoc().createTextNode(label+' '));
  const arrow=siteDoc().createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent='↗';anchor.append(arrow);
  const img=clone.querySelector('.fresuni-highlight-picture img');
  img.setAttribute('src',src);img.setAttribute('alt',alt||'Imagem do FRESUNI Social');
  clone.dataset.fresuniPhoto=/^data:image\//.test(src)?'true':'false';
  fsMediaCheckBudget(clone.outerHTML,slide);
  snapshot();slide.replaceWith(clone);
  // Reinicia os eventos do carrossel, pois seus elementos foram atualizados.
  const html=serialize();reloadFrame(html,state.route);dirty();
  fsHomeShowcaseReset=false;$('#fs-home-showcase-file').value='';
  fsHomeShowcaseStatus('Destaque atualizado no rascunho. Publique para disponibilizar aos visitantes.');
  notify('Destaque da página inicial atualizado no rascunho.');
 }catch(err){fsHomeShowcaseStatus('Não foi possível aplicar: '+(err?.message||String(err)));}
 finally{
  fsHomeShowcaseSaving=false;button.disabled=false;
  const preview=$('#fs-home-showcase-image');
  if(preview.dataset.fsObjectUrl){URL.revokeObjectURL(preview.dataset.fsObjectUrl);delete preview.dataset.fsObjectUrl;}
 }
});



/* Terceira opção dos destaques: banner integral como um slide.
   O slide original mantém título, botão e foto no DOM para restauração.
   Só os slides adicionados pelo administrador podem ser excluídos. */
let fsCarouselBannerBusy=false,fsCarouselBannerPending=null;
function fsCarouselBannerCurrent(){
 const id=$('#fs-carousel-banner-choice')?.value||'new';
 return id==='new'?null:fsCarouselSlides().find(slide=>slide.dataset.fresuniSlide===id)||null;
}
function fsCarouselBannerStatus(message){
 fsMediaStatus('fs-carousel-banner-status',message);
}
function fsCarouselBannerRevokePreview(){
 const preview=$('#fs-carousel-banner-preview');
 if(!preview)return;
 if(preview.dataset.fsObjectUrl)URL.revokeObjectURL(preview.dataset.fsObjectUrl);
 delete preview.dataset.fsObjectUrl;
}
function fsCarouselBannerRead(preferred=''){
 const select=$('#fs-carousel-banner-choice');if(!select)return;
 fsCarouselSyncSelectors('',preferred||select.value||'new');
 const slide=fsCarouselBannerCurrent(),items=fsCarouselSlides();
 const full=slide?.dataset.fresuniCarouselMode==='full-image';
 const picture=full?slide?.querySelector('.fresuni-highlight-full-link img'):null;
 const link=full?slide.querySelector('.fresuni-highlight-full-link'):slide?.querySelector('.fresuni-highlight-link');
 const src=picture?.getAttribute('src')||'';
 fsCarouselBannerRevokePreview();
 const preview=$('#fs-carousel-banner-preview');
 if(src){preview.src=src;preview.hidden=false;}
 else{preview.removeAttribute('src');preview.hidden=true;}
 $('#fs-carousel-banner-image-url').value=/^https:\/\//i.test(src)?src:'';
 $('#fs-carousel-banner-file').value='';
 $('#fs-carousel-banner-alt').value=picture?.getAttribute('alt')||'';
 fsHomeLinkRead('fs-carousel-banner',link?.getAttribute('href')||'#/acoes');
 $('#fs-carousel-banner-save').textContent=slide?'Aplicar banner neste slide':'Adicionar slide com banner';
 $('#fs-carousel-banner-restore').hidden=!full;
 $('#fs-carousel-banner-remove').hidden=!slide||slide.dataset.fresuniSlideAdded!=='true';
 const i=items.indexOf(slide);
 $('#fs-carousel-banner-up').hidden=!slide||i<1;
 $('#fs-carousel-banner-down').hidden=!slide||i<0||i===items.length-1;
 fsCarouselBannerStatus(!slide
  ?'Novo slide: selecione uma imagem, descreva e escolha o destino. Até '+FS_CAROUSEL_MAX_SLIDES+' slides no total.'
  :full
   ?'Banner atual carregado. Você pode mudar imagem/link, restaurar texto + imagem, ou reorganizar este slide.'
   :'Este slide usa texto + imagem. Envie um banner inteiro para substituir a aparência sem perder o conteúdo original.');
}
$('#fs-carousel-banner-choice')?.addEventListener('change',()=>fsCarouselBannerRead());
frame.addEventListener('load',()=>{
 fsCarouselBannerRead(fsCarouselBannerPending||'');
 fsCarouselBannerPending=null;
});
$('#fs-carousel-banner-file')?.addEventListener('change',e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!FS_MEDIA_TYPES.includes(file.type)||!file.size||file.size>FS_MEDIA_INPUT_LIMIT){
  e.target.value='';fsCarouselBannerStatus('Use JPG, PNG ou WebP de até 5 MB.');return;
 }
 const preview=$('#fs-carousel-banner-preview');fsCarouselBannerRevokePreview();
 const url=URL.createObjectURL(file);preview.dataset.fsObjectUrl=url;
 preview.src=url;preview.hidden=false;
 $('#fs-carousel-banner-image-url').value='';
 fsCarouselBannerStatus('Imagem selecionada. A compactação será feita ao aplicar no slide.');
});
$('#fs-carousel-banner-image-url')?.addEventListener('change',e=>{
 const value=e.target.value.trim();if(!value)return;
 if(!/^https:\/\//i.test(value)||!fsMediaLinkAllowed(value)){
  fsCarouselBannerStatus('A imagem externa precisa ter endereço HTTPS válido.');return;
 }
 fsCarouselBannerRevokePreview();
 $('#fs-carousel-banner-file').value='';
 const preview=$('#fs-carousel-banner-preview');preview.src=value;preview.hidden=false;
 fsCarouselBannerStatus('Imagem externa selecionada. O endereço deverá continuar disponível para o banner aparecer.');
});
$('#fs-carousel-banner-save')?.addEventListener('click',async()=>{
 if(fsCarouselBannerBusy)return;
 if(!state.editable){fsCarouselBannerStatus('Ative o modo de edição antes de modificar os destaques.');return;}
 const current=fsCarouselBannerCurrent(),slides=fsCarouselSlides(),file=$('#fs-carousel-banner-file').files?.[0];
 const externalSrc=$('#fs-carousel-banner-image-url').value.trim();
 const href=fsHomeLinkValue('fs-carousel-banner'),alt=$('#fs-carousel-banner-alt').value.trim();
 if(!current&&slides.length>=FS_CAROUSEL_MAX_SLIDES){
  fsCarouselBannerStatus('Limite de 15 slides atingido. Edite ou substitua um dos slides existentes.');return;
 }
 if(!alt){fsCarouselBannerStatus('Informe a descrição acessível da imagem e do destino.');return;}
 if(!href||!fsMediaLinkAllowed(href)||(href.startsWith('#/')&&!pageFor(href.slice(1)))){
  fsCarouselBannerStatus('Escolha uma página interna existente ou endereço HTTPS válido.');return;
 }
 const source=slides[0];
 if(!current&&!source){fsCarouselBannerStatus('Não encontramos o carrossel original da página inicial.');return;}
 const button=$('#fs-carousel-banner-save');button.disabled=true;
 fsCarouselBannerBusy=true;fsCarouselBannerStatus('Preparando o slide e verificando a imagem…');
 try{
  const existingSrc=current?.querySelector('.fresuni-highlight-full-link img')?.getAttribute('src')||'';
  const uploaded=file?await fsCompressMedia(file,'carousel-banner'):null;
  const src=uploaded?.src||externalSrc||existingSrc;
  if(!fsMediaSrcAllowed(src)||(/^(?!data:)/i.test(src)&&!fsMediaLinkAllowed(src)))
   throw Error('Selecione uma imagem JPG, PNG, WebP ou endereço HTTPS válido.');
  const clone=(current||source).cloneNode(true);
  const id=current?.dataset.fresuniSlide||
   'banner-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  if(!current){
   clone.dataset.fresuniSlide=id;
   clone.dataset.fresuniSlideAdded='true';
   // Um novo slide pode depois voltar ao formato tradicional e ser editado
   // no painel de destaques sem duplicar conteúdos do slide de origem.
   const text=clone.querySelector('.fresuni-highlight-content');
   if(text){
    const kicker=text.querySelector('.fresuni-highlight-kicker'),heading=text.querySelector('h3');
    const desc=text.querySelector('p'),cta=text.querySelector('.fresuni-highlight-link');
    if(kicker)kicker.textContent='Conheça o FRESUNI';
    if(heading)heading.textContent='Novo destaque';
    if(desc)desc.textContent='Conheça mais sobre nossas iniciativas e ações.';
    if(cta){cta.href=href;cta.textContent='Saiba mais';}
   }
  }
  clone.dataset.fresuniCarouselMode='full-image';
  clone.querySelector('.fresuni-highlight-full-link')?.remove();
  const link=siteDoc().createElement('a');
  link.className='fresuni-highlight-full-link';link.href=href;
  link.setAttribute('aria-label','Acessar: '+alt+(href.startsWith('https://')?' (abre em nova aba)':''));
  if(href.startsWith('https://')){link.target='_blank';link.rel='noopener noreferrer';}
  const img=siteDoc().createElement('img');
  img.src=src;img.alt=alt;img.loading='lazy';img.decoding='async';
  if(uploaded?.width&&uploaded?.height){img.width=uploaded.width;img.height=uploaded.height;}
  link.append(img);clone.append(link);
  clone.removeAttribute('data-fresuni-selected');
  clone.removeAttribute('data-fresuni-editable');
  clone.removeAttribute('contenteditable');
  fsMediaCheckBudget(clone.outerHTML,current);
  snapshot();
  if(current)current.replaceWith(clone);
  else source.parentElement.append(clone);
  fsCarouselBannerRevokePreview();
  fsCarouselBannerPending=id;
  reloadFrame(serialize(),'/');dirty();
  notify(current?'Banner aplicado ao destaque existente.':'Novo slide com banner adicionado.');
  fsCarouselBannerStatus('Banner aplicado ao rascunho. Publique quando estiver satisfeito.');
 }catch(err){fsCarouselBannerStatus('Não foi possível aplicar: '+fsMediaErrorText(err));}
 finally{fsCarouselBannerBusy=false;button.disabled=false;}
});
$('#fs-carousel-banner-restore')?.addEventListener('click',()=>{
 const slide=fsCarouselBannerCurrent();
 if(!state.editable||!slide||slide.dataset.fresuniCarouselMode!=='full-image')return;
 snapshot();const clone=slide.cloneNode(true);
 clone.removeAttribute('data-fresuni-carousel-mode');
 clone.querySelector('.fresuni-highlight-full-link')?.remove();
 slide.replaceWith(clone);
 fsCarouselBannerPending=clone.dataset.fresuniSlide;
 reloadFrame(serialize(),'/');dirty();
 notify('Formato original de texto + imagem restaurado. Seus textos permanecem disponíveis no primeiro painel.');
});
$('#fs-carousel-banner-remove')?.addEventListener('click',()=>{
 const slide=fsCarouselBannerCurrent();
 if(!state.editable||!slide||slide.dataset.fresuniSlideAdded!=='true'){
  fsCarouselBannerStatus('Os três destaques originais não podem ser excluídos; restaure texto + imagem se desejar.');return;
 }
 if(!confirm('Excluir apenas este slide adicional do RASCUNHO? Os três originais continuarão no carrossel. Você poderá usar Desfazer.'))return;
 snapshot();slide.remove();
 fsCarouselBannerPending='new';
 reloadFrame(serialize(),'/');dirty();notify('Slide adicional excluído somente do rascunho.');
});
for(const [button,direction] of [['fs-carousel-banner-up',-1],['fs-carousel-banner-down',1]]){
 $('#'+button)?.addEventListener('click',()=>{
  const slide=fsCarouselBannerCurrent(),items=fsCarouselSlides(),index=items.indexOf(slide);
  const other=items[index+direction];
  if(!state.editable||!slide||!other)return;
  snapshot();
  if(direction<0)slide.parentElement.insertBefore(slide,other);
  else slide.parentElement.insertBefore(other,slide);
  fsCarouselBannerPending=slide.dataset.fresuniSlide;
  reloadFrame(serialize(),'/');dirty();
  notify('Ordem dos destaques atualizada no rascunho.');
 });
}

/* Gerenciador de banners inteiros da página inicial.
   Nenhuma frase é desenhada por cima da imagem. */
let fsHomeBannerSaving=false,fsHomeBannerPendingSelection=null;
function fsHomeBannerHost(create=false){
 const home=pageFor('/')?.querySelector('.home-wrap');if(!home)return null;
 let host=home.querySelector('#fresuni-home-banner-list');
 if(!host&&create){
  host=home.ownerDocument.createElement('section');
  host.id='fresuni-home-banner-list';
  host.setAttribute('aria-label','Banners informativos do FRESUNI');
  home.insertBefore(host,home.querySelector('.home-directory')||null);
 }
 return host;
}
function fsHomeBannerItems(){
 return Array.from(fsHomeBannerHost()?.querySelectorAll('[data-fresuni-home-banner]')||[]);
}
function fsHomeBannerCurrent(){
 const id=$('#fs-home-banner-choice')?.value||'new';
 return id==='new'?null:fsHomeBannerItems().find(b=>b.dataset.fresuniHomeBanner===id)||null;
}
function fsHomeBannerStatus(message){
 fsMediaStatus('fs-home-banner-status',message);
}
function fsHomeBannerPreviewClear(){
 const img=$('#fs-home-banner-preview');if(!img)return;
 if(img.dataset.fsObjectUrl)URL.revokeObjectURL(img.dataset.fsObjectUrl);
 delete img.dataset.fsObjectUrl;
}
function fsHomeBannerRead(preferred=''){
 const select=$('#fs-home-banner-choice');if(!select)return;
 const chosen=preferred||select.value||'new';
 select.replaceChildren();
 const option=document.createElement('option');option.value='new';option.textContent='＋ Criar um novo banner';select.append(option);
 const banners=fsHomeBannerItems();
 banners.forEach((item,i)=>{
  const opt=document.createElement('option');
  opt.value=item.dataset.fresuniHomeBanner;
  const alt=item.querySelector('img')?.getAttribute('alt')||'Banner informativo';
  opt.textContent=String(i+1)+' · '+alt.slice(0,58);
  select.append(opt);
 });
 select.value=[...select.options].some(x=>x.value===chosen)?chosen:'new';
 const banner=fsHomeBannerCurrent(),img=banner?.querySelector('.fresuni-banner-image img');
 const src=img?.getAttribute('src')||'';
 const preview=$('#fs-home-banner-preview');
 fsHomeBannerPreviewClear();
 if(src){preview.src=src;preview.hidden=false;}
 else{preview.hidden=true;preview.removeAttribute('src');}
 $('#fs-home-banner-file').value='';
 $('#fs-home-banner-alt').value=img?.getAttribute('alt')||'';
 fsHomeLinkRead('fs-home-banner',banner?.querySelector('.fresuni-banner-image a')?.getAttribute('href')||'#/');
 $('#fs-home-banner-save').textContent=banner?'Atualizar banner':'Adicionar banner';
 $('#fs-home-banner-delete').hidden=!banner;
 const index=banners.indexOf(banner);
 $('#fs-home-banner-up').hidden=!banner||index<=0;
 $('#fs-home-banner-down').hidden=!banner||index>=banners.length-1;
 fsHomeBannerStatus(banner?
  'Banner carregado. É possível atualizar a imagem, o destino e a descrição, ou alterar a ordem.':
  'Novo banner: envie uma imagem, escolha o destino e clique em Adicionar banner.');
}
$('#fs-home-banner-choice')?.addEventListener('change',()=>fsHomeBannerRead());
frame.addEventListener('load',()=>{
 fsHomeBannerRead(fsHomeBannerPendingSelection||'');
 fsHomeBannerPendingSelection=null;
});
$('#fs-home-banner-file')?.addEventListener('change',e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!FS_MEDIA_TYPES.includes(file.type)||!file.size||file.size>FS_MEDIA_INPUT_LIMIT){
  e.target.value='';fsHomeBannerStatus('Arquivo recusado: use JPG, PNG ou WebP de até 5 MB.');return;
 }
 const preview=$('#fs-home-banner-preview');fsHomeBannerPreviewClear();
 const url=URL.createObjectURL(file);
 preview.dataset.fsObjectUrl=url;preview.src=url;preview.hidden=false;
 fsHomeBannerStatus('Imagem selecionada. Será compactada ao clicar em Adicionar ou Atualizar.');
});
$('#fs-home-banner-save')?.addEventListener('click',async()=>{
 if(fsHomeBannerSaving)return;
 if(!state.editable){fsHomeBannerStatus('Ative o modo de edição antes de alterar o banner.');return;}
 const home=pageFor('/')?.querySelector('.home-wrap');
 if(!home){fsHomeBannerStatus('A página inicial não foi carregada.');return;}
 const previous=fsHomeBannerCurrent(),file=$('#fs-home-banner-file').files?.[0];
 const alt=$('#fs-home-banner-alt').value.trim();
 const href=fsHomeLinkValue('fs-home-banner');
 if(!alt){fsHomeBannerStatus('É obrigatório descrever a imagem e o destino para leitores de tela.');return;}
 if(!href||!fsMediaLinkAllowed(href)||(href.startsWith('#/')&&!pageFor(href.slice(1)))){
  fsHomeBannerStatus('Escolha uma página existente ou um endereço HTTPS válido.');return;
 }
 if(!previous&&!file){fsHomeBannerStatus('Escolha uma imagem para o novo banner.');return;}
 const save=$('#fs-home-banner-save');fsHomeBannerSaving=true;save.disabled=true;
 fsHomeBannerStatus('Preparando e compactando banner…');
 try{
  const source=file?await fsCompressMedia(file,'banner'):null;
  const src=source?.src||previous?.querySelector('.fresuni-banner-image img')?.getAttribute('src')||'';
  if(!fsMediaSrcAllowed(src))throw Error('Imagem inválida. Selecione uma imagem JPG, PNG ou WebP.');
  const id=previous?.dataset.fresuniHomeBanner||
   'banner-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  const original=previous?.querySelector('.fresuni-banner-image img');
  const width=source?.width||Number(original?.getAttribute('width'))||0;
  const height=source?.height||Number(original?.getAttribute('height'))||0;
  const dimensions=width&&height?' width="'+width+'" height="'+height+'"':'';
  const external=/^https:\/\//i.test(href);
  const img='<img src="'+escapeHTML(src)+'" alt="'+escapeHTML(alt)+'"'+dimensions+' decoding="async" loading="lazy">';
  const anchor='<a href="'+escapeHTML(href)+'" aria-label="'+escapeHTML(alt+(external?' (abre em nova aba)':''))+'"'+
   (external?' target="_blank" rel="noopener noreferrer"':'')+'>'+img+'</a>';
  const markup='<section class="fresuni-site-banner fresuni-home-banner" data-fresuni-block="banner" data-fresuni-home-banner="'+
   escapeHTML(id)+'"><div class="fresuni-banner-image">'+anchor+'</div></section>';
  fsMediaCheckBudget(markup,previous);
  snapshot();
  const holder=fsHomeBannerHost(true);
  const template=siteDoc().createElement('template');template.innerHTML=markup;
  const element=template.content.firstElementChild;
  if(previous)previous.replaceWith(element);
  else holder.append(element);
  fsHomeBannerPreviewClear();
  $('#fs-home-banner-file').value='';
  fsHomeBannerPendingSelection=id;
  const updated=serialize();reloadFrame(updated,'/');dirty();
  fsHomeBannerStatus('Banner aplicado ao rascunho. Clique em Publicar alterações para atualizar o site.');
  notify('Banner '+(previous?'atualizado':'adicionado')+' na página inicial.');
 }catch(err){fsHomeBannerStatus('Não foi possível aplicar: '+fsMediaErrorText(err));}
 finally{fsHomeBannerSaving=false;save.disabled=false;}
});
$('#fs-home-banner-delete')?.addEventListener('click',()=>{
 const block=fsHomeBannerCurrent();if(!block||!state.editable)return;
 if(!confirm('Excluir este banner do rascunho? A exclusão só chega ao site após publicar.'))return;
 snapshot();block.remove();fsHomeBannerPreviewClear();
 fsHomeBannerPendingSelection='new';
 reloadFrame(serialize(),'/');dirty();notify('Banner excluído do rascunho.');
});
for(const [button,direction] of [['fs-home-banner-up',-1],['fs-home-banner-down',1]]){
 $('#'+button)?.addEventListener('click',()=>{
  const block=fsHomeBannerCurrent();if(!block||!state.editable)return;
  const list=fsHomeBannerItems(),index=list.indexOf(block),target=list[index+direction];
  if(!target)return;
  snapshot();
  if(direction<0)block.parentElement.insertBefore(block,target);
  else block.parentElement.insertBefore(target,block);
  dirty();fsHomeBannerRead(block.dataset.fresuniHomeBanner);
  notify('Ordem dos banners alterada no rascunho.');
 });
}

function fsOpenGallery(edit=null){
 if(!state.editable){notify('Volte ao modo de edição para inserir uma galeria.');return;}
 fsGalleryEditing=edit?.isConnected?edit:null;fsGalleryItems=[];
 for(const fig of fsGalleryEditing?.querySelectorAll('.fresuni-gallery-grid figure')||[]){
  const img=fig.querySelector('img'),src=img?.getAttribute('src')||'';
  if(img&&fsMediaSrcAllowed(src))fsGalleryItems.push({src,alt:img.getAttribute('alt')||'',caption:fig.querySelector('figcaption')?.textContent||''});
 }
 $('#fs-gallery-title').value=fsGalleryEditing?.querySelector(':scope > h2')?.textContent||'Galeria de fotos';
 $('#fs-gallery-files').value='';$('#fs-gallery-save').textContent=fsGalleryEditing?'Atualizar galeria':'Inserir galeria';
 fsMediaStatus('fs-gallery-status',fsGalleryItems.length+' de 12 fotos. Compactação automática antes de inserir.');
 fsRenderGalleryDraft();$('#fs-gallery-dialog').showModal();
}
function fsRenderGalleryDraft(){
 const host=$('#fs-gallery-items');host.replaceChildren();
 for(const [index,item] of fsGalleryItems.entries()){
  const row=document.createElement('div');row.className='fs-gallery-item';
  const image=document.createElement('img');image.src=item.src;image.alt='Prévia da fotografia '+(index+1);image.loading='lazy';
  const fields=document.createElement('div');fields.className='fs-gallery-item-fields';
  function editable(label,field,max){
   const lab=document.createElement('label');lab.textContent=label;
   const inp=document.createElement('input');inp.type='text';inp.maxLength=max;inp.value=item[field]||'';
   inp.addEventListener('input',()=>{item[field]=inp.value;});lab.append(inp);fields.append(lab);
  }
  editable('Descrição acessível da foto '+(index+1),'alt',180);
  editable('Legenda (opcional)','caption',250);
  const buttons=document.createElement('div');buttons.className='fs-gallery-item-buttons';
  function action(symbol,title,disabled,handler){
   const b=document.createElement('button');b.type='button';b.textContent=symbol;b.title=title;b.setAttribute('aria-label',title+' foto '+(index+1));b.disabled=disabled;
   if(symbol==='✕')b.className='danger';
   b.addEventListener('click',handler);buttons.append(b);
  }
  action('↑','Subir',index===0,()=>{[fsGalleryItems[index-1],fsGalleryItems[index]]=[fsGalleryItems[index],fsGalleryItems[index-1]];fsRenderGalleryDraft();});
  action('↓','Descer',index===fsGalleryItems.length-1,()=>{[fsGalleryItems[index+1],fsGalleryItems[index]]=[fsGalleryItems[index],fsGalleryItems[index+1]];fsRenderGalleryDraft();});
  action('✕','Remover',false,()=>{fsGalleryItems.splice(index,1);fsRenderGalleryDraft();});
  fields.append(buttons);row.append(image,fields);host.append(row);
 }
 $('#fs-gallery-save').disabled=fsGalleryBusy;
}
$('#fs-gallery-files').addEventListener('change',async event=>{
 const input=event.target,files=[...input.files];input.value='';
 if(!files.length||fsGalleryBusy)return;
 if(fsGalleryItems.length+files.length>FS_MEDIA_MAX_GALLERY){
  fsMediaStatus('fs-gallery-status','Limite de 12 fotos por galeria. Selecione menos imagens ou remova alguma.');return;
 }
 fsGalleryBusy=true;$('#fs-gallery-save').disabled=true;input.disabled=true;
 const errors=[];let count=0,totalBytes=0;
 try{
  for(const file of files){
   try{
    fsMediaStatus('fs-gallery-status','Compactando '+(count+errors.length+1)+' de '+files.length+': '+file.name);
    const data=await fsCompressMedia(file,'gallery');totalBytes+=data.bytes;
    const alt=file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim().slice(0,180)||'Foto do FRESUNI';
    fsGalleryItems.push({src:data.src,alt,caption:''});count++;
   }catch(err){errors.push(file.name+': '+fsMediaErrorText(err));}
  }
 }finally{fsGalleryBusy=false;input.disabled=false;$('#fs-gallery-save').disabled=false;fsRenderGalleryDraft();}
 const message=count+' foto(s) compactadas; '+fsGalleryItems.length+'/12 no total. '+(errors.length?'Não adicionadas: '+errors.join('; '):'Prontas para inserir.');
 fsMediaStatus('fs-gallery-status',message);
});
$('#fs-gallery-cancel').addEventListener('click',()=>{$('#fs-gallery-dialog').close();});
$('#fs-gallery-form').addEventListener('submit',e=>{
 e.preventDefault();if(fsGalleryBusy)return;
 if(!fsGalleryItems.length){fsMediaStatus('fs-gallery-status','Adicione pelo menos uma fotografia.');return;}
 if(fsGalleryItems.some(item=>!fsMediaSrcAllowed(item.src))){fsMediaStatus('fs-gallery-status','Uma das imagens é inválida.');return;}
 const title=$('#fs-gallery-title').value.trim();
 const figures=fsGalleryItems.map(item=>'<figure><button type="button" class="fresuni-gallery-zoom" aria-label="Ampliar foto: '+escapeHTML(item.alt||'fotografia')+'"><img src="'+escapeHTML(item.src)+'" alt="'+escapeHTML(item.alt)+'" loading="lazy" decoding="async"></button>'+
  (item.caption.trim()?'<figcaption>'+escapeHTML(item.caption.trim())+'</figcaption>':'')+'</figure>').join('');
 const html='<section class="fresuni-photo-gallery" data-fresuni-block="gallery" aria-label="'+escapeHTML(title||'Galeria de fotos')+'">'+(title?'<h2>'+escapeHTML(title)+'</h2>':'')+'<div class="fresuni-gallery-grid">'+figures+'</div></section>';
 try{fsMediaApply(html,fsGalleryEditing);$('#fs-gallery-dialog').close();notify('Galeria de fotos '+(fsGalleryEditing?'atualizada':'adicionada')+' no rascunho.');}
 catch(err){fsMediaStatus('fs-gallery-status',fsMediaErrorText(err));}
});
function fsOpenBanner(edit=null){
 if(!state.editable){notify('Volte ao modo de edição para inserir um banner.');return;}
 fsBannerEditing=edit?.isConnected?edit:null;
 fsBannerSource=fsBannerEditing?.querySelector('.fresuni-banner-image img')?.getAttribute('src')||'';
 $('#fs-banner-title').value=fsBannerEditing?.querySelector('.fresuni-banner-text h2')?.textContent||'';
 $('#fs-banner-description').value=fsBannerEditing?.querySelector('.fresuni-banner-text p')?.textContent||'';
 $('#fs-banner-alt').value=fsBannerEditing?.querySelector('.fresuni-banner-image img')?.getAttribute('alt')||'';
 $('#fs-banner-link').value=fsBannerEditing?.querySelector('.fresuni-banner-image a')?.getAttribute('href')||'';
 $('#fs-banner-ratio').value=fsBannerEditing?.dataset.bannerRatio==='standard'?'standard':'wide';
 $('#fs-banner-file').value='';$('#fs-banner-save').textContent=fsBannerEditing?'Atualizar banner':'Inserir banner';
 $('#fs-banner-preview').hidden=!fsBannerSource;
 if(fsBannerSource)$('#fs-banner-preview').src=fsBannerSource;else $('#fs-banner-preview').removeAttribute('src');
 fsMediaStatus('fs-banner-status',fsBannerSource?'Você pode trocar a imagem ou atualizar o texto e link.':'Envie uma imagem para criar seu banner.');
 $('#fs-banner-dialog').showModal();
}
$('#fs-banner-file').addEventListener('change',async e=>{
 const input=e.target,file=input.files?.[0];input.value='';if(!file||fsBannerBusy)return;
 fsBannerBusy=true;input.disabled=true;$('#fs-banner-save').disabled=true;
 fsMediaStatus('fs-banner-status','Compactando banner…');
 try{
  const result=await fsCompressMedia(file,'banner');fsBannerSource=result.src;
  $('#fs-banner-preview').src=fsBannerSource;$('#fs-banner-preview').hidden=false;
  if(!$('#fs-banner-alt').value.trim())$('#fs-banner-alt').value=file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,180);
  fsMediaStatus('fs-banner-status','Imagem compactada para '+Math.ceil(result.bytes/1024)+' KB. Pronta para adicionar.');
 }catch(err){fsMediaStatus('fs-banner-status',fsMediaErrorText(err));}
 finally{fsBannerBusy=false;input.disabled=false;$('#fs-banner-save').disabled=false;}
});
$('#fs-banner-cancel').addEventListener('click',()=>$('#fs-banner-dialog').close());
$('#fs-banner-form').addEventListener('submit',e=>{
 e.preventDefault();if(fsBannerBusy)return;
 if(!fsMediaSrcAllowed(fsBannerSource)){fsMediaStatus('fs-banner-status','Selecione uma imagem válida para o banner.');return;}
 const title=$('#fs-banner-title').value.trim(),description=$('#fs-banner-description').value.trim(),alt=$('#fs-banner-alt').value.trim();
 const link=$('#fs-banner-link').value.trim(),ratio=$('#fs-banner-ratio').value;
 if(!fsMediaLinkAllowed(link)){fsMediaStatus('fs-banner-status','Use um endereço interno (#/pagina) ou HTTPS válido.');return;}
 const image='<img src="'+escapeHTML(fsBannerSource)+'" alt="'+escapeHTML(alt)+'" decoding="async" loading="lazy">';
 const media='<div class="fresuni-banner-image">'+(link?'<a href="'+escapeHTML(link)+'"'+(link.startsWith('https://')?' target="_blank" rel="noopener noreferrer"':'')+'>'+image+'</a>':image)+'</div>';
 const caption=(title||description)?'<div class="fresuni-banner-text">'+(title?'<h2>'+escapeHTML(title)+'</h2>':'')+(description?'<p>'+escapeHTML(description)+'</p>':'')+'</div>':'';
 const html='<section class="fresuni-site-banner" data-fresuni-block="banner" data-banner-ratio="'+(ratio==='standard'?'standard':'wide')+'">'+media+caption+'</section>';
 try{fsMediaApply(html,fsBannerEditing);$('#fs-banner-dialog').close();notify('Banner '+(fsBannerEditing?'atualizado':'adicionado')+' no rascunho.');}
 catch(err){fsMediaStatus('fs-banner-status',fsMediaErrorText(err));}
});

// Google Formulários: integrações reais dentro da página, configuráveis no editor.
// Não é necessário colocar scripts do Google no site nem mexer no Worker.
const gfDialog=$('#google-forms-dialog'),gfInput=$('#google-forms-url');
let gfEditing=null;
function fsParseGoogleForm(raw,mode){
 let text=String(raw||'').trim(),suggestedHeight=0;
 if(!text)throw Error('Cole o link para responder ao formulário ou o código de incorporação.');
 if(/^<iframe\b/i.test(text)){
  const doc=new DOMParser().parseFromString(text,'text/html');
  const iframe=doc.querySelector('iframe');
  if(!iframe)throw Error('Não foi possível reconhecer o iframe. Copie o código de incorporação do Google Formulários.');
  suggestedHeight=Number(iframe.getAttribute('height'))||0;
  text=iframe.getAttribute('src')||'';
 }
 let url;try{url=new URL(text);}catch{throw Error('O endereço precisa começar com https://.');}
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Use um link HTTPS público do Google Formulários.');
 const host=url.hostname.toLowerCase();
 const short=host==='forms.gle';
 const full=host==='docs.google.com'&&/^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[a-z0-9_-]+\/viewform\/?$/i.test(url.pathname);
 if(!short&&!full)throw Error('Use um link de resposta do Google Formulários (docs.google.com/forms/…/viewform) ou um link curto forms.gle.');
 if(short&&mode==='embed')throw Error('Links curtos forms.gle não podem ser incorporados diretamente. No Google Formulários, copie o código de incorporação (<>) ou escolha “Botão para abrir”.');
 if(full&&mode==='embed')url.searchParams.set('embedded','true');
 url.hash='';
 return {url:url.toString(),suggestedHeight,short};
}
function fsGoogleFormBlock({url,title,height,mode}){
 const name=String(title||'Formulário do FRESUNI').trim().slice(0,120)||'Formulário do FRESUNI';
 const safeTitle=escapeHTML(name),safeUrlText=escapeHTML(url);
 const label='<h2 class="fresuni-google-forms-title" style="font-family:Merriweather,Georgia,serif;font-size:1.4rem;line-height:1.4;color:var(--purple,#214ECF);margin:0 0 14px">'+safeTitle+'</h2>';
 const link='<a href="'+safeUrlText+'" target="_blank" rel="noopener noreferrer" class="fresuni-google-form-link" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:11px 18px;border:1px solid var(--purple,#214ECF);border-radius:8px;color:var(--purple,#214ECF);font-family:Prompt,Arial,sans-serif;font-weight:600;text-decoration:none;overflow-wrap:anywhere">Abrir formulário em outra aba ↗</a>';
 const iframe=mode==='embed'?'<iframe title="'+safeTitle+'" src="'+safeUrlText+'" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" style="display:block;width:100%;height:'+height+'px;border:1px solid #e4d7eb;border-radius:10px;background:#fff;max-width:100%" allow="clipboard-write"></iframe>':'';
 const content=label+iframe+'<div style="margin-top:12px">'+link+'</div>';
 return '<section data-fresuni-block="google-forms" data-fresuni-google-forms-mode="'+mode+'" class="fresuni-google-forms" style="box-sizing:border-box;grid-column:1 / -1;width:100%;max-width:960px;min-width:0;margin:28px auto;padding:0;overflow-wrap:anywhere">'+content+'</section>';
}
function fsGoogleFormHost(){
 const page=selectedPage();if(!page)return null;
 const selected=state.selected?.closest('.site-page')===page?state.selected:null;
 if(selected){
  const directory=selected.closest('.directory-links');
  if(directory){
   const selectedItem=fsWholeGridItem(selected);
   return {parent:directory,before:selectedItem?.nextSibling||null};
  }
  const cards=selected.closest('.card-grid');
  if(cards){
   const selectedItem=fsWholeGridItem(selected);
   return {parent:cards,before:selectedItem?.nextSibling||null};
  }
  // Não aninhar iframe em parágrafos, links ou cartões já existentes.
  const holder=selected.closest('.prose,.page-shell,.home-wrap,.home-values,.site-page');
  if(holder){
   let child=selected;
   while(child.parentElement&&child.parentElement!==holder)child=child.parentElement;
   if(child.parentElement===holder)return {parent:holder,before:child.nextSibling};
  }
 }
 const holder=page.querySelector('.prose,.page-shell,.home-wrap,.home-values')||page;
 return {parent:holder,before:null};
}
function fsOpenGoogleForms(edit=null){
 if(!state.editable){notify('Volte ao modo de edição para integrar um formulário.');return;}
 const current=edit||state.selected?.closest?.('[data-fresuni-block="google-forms"]')||null;
 gfEditing=current?.isConnected?current:null;
 const mode=gfEditing?.dataset.fresuniGoogleFormsMode||(gfEditing?.querySelector('iframe')?'embed':'link')||'embed';
 const src=gfEditing?.querySelector('iframe')?.getAttribute('src')||gfEditing?.querySelector('a[href]')?.getAttribute('href')||'';
 gfInput.value=src;
 $('#google-forms-title').value=gfEditing?.querySelector('.fresuni-google-forms-title')?.textContent||'Formulário do FRESUNI';
 $('#google-forms-mode').value=mode;
 $('#google-forms-height').value=parseInt(gfEditing?.querySelector('iframe')?.style.height)||800;
 $('#google-forms-submit').textContent=gfEditing?'Atualizar formulário':'Integrar à página';
 $('#google-forms-warning').hidden=true;
 fsToggleGoogleMode();
 gfDialog.showModal();
 gfInput.focus();
}
function fsToggleGoogleMode(){$('#google-forms-height-wrap').hidden=$('#google-forms-mode').value!=='embed';}
$('#google-forms-mode').addEventListener('change',fsToggleGoogleMode);
$('#google-forms-cancel').addEventListener('click',()=>gfDialog.close());
gfDialog.addEventListener('close',()=>{gfEditing=null;});
$('#google-forms-form').addEventListener('submit',event=>{
 event.preventDefault();
 const mode=$('#google-forms-mode').value;
 let parsed;
 const warning=$('#google-forms-warning');
 try{parsed=fsParseGoogleForm(gfInput.value,mode);}catch(e){warning.textContent=e.message;warning.hidden=false;gfInput.focus();return;}
 const name=$('#google-forms-title').value.trim()||'Formulário do FRESUNI';
 const height=Math.max(350,Math.min(2600,Number($('#google-forms-height').value)||parsed.suggestedHeight||800));
 const rendered=fsGoogleFormBlock({url:parsed.url,title:name,height,mode});
 const target=gfEditing;
 const d=siteDoc();
 if(!d){warning.textContent='A prévia do site ainda não foi carregada.';warning.hidden=false;return;}
 const template=d.createElement('template');template.innerHTML=rendered;
 const replacement=template.content.firstElementChild;
 if(!replacement){warning.textContent='Não foi possível montar o formulário.';warning.hidden=false;return;}
 if(target?.isConnected){
  snapshot();
  // Preservar ajustes de largura e margens feitos na edição anterior.
  const keepStyle=target.getAttribute('style');
  if(keepStyle)replacement.setAttribute('style',keepStyle);
  target.replaceWith(replacement);
 }else{
  const dest=fsGoogleFormHost();
  if(!dest){warning.textContent='Selecione uma página para inserir o formulário.';warning.hidden=false;return;}
  snapshot();
  dest.parent.insertBefore(replacement,dest.before);
 }
 if(replacement.parentElement?.matches('.card-grid,.directory-links'))replacement.style.gridColumn='1 / -1';
 gfDialog.close();
 fsEnsureGoogleFormHandle(replacement);
 state.selected=null;
 selectElement(replacement);
 dirty();
 replacement.scrollIntoView({behavior:'smooth',block:'center'});
 notify('Google Formulários integrado ao rascunho. Publique quando estiver pronto.');
});
function fsEnsureGoogleFormHandle(section){
 if(!section||section.querySelector('[data-fresuni-google-edit]'))return;
 const d=section.ownerDocument;
 const button=d.createElement('button');button.type='button';button.className='fresuni-google-edit';button.textContent='✎ Editar Google Formulários';button.dataset.editorInternal='';button.dataset.fresuniGoogleEdit='';
 button.style.cssText='display:block;margin:0 0 12px;padding:9px 14px;border:1px dashed #214ECF;border-radius:8px;color:#6500a8;background:#faf5ff;font:600 13px Prompt,Arial,sans-serif;cursor:pointer';
 button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();state.selected=null;selectElement(section);fsOpenGoogleForms(section);});
 section.insertBefore(button,section.firstChild);
}
function setupGoogleFormsHandles(d){
 $$('.fresuni-google-forms[data-fresuni-block="google-forms"]',d).forEach(fsEnsureGoogleFormHandle);
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
// Formatação contextual na prévia: texto selecionado recebe estilo apenas no trecho.
let savedTextRange=null,floatBar=null;
const FONT_WEIGHTS={Prompt:[100,200,300,400,500,600,700,800,900],Merriweather:[300,400,500,600,700,800,900]};
const weightLabels={100:'Thin',200:'ExtraLight',300:'Light',400:'Regular',500:'Medium',600:'SemiBold',700:'Bold',800:'ExtraBold',900:'Black'};
function setWeightOptions(font,value){
 const sel=$('#font-weight');const weights=FONT_WEIGHTS[font]||FONT_WEIGHTS.Prompt;
 sel.replaceChildren();for(const w of weights){const opt=document.createElement('option');opt.value=String(w);opt.textContent=weightLabels[w]+' · '+w;sel.append(opt);}
 sel.value=String(weights.includes(+value)?+value:weights.includes(400)?400:weights[0]);
}
function closestElement(node){return node?.nodeType===1?node:node?.parentElement;}
function activeTextRange(){const r=savedTextRange;if(!r||r.collapsed||!r.startContainer?.isConnected||!r.endContainer?.isConnected)return null;
 const a=closestElement(r.startContainer)?.closest('.site-page,.site-header,.site-footer'),b=closestElement(r.endContainer)?.closest('.site-page,.site-header,.site-footer');
 return a&&a===b&&(!a.matches('.site-page')||a.dataset.route===state.route)&&String(r).trim()?r:null;
}
function captureTextSelection(){const d=siteDoc();if(!d||!state.editable)return;const sel=d.getSelection();if(!sel||!sel.rangeCount||sel.isCollapsed)return;
 const r=sel.getRangeAt(0);const a=closestElement(r.startContainer)?.closest('[data-fresuni-editable="true"]');const b=closestElement(r.endContainer)?.closest('[data-fresuni-editable="true"]');
 if(!a||a!==b||!a.closest('.site-page:not([hidden]),.site-header,.site-footer')||!String(r).trim())return;
 savedTextRange=r.cloneRange();
}
function restoreTextRange(){const d=siteDoc(),r=activeTextRange();if(!r)return null;
 const s=d.getSelection();s.removeAllRanges();s.addRange(r);return r;
}
function applyInlineStyle(prop,value){const d=siteDoc();if(!d||!state.editable)return;let range=activeTextRange();
 if(range){snapshot();range=restoreTextRange();try{
  const span=d.createElement('span');span.style.setProperty(prop,value,prop==='color'?'important':'');span.dataset.fresuniStyled='';
  const part=range.extractContents();span.append(part);range.insertNode(span);
  const sel=d.getSelection();sel.removeAllRanges();const nr=d.createRange();nr.selectNodeContents(span);sel.addRange(nr);savedTextRange=nr.cloneRange();
  dirty();positionFloatingToolbar();return;
 }catch(e){notify('Não foi possível formatar a seleção: '+e.message);return;}}
 const el=state.selected;if(!el){notify('Selecione uma palavra ou um elemento.');return;}snapshot();el.style.setProperty(prop,value,prop==='color'?'important':'');dirty();if(prop==='color')fsIndividualColorRead(el);selectElement(el);
}
function execFormat(command,value){const d=siteDoc();if(!d||!state.editable)return;
 const range=activeTextRange();
 if(!range&&state.selected){const map={bold:['font-weight',frame.contentWindow.getComputedStyle(state.selected).fontWeight==='700'?'400':'700'],italic:['font-style',frame.contentWindow.getComputedStyle(state.selected).fontStyle==='italic'?'normal':'italic'],underline:['text-decoration',frame.contentWindow.getComputedStyle(state.selected).textDecorationLine.includes('underline')?'none':'underline'],strikeThrough:['text-decoration','line-through']};if(map[command]){applyInlineStyle(...map[command]);return;}}
 snapshot();if(range)restoreTextRange();else if(state.selected?.isContentEditable){state.selected.focus();}
 try{d.execCommand('styleWithCSS',false,true);const ok=d.execCommand(command,false,value);if(!ok)notify('Selecione uma palavra ou texto para aplicar esta opção.');}catch{notify('Selecione um texto antes de usar esta formatação.');return;}dirty();
}
$$('[data-format]').forEach(b=>{b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>execFormat(b.dataset.format));});
$$('[data-align]').forEach(b=>{b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>{const el=state.selected;if(el){snapshot();el.style.textAlign=b.dataset.align;dirty();}});});
$('#text-color').addEventListener('change',e=>applyInlineStyle('color',e.target.value));
$('#highlight-color').addEventListener('change',e=>applyInlineStyle('background-color',e.target.value));
$('#font-family').addEventListener('change',e=>{setWeightOptions(e.target.value,400);applyInlineStyle('font-family',e.target.value+(e.target.value==='Merriweather'?',Georgia,serif':',Arial,sans-serif'));});
$('#font-weight').addEventListener('change',e=>applyInlineStyle('font-weight',String(+e.target.value||400)));
$('#font-size').addEventListener('change',e=>applyInlineStyle('font-size',Math.max(10,Math.min(180,+e.target.value||16))+'px'));
function findLinkFor(el){if(!el)return null;if(el.matches('a[href]'))return el;const closest=el.closest('a[href]');if(closest)return closest;
 return el.querySelector('a[href]');}
let linkMode='internal';
function chooseLinkMode(mode){linkMode=mode;$('#link-internal-wrap').hidden=mode!=='internal';$('#link-external-wrap').hidden=mode!=='external';
 for(const [id,is] of [['#link-tab-internal',mode==='internal'],['#link-tab-external',mode==='external']]){$(id).classList.toggle('active',is);$(id).setAttribute('aria-pressed',String(is));}}
$('#link-tab-internal').addEventListener('click',()=>chooseLinkMode('internal'));
$('#link-tab-external').addEventListener('click',()=>chooseLinkMode('external'));
function openLinkDialog(){if(!state.editable)return;captureTextSelection();const range=activeTextRange(),el=state.selected;
 if(!range&&!el){notify('Selecione um texto, uma imagem, forma ou outro elemento.');return;}
 const sel=$('#link-internal-page');sel.replaceChildren();for(const p of pageNodes()){
  const opt=document.createElement('option');opt.value='#'+p.dataset.route;opt.textContent=labelPath(p);sel.append(opt);}
 const existing=range?closestElement(range.startContainer)?.closest('a[href]'):findLinkFor(el),url=existing?.getAttribute('href')||'';
 chooseLinkMode(!url||url.startsWith('#')?'internal':'external');
 $('#link-internal-page').value=url.startsWith('#/')?url:'#'+(state.route||'/');$('#link-external-url').value=url.startsWith('#')?'':url;
 $('#link-label').value='';$('#link-error').textContent='';
 $('#link-context').textContent=range?'Texto selecionado: “'+String(range).slice(0,110)+'”':'Elemento selecionado: '+(el?.textContent?.trim()?.slice(0,70)||el?.tagName?.toLowerCase()||'imagem')+'.';
 $('#link-new-tab').checked=!!(existing?.target==='_blank'||(url&&!url.startsWith('#')));
 $('#link-dialog').showModal();
}
$('#make-link').addEventListener('click',openLinkDialog);
$('#element-add-link').addEventListener('click',openLinkDialog);
$('#cancel-link').addEventListener('click',()=>$('#link-dialog').close());
function decorateLink(a,url,blank){a.href=url;if(blank&&!url.startsWith('#')){a.target='_blank';a.rel='noopener noreferrer';}else{a.removeAttribute('target');a.removeAttribute('rel');}}
function applyLink(url,label,blank){const d=siteDoc(),range=activeTextRange(),el=state.selected;
 if(!d||!safeUrl(url)){throw Error('Use https://, http://, e-mail, telefone ou uma página interna válida.');}
 if(!range&&!el)throw Error('Selecione primeiro um elemento ou uma palavra.');
 if(range){const startHost=closestElement(range.startContainer)?.closest('[data-fresuni-editable="true"]');const endHost=closestElement(range.endContainer)?.closest('[data-fresuni-editable="true"]');
  if(!startHost||startHost!==endHost)throw Error('Selecione palavras dentro de uma mesma caixa de texto.');
  snapshot();let existing=closestElement(range.startContainer)?.closest('a[href]');
  if(existing&&existing.contains(range.endContainer)){decorateLink(existing,url,blank);if(label)existing.textContent=label;
  }else{const a=d.createElement('a');decorateLink(a,url,blank);a.style.cursor='pointer';
   if(label){range.deleteContents();a.textContent=label;}else{a.append(range.extractContents());}
   range.insertNode(a);
  }
  savedTextRange=null;dirty();return;
 }
 let existing=el.matches('a[href]')?el:el.closest('a[href]');
 if(existing){snapshot();decorateLink(existing,url,blank);if(label&&existing.children.length===0)existing.textContent=label;dirty();return;}
 // Whole text content, headings, list entries and buttons: link the element contents.
 if(el.matches('p,h1,h2,h3,h4,h5,h6,li,summary,blockquote,span,cite')&& !el.querySelector('a[href]')){
  snapshot();const a=d.createElement('a');decorateLink(a,url,blank);a.style.color='inherit';a.style.textDecoration='underline';a.style.textDecorationColor='#214ECF';
  if(label) a.textContent=label;else while(el.firstChild)a.append(el.firstChild);
  if(label)el.replaceChildren(a);else el.append(a);dirty();return;
 }
 // Images: wrap the image, not the entire figure (keeps layout and captions).
 if(el.matches('img')||el.matches('figure')){
  const image=el.matches('img')?el:el.querySelector('img');if(!image)throw Error('A imagem não foi encontrada.');
  snapshot();const a=d.createElement('a');decorateLink(a,url,blank);a.setAttribute('aria-label',label||image.alt||'Abrir link da imagem');
  image.replaceWith(a);a.append(image);dirty();return;
 }
 if(el.querySelector('a[href]'))throw Error('Este bloco já contém links. Selecione um elemento específico, sem criar links dentro de links.');
 if(el.matches('iframe')){snapshot();const a=d.createElement('a');decorateLink(a,url,blank);a.textContent=label||'Abrir conteúdo em uma nova página';el.after(a);dirty();return;}
 // Shapes and containers: clickable block preserving regular page flow, no absolute positioning.
 snapshot();const a=d.createElement('a');decorateLink(a,url,blank);a.className='fresuni-clickable-block';a.dataset.fresuniLinkBlock='';
 a.style.display='block';a.style.width='fit-content';a.style.maxWidth='100%';a.style.color='inherit';a.style.textDecoration='none';a.style.cursor='pointer';
 el.replaceWith(a);a.append(el);dirty();
}
$('#link-form').addEventListener('submit',e=>{e.preventDefault();const url=(linkMode==='internal'?$('#link-internal-page').value:$('#link-external-url').value).trim();
 try{applyLink(url,$('#link-label').value.trim(),$('#link-new-tab').checked);$('#link-dialog').close();notify('Link aplicado ao rascunho. Publique quando estiver pronto.');
  const el=state.selected;if(el?.isConnected){state.selected=null;selectElement(el);}else clearSelection();
 }catch(err){$('#link-error').textContent=err.message;}
});
function unlinkSelected(){const el=state.selected,range=activeTextRange();const a=range?closestElement(range.startContainer)?.closest('a[href]'):findLinkFor(el);
 if(!a){notify('Este elemento não tem um link para remover.');return;}
 snapshot();const parent=a.parentNode;while(a.firstChild)parent.insertBefore(a.firstChild,a);a.remove();dirty();clearSelection();notify('Link removido do rascunho.');
}
$('#remove-link').addEventListener('click',unlinkSelected);$('#element-remove-link').addEventListener('click',unlinkSelected);
// Campo legado passa a indicar destino do link sem alterar URLs de arquivos de imagem.
$('#element-url').addEventListener('click',openLinkDialog);
$('#add-emoji').addEventListener('click',()=>{const emoji=prompt('Digite ou cole o emoji:','💜');if(!emoji)return;const d=siteDoc(),r=activeTextRange();if(r){snapshot();restoreTextRange();d.execCommand('insertText',false,emoji);dirty();}else if(state.selected?.isContentEditable){snapshot();state.selected.append(emoji);dirty();}else notify('Selecione uma caixa de texto.');});
function hideFloatingToolbar(){if(floatBar)floatBar.hidden=true;}
function positionFloatingToolbar(){if(!floatBar||!state.editable||!state.selected?.isConnected){hideFloatingToolbar();return;}
 const r=activeTextRange();const rect=(r?r.getBoundingClientRect():state.selected.getBoundingClientRect());
 if(!rect||(!rect.width&&!rect.height)){hideFloatingToolbar();return;}
 const win=frame.contentWindow;floatBar.hidden=false;
 // Toolbar width can be larger than the text block. Keep it within iframe viewport.
 const w=floatBar.getBoundingClientRect().width||550,h=floatBar.getBoundingClientRect().height||56;
 floatBar.style.left=Math.round(Math.min(Math.max(8,rect.left+rect.width/2-w/2),Math.max(8,win.innerWidth-w-8)))+'px';
 floatBar.style.top=Math.round(Math.max(8,rect.top-h-13))+'px';
}
function setupFloatingToolbar(d){
 floatBar=d.createElement('div');floatBar.className='fresuni-float-toolbar';floatBar.hidden=true;floatBar.dataset.editorInternal='';floatBar.setAttribute('role','toolbar');floatBar.setAttribute('aria-label','Barra de formatação flutuante');
 floatBar.innerHTML='<select aria-label="Estilo do texto" data-float="style"><option value="custom">Texto normal</option><option value="heading-xl">Título grande</option><option value="heading-md">Título médio</option><option value="heading-sm">Título pequeno</option><option value="body-xl">Texto grande</option><option value="body-md">Texto médio</option><option value="body-sm">Texto pequeno</option></select><select aria-label="Fonte" data-float="family"><option>Prompt</option><option>Merriweather</option></select><select aria-label="Peso" data-float="weight"></select><input type="number" min="10" max="180" value="16" data-float="size" aria-label="Tamanho em pixels"><button type="button" data-float-format="bold" title="Negrito"><b>B</b></button><button type="button" data-float-format="italic" title="Itálico"><i>I</i></button><button type="button" data-float-format="underline" title="Sublinhado"><u>U</u></button><input type="color" data-float="color" value="#214ECF" aria-label="Cor do texto"><input type="color" data-float="mark" value="#fff59d" aria-label="Marca-texto"><button type="button" data-float-format="insertOrderedList" title="Lista numerada">1.</button><button type="button" data-float-format="insertUnorderedList" title="Lista com marcadores">☷</button><button type="button" data-float-action="link" title="Inserir link">🔗</button><button type="button" data-float-action="clone" title="Duplicar bloco">▣</button><button type="button" data-float-action="delete" title="Excluir bloco">⌫</button>';
 d.body.append(floatBar);
 const fw=floatBar.querySelector('[data-float="weight"]');const fillWeights=()=>{const f=floatBar.querySelector('[data-float="family"]').value;fw.replaceChildren();for(const w of FONT_WEIGHTS[f]){const opt=d.createElement('option');opt.value=w;opt.textContent=weightLabels[w]+' · '+w;fw.append(opt);}};
 fillWeights();
 // Prevent toolbar from disrupting a live highlighted selection, including pointer interaction.
 floatBar.addEventListener('pointerdown',e=>{e.stopPropagation();if(e.target.closest('button'))e.preventDefault();});
 floatBar.addEventListener('click',e=>{e.stopPropagation();const b=e.target.closest('button');if(!b)return;
  if(b.dataset.floatFormat)execFormat(b.dataset.floatFormat);
  else if(b.dataset.floatAction==='link')openLinkDialog();
  else if(b.dataset.floatAction==='clone')$('#duplicate-block').click();
  else if(b.dataset.floatAction==='delete')$('#selected-remove').click();
 });
 floatBar.addEventListener('change',e=>{e.stopPropagation();const key=e.target.dataset.float;if(!key)return;
  if(key==='family'){fillWeights();$('#font-family').value=e.target.value;applyInlineStyle('font-family',e.target.value+(e.target.value==='Merriweather'?',Georgia,serif':',Arial,sans-serif'));}
  else if(key==='weight'){setWeightOptions($('#font-family').value,e.target.value);applyInlineStyle('font-weight',e.target.value);}
  else if(key==='size'){$('#font-size').value=e.target.value;applyInlineStyle('font-size',Math.max(10,Math.min(180,+e.target.value||16))+'px');}
  else if(key==='color')applyInlineStyle('color',e.target.value);
  else if(key==='mark')applyInlineStyle('background-color',e.target.value);
  else if(key==='style'){$('#text-preset').value=e.target.value;$('#text-preset').dispatchEvent(new Event('change'));}
 });
 const refresh=()=>{if(floatBar.hidden||!state.selected?.isConnected)return;const cs=frame.contentWindow.getComputedStyle(state.selected);const ff=cs.fontFamily.toLowerCase().includes('merriweather')?'Merriweather':'Prompt';floatBar.querySelector('[data-float="family"]').value=ff;fillWeights();fw.value=String(Math.round(parseInt(cs.fontWeight)||400));floatBar.querySelector('[data-float="size"]').value=parseInt(cs.fontSize)||16;};
 d.addEventListener('click',()=>{requestAnimationFrame(()=>{positionFloatingToolbar();refresh();});});
 frame.contentWindow.addEventListener('scroll',positionFloatingToolbar,{passive:true});
}
const presets={'heading-xl':{tag:'H1',size:44,font:'Merriweather'},'heading-md':{tag:'H2',size:30,font:'Merriweather'},'heading-sm':{tag:'H3',size:23,font:'Merriweather'},'body-xl':{tag:'P',size:22,font:'Prompt'},'body-md':{tag:'P',size:16,font:'Prompt'},'body-sm':{tag:'P',size:14,font:'Prompt'}};
$('#text-preset').addEventListener('change',e=>{const el=state.selected;if(!el||!presets[e.target.value])return;const spec=presets[e.target.value];if(activeTextRange()){applyInlineStyle('font-size',spec.size+'px');applyInlineStyle('font-family',spec.font+(spec.font==='Merriweather'?',serif':',sans-serif'));return;}snapshot();let target=el;
 if(el.matches('h1,h2,h3,h4,h5,h6,p')&&el.tagName!==spec.tag){const repl=siteDoc().createElement(spec.tag.toLowerCase());for(const a of [...el.attributes])repl.setAttribute(a.name,a.value);repl.innerHTML=el.innerHTML;el.replaceWith(repl);target=repl;state.selected=repl;}
 target.style.fontSize=spec.size+'px';target.style.fontFamily=spec.font+(spec.font==='Merriweather'?',serif':',sans-serif');$('#font-size').value=spec.size;$('#font-family').value=spec.font;dirty();state.selected=null;selectElement(target);
});
$('#background-color').addEventListener('change',e=>{if(!state.selected)return;snapshot();state.selected.style.backgroundColor=e.target.value;});

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
function bindDrag(d){
 d.addEventListener('dragstart',e=>{
  if(!e.altKey||!state.editable)return;
  const el=fsWholeGridItem(e.target)||e.target.closest('[data-fresuni-block]');
  if(!el||!el.closest('.site-page'))return;
  dragged=el;e.dataTransfer.effectAllowed='move';
 });
 d.addEventListener('dragover',e=>{
  const target=fsWholeGridItem(e.target)||e.target.closest('[data-fresuni-block]');
  if(dragged&&target&&dragged.parentElement===target.parentElement&&!dragged.contains(target))e.preventDefault();
 });
 d.addEventListener('drop',e=>{
  const target=fsWholeGridItem(e.target)||e.target.closest('[data-fresuni-block]');
  if(!dragged||!target||target===dragged||dragged.contains(target)||dragged.parentElement!==target.parentElement)return;
  e.preventDefault();snapshot();
  const r=target.getBoundingClientRect();
  const grid=fsGridParent(target);
  const dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);
  const before=grid&&Math.abs(dy)<r.height*.42?dx<0:dy<0;
  target.parentElement.insertBefore(dragged,before?target:target.nextSibling);
  const moved=dragged;dragged=null;
  state.selected=null;selectElement(moved);dirty();
 });
 d.addEventListener('dragend',()=>{dragged=null;});
}
function blockElement(){const el=state.selected;if(!el)return;return el.closest('[data-fresuni-block]')||el;}
function isCoreShared(el){return !!el?.closest('.header-actions,.main-nav,.brand,.footer-logo')||el?.matches('.site-header,.site-footer,.header-inner,.footer-inner,.main-nav,.header-actions');}
function blockMove(direction){const el=blockElement();if(!el||isCoreShared(el))return;
 const grid=el.parentElement?.classList.contains('directory-links');
 if((direction==='left'||direction==='right')&&!grid){notify('Use ← → nos links ou textos dos guias rápidos. Nas demais áreas, use Subir/Descer.');return;}
 const step=(direction==='up'||direction==='left')?'previous':'next';
 const sibling=step==='previous'?el.previousElementSibling:el.nextElementSibling;
 if(!sibling||sibling.hasAttribute('data-editor-internal')){notify('Este elemento já está na extremidade da seção.');return;}
 snapshot();el.parentNode.insertBefore(el,step==='previous'?sibling:sibling.nextSibling);dirty();selectElement(el);positionResizeGrip();}
for(const [id,dir] of [['move-block-up','up'],['move-block-down','down'],['move-selection-up','up'],['move-selection-down','down'],['move-block-left','left'],['move-block-right','right'],['move-selection-left','left'],['move-selection-right','right']])$('#'+id).addEventListener('click',()=>blockMove(dir));
function duplicateElement(){const el=blockElement();if(!el||isCoreShared(el)){notify('Para duplicar um link do menu, use a aba Cabeçalho e rodapé.');return;}snapshot();
 const n=el.cloneNode(true);n.removeAttribute('data-fresuni-selected');n.removeAttribute('contenteditable');n.removeAttribute('data-fresuni-drag');n.removeAttribute('draggable');
 el.after(n);setEditable(true);selectElement(n);dirty();notify('Elemento duplicado com texto, formatação e links. Salve o rascunho ou publique quando desejar.');}
$('#duplicate-block').addEventListener('click',duplicateElement);$('#duplicate-selection').addEventListener('click',duplicateElement);
$('#selected-remove').addEventListener('click',()=>{const el=blockElement();if(!el||!state.editable)return;
 if(el.closest('[data-fresuni-page-meta]')){const page=el.closest('.site-page');if(!page)return;
  if(!confirm('Remover as datas desta página? Você pode restaurá-las depois.'))return;
  snapshot();page.dataset.fresuniDates='off';el.closest('[data-fresuni-page-meta]').remove();clearSelection();fsSyncPageDates();dirty();notify('Datas removidas nesta página.');return;
 }if(isCoreShared(el)){notify('Use a aba Cabeçalho e rodapé para administrar este componente sem quebrar a navegação.');return;}if(!confirm('Remover este elemento da página?'))return;snapshot();el.remove();clearSelection();});
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
function updatePageSidebar(){const p=selectedPage();if(!p)return;const isStory=/^\/(noticias|artigos)\/.+/.test(p.dataset.route)&&!p.hasAttribute('data-fresuni-news-archive');$('#featured-article-controls').hidden=!isStory;if(isStory){const a=pageFor('/')?.querySelector('.directory-row[aria-labelledby="'+(p.dataset.route.startsWith('/noticias/')?'noticias-label':'artigos-label')+'"] .directory-links a[href="#'+p.dataset.route+'"]');$('#feature-on-home').disabled=!!a;$('#unfeature-on-home').disabled=!a;} $('#page-title').value=titleOf(p);$('#page-group').value=groupFor(p);$('#page-show').checked=p.dataset.editorNav!=='false';fsSyncPageHierarchyControls(p);}

/* Edição de hierarquia, independente do endereço e do conteúdo da página. */
function fsNavMode(p){return p?.dataset.fresuniNavMode||'auto';}
function fsSyncPageHierarchyControls(p){
 const select=$('#page-parent'),mode=$('#page-nav-mode'),root=p.dataset.route==='/';
 const previous=select.value;select.replaceChildren();
 for(const candidate of pageNodes()){
  if(candidate===p||candidate.hasAttribute('data-fresuni-news-archive'))continue;
  let ancestor=candidate,cycle=false;
  for(let i=0;ancestor&&i<pageNodes().length;i++){
   if(ancestor===p){cycle=true;break;}
   const parent=parentRouteOf(ancestor);ancestor=parent?pageFor(parent):null;
  }
  if(!cycle)select.add(new Option(candidate.dataset.route==='/'?'Início (sem página-mãe)':labelPath(candidate),candidate.dataset.route));
 }
 select.value=parentRouteOf(p)||'/';if(!select.value)select.value='/';
 select.disabled=root;mode.value=fsNavMode(p);mode.disabled=root;
 $('#page-parent-hint').textContent=root?'A página inicial não pode ser movida.':'Mudar a página-mãe não altera o endereço antigo, os textos ou as imagens.';
}
function fsUpdateBreadcrumbHierarchy(page){
 const crumbs=page.querySelector('.breadcrumbs');if(!crumbs)return;
 const d=siteDoc(),ancestors=[],seen=new Set([page.dataset.route]);let current=parentRouteOf(page);
 while(current&&current!=='/'&&!seen.has(current)&&ancestors.length<15){
  const p=pageFor(current);if(!p)break;seen.add(current);ancestors.unshift(p);current=parentRouteOf(p);
 }
 const link=(route,title)=>{const a=d.createElement('a');a.href='#'+route;a.textContent=title;return a;};
 const sep=()=>{const x=d.createElement('span');x.className='breadcrumb-sep';x.setAttribute('aria-hidden','true');x.textContent=' / ';return x;};
 const currentName=d.createElement('span');currentName.setAttribute('aria-current','page');currentName.textContent=titleOf(page);
 crumbs.replaceChildren(link('/','Início'));
 for(const a of ancestors)crumbs.append(sep(),link(a.dataset.route,titleOf(a)));
 crumbs.append(sep(),currentName);
}
function fsUpdateFamilyBreadcrumbs(changedRoute){
 for(const p of pageNodes()){
  if(p.dataset.route===changedRoute){fsUpdateBreadcrumbHierarchy(p);continue;}
  let walk=parentRouteOf(p),seen=new Set([p.dataset.route]);
  while(walk&&!seen.has(walk)){
   if(walk===changedRoute){fsUpdateBreadcrumbHierarchy(p);break;}
   seen.add(walk);walk=parentRouteOf(pageFor(walk));
  }
 }
}
$('#page-parent').addEventListener('change',e=>{
 const p=selectedPage(),newParent=e.target.value;if(!p||p.dataset.route==='/'||!pageFor(newParent))return;
 if(newParent===p.dataset.route)return;
 snapshot();p.dataset.editorParent=newParent;
 p.dataset.fresuniNavMode=newParent==='/'?'root':'child';p.dataset.editorNav='true';
 if(newParent==='/')p.dataset.editorGroup='principal';
 removeChildLink(p.dataset.route);
 fsUpdateFamilyBreadcrumbs(p.dataset.route);
 expandedPages.add(newParent);renderNav();const html=serialize();reloadFrame(html,state.route);dirty();
 notify(newParent==='/'?'Página independente adicionada ao menu principal.':'Página movida para a hierarquia de '+titleOf(pageFor(newParent))+'.');
});
$('#page-nav-mode').addEventListener('change',e=>{
 const p=selectedPage(),mode=e.target.value;if(!p||p.dataset.route==='/')return;
 if(mode==='child'&&parentRouteOf(p)==='/'){notify('Escolha primeiro uma página-mãe diferente de Início.');e.target.value=fsNavMode(p);return;}
 snapshot();p.dataset.fresuniNavMode=mode;p.dataset.editorNav=String(mode!=='hidden');
 if(mode==='root'){p.dataset.editorParent='/';p.dataset.editorGroup='principal';fsUpdateFamilyBreadcrumbs(p.dataset.route);}
 renderNav();reloadFrame(serialize(),state.route);dirty();
 notify('Posição da página na navegação alterada. Publique quando estiver tudo certo.');
});


// Atalhos de Ações: a navegação é independente da hierarquia dos 43 conteúdos.
// Edições nas páginas não modificam os atalhos; ações conscientes em
// Cabeçalho e rodapé podem alterar o submenu sem exigir alterações no código.
let fsActionsMenuExplicitEdit=false;
function fsRestoreActionsMenuPreview(){
 if(fsActionsMenuExplicitEdit||!state.html)return;
 const current=siteDoc()?.getElementById('sub-acoes');
 const canonical=new DOMParser().parseFromString(state.html,'text/html')
  .querySelector('#sub-acoes[data-fresuni-menu-policy]');
 if(!current||!canonical)return;
 if(current.outerHTML!==canonical.outerHTML)current.replaceWith(siteDoc().importNode(canonical,true));
}

function renderNav(){const d=siteDoc(),nav=$('#menu-principal',d);if(!nav)return;
 // Only edit known menus, preserving the original markup and drop-down behaviour.
 const index=new Map(pageNodes().map((p,i)=>[p.dataset.route,i]));
 for(const group of ['inicio','manifesto','acoes']){
  const el=$('#sub-'+group,nav);if(!el)continue;
  if(group==='acoes'&&el.hasAttribute('data-fresuni-menu-policy'))continue; // Evita inserir todos os projetos automaticamente.
  $$('a',el).forEach(a=>{if(a.hasAttribute('data-fresuni-manual-link'))return;const href=a.getAttribute('href')||'';if(!href.startsWith('#/'))return;const route=href.slice(1);if(route&&!pageFor(route))a.remove();else if(route&&pageFor(route)&&groupFor(pageFor(route))!==group){
    const fixed=group==='inicio'&&['/','/noticias','/artigos','/acessibilidade'].includes(route)||group==='manifesto'&&route==='/manifesto'||group==='acoes'&&route==='/acoes';
    if(!fixed)a.remove();
   }});
  for(const p of pageNodes()){
   if(fsNavMode(p)!=='auto'||groupFor(p)!==group||p.dataset.editorNav==='false'||p.dataset.route==='/'||['noticias','artigos'].includes(groupFor(p)))continue;
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
  const route=p.dataset.route;if(fsNavMode(p)!=='auto'||groupFor(p)!=='principal'||p.dataset.editorNav==='false'||['/filiacao','/estatuto'].includes(route))continue;
  const a=d.createElement('a');a.className='nav-root solo';a.href='#'+route;a.textContent=titleOf(p);a.dataset.fresuniNavCustom='';nav.insertBefore(a,before||null);
 }
 // Nonroot disabled items in existing root navigation should not remain visible.
 for(const p of pageNodes()){
  if(p.dataset.editorNav==='false')$('a[href="#'+CSS.escape(p.dataset.route)+'"]',nav).filter(a=>a.dataset.fresuniNavCustom===undefined&&a.classList.contains('nav-root')===false).forEach(a=>a.remove());
 }
 fsApplyPageNavigation();
 fsRestoreActionsMenuPreview();
}
$('#page-title').addEventListener('change',e=>{const p=selectedPage();const name=e.target.value.trim();if(!p||!name)return;snapshot();p.dataset.title=name;const heading=$('h1:not(.sr-only)',p);if(heading)heading.textContent=name;$$('.breadcrumbs [aria-current="page"]',p).forEach(x=>x.textContent=name);
 $$('a[href="#'+p.dataset.route+'"]',siteDoc()).forEach(a=>{if(a.closest('.site-header'))a.textContent=name;});
 syncStoryReferences(p.dataset.route,name);$('#current-page-title').textContent=name;renderPages();renderNav();dirty();});
$('#page-group').addEventListener('change',e=>{const p=selectedPage();if(!p)return;snapshot();p.dataset.editorGroup=e.target.value;if(e.target.value==='oculto'){p.dataset.fresuniNavMode='hidden';p.dataset.editorNav='false';}if(!autoRegisterStory(p))removeCollectionCard(p.dataset.route);renderNav();reloadFrame(serialize(),state.route);dirty();});
$('#page-show').addEventListener('change',e=>{const p=selectedPage();if(!p)return;snapshot();p.dataset.editorNav=String(e.target.checked);p.dataset.fresuniNavMode=e.target.checked?(parentRouteOf(p)==='/'?'root':'child'):'hidden';renderNav();reloadFrame(serialize(),state.route);dirty();});

// Os vínculos explícitos prevalecem sobre os grupos antigos, sem duplicar links.
function fsApplyPageNavigation(){
 const nav=sharedEl('header')?.querySelector('.main-nav');if(!nav)return;
 for(const wrapper of [...nav.querySelectorAll('[data-fresuni-editor-converted]')]){
  const anchor=wrapper.querySelector(':scope > a.nav-root');
  if(anchor){anchor.classList.add('solo');wrapper.replaceWith(anchor);}else wrapper.remove();
 }
 nav.querySelectorAll('[data-fresuni-editor-generated]').forEach(el=>el.remove());
 const pages=pageNodes(),custom=pages.filter(p=>fsNavMode(p)!=='auto'&&p.dataset.route!=='/');
 // Remove a navegação antiga APENAS da página que recebeu uma nova escolha.
 for(const p of custom){
  for(const anchor of [...nav.querySelectorAll('a[href]')].filter(a=>a.getAttribute('href')==='#'+p.dataset.route)){
   if(anchor.classList.contains('nav-root')&&anchor.parentElement?.classList.contains('nav-group')){
    // Não apaga os conteúdos das páginas; somente o antigo grupo do menu.
    anchor.parentElement.remove();
   }else anchor.remove();
  }
 }
 const rootAnchor=route=>[...nav.children].map(child=>child.matches('a.nav-root')?child:child.matches('.nav-group')?child.querySelector(':scope > a.nav-root'):null).find(a=>a?.getAttribute('href')==='#'+route);
 function addRoot(p){
  if(rootAnchor(p.dataset.route))return;
  const a=siteDoc().createElement('a');a.className='nav-root solo';a.href='#'+p.dataset.route;
  a.textContent=titleOf(p);a.dataset.fresuniEditorGenerated='';
  const statute=rootAnchor('/estatuto');const insertAt=statute?.closest('.nav-group')||statute;
  if(insertAt)nav.insertBefore(a,insertAt);else nav.append(a);
 }
 for(const p of custom.filter(p=>fsNavMode(p)==='root'))addRoot(p);
 // Filiação e qualquer outra página independente podem ganhar um submenu.
 for(const p of custom.filter(p=>fsNavMode(p)==='child'&&p.dataset.editorNav!=='false')){
  const parent=parentRouteOf(p);if(!parent||parent==='/')continue;
  let ancestor=parent,chosen=null,seen=new Set([p.dataset.route]),subpath=[];
  for(let i=0;ancestor&&!seen.has(ancestor)&&i<pages.length;i++){
   seen.add(ancestor);const pa=pageFor(ancestor);if(!pa)break;
   subpath.unshift(titleOf(pa));const a=rootAnchor(ancestor);
   if(a){chosen=a;break;}
   ancestor=parentRouteOf(pa);
  }
  if(!chosen)chosen=rootAnchor('/');
  if(!chosen)continue;
  let group=chosen.closest('.nav-group');
  if(!group){
   group=siteDoc().createElement('div');group.className='nav-group';group.dataset.fresuniEditorConverted='';
   chosen.replaceWith(group);chosen.classList.remove('solo');group.append(chosen);
   const id='sub-editor-'+chosen.getAttribute('href').slice(1).replace(/[^a-z0-9]/gi,'-');
   const b=siteDoc().createElement('button');b.className='nav-drop';b.type='button';b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls',id);
   b.setAttribute('aria-label','Abrir submenu '+chosen.textContent.trim());
   const arrow=siteDoc().createElement('span');arrow.className='chevron';arrow.setAttribute('aria-hidden','true');b.append(arrow);
   const sub=siteDoc().createElement('div');sub.className='subnav';sub.id=id;
   group.append(b,sub);
  }
  const sub=group.querySelector(':scope > .subnav');if(!sub)continue;
  if([...sub.querySelectorAll('a')].some(a=>a.getAttribute('href')==='#'+p.dataset.route))continue;
  const a=siteDoc().createElement('a');a.href='#'+p.dataset.route;a.textContent=
   (subpath.length>1?subpath.slice(0,-1).join(' › ')+' › ':'')+titleOf(p);
  a.dataset.fresuniEditorGenerated='';sub.append(a);
 }
}

function syncStoryReferences(route,title){
 const d=siteDoc();if(!d||!route||!title)return;
 $$('a[href="#'+CSS.escape(route)+'"]',d).forEach(a=>{
  if(a.classList.contains('content-card')){const heading=a.querySelector('h3');if(heading)heading.textContent=title;}
  else if(a.matches('.directory-links > a,[data-fresuni-children] a'))a.textContent=title;
 });
}
function autoRegisterStory(p){
 const group=groupFor(p),route=p.dataset.route;
 if(!['noticias','artigos'].includes(group)||route==='/'+group||p.hasAttribute('data-fresuni-news-archive')||/^\/noticias\/\d{4}$/.test(route))return false;
 if(group==='noticias'&&!p.dataset.publishedMonth)p.dataset.publishedMonth=fsNewsCurrentMonth();
 const parent=pageFor('/'+group),grid=parent?.querySelector('.card-grid');if(!grid)return false;
 if(!grid.querySelector('a.content-card[href="#'+CSS.escape(route)+'"]'))addCollectionCard(group,route,titleOf(p));
 return true;
}
function addCollectionCard(group,route,title){const parent=pageFor('/'+group);const grid=parent?.querySelector('.card-grid');if(!grid)return;const d=siteDoc();const card=d.createElement('a');card.className='content-card';card.setAttribute('data-reveal','');card.href='#'+route;card.innerHTML='<span class="card-eyebrow"></span><h3></h3><p>Apresentação da nova página. Você pode editar este texto.</p><span class="card-action">Leia mais ↗</span>';card.querySelector('.card-eyebrow').textContent=group==='noticias'?'Notícia':group==='artigos'?'Artigo':'Ação';card.querySelector('h3').textContent=title;grid.append(card);}
function removeCollectionCard(route){const d=siteDoc();$$('a.content-card',d).filter(a=>a.getAttribute('href')==='#'+route).forEach(a=>a.remove());}
function openNewPage(parentHint){
 $('#new-page-form').reset();const select=$('#new-page-parent');select.replaceChildren();for(const p of pageNodes()){
  const opt=document.createElement('option');opt.value=p.dataset.route;opt.textContent=labelPath(p);select.append(opt);
 }
 const chosen=parentHint||state.route||'/';select.value=pageFor(chosen)?chosen:'/';
 const group=groupFor(pageFor(select.value)||pageFor('/'));$('#new-page-group').value=group==='oculto'?'inicio':group;
 $('#new-page-slug').value='';$('#new-page-main-menu').checked=select.value==='/'&&['principal','inicio'].includes($('#new-page-group').value);$('#new-page-dialog').showModal();$('#new-page-title').focus();
}
$('#new-page-parent').addEventListener('change',e=>{const p=pageFor(e.target.value);if(p){const g=groupFor(p);$('#new-page-group').value=g==='oculto'?'inicio':g;$('#new-page-main-menu').checked=e.target.value==='/';}});
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
 if(group&&parent?.querySelector('.card-grid'))addCollectionCard(group,route,title);
 // Outras subpáginas ficam no menu do cabeçalho. Não criar Páginas relacionadas.
}
function removeChildLink(route){removeCollectionCard(route);const d=siteDoc();$$('[data-fresuni-children] li',d).filter(li=>li.querySelector('a')?.getAttribute('href')==='#'+route).forEach(li=>li.remove());}
$('#new-page-form').addEventListener('submit',e=>{
 e.preventDefault();const name=$('#new-page-title').value.trim();if(!name)return;
 const nameSlug=slug($('#new-page-slug').value||name),group=$('#new-page-group').value;
 const parentRoute=$('#new-page-parent').value||'/';if(!pageFor(parentRoute)){notify('Selecione uma página-mãe válida.');return;}
 let route=(parentRoute==='/'?'':parentRoute)+'/'+nameSlug;
 if(parentRoute==='/'&&['acoes','manifesto','noticias','artigos'].includes(group))route='/'+group+'/'+nameSlug;
 if(pageFor(route)){notify('Já existe uma página com este endereço. Escolha outro.');return;}
 snapshot();const d=siteDoc();const main=$('main#conteudo',d);const div=d.createElement('div');div.className='site-page';div.dataset.route=route;div.dataset.title=name;div.dataset.editorGroup=group;div.dataset.editorParent=$('#new-page-main-menu').checked?'/':parentRoute;div.dataset.editorNav=String(group!=='oculto');div.dataset.fresuniNavMode=group==='oculto'?'hidden':$('#new-page-main-menu').checked?'root':parentRoute!=='/'?'child':'auto';if(group==='noticias'&&route.startsWith('/noticias/'))div.dataset.publishedMonth=fsNewsCurrentMonth();div.hidden=true;
 const ancestors=[];let walk=parentRoute;for(let i=0;walk&&walk!=='/'&&i<12;i++){const p=pageFor(walk);if(!p)break;ancestors.unshift({route:walk,title:titleOf(p)});walk=parentRouteOf(p);}
 const crumbs='<a href="#/">Início</a>'+ancestors.map(x=>'<span class="breadcrumb-sep" aria-hidden="true"> / </span><a href="#'+escapeHTML(x.route)+'">'+escapeHTML(x.title)+'</a>').join('');
 div.innerHTML=`<div class="container page-shell"><nav class="breadcrumbs" aria-label="Caminho de navegação">${crumbs}<span class="breadcrumb-sep" aria-hidden="true"> / </span><span aria-current="page">${escapeHTML(name)}</span></nav><div class="page-heading"><span class="eyebrow">FRESUNI Social</span><h1>${escapeHTML(name)}</h1><p class="page-lead">Escreva aqui uma apresentação da página.</p></div><article class="prose page-article"><p>Clique neste texto para começar a escrever.</p></article></div>`;
 main.append(div);if(!autoRegisterStory(div))attachChildLink(parentRoute,route,name);
 if($('#new-page-main-menu').checked)fsAddPageMainMenu(route,name);
 expandedPages.add(parentRoute);renderNav();$('#new-page-dialog').close();const result=serialize();reloadFrame(result,route);dirty();notify($('#new-page-main-menu').checked?'Página independente criada no menu principal.':'Subpágina criada dentro de '+titleOf(pageFor(parentRoute))+'.');
});
function reorderCollectionCards(group){const grid=pageFor('/'+group)?.querySelector('.card-grid');if(!grid)return;
 const map=new Map([...grid.querySelectorAll('a.content-card')].map(a=>[a.getAttribute('href')?.slice(1),a]));for(const p of pageNodes())if(groupFor(p)===group&&p.dataset.route!=='/'+group){const a=map.get(p.dataset.route);if(a)grid.append(a);}}
function movePage(direction){const p=selectedPage();if(!p||p.dataset.route==='/')return;const sibling=direction==='up'?p.previousElementSibling:p.nextElementSibling;if(!sibling||groupFor(sibling)!==groupFor(p))return;snapshot();if(direction==='up')p.parentNode.insertBefore(p,sibling);else p.parentNode.insertBefore(sibling,p);reorderCollectionCards(groupFor(p));renderPages();renderNav();dirty();}
$('#page-up').addEventListener('click',()=>movePage('up'));$('#page-down').addEventListener('click',()=>movePage('down'));
$('#duplicate-page').addEventListener('click',()=>{const p=selectedPage();if(!p)return;const name=prompt('Nome da cópia:',titleOf(p)+' (cópia)');if(!name)return;
 const parent=parentRouteOf(p)||'/';let route=(parent==='/'?'':parent)+'/'+slug(name);if(pageFor(route)){notify('Já existe uma página com esse endereço.');return;}
 snapshot();const n=p.cloneNode(true);n.querySelectorAll('[data-fresuni-page-meta]').forEach(x=>x.remove());n.dataset.route=route;n.dataset.title=name;n.dataset.editorGroup=groupFor(p);n.dataset.editorParent=parent;n.dataset.editorNav='true';if(groupFor(n)==='noticias')n.dataset.publishedMonth=fsNewsCurrentMonth();const h=$('h1:not(.sr-only)',n);if(h)h.textContent=name;$$('[id]',n).forEach(x=>x.removeAttribute('id'));
 p.after(n);if(!autoRegisterStory(n))attachChildLink(parent,route,name);renderNav();reloadFrame(serialize(),route);dirty();notify('Página duplicada.');});
$('#delete-page').addEventListener('click',()=>{const p=selectedPage();if(!p||p.dataset.route==='/'){notify('A página inicial não pode ser excluída.');return;}
 if(!confirm('Excluir permanentemente a página “'+titleOf(p)+'” do site? Os links que apontarem para ela precisarão ser revisados.'))return;
 if(pageNodes().some(x=>parentRouteOf(x)===p.dataset.route)){notify('Esta página possui subpáginas. Exclua ou mova as subpáginas antes de excluí-la.');return;}
 snapshot();removeChildLink(p.dataset.route);p.remove();renderNav();reloadFrame(serialize(),'/');dirty();notify('Página removida do rascunho.');});
// -------- Guias rápidos: inclusões e reordenação dentro da grade original --------
const homeQuickSections={conheca:'CONHEÇA',noticias:'NOTÍCIAS',artigos:'ARTIGOS',palestras:'AÇÕES NAS COMUNIDADES ESCOLARES'}; // chave interna histórica mantida para preservar itens do Editor
function homeQuickRow(key){const p=pageFor('/');return p?.querySelector('.directory-row[aria-labelledby="'+key+'-label"]')||null;}
function updateHomeQuickTargets(){const input=$('#home-quick-target');if(!input)return;const previous=input.value;input.replaceChildren();
 for(const [value,label] of [['__plain','Somente texto, sem link'],['__external','Outro endereço (URL)']]){const op=document.createElement('option');op.value=value;op.textContent=label;input.append(op);}
 for(const page of pageNodes()){const op=document.createElement('option');op.value='#'+page.dataset.route;op.textContent='Página: '+labelPath(page);input.append(op);}
 input.value=Array.from(input.options).some(o=>o.value===previous)?previous:'__plain';
 $('#home-quick-external-wrap').hidden=input.value!=='__external';
}
$('#home-quick-target').addEventListener('change',e=>{$('#home-quick-external-wrap').hidden=e.target.value!=='__external';});
function addHomeQuick(key,title,target,external=''){
 const row=homeQuickRow(key),holder=row?.querySelector('.directory-links');if(!holder){notify('Não foi encontrada a seção '+key+'.');return;}
 title=String(title||'').trim();if(!title){notify('Escreva o texto que deseja adicionar.');return;}
 const href=target==='__plain'?'':target==='__external'?String(external||'').trim():target;
 if(href&&!safeUrl(href)){notify('O link é inválido. Utilize uma página interna ou endereço HTTPS.');return;}
 snapshot();const d=siteDoc();const item=d.createElement(href?'a':'p');item.textContent=title;
 if(href){item.href=href;if(/^https?:/i.test(href)){item.target='_blank';item.rel='noopener noreferrer';}}
 item.dataset.fresuniBlock='quick-item';item.style.minWidth='0';item.style.maxWidth='100%';item.style.overflowWrap='anywhere';item.style.margin='0';
 holder.insertBefore(item,holder.querySelector('.fresuni-quick-add[data-editor-internal]'));
 selectRoute('/');selectElement(item);setEditable(true);item.scrollIntoView({block:'center',behavior:'smooth'});dirty();notify('Elemento adicionado ao guia '+homeQuickSections[key]+'. Os demais itens se reorganizaram automaticamente.');
}
function refreshHomeQuickButtons(){const d=siteDoc();if(!d)return;
 d.querySelectorAll('.fresuni-quick-add[data-editor-internal]').forEach(b=>b.remove());
 if(!state.editable)return;
 for(const key of Object.keys(homeQuickSections)){
  const row=homeQuickRow(key),holder=row?.querySelector('.directory-links');if(!holder)continue;
  const button=d.createElement('button');button.type='button';button.textContent='+ Adicionar';button.className='fresuni-quick-add';button.dataset.editorInternal='';button.setAttribute('aria-label','Adicionar link ou texto à seção '+homeQuickSections[key]);
  button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();$('#home-quick-section').value=key;$$('[data-tab]').find(b=>b.dataset.tab==='insert')?.click();$('#home-quick-tools').scrollIntoView({block:'nearest'});$('#home-quick-label').focus();});
  holder.append(button);
 }
}
$('#home-quick-add').addEventListener('click',()=>{
 const key=$('#home-quick-section').value;
 addHomeQuick(key,$('#home-quick-label').value,$('#home-quick-target').value,$('#home-quick-external').value);
 $('#home-quick-label').value='';
});
// Matérias e artigos podem ser destacados na página inicial sem duplicar o conteúdo.
function toggleFeaturedStory(add){const p=selectedPage(),route=p?.dataset.route||'';const match=p?.hasAttribute('data-fresuni-news-archive')?null:route.match(/^\/(noticias|artigos)\/.+/);if(!match){notify('Abra uma notícia ou artigo antes de destacar.');return;}
 const home=pageFor('/'),row=home?.querySelector('#'+match[1]+'-label')?.closest('.directory-row');const holder=row?.querySelector('.directory-links');if(!holder){notify('A seção correspondente não foi encontrada na página inicial.');return;}
 const existing=Array.from(holder.querySelectorAll('a[href]')).find(a=>a.getAttribute('href')==='#'+route);
 if(add&&existing){notify('Esta matéria já está destacada no início.');return;}
 if(!add&&!existing){notify('Esta matéria ainda não aparece no início.');return;}
 snapshot();if(add){const a=siteDoc().createElement('a');a.href='#'+route;a.textContent=titleOf(p);a.dataset.fresuniFeatured='';holder.insertBefore(a,holder.firstChild);}else existing.remove();
 dirty();updatePageSidebar();notify(add?'Matéria destacada no início, aguardando publicação.':'Destaque removido do rascunho.');
}
$('#feature-on-home').addEventListener('click',()=>toggleFeaturedStory(true));
$('#unfeature-on-home').addEventListener('click',()=>toggleFeaturedStory(false));
// -------- Áreas compartilhadas: cabeçalho e rodapé --------
function sharedEl(type){return siteDoc()?.querySelector(type==='header'?'.site-header':'.site-footer');}
function sharedLink(link,target){
 if(!safeUrl(target)){notify('Informe um destino válido, como #/noticias ou https://exemplo.com.');return false;}
 link.setAttribute('href',target);
 if(target.startsWith('http')){link.target='_blank';link.rel='noopener noreferrer';}
 else{link.removeAttribute('target');link.removeAttribute('rel');}
 return true;
}
function structureInput(id,value){const el=$('#'+id);if(el && document.activeElement!==el)el.value=value;}

 // Gerenciamento facilitado de páginas existentes no menu, sem excluir as páginas.
 function fsMainMenuLink(route){
  const nav=sharedEl('header')?.querySelector('.main-nav');
  return [...(nav?.children||[])].map(el=>el.matches('a.nav-root')?el:el.matches('.nav-group')?el.querySelector(':scope > a.nav-root'):null).find(a=>a?.getAttribute('href')==='#'+route)||null;
 }
 function fsSyncMainMenuControls(){
  const route=$('#fs-main-menu-page').value,listed=route&&!!fsMainMenuLink(route);
  $('#fs-main-menu-add').disabled=!route||listed;
  $('#fs-main-menu-remove').disabled=!route||!listed;
  $('#fs-main-menu-status').textContent=route?(listed?'A página já está no menu principal.':'Esta página ainda não está no menu principal.'):'';
 }
 function fsMainMenuOptions(){
  const select=$('#fs-main-menu-page'),current=select.value;
  select.replaceChildren(new Option('Escolher página',''));
  const pages=pageNodes().filter(p=>p.dataset.route!=='/'&&!p.hasAttribute('data-fresuni-news-archive'));
  pages.sort((a,b)=>titleOf(a).localeCompare(titleOf(b),'pt-BR'));
  for(const p of pages)select.add(new Option(titleOf(p)+' (#'+p.dataset.route+')',p.dataset.route));
  if(pages.some(p=>p.dataset.route===current))select.value=current;
  fsSyncMainMenuControls();
 }
 function fsAddPageMainMenu(route,name){
  const p=pageFor(route);if(!p||route==='/')return false;
  p.dataset.editorNav='true';p.dataset.editorParent='/';p.dataset.editorGroup='principal';p.dataset.fresuniNavMode='root';
  fsUpdateFamilyBreadcrumbs(route);renderNav();return true;
 }
 $('#fs-main-menu-page').addEventListener('change',fsSyncMainMenuControls);
 $('#fs-main-menu-add').addEventListener('click',()=>{
  const route=$('#fs-main-menu-page').value;if(!pageFor(route)||fsMainMenuLink(route))return;
  snapshot();fsAddPageMainMenu(route);dirty();renderStructurePanel();
  notify('Página adicionada ao menu principal no rascunho. Publique para disponibilizar.');
 });
 $('#fs-main-menu-remove').addEventListener('click',()=>{
  const route=$('#fs-main-menu-page').value,link=fsMainMenuLink(route);if(!link)return;
  snapshot();pageFor(route).dataset.fresuniNavMode='hidden';pageFor(route).dataset.editorNav='false';
  renderNav();dirty();renderStructurePanel();
  notify('Link retirado do menu principal. A página continua existindo.');
 });

function sharedMenuLinks(){return Array.from(siteDoc()?.querySelectorAll('.site-header .main-nav a[href]')||[]);}
function sharedFooterLinks(){return Array.from(siteDoc()?.querySelectorAll('.site-footer nav a[href]')||[]);}
function sharedRow(parent,link,type){
 const row=document.createElement('div');row.className='structure-link-row';
 const name=document.createElement('input');name.type='text';name.value=link.textContent.trim();name.setAttribute('aria-label','Texto do link');
 const url=document.createElement('input');url.type='text';url.value=link.getAttribute('href')||'';url.setAttribute('aria-label','Destino do link');
 const badges=document.createElement('small');badges.textContent=type==='footer'?'Rodapé':link.closest('.subnav')?'Submenu':'Menu principal';
 const actions=document.createElement('div');actions.className='structure-link-actions';
 for(const [symbol,title,action] of [['↑','Subir',-1],['↓','Descer',1],['✕','Excluir link',0]]){
  const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=symbol;b.title=title;b.setAttribute('aria-label',title+' '+link.textContent.trim());
  b.addEventListener('click',()=>{
   if(!link.isConnected)return;
   const wasActionsShortcut=!!link.closest('#sub-acoes');
   if(action===0){if(!confirm('Remover este link? A ação não será publicada até você clicar em Publicar.'))return;
    snapshot();if(link.matches('.nav-root')&&link.closest('.nav-group'))link.closest('.nav-group').remove();else link.remove();
   }else{
    const item=link.matches('.nav-root')&&link.closest('.nav-group')?link.closest('.nav-group'):link;
    const sibling=action<0?item.previousElementSibling:item.nextElementSibling;
    if(!sibling)return;
    snapshot();item.parentNode.insertBefore(item,action<0?sibling:sibling.nextSibling);
   }
   if(wasActionsShortcut)fsActionsMenuExplicitEdit=true;
   dirty();renderStructurePanel();
  });actions.append(b);
 }
 name.addEventListener('change',()=>{const val=name.value.trim();if(!val){name.value=link.textContent.trim();return;}snapshot();
  // Links sociais mantêm ícone acessível mesmo quando o título é editado.
  const socialIcon=type==='footer'&&link.classList.contains('fresuni-social-link')
   ?link.querySelector('svg.fresuni-social-icon')?.cloneNode(true):null;
  if(socialIcon){
   const caption=link.ownerDocument.createElement('span');caption.textContent=val;
   link.replaceChildren(socialIcon,caption);
   link.setAttribute('aria-label',val+' (abre em nova aba)');
  }else link.textContent=val;
  if(link.matches('.nav-root')&&link.closest('.nav-group')){const button=link.closest('.nav-group').querySelector('.nav-drop');if(button)button.setAttribute('aria-label','Abrir submenu '+val);}
  if(link.closest('#sub-acoes'))fsActionsMenuExplicitEdit=true;
  dirty();renderStructurePanel();
 });
 url.addEventListener('change',()=>{const val=url.value.trim();if(!safeUrl(val)){url.value=link.getAttribute('href')||'';notify('Destino inválido. Use #/caminho ou https://');return;}
  snapshot();sharedLink(link,val);if(link.closest('#sub-acoes'))fsActionsMenuExplicitEdit=true;dirty();renderStructurePanel();
 });
 row.append(badges,name,url,actions);parent.append(row);
}
function renderStructurePanel(){const header=sharedEl('header'),footer=sharedEl('footer');if(!header||!footer)return;
 const w=frame.contentWindow;if(!w)return;
 const color=(el,property,fallback)=>toHex(w.getComputedStyle(el)[property],fallback);
 const headerNav=header.querySelector('.main-nav'),footNav=footer.querySelector('nav');
 structureInput('structure-header-bg',color(header,'backgroundColor','#ffffff'));
 structureInput('structure-header-text',headerNav?.querySelector('a')?color(headerNav.querySelector('a'),'color','#111111'):'#111111');
 structureInput('structure-header-padding',Math.round(parseFloat(w.getComputedStyle(header.querySelector('.header-inner')||header).paddingTop)||0));
 structureInput('structure-header-logo-width',Math.round(header.querySelector('.brand img')?.getBoundingClientRect().width||125));
 structureInput('structure-footer-bg',color(footer,'backgroundColor','#ffffff'));
 structureInput('structure-footer-text',color(footer.querySelector('p')||footer,'color','#111111'));
 structureInput('structure-footer-padding',Math.round(parseFloat(w.getComputedStyle(footer.querySelector('.footer-inner')||footer).paddingTop)||0));
 structureInput('structure-footer-logo-width',Math.round(footer.querySelector('.footer-logo img')?.getBoundingClientRect().width||125));
 structureInput('structure-footer-message',footer.querySelector('.footer-inner > p')?.textContent.trim()||'');
 structureInput('structure-footer-legal',footer.querySelector('.footer-inner > small')?.textContent.trim()||'');
 const m=$('#structure-menu-links'),f=$('#structure-footer-links');if(!m||!f)return;m.replaceChildren();f.replaceChildren();
 sharedMenuLinks().forEach(link=>sharedRow(m,link,'header'));
 fsMainMenuOptions();
 sharedFooterLinks().forEach(link=>sharedRow(f,link,'footer'));
 fsLogoRead();
}
function selectSharedArea(type){
 const el=sharedEl(type);if(!el)return;
 // Abrir já com um elemento editável, não com o contêiner institucional bloqueado.
 const candidate=type==='footer'
  ?el.querySelector('.footer-inner > p,.footer-inner > small,.footer-inner nav a[href],.footer-logo img')
  :el.querySelector('.main-nav a.nav-root,.header-inner > .brand img,[data-fresuni-header-message]');
 setEditable(true);selectElement(candidate||el);
 (candidate||el).scrollIntoView({block:type==='header'?'start':'end',behavior:'smooth'});
 fsKeyboardFeedback('Área aberta. Clique em qualquer texto, imagem, logo ou link para mover, editar ou excluir com segurança.');
}
$('#edit-site-header').addEventListener('click',()=>selectSharedArea('header'));
$('#edit-site-footer').addEventListener('click',()=>selectSharedArea('footer'));
for(const [id,type,fn] of [
 ['structure-header-bg','header',(el,v)=>{el.style.backgroundColor=v;}],
 ['structure-footer-bg','footer',(el,v)=>{el.style.backgroundColor=v;}],
 ['structure-header-text','header',(el,v)=>{el.style.color=v;el.querySelectorAll('.main-nav a').forEach(a=>a.style.color=v);}],
 ['structure-footer-text','footer',(el,v)=>{el.style.color=v;el.querySelectorAll('.footer-inner p,.footer-inner small,.footer-inner nav a').forEach(a=>a.style.color=v);}],
 ['structure-header-padding','header',(el,v)=>{const r=el.querySelector('.header-inner')||el;r.style.paddingTop=v+'px';r.style.paddingBottom=v+'px';}],
 ['structure-footer-padding','footer',(el,v)=>{const r=el.querySelector('.footer-inner')||el;r.style.paddingTop=v+'px';r.style.paddingBottom=v+'px';}],
 ['structure-header-logo-width','header',(el,v)=>{const a=el.querySelector('.brand'),im=a?.querySelector('img');if(im){a.style.setProperty('--fresuni-logo-width',v+'px');im.style.removeProperty('width');im.style.height='auto';im.removeAttribute('height');im.removeAttribute('width');}}],
 ['structure-footer-logo-width','footer',(el,v)=>{const a=el.querySelector('.footer-logo'),im=a?.querySelector('img');if(im){a.style.setProperty('--fresuni-logo-width',v+'px');im.style.removeProperty('width');im.style.height='auto';im.removeAttribute('height');im.removeAttribute('width');}}]
])$('#'+id).addEventListener('change',e=>{const el=sharedEl(type);if(!el)return;const raw=e.target.value;
 const v=e.target.type==='number'?Math.max(0,Math.min(id.includes('logo')?500:180,Math.round(Number(raw)||0))):raw;
 snapshot();fn(el,v);dirty();renderStructurePanel();});
for(const [id,selector] of [['structure-footer-message','.footer-inner > p'],['structure-footer-legal','.footer-inner > small']])$('#'+id).addEventListener('change',e=>{
 const footer=sharedEl('footer'),target=footer?.querySelector(selector);if(!target)return;snapshot();target.textContent=e.target.value;dirty();});

/* Marcas independentes: cabeçalho, menu de navegação e rodapé. */
const FS_OFFICIAL_LOGO='https://jassinks.github.io/fresuni/admin/logo.png';
function fsLogoSlot(area){
 const footer=sharedEl('footer'),header=sharedEl('header');
 if(area==='footer')return {root:footer?.querySelector('.footer-inner'),logo:footer?.querySelector('.footer-inner > .footer-logo'),name:'rodapé'};
 if(area==='menu')return {root:header?.querySelector('.main-nav'),logo:header?.querySelector('.main-nav > .fresuni-menu-logo'),name:'menu'};
 return {root:header?.querySelector('.header-inner'),logo:header?.querySelector('.header-inner > .brand'),name:'cabeçalho'};
}
function fsEnsureLogo(area){
 const slot=fsLogoSlot(area);
 if(!slot.root)return null;
 if(slot.logo)return slot.logo;
 const d=siteDoc(),anchor=d.createElement('a'),img=d.createElement('img');
 anchor.href='#/';
 anchor.className=area==='footer'?'footer-logo':area==='menu'?'fresuni-menu-logo':'brand';
 anchor.setAttribute('aria-label','FRESUNI Social — voltar ao início');
 img.alt='FRESUNI Social';img.src=FS_OFFICIAL_LOGO;img.loading='lazy';img.decoding='async';
 anchor.append(img);
 anchor.style.setProperty('--fresuni-logo-width',area==='menu'?'95px':area==='footer'?'110px':'125px');
 if(area==='menu')slot.root.prepend(anchor);
 else slot.root.prepend(anchor);
 return anchor;
}
function fsLogoArea(){return $('#fs-brand-logo-area')?.value||'header';}
function fsLogoPositions(area){
 if(area==='footer')return [['center','Centralizada'],['left','À esquerda'],['right','À direita']];
 if(area==='menu')return [['start','Início do menu'],['end','Fim do menu']];
 return [['left','À esquerda'],['right','À direita (após os controles)']];
}
function fsLogoRead(){
 const area=fsLogoArea(),{logo,name}=fsLogoSlot(area),image=logo?.querySelector('img'),pos=$('#fs-brand-logo-position'),preview=$('#fs-brand-logo-preview');
 if(!pos||!preview)return;
 const value=logo?.dataset.fresuniLogoPosition||fsLogoPositions(area)[0][0];
 pos.replaceChildren();
 for(const [id,title] of fsLogoPositions(area)){
  const op=document.createElement('option');op.value=id;op.textContent=title;pos.append(op);
 }
 pos.value=fsLogoPositions(area).some(x=>x[0]===value)?value:pos.options[0].value;
 const width=Number.parseFloat(logo?.style.getPropertyValue('--fresuni-logo-width'))||
  Math.round(image?.getBoundingClientRect().width||({menu:95,header:125,footer:110}[area]));
 $('#fs-brand-logo-width').value=Math.min(260,Math.max(40,Math.round(width)));
 $('#fs-brand-logo-alt').value=image?.getAttribute('alt')||'FRESUNI Social';
 const bgMode=logo?.dataset.fresuniLogoBackground==='custom'?'custom':'transparent';
 $('#fs-brand-logo-background').value=bgMode;
 $('#fs-brand-logo-background-color-wrap').hidden=bgMode!=='custom';
 $('#fs-brand-logo-background-color').value=toHex(logo?.style.backgroundColor||'#ffffff','#ffffff');
 preview.hidden=!image;
 if(image)preview.src=image.getAttribute('src')||FS_OFFICIAL_LOGO;
 else preview.removeAttribute('src');
 $('#fs-brand-logo-upload').textContent=image?'Trocar imagem da marca':'Adicionar logomarca';
 $('#fs-brand-logo-remove').disabled=!image;
 $('#fs-brand-logo-status').textContent=image?'Marca do '+name+' carregada. Alterações deste local não afetam os demais.':
  'Não há logomarca no '+name+'. Você pode adicionar uma imagem ou usar a marca institucional.';
}
$('#fs-brand-logo-area')?.addEventListener('change',fsLogoRead);
$('#fs-brand-logo-background')?.addEventListener('change',e=>{
 const logo=fsLogoSlot(fsLogoArea()).logo;
 if(!state.editable||!logo){notify('Adicione uma logomarca para configurar o fundo.');fsLogoRead();return;}
 const custom=e.target.value==='custom';
 snapshot();
 logo.dataset.fresuniLogoBackground=custom?'custom':'transparent';
 logo.style.setProperty('background-color',custom?$('#fs-brand-logo-background-color').value:'transparent','important');
 logo.style.padding=custom?'9px':'0';
 logo.style.boxShadow='none';
 logo.style.border='0';
 dirty();fsLogoRead();
 notify(custom?'Fundo personalizado aplicado apenas à marca desta área.':'Fundo transparente aplicado à marca, sem caixa branca.');
});
$('#fs-brand-logo-background-color')?.addEventListener('change',e=>{
 if($('#fs-brand-logo-background').value!=='custom'||!state.editable)return;
 const logo=fsLogoSlot(fsLogoArea()).logo;if(!logo)return;
 snapshot();logo.dataset.fresuniLogoBackground='custom';
 logo.style.setProperty('background-color',e.target.value,'important');dirty();
 notify('Cor do fundo atrás da marca alterada somente nesta área.');
});
$('#fs-brand-logo-position')?.addEventListener('change',e=>{
 if(!state.editable)return;
 const area=fsLogoArea(),logo=fsLogoSlot(area).logo;
 if(!logo){notify('Adicione a marca a esta área para modificar sua posição.');return;}
 snapshot();logo.dataset.fresuniLogoPosition=e.target.value;
 if(area==='menu'){
  const menu=logo.parentElement;
  if(e.target.value==='end')menu.append(logo);else menu.prepend(logo);
 }
 dirty();fsLogoRead();notify('Posição da marca atualizada apenas nesta área.');
});
$('#fs-brand-logo-width')?.addEventListener('change',e=>{
 if(!state.editable)return;
 const area=fsLogoArea(),logo=fsLogoSlot(area).logo;
 if(!logo){notify('Adicione a marca antes de modificar a largura.');return;}
 const max=area==='menu'?125:260;
 const size=Math.max(40,Math.min(max,Math.round(Number(e.target.value)||110)));
 snapshot();logo.style.setProperty('--fresuni-logo-width',size+'px');
 const image=logo.querySelector('img');
 if(image){image.style.removeProperty('width');image.style.height='auto';image.removeAttribute('height');image.removeAttribute('width');}
 dirty();fsLogoRead();notify('Largura alterada com proporção preservada.');
});
$('#fs-brand-logo-alt')?.addEventListener('change',e=>{
 const area=fsLogoArea(),image=fsLogoSlot(area).logo?.querySelector('img');
 if(!state.editable||!image)return;
 const alt=e.target.value.trim();
 if(!alt){notify('A marca precisa de uma descrição acessível.');fsLogoRead();return;}
 snapshot();image.alt=alt;const logo=fsLogoSlot(area).logo;logo?.setAttribute('aria-label',alt+' — voltar ao início');dirty();notify('Descrição acessível da imagem atualizada.');
});
$('#fs-brand-logo-remove')?.addEventListener('click',()=>{
 const area=fsLogoArea(),logo=fsLogoSlot(area).logo;
 if(!state.editable||!logo)return;
 if(!confirm('Remover apenas a logomarca desta área? Os demais locais permanecerão iguais.'))return;
 snapshot();logo.remove();dirty();fsLogoRead();renderStructurePanel();
 notify('Marca removida somente desta área no rascunho.');
});
$('#fs-brand-logo-original')?.addEventListener('click',()=>{
 if(!state.editable)return;
 const area=fsLogoArea();snapshot();
 const logo=fsEnsureLogo(area);if(!logo){notify('Não foi possível localizar a área.');return;}
 const image=logo.querySelector('img');image.src=FS_OFFICIAL_LOGO;image.alt='FRESUNI Social';logo.setAttribute('aria-label','FRESUNI Social — voltar ao início');
 image.style.removeProperty('width');image.style.height='auto';
 dirty();fsLogoRead();renderStructurePanel();
 notify('Marca institucional aplicada apenas nesta área, no rascunho.');
});
$('#fs-brand-logo-upload')?.addEventListener('click',()=>{
 if(!state.editable){notify('Volte ao modo de edição para mudar a marca.');return;}
 nextLogoTarget=fsLogoArea();
 $('#upload-shared-logo').click();
});
frame.addEventListener('load',fsLogoRead);

let nextLogoTarget='header';
for(const [id,type] of [['change-header-logo','header'],['change-footer-logo','footer']])$('#'+id).addEventListener('click',()=>{nextLogoTarget=type;$('#upload-shared-logo').click();});
$('#upload-shared-logo').addEventListener('change',async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 if(!/^image\/(png|jpeg|webp)$/.test(file.type)){
  notify('Escolha PNG, JPG ou WebP. Para sua segurança, o Editor não incorpora arquivos SVG com scripts.');return;
 }
 if(file.size>2.5e6){notify('Imagem grande demais. Escolha até 2,5 MB.');return;}
 // Manter transparência e nitidez do logotipo original. Não deformar largura/altura.
 const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(file);}).catch(()=>null);
 if(!data){notify('Não foi possível ler a imagem.');return;}
 const area=nextLogoTarget,previous=fsLogoSlot(area).logo;
 const oldBytes=fsBytes(previous?.querySelector('img')?.getAttribute('src')||'');
 if(fsBytes(serialize())-oldBytes+fsBytes(data)+16384>FS_MEDIA_SITE_LIMIT){
  notify('A imagem ultrapassa o limite de 6 MB do site. Use um arquivo menor.');return;
 }
 snapshot();
 const logo=fsEnsureLogo(area);if(!logo)return;
 const img=logo.querySelector('img');img.src=data;img.alt=$('#fs-brand-logo-alt')?.value.trim()||'FRESUNI Social';logo.setAttribute('aria-label',img.alt+' — voltar ao início');
 img.style.removeProperty('width');img.style.height='auto';img.removeAttribute('height');img.removeAttribute('width');
 dirty();renderStructurePanel();fsLogoRead();
 notify('Logomarca do '+fsLogoSlot(area).name+' atualizada sem distorção, apenas no rascunho.');
});
$('#structure-menu-add').addEventListener('click',()=>{const label=$('#structure-menu-label').value.trim(),href=$('#structure-menu-href').value.trim();
 if(!label||!safeUrl(href)){notify('Informe o nome e um destino válido para o novo link.');return;}
 const nav=sharedEl('header')?.querySelector('.main-nav');if(!nav)return;
 const place=$('#structure-menu-place').value;const parent=place==='main'?nav:nav.querySelector('#'+place);
 if(!parent){notify('Submenu não encontrado.');return;}
 snapshot();const a=siteDoc().createElement('a');a.textContent=label;a.dataset.fresuniManualLink='';if(place==='main')a.className='nav-root solo';sharedLink(a,href);parent.append(a);if(place==='sub-acoes')fsActionsMenuExplicitEdit=true;
 dirty();renderStructurePanel();$('#structure-menu-label').value='';$('#structure-menu-href').value='';setEditable(true);notify('Link adicionado ao cabeçalho.');
});
$('#structure-footer-add').addEventListener('click',()=>{const label=$('#structure-footer-label').value.trim(),href=$('#structure-footer-href').value.trim();
 if(!label||!safeUrl(href)){notify('Informe nome e endereço válido.');return;}
 const nav=sharedEl('footer')?.querySelector('nav');if(!nav)return;snapshot();const a=siteDoc().createElement('a');a.textContent=label;sharedLink(a,href);nav.append(a);
 dirty();renderStructurePanel();$('#structure-footer-label').value='';$('#structure-footer-href').value='';setEditable(true);notify('Link adicionado ao rodapé.');
});
$('#structure-header-text-add').addEventListener('click',()=>{
 const el=sharedEl('header');if(!el)return;snapshot();const line=siteDoc().createElement('p');line.dataset.fresuniHeaderMessage='';line.textContent='Novo texto no cabeçalho. Clique para editar.';
 line.style.cssText='max-width:1100px;margin:0 auto;padding:8px 18px;text-align:center;overflow-wrap:anywhere;font:400 16px Prompt,Arial,sans-serif';el.append(line);
 dirty();setEditable(true);selectElement(line);notify('Texto inserido no cabeçalho.');
});
$('#structure-footer-text-add').addEventListener('click',()=>{
 const el=sharedEl('footer')?.querySelector('.footer-inner');if(!el)return;snapshot();const p=siteDoc().createElement('p');p.textContent='Novo parágrafo no rodapé. Clique para editar.';
 el.append(p);dirty();setEditable(true);selectElement(p);notify('Texto inserido no rodapé.');
});

// ----- FRESUNI · controle de grade, dimensões, movimento e contador -----
// Os ajustes são feitos no fluxo normal do documento; nunca em position:absolute.
const fsPropMap={
 'fs-max-width':['maxWidth',0,1800],
 'fs-margin-top':['marginTop',0,250],
 'fs-margin-bottom':['marginBottom',0,250],
 'fs-padding':['padding',0,120],
 'fs-letter-spacing':['letterSpacing',-2,12]
};
function fsGridParent(el){return !!el?.parentElement?.matches('.card-grid,.directory-links,[data-fresuni-grid]');}
function fsWholeGridItem(el){
 if(!el?.closest)return null;
 const holder=el.closest('.card-grid,.directory-links,[data-fresuni-grid]');
 if(!holder||el===holder)return null;
 let item=el;
 while(item.parentElement&&item.parentElement!==holder)item=item.parentElement;
 return item.parentElement===holder?item:null;
}
function fsNumber(v,min,max){return Math.min(max,Math.max(min,Number.isFinite(Number(v))?Number(v):0));}
function fsSyncControls(el){
 if(!el)return;
 for(const [id,[prop]] of Object.entries(fsPropMap)){
  const v=parseFloat(el.style[prop]);
  $('#'+id).value=Number.isFinite(v)?v:0;
 }
 $('#fs-h-align').value=el.dataset.fresuniHAlign||'auto';
 $('#fs-v-align').value=el.style.alignSelf||'auto';
 const grid=fsGridParent(el);
 $('#fs-grid-span').disabled=!grid;window.FRESUNI_FLOW_EDITOR?.sync?.(el);
 $('#fs-grid-span').value=grid?(el.dataset.fresuniGridSpan||'auto'):'auto';
 $('#fs-grid-hint').textContent=grid
   ?'Aqui, aumentar a quantidade de colunas reorganiza os outros itens dentro da grade. No celular o bloco volta a ocupar uma coluna.'
   :'Para ocupar mais colunas, selecione diretamente um cartão ou link dentro de uma grade.';
 $('#fs-line-height').value=['1','1.25','1.5','1.75','2'].includes(el.style.lineHeight)?el.style.lineHeight:'auto';
 $('#fs-text-align').value=['left','center','right','justify'].includes(el.style.textAlign)?el.style.textAlign:'auto';
 $('#fs-text-transform').value=['uppercase','lowercase','capitalize'].includes(el.style.textTransform)?el.style.textTransform:'none';
 $('#fs-hover').value=el.dataset.fresuniHover||'none';
 $('#fs-click').value=el.dataset.fresuniClick||'none';
 $('#fs-counter-target').value=el.dataset.fresuniCounter||75;
 $('#fs-counter-suffix').value=el.dataset.fresuniCounterSuffix??'%';
}
function fsSelected(){const el=state.selected;if(!el||!el.isConnected){notify('Selecione um elemento na prévia para continuar.');return null;}return el;}
function fsChange(id,fn){
 const input=$('#'+id);if(!input)return;
 input.addEventListener('change',()=>{
  const el=fsSelected();if(!el)return;
  snapshot();
  const result=fn(el,input.value);
  if(result===false){fsSyncControls(el);return;}
  dirty();positionResizeGrip();
 });
}
for(const [id,[prop,min,max]] of Object.entries(fsPropMap)){
 fsChange(id,(el,val)=>{
  const n=fsNumber(val,min,max);
  if(id==='fs-max-width'){if(n===0)el.style.removeProperty('max-width');else{el.style.maxWidth=n+'px';el.style.boxSizing='border-box';}}
  else if(id==='fs-letter-spacing'){if(n===0)el.style.removeProperty('letter-spacing');else el.style.letterSpacing=n+'px';}
  else if(id==='fs-padding'){if(n===0)el.style.removeProperty('padding');else{el.style.padding=n+'px';el.style.boxSizing='border-box';}}
  else if(n===0)el.style[prop]='0px';
  else el.style[prop]=n+'px';
 });
}
fsChange('fs-h-align',(el,v)=>{
 el.dataset.fresuniHAlign=v;
 for(const p of ['margin-left','margin-right','justify-self'])el.style.removeProperty(p);
 if(v==='center'){el.style.marginLeft='auto';el.style.marginRight='auto';if(fsGridParent(el))el.style.justifySelf='center';}
 if(v==='start'){el.style.marginLeft='0';el.style.marginRight='auto';if(fsGridParent(el))el.style.justifySelf='start';}
 if(v==='end'){el.style.marginLeft='auto';el.style.marginRight='0';if(fsGridParent(el))el.style.justifySelf='end';}
 if(v!=='auto'&&!el.matches('img,iframe')&&['inline','inline-flex'].includes(frame.contentWindow.getComputedStyle(el).display))el.style.display='inline-block';
});
fsChange('fs-v-align',(el,v)=>{if(v==='auto')el.style.removeProperty('align-self');else el.style.alignSelf=v;});
fsChange('fs-grid-span',(el,v)=>{
 if(!fsGridParent(el)){notify('Este elemento não está diretamente dentro de uma grade.');return false;}
 if(v==='auto'){el.style.removeProperty('grid-column');delete el.dataset.fresuniGridSpan;}
 else{el.style.gridColumn=v==='full'?'1 / -1':'span '+v;el.dataset.fresuniGridSpan=v;}
});
fsChange('fs-line-height',(el,v)=>{if(v==='auto')el.style.removeProperty('line-height');else el.style.lineHeight=v;});
fsChange('fs-text-align',(el,v)=>{if(v==='auto')el.style.removeProperty('text-align');else el.style.textAlign=v;});
fsChange('fs-text-transform',(el,v)=>{el.style.textTransform=v==='none'?'none':v;});
fsChange('fs-hover',(el,v)=>{if(v==='none')delete el.dataset.fresuniHover;else el.dataset.fresuniHover=v;});
fsChange('fs-click',(el,v)=>{
 if(v!=='none'&&!el.matches('a,button,[role="button"]')){notify('O efeito de clique funciona em links e botões. Selecione um desses elementos.');return false;}
 if(v==='none')delete el.dataset.fresuniClick;else el.dataset.fresuniClick=v;
});
$('#fs-select-grid-item').addEventListener('click',()=>{
 const item=fsWholeGridItem(state.selected);
 if(!item){notify('Selecione primeiro um texto dentro de um cartão ou de uma grade.');return;}
 state.selected=null;selectElement(item);
 notify('Caixa completa selecionada. Agora ajuste a largura, o encaixe ou a posição na grade.');
});
$('#fs-layout-reset').addEventListener('click',()=>{
 const el=fsSelected();if(!el)return;
 snapshot();
 for(const p of ['max-width','margin-top','margin-bottom','margin-left','margin-right','justify-self','align-self','grid-column','padding','letter-spacing','line-height','text-align','text-transform'])el.style.removeProperty(p);
 for(const p of ['fresuniHAlign','fresuniGridSpan'])delete el.dataset[p];
 fsSyncControls(el);dirty();positionResizeGrip();notify('Grade, alinhamentos e espaçamentos restaurados.');
});
const fsCounterFormat=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(n);
$('#fs-counter-apply').addEventListener('click',()=>{
 const el=fsSelected();if(!el)return;
 if(!el.matches('p,h1,h2,h3,h4,h5,h6,span,strong,b,li,blockquote')||el.querySelector('a,button,img,svg,iframe,strong,em,span')){
  notify('Selecione um bloco de texto simples, sem links ou imagens internos, para criar um contador.');return;
 }
 const value=Math.round(fsNumber($('#fs-counter-target').value,0,1000000));
 const suffix=$('#fs-counter-suffix').value.slice(0,12);
 if(!el.dataset.fresuniCounter && !/^\s*[\d.,\s]+[%+°]?\s*$/.test(el.textContent) &&
    !confirm('Transformar este texto em um contador numérico? O texto anterior será substituído.'))return;
 snapshot();el.dataset.fresuniCounter=String(value);el.dataset.fresuniCounterSuffix=suffix;
 el.textContent=fsCounterFormat(value)+suffix;
 if(!el.hasAttribute('aria-label')){el.setAttribute('aria-label',el.textContent);el.dataset.fresuniCounterAriaSet='';}
 el.style.fontVariantNumeric='tabular-nums';
 dirty();notify('Contador configurado. O número crescerá de 0 até '+value+suffix+' quando aparecer ao visitante.');
});
$('#fs-counter-remove').addEventListener('click',()=>{
 const el=fsSelected();if(!el||!el.hasAttribute('data-fresuni-counter'))return;
 snapshot();
 for(const attr of ['data-fresuni-counter','data-fresuni-counter-suffix'])el.removeAttribute(attr);
 if(el.hasAttribute('data-fresuni-counter-aria-set')){el.removeAttribute('aria-label');el.removeAttribute('data-fresuni-counter-aria-set');}
 el.style.removeProperty('font-variant-numeric');dirty();notify('Contador removido; valor final preservado.');
});
$('#fs-motion-reset').addEventListener('click',()=>{
 const el=fsSelected();if(!el)return;snapshot();
 for(const a of ['data-fresuni-motion','data-fresuni-hover','data-fresuni-click'])el.removeAttribute(a);
 el.style.removeProperty('--fresuni-motion-duration');
 el.removeAttribute('data-reveal');$('#block-motion').value='none';$('#motion-time').value='650';
 fsSyncControls(el);dirty();notify('Efeitos deste elemento removidos.');
});
$('#fs-motion-preview').addEventListener('click',()=>{
 const el=fsSelected();if(!el)return;
 const kind=el.dataset.fresuniMotion||'slide';
 const duration=fsNumber(parseInt(el.style.getPropertyValue('--fresuni-motion-duration'))||850,100,2400);
 const poses={
 fade:[{opacity:0},{opacity:1}],
 slide:[{opacity:0,transform:'translateY(30px)'},{opacity:1,transform:'none'}],
 zoom:[{opacity:0,transform:'scale(.9)'},{opacity:1,transform:'none'}],
 left:[{opacity:0,transform:'translateX(-38px)'},{opacity:1,transform:'none'}],
 right:[{opacity:0,transform:'translateX(38px)'},{opacity:1,transform:'none'}],
 blur:[{opacity:0,filter:'blur(7px)'},{opacity:1,filter:'blur(0px)'}],
 pop:[{opacity:0,transform:'scale(.8)'},{opacity:1,transform:'none'}]
 };
 if(kind==='none'&&!el.hasAttribute('data-fresuni-counter')){notify('Escolha uma animação ou configure um contador.');return;}
 if(kind!=='none'&&el.animate){
  el.classList.add('fresuni-previewing');
  const a=el.animate(poses[kind]||poses.slide,{duration,easing:'cubic-bezier(.19,.75,.25,1)'});
  a.onfinish=()=>el.classList.remove('fresuni-previewing');
  a.oncancel=()=>el.classList.remove('fresuni-previewing');
 }
 if(el.hasAttribute('data-fresuni-counter')){
  const target=Number(el.dataset.fresuniCounter)||0,suffix=el.dataset.fresuniCounterSuffix||'';
  const start=performance.now();function step(now){
   if(!el.isConnected)return;
   const t=Math.min(1,(now-start)/Math.max(650,duration));el.textContent=fsCounterFormat(Math.round(target*(1-Math.pow(1-t,3))))+suffix;
   if(t<1)frame.contentWindow.requestAnimationFrame(step);
   else el.textContent=fsCounterFormat(target)+suffix;
  }
  frame.contentWindow.requestAnimationFrame(step);
 }
});

// Tema: usa variáveis CSS do site sem remover as regras existentes.
function themeEl(doc){let el=$('#fresuni-custom-theme',doc);if(!el){el=doc.createElement('style');el.id='fresuni-custom-theme';doc.head.append(el);}return el;}
const theme={primary:'#214ECF',text:'#000000',background:'#ffffff',font:'Prompt'};
function applyTheme(){const d=siteDoc();if(!d)return;themeEl(d).textContent=`:root{--primary:${theme.primary};--purple:${theme.primary};--accent:${theme.primary};--ink:${theme.text};--background:${theme.background};--bg:${theme.background}} body{background:${theme.background};color:${theme.text};font-family:${theme.font},Arial,sans-serif} .page-heading h1,.prose h2,.value-section summary{color:${theme.primary}} .brand:focus-visible{outline-color:${theme.primary}}`;
 dirty();}
for(const [id,key] of [['#theme-primary','primary'],['#theme-text','text'],['#theme-bg','background'],['#theme-font','font']])$(id).addEventListener('change',e=>{snapshot();theme[key]=e.target.value;applyTheme();});
$('#reset-theme').addEventListener('click',()=>{snapshot();Object.assign(theme,{primary:'#214ECF',text:'#000000',background:'#ffffff',font:'Prompt'});$$('[id^="theme-"]').forEach(e=>{const key={'theme-primary':'primary','theme-text':'text','theme-bg':'background','theme-font':'font'}[e.id];if(key)e.value=theme[key];});themeEl(siteDoc()).remove();dirty();});
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{$$('[data-tab]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b));});$$('[data-panel]').forEach(x=>x.hidden=x.dataset.panel!==b.dataset.tab);updatePageSidebar();if(b.dataset.tab==='structure')renderStructurePanel();}));
$('#view-desktop').addEventListener('click',()=>{ $('#canvas').classList.remove('mobile');$('#view-desktop').classList.add('active');$('#view-mobile').classList.remove('active');$('#view-desktop').setAttribute('aria-pressed','true');$('#view-mobile').setAttribute('aria-pressed','false');});
$('#view-mobile').addEventListener('click',()=>{ $('#canvas').classList.add('mobile');$('#view-mobile').classList.add('active');$('#view-desktop').classList.remove('active');$('#view-desktop').setAttribute('aria-pressed','false');$('#view-mobile').setAttribute('aria-pressed','true');});
$('#preview').addEventListener('click',()=>{setEditable(!state.editable);notify(state.editable?'Clique nos textos da página para editar.':'Você está vendo a prévia, sem ferramentas de edição.');});
function exportText(content,name){const blob=new Blob([content],{type:'text/html;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2500);}
$('#export').addEventListener('click',()=>{exportText(serialize(),'index.html');notify('HTML exportado. Você pode publicá-lo manualmente no GitHub.');});
$('#backup').addEventListener('click',()=>{exportText(serialize(),'fresuni-backup-'+new Date().toISOString().slice(0,10)+'.html');notify('Backup criado.');});
function doUndo(){if(!state.undo.length){notify('Nada para desfazer.');return;}state.redo.push(serialize());const html=state.undo.pop();reloadFrame(html,state.route);dirty();notify('Alteração desfeita.');}
function doRedo(){if(!state.redo.length){notify('Nada para refazer.');return;}state.undo.push(serialize());const html=state.redo.pop();reloadFrame(html,state.route);dirty();notify('Alteração refeita.');}
$('#undo').addEventListener('click',doUndo);$('#redo').addEventListener('click',doRedo);
$('#draft-save').addEventListener('click',async()=>{try{await saveDraft();notify('Rascunho salvo neste navegador. Para atualizar o site, clique em Publicar alterações.');}catch(e){fsDraftFailed(e);}});
$('#restore-published').addEventListener('click',async()=>{if(!confirm('Descartar todas as mudanças NÃO PUBLICADAS e voltar ao arquivo que está no GitHub?'))return;
 clearTimeout(draftTimer);state.dirty=false;await fsSaveQueue.catch(()=>{});await draftAction('delete').catch(()=>{});state.undo=[];state.redo=[];fsLastSavedRevision=fsDraftRevision;reloadFrame(state.html,'/');fsAutosaveStatus('✓ Versão publicada restaurada','ok');setStatus('Versão publicada restaurada');notify('Voltamos à versão publicada do site.');});
function showPublishError(err){
 const panel=$('#publish-error');panel.hidden=false;
 let msg=String(err.message||err);if(err.status===401)msg+=' Sua sessão pode ter expirado: saia e entre novamente.';
 if(err.status===403||/403|404|Resource not accessible|Not Found/i.test(msg))msg+=' Confira o GITHUB_TOKEN, a permissão Contents: Read and write e o repositório fresuni no Cloudflare Worker.';
 if(err.status===409)msg+=' O arquivo publicado mudou. Faça backup antes de restaurar a versão remota.';
 $('#publish-error-message').textContent=msg;panel.scrollIntoView({block:'nearest',behavior:'smooth'});
 setStatus('Publicação não realizada · rascunho preservado');
}
$('#diagnose-publish').addEventListener('click',async()=>{
 const out=$('#diagnose-publish-result'),btn=$('#diagnose-publish');
 btn.disabled=true;out.textContent='Testando permissão real de escrita do token da Cloudflare, sem alterar páginas…';
 try{
  const r=await api('/write-check',{method:'POST',body:'{}'});
  out.textContent=(r.writeAllowed===true?'ESCRITA AUTORIZADA':'ESCRITA RECUSADA')+
   '\nRepositório: '+(r.repository||'jassinks/fresuni')+' · HTTP '+r.status+
   (r.requiredPermissions?'\nPermissão exigida pelo GitHub: '+r.requiredPermissions:'')+
   (r.githubMessage?'\nResposta do GitHub: '+r.githubMessage:'')+
   '\n'+(r.guidance||'');
 }catch(e){out.textContent='Não foi possível completar o teste: '+e.message+'\nConfira se o Worker foi atualizado e publicado via npx.cmd wrangler deploy.';}
 finally{btn.disabled=false;}
});
$('#dismiss-publish-error').addEventListener('click',()=>$('#publish-error').hidden=true);
$('#copy-publish-error').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#publish-error-message').textContent);notify('Detalhes copiados sem dados secretos.');}catch{notify('Selecione e copie a mensagem de erro.');}});
$('#publish').addEventListener('click',async()=>{
 if(!state.dirty){notify('Não há alterações pendentes.');return;}
 let html;
 try{html=fsPreparePublishDates(fsPrepareSafePublish(serialize()));fsValidateMediaPublish(html);}
 catch(e){alert(e.message);notify('Publicação protegida: '+e.message);return;}
 const warnings=fsPublicationWarnings(html);
 if(warnings.length&&!confirm('ATENÇÃO: foram detectadas alterações que podem ocultar conteúdos existentes:\n\n• '+warnings.join('\n• ')+'\n\nVocê confirma que deseja removê-los?'))return;
 $('#publish-error').hidden=true;
 if(!confirm('Publicar agora todas as alterações no seu repositório do GitHub?'))return;
 const b=$('#publish');b.disabled=true;b.textContent='Publicando…';setStatus('Publicando no GitHub…');
 try{const r=await api('/publish',{method:'POST',body:JSON.stringify({html,expectedSha:state.sha})});if(!r.ok||!r.sha)throw Error('O servidor não confirmou o envio ao GitHub.');state.sha=r.sha;state.html=html;fsActionsMenuExplicitEdit=false;state.undo=[];state.redo=[];state.dirty=false;clearTimeout(draftTimer);fsLastSavedRevision=fsDraftRevision;await fsSaveQueue.catch(()=>{});await draftAction('delete').catch(()=>{});fsAutosaveStatus('✓ Publicação enviada ao GitHub','ok');setStatus('Publicado no GitHub');reloadFrame(html,state.route);notify('Alterações enviadas ao GitHub! O Pages pode demorar a atualizar o site.');}
 catch(e){dirty();showPublishError(e);notify('Publicação não concluída. Veja a mensagem com os detalhes abaixo da prévia.');}
 finally{b.disabled=false;b.textContent='Publicar alterações';}
});
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden'&&state.dirty)saveDraft().catch(fsDraftFailed);
});
setInterval(()=>{if(state.dirty&&!state.loading&&fsLastSavedRevision<fsDraftRevision)saveDraft().catch(fsDraftFailed);},12000);
$('#quick-save-draft')?.addEventListener('click',()=>$('#draft-save').click());
$('#quick-google-form')?.addEventListener('click',()=>actionInsert('google-forms'));
$('#quick-effects')?.addEventListener('click',()=>{
 const el=state.selected;if(!el){notify('Selecione um título, texto, botão ou cartão na prévia para editar a animação.');return;}
 $('#fs-motion-advanced')?.scrollIntoView({block:'center',behavior:'smooth'});
 $('#block-motion')?.focus();
});

window.FRESUNI_EDITOR_BRIDGE={get selected(){return state.selected;},set selected(value){state.selected=value;},get editable(){return state.editable;},frame,siteDoc,selectElement,clearSelection,snapshot,dirty,notify,positionResizeGrip};
window.addEventListener('beforeunload',e=>{if(state.dirty&&fsLastSavedRevision<fsDraftRevision){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(app.hidden||!(e.ctrlKey||e.metaKey))return;
 if(e.key.toLowerCase()==='s'){e.preventDefault();$('#draft-save').click();}
 if(e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();e.shiftKey?doRedo():doUndo();}
 if(e.key.toLowerCase()==='y'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();doRedo();}
});
})();