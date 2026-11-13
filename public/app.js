'use strict';
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
};
const icons = {
  plus:'M12 5v14M5 12h14', left:'m14 6-6 6 6 6', right:'m9 6 6 6-6 6',
  calendar:'M4 8h16M8 3v4m8-4v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  close:'m6 6 12 12M18 6 6 18', clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0'
};
function icon(name) {
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg'), p=document.createElementNS(ns,'path');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','class':'icon','aria-hidden':'true'})) svg.setAttribute(key,value);
  p.setAttribute('d',icons[name]); svg.append(p); return svg;
}
document.querySelectorAll('[data-icon]').forEach(i => i.replaceWith(icon(i.dataset.icon)));
const today = new Date();
let selected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let month = new Date(selected.getFullYear(), selected.getMonth(), 1);
let session = {connected:false,pages:[],page_id:null};
let remote=[], drafts=[], revision=0, editing=null, mediaFile=null, deleting=null, busy=false, loading=false, failed=false;
let dayUrls=[], editorUrl=null;
const fmt = (date, options) => new Intl.DateTimeFormat('pt-BR',options).format(date);
const clock = date => fmt(date,{hour:'2-digit',minute:'2-digit'});
const cap = text => text.charAt(0).toUpperCase()+text.slice(1);
const ymd = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const pretty = {scheduled:'Agendado',published:'Publicado',draft:'Rascunho'};
function notice(msg=''){ $('message').textContent=msg; $('message').hidden=!msg; }
async function api(path, method='GET', body=null){
  const opts={method,credentials:'same-origin',headers:{Accept:'application/json'}};
  if(body instanceof FormData) opts.body=body;
  else if(body!==null){ opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify(body); }
  const res=await fetch('/api/'+path,opts);
  if(res.status===204) return {};
  let data;
  try{data=await res.json();}catch{throw Error('O servidor do FácilPost não respondeu. Tente novamente.');}
  if(!res.ok) throw Error(typeof data.detail==='string'?data.detail:'A solicitação falhou. Tente novamente.');
  return data;
}
let draftDatabase;
function database(){
  if(!draftDatabase) draftDatabase=new Promise((resolve,reject)=>{
    const req=indexedDB.open('facilpost-editor',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('drafts',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(Error('O navegador não permitiu acessar os rascunhos.'));
  });
  return draftDatabase;
}
async function draftOp(action,value){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts',action==='getAll'?'readonly':'readwrite');
    const store=tx.objectStore('drafts'),req=action==='getAll'?store.getAll():store[action](value);
    tx.oncomplete=()=>resolve(req.result);
    tx.onabort=()=>reject(Error('Não foi possível salvar ou carregar o rascunho neste navegador.'));
  });
}
function allPosts(){return [...remote,...drafts.filter(d=>!d.page_id||d.page_id===session.page_id)].sort((a,b)=>new Date(a.at)-new Date(b.at));}
function calendarBounds(){
  const start=new Date(month.getFullYear(),month.getMonth(),1-month.getDay());
  const last=new Date(month.getFullYear(),month.getMonth()+1,0);
  const days=Math.ceil((last.getDate()+month.getDay())/7)*7;
  return {start,days,end:new Date(start.getFullYear(),start.getMonth(),start.getDate()+days)};
}
function safeURL(url){try{const parsed=new URL(url); return ['https:','http:'].includes(parsed.protocol)?parsed.href:null;}catch{return null;}}
function media(post,group){
  if(!['video','photo'].includes(post.media_type))return null;
  let src=safeURL(post.media_url), thumb=safeURL(post.thumbnail);
  if(post.file){src=URL.createObjectURL(post.file); if(group==='editor')editorUrl=src;else dayUrls.push(src);}
  let node;
  if(post.media_type==='video'&&src){node=el('video','media');node.controls=true;node.playsInline=true;node.preload='metadata';node.muted=true;if(thumb)node.poster=thumb;node.src=src;node.addEventListener('timeupdate',()=>{if(node.currentTime>=8&&!node.paused){node.pause();node.currentTime=0;}});}
  else if(thumb||src){node=el('img','media');node.alt=post.media_type==='video'?'Capa do vídeo':'Foto da publicação';node.loading='lazy';node.src=thumb||src;}
  return node;
}
function button(text,cls,handler){const b=el('button',cls,text);b.type='button';b.addEventListener('click',handler);return b;}
function render(){
  const posts=allPosts(), grouped=new Map();
  for(const p of posts){const key=ymd(new Date(p.at));if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(p);}
  $('monthLabel').textContent=cap(fmt(month,{month:'long',year:'numeric'}));
  const {start,days}=calendarBounds();const grid=document.createDocumentFragment();
  for(let i=0;i<days;i++){
    const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),key=ymd(d),list=grouped.get(key)||[];
    const b=button('','day',()=>{
      const moved=d.getMonth()!==month.getMonth();selected=d;
      if(moved){month=new Date(d.getFullYear(),d.getMonth(),1);loadMonth();}
      else render();
      if(matchMedia('(max-width:720px)').matches)$('agenda').scrollIntoView({block:'start'});
      else document.querySelector('.day.selected')?.focus({preventScroll:true});
    });
    if(d.getMonth()!==month.getMonth())b.classList.add('out');
    if(key===ymd(new Date()))b.classList.add('current');
    if(key===ymd(selected))b.classList.add('selected');
    b.setAttribute('aria-pressed',String(key===ymd(selected)));b.setAttribute('aria-label',fmt(d,{dateStyle:'full'})+', '+list.length+' publicações');
    b.append(el('span','num',d.getDate()));
    list.slice(0,2).forEach(p=>b.append(el('span','event '+p.status,clock(new Date(p.at))+' '+(p.message||'Mídia'))));
    if(list.length>2)b.append(el('span','more','+'+(list.length-2)+' mais'));
    grid.append(b);
  }
  $('calendar').replaceChildren(grid);
  const count=posts.filter(p=>ymd(new Date(p.at)).slice(0,7)===ymd(month).slice(0,7)).length;
  $('monthCount').textContent=loading?'Carregando publicações…':failed?'Falha ao atualizar publicações':count+' '+(count===1?'publicação no mês':'publicações no mês');
  $('timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ');
  $('dayLabel').textContent=fmt(selected,{day:'numeric',month:'long'});
  $('dayFull').textContent=cap(fmt(selected,{weekday:'long'}));
  $('dayPosts').replaceChildren();dayUrls.forEach(url=>URL.revokeObjectURL(url));dayUrls=[];
  const day=grouped.get(ymd(selected))||[];
  if(!day.length){
    const box=el('div','empty'),badge=el('div','empty-icon');badge.append(icon('clock'));
    box.append(badge,el('strong','',loading?'Carregando…':failed?'Agenda indisponível':'Dia livre'),el('p','',failed?'Tente atualizar as publicações.':'Nenhuma publicação neste dia.'));
    if(failed)box.append(button('Tentar novamente','link',()=>loadMonth()));$('dayPosts').append(box);
  }
  day.forEach(p=>{
    const item=el('article','item'),meta=el('div','postMeta'),time=el('time','',clock(new Date(p.at)));time.dateTime=p.at;
    meta.append(time,el('b','dot '+(p.status==='scheduled'?'planned':p.status)),el('span','',pretty[p.status]));
    item.append(meta,el('h3','',p.message||({photo:'Foto',video:'Vídeo'}[p.media_type]||'Publicação')));
    const preview=media(p,'agenda');if(preview)item.append(preview);
    if(p.media_type==='video'&&!safeURL(p.media_url)&&!p.file&&safeURL(p.permalink)){const link=el('a','link','Assistir no Facebook');link.href=safeURL(p.permalink);link.target='_blank';link.rel='noopener noreferrer';item.append(link);}
    const actions=el('div','itemActions');
    actions.append(button('Editar','',()=>openEditor(p)));
    if(p.status==='published')actions.append(button('Métricas','',()=>openMetrics(p)));
    actions.append(button('Excluir','delete',()=>{deleting=p;$('confirmText').textContent=p.status==='draft'?'Este rascunho será removido deste navegador.':'Esta publicação será excluída da Página do Facebook.';$('confirm').showModal();}));
    item.append(actions);$('dayPosts').append(item);
  });
  $('accountName').textContent=session.connected?(session.pages.find(p=>p.id===session.page_id)?.name||'Minhas Páginas'):'Conectar Facebook';
}
async function loadMonth(){
  const id=++revision;remote=[];loading=!!session.page_id;failed=false;render();
  const {start,end}=calendarBounds();
  try{
    if(session.page_id){
      const data=await api('posts?'+new URLSearchParams({start:start.toISOString(),end:end.toISOString()}));
      if(revision===id){remote=data.posts;notice();}
    }
  }catch(e){if(id===revision){failed=true;notice(e.message);}}
  finally{if(id===revision){loading=false;render();}}
}
function shiftMonth(delta){
  month=new Date(month.getFullYear(),month.getMonth()+delta,1);
  selected=new Date(month.getFullYear(),month.getMonth(),Math.min(selected.getDate(),new Date(month.getFullYear(),month.getMonth()+1,0).getDate()));
  loadMonth();
}
function resetEditorURL(){if(editorUrl)URL.revokeObjectURL(editorUrl);editorUrl=null;}
function showPreview(){
  resetEditorURL();$('mediaPreview').replaceChildren();
  const post=mediaFile?{file:mediaFile,media_type:mediaFile.type.startsWith('video/')?'video':'photo'}:editing?.status!=='draft'?editing:null;
  const preview=post&&media(post,'editor');if(preview)$('mediaPreview').append(preview);
  $('removeFile').hidden=!mediaFile;
}
function openEditor(post=null){
  editing=post;mediaFile=post?.file||null;const isRemote=!!post&&post.status!=='draft';
  const at=post?new Date(post.at):new Date(selected.getFullYear(),selected.getMonth(),selected.getDate(),12);
  if(!post&&ymd(at)===ymd(new Date()))at.setTime(Date.now()+30*60000);
  $('editorTitle').textContent=post?'Editar publicação':'Criar publicação';
  $('caption').value=post?.message||'';$('file').value='';
  $('when').value=ymd(at)+'T'+clock(at);$('when').dataset.original=$('when').value;
  $('mediaControls').hidden=isRemote;$('dateLabel').hidden=post?.status==='published';
  $('editorStatus').textContent='';$('publish').hidden=isRemote;$('saveDraft').hidden=isRemote;
  $('schedule').textContent=isRemote?'Salvar alterações':'Agendar';
  showPreview();$('editor').showModal();$('caption').focus();
}
$('editor').addEventListener('close',resetEditorURL);
$('file').onchange=()=>{const next=$('file').files[0];if(!next)return;if(next.size>64*1024*1024){$('editorStatus').textContent='Selecione um arquivo de até 64 MiB.';$('file').value='';return;}
  mediaFile=next;$('editorStatus').textContent='';showPreview();};
$('removeFile').onclick=()=>{mediaFile=null;$('file').value='';showPreview();};
function showError(e){$('editorStatus').textContent=e.message;}
function setBusy(value){busy=value;document.querySelectorAll('#editor button,#editor input,#editor textarea,#confirm button').forEach(n=>n.disabled=value);}
async function submit(mode){
  if(busy)return;
  const message=$('caption').value.trim(),when=new Date($('when').value), isRemote=editing&&editing.status!=='draft';
  if(!message&&!mediaFile&&!(isRemote&&editing.media_type!=='text'))return showError(Error('Escreva uma legenda ou selecione uma mídia.'));
  if((mode!=='publish'&&editing?.status!=='published')&&Number.isNaN(+when))return showError(Error('Escolha uma data e um horário.'));
  if(mode!=='draft'&&!session.page_id){showError(Error('Salve o rascunho e conecte uma Página do Facebook para publicar.'));return;}
  if(mode==='schedule'&&(!isRemote||(editing.status==='scheduled'&&$('when').value!==$('when').dataset.original))){
    const delay=+when-Date.now();if(delay<600000||delay>75*86400000)return showError(Error('Escolha um horário entre 10 minutos e 75 dias a partir de agora.'));
  }
  setBusy(true);
  try{
    if(mode==='draft'){
      const draft={id:editing?.id||crypto.randomUUID(),page_id:editing?.page_id||session.page_id||null,message,at:when.toISOString(),status:'draft',file:mediaFile,media_type:mediaFile?(mediaFile.type.startsWith('video/')?'video':'photo'):'text'};
      await draftOp('put',draft);drafts=drafts.filter(d=>d.id!==draft.id).concat(draft);
    }else if(isRemote){
      const data={message};if(editing.status==='scheduled'&&$('when').value!==$('when').dataset.original)data.at=when.toISOString();
      await api('posts/'+encodeURIComponent(editing.id),'PATCH',data);
    }else{
      const data=new FormData();data.append('message',message);if(mediaFile)data.append('file',mediaFile);if(mode==='schedule')data.append('at',when.toISOString());
      await api('posts','POST',data);
      if(editing){const id=editing.id;drafts=drafts.filter(d=>d.id!==id);try{await draftOp('delete',id);}catch{notice('Enviado ao Facebook. A cópia local do rascunho pode permanecer neste navegador.');}}
    }
    const target=mode==='publish'?new Date():editing?.status==='published'?new Date(editing.at):when;
    selected=new Date(target.getFullYear(),target.getMonth(),target.getDate());month=new Date(target.getFullYear(),target.getMonth(),1);
    $('editor').close();await loadMonth();
    if(!failed)notice(mode==='draft'?'Rascunho salvo neste navegador.':isRemote?'Publicação atualizada.':mode==='schedule'?'Publicação agendada no Facebook.':'Publicação enviada ao Facebook.');
  }catch(e){showError(e);}finally{setBusy(false);}
}
async function openMetrics(post){
  const id=post.id;$('statsBody').dataset.id=id;$('statsBody').textContent='Buscando métricas…';$('stats').showModal();
  try{
    const values=await api('posts/'+encodeURIComponent(id)+'/metrics');if($('statsBody').dataset.id!==id)return;
    $('statsBody').replaceChildren();for(const [key,label] of Object.entries({reactions:'Reações',comments:'Comentários',shares:'Compartilhamentos'})){
      const row=el('div','metric');row.append(el('span','',label),el('strong','',values[key]==null?'Indisponível':new Intl.NumberFormat('pt-BR').format(values[key])));$('statsBody').append(row);
    }
  }catch(e){if($('statsBody').dataset.id===id)$('statsBody').textContent=e.message;}
}
$('doDelete').onclick=async()=>{
  if(!deleting||busy)return;setBusy(true);
  try{
    if(deleting.status==='draft'){await draftOp('delete',deleting.id);drafts=drafts.filter(d=>d.id!==deleting.id);}
    else await api('posts/'+encodeURIComponent(deleting.id),'DELETE');
    $('confirm').close();await loadMonth();if(!failed)notice('Publicação excluída.');
  }catch(e){$('confirmText').textContent=e.message;}finally{setBusy(false);}
};
$('cancelDelete').onclick=()=>$('confirm').close();
async function account(){
  if(!session.connected){location.assign('/api/facebook/connect');return;}
  const box=$('pageList');box.replaceChildren();
  session.pages.forEach(page=>{
    const b=button(page.name,'outline pageRow',async()=>{
      b.disabled=true;try{await api('page','POST',{id:page.id});session.page_id=page.id;$('pages').close();await loadMonth();}catch(e){box.append(el('p','hint',e.message));}finally{b.disabled=false;}
    });b.setAttribute('aria-pressed',String(page.id===session.page_id));if(page.id===session.page_id)b.append(el('span','hint','Selecionada'));box.append(b);
  });
  if(!session.pages.length)box.append(el('p','hint','Nenhuma Página disponível nesta conexão.'));
  box.append(button('Conectar novamente','outline',()=>location.assign('/api/facebook/connect')));
  box.append(button('Desconectar Facebook','link',async()=>{
    try{await api('logout','POST');session={connected:false,pages:[],page_id:null};$('pages').close();await loadMonth();notice('Facebook desconectado.');}catch(e){box.append(el('p','hint',e.message));}
  }));$('pages').showModal();
}
document.querySelectorAll('button.close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});$('confirm').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('account').onclick=account;$('newPost').onclick=()=>openEditor();$('newDay').onclick=()=>openEditor();$('saveDraft').onclick=()=>submit('draft');$('publish').onclick=()=>submit('publish');
$('postForm').onsubmit=e=>{e.preventDefault();submit('schedule');};
$('prev').onclick=()=>shiftMonth(-1);$('next').onclick=()=>shiftMonth(1);$('today').onclick=()=>{const d=new Date();selected=new Date(d.getFullYear(),d.getMonth(),d.getDate());month=new Date(d.getFullYear(),d.getMonth(),1);loadMonth();};
async function init(){
  render();
  const [s,d]=await Promise.allSettled([api('session'),draftOp('getAll')]);
  if(s.status==='fulfilled')session=s.value;if(d.status==='fulfilled')drafts=d.value;
  await loadMonth();
  const url=new URL(location.href),err=url.searchParams.get('error');
  if(err){notice(err);url.searchParams.delete('error');history.replaceState(null,'',url);}
  else if(s.status==='rejected')notice(s.reason.message);
  else if(d.status==='rejected')notice(d.reason.message);
  if(session.connected&&!session.page_id&&!err)account();
}
init();
