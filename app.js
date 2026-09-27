import { openDB, all, get, put, byIndex, softDelete, clearAll, exportAll, stampBase, uid, getMeta, setMeta } from './db.js';

const LEGEND_SEED = [
  'Akali','Ambessa','Annie','Azir','Diana','Draven','Ezreal','Fiora','Irelia','Jax','Jayce','Kennen',
  "Kha'Zix",'Master Yi','Mel','Ornn','Pyke',"Rek'Sai",'Rengar','Rumble','Shen','Vex','Vi','Zed'
];

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const app = $('#app');
const modal = $('#modal');
const modalTitle = $('#modalTitle');
const modalBody = $('#modalBody');
const toastEl = $('#toast');
const saveStatus = $('#saveStatus');

const state = {
  screen: 'home',
  activeSession: null,
  activeMatch: null,
  activeGame: null,
  tick: null,
  historyFilters: {},
  statsScope: 'overall',
  notesQuery: ''
};

function iso(){ return new Date().toISOString(); }
function ms(v){ return v ? new Date(v).getTime() : 0; }
function esc(v=''){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDuration(value){
  const total = Math.max(0, Math.floor((value||0)/1000));
  const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtHours(value){
  const mins=Math.floor(Math.max(0,value||0)/60000); return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;
}
function fmtDate(v){
  if(!v) return '—';
  return new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function pct(n,d){ return d ? `${(n/d*100).toFixed(d<10?0:1)}%` : '—'; }
function avg(n,d, digits=1){ return d ? (n/d).toFixed(digits) : '—'; }
function titleCase(s=''){ return s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove('show'),1800); }
function markSaved(){ saveStatus.textContent='Saved on this iPhone'; saveStatus.style.color='var(--good)'; }
function markSaving(){ saveStatus.textContent='Saving…'; saveStatus.style.color='var(--warn)'; }
async function save(store,row){ markSaving(); await put(store,row); markSaved(); return row; }
function showModal(title,html){ modalTitle.textContent=title; modalBody.innerHTML=html; if(!modal.open) modal.showModal(); }
function closeModal(){ if(modal.open) modal.close(); }
function confirmModal(title,message,onConfirm,label='Confirm'){
  showModal(title, `<p class="muted small">${esc(message)}</p><div class="btn-row"><button type="button" class="btn ghost" id="cancelConfirm">Cancel</button><button type="button" class="btn danger" id="doConfirm">${esc(label)}</button></div>`);
  $('#cancelConfirm').onclick=closeModal;
  $('#doConfirm').onclick=async()=>{ closeModal(); await onConfirm(); };
}

async function seedLegends(){
  const existing=await all('legends');
  if(existing.length) return;
  for(const name of LEGEND_SEED) await put('legends', stampBase({name, archived:false}));
}

async function refreshActive(){
  const sessions=(await all('sessions')).filter(s=>s.status==='active'||s.status==='paused').sort((a,b)=>ms(b.started_at)-ms(a.started_at));
  state.activeSession=sessions[0]||null;
  state.activeMatch=null; state.activeGame=null;
  if(state.activeSession){
    const matches=(await byIndex('matches','session_id',state.activeSession.id)).filter(m=>!m.ended_at).sort((a,b)=>ms(b.started_at)-ms(a.started_at));
    state.activeMatch=matches[0]||null;
    if(state.activeMatch){
      const games=(await byIndex('games','match_id',state.activeMatch.id)).filter(g=>!g.ended_at).sort((a,b)=>a.game_number-b.game_number);
      state.activeGame=games[0]||null;
    }
  }
}

function sessionActiveMs(session, at=Date.now()){
  if(!session) return 0;
  const end = session.ended_at ? ms(session.ended_at) : (session.status==='paused' && session.paused_at ? ms(session.paused_at) : at);
  let total=Math.max(0,end-ms(session.started_at));
  for(const p of (session.pause_intervals||[])){
    const pe=p.ended_at?ms(p.ended_at):end;
    total-=Math.max(0,pe-ms(p.started_at));
  }
  return Math.max(0,total);
}

function intervalActiveMs(start,end,pauses=[]){
  let total=Math.max(0,end-start);
  for(const p of pauses){
    const ps=ms(p.started_at), pe=p.ended_at?ms(p.ended_at):end;
    const overlap=Math.max(0,Math.min(end,pe)-Math.max(start,ps));
    total-=overlap;
  }
  return Math.max(0,total);
}

function setScreen(name){
  state.screen=name;
  $$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===name));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
  const titles={home:'Home',play:'Play',decks:'Decks',history:'History',stats:'Stats',more:'Journal & Data'};
  $('#screenTitle').textContent=titles[name]||'RiftMastery';
  renderCurrent();
}

$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setScreen(b.dataset.nav)));

async function lookups(){
  const [legends,decks]=await Promise.all([all('legends'),all('decks')]);
  return {
    legends, decks,
    legendMap:Object.fromEntries(legends.map(x=>[x.id,x])),
    deckMap:Object.fromEntries(decks.map(x=>[x.id,x]))
  };
}

async function homeStats(){
  const [sessions,matches,games]=await Promise.all([all('sessions'),all('matches'),all('games')]);
  let total=sessions.filter(s=>s.status==='completed').reduce((a,s)=>a+(s.active_play_ms??sessionActiveMs(s)),0);
  if(state.activeSession) total+=sessionActiveMs(state.activeSession);
  const formal=matches.filter(m=>m.result==='me'||m.result==='opponent');
  const wins=formal.filter(m=>m.result==='me').length;
  return {total,matches:matches.length,games:games.length,wins,losses:formal.length-wins};
}

async function renderHome(){
  const el=$('#screen-home');
  const s=await homeStats();
  const {legendMap,deckMap}=await lookups();
  const matches=(await all('matches')).sort((a,b)=>ms(b.started_at)-ms(a.started_at)).slice(0,4);
  const active=state.activeSession;
  el.innerHTML=`
    <div class="hero"><h2>${active?'Session in progress':'Train. Track. Improve.'}</h2><p>${active?`${titleCase(active.mode)} • ${titleCase(active.context)} • ${fmtDuration(sessionActiveMs(active))}`:'A local-first Riftbound development log built for actual reps.'}</p></div>
    ${active?`<div class="session-strip"><div><div class="strong">${active.event_name?esc(active.event_name):titleCase(active.context)}</div><div class="small muted">${active.status==='paused'?'Paused':'Active'} • ${titleCase(active.mode)}</div></div><div class="time">${fmtDuration(sessionActiveMs(active))}</div></div>`:''}
    <div class="grid-2">
      <div class="card stat-card"><div class="k">Active development</div><div class="v">${fmtHours(s.total)}</div></div>
      <div class="card stat-card"><div class="k">Formal record</div><div class="v">${s.wins}–${s.losses}</div></div>
      <div class="card stat-card"><div class="k">Matches</div><div class="v">${s.matches}</div></div>
      <div class="card stat-card"><div class="k">Games</div><div class="v">${s.games}</div></div>
    </div>
    <div class="primary-actions">
      <button class="btn primary" id="homePaper">${active?.mode==='paper'?'Resume Paper Session':'Start Paper Session'}</button>
      <button class="btn" id="homeOnline">${active?.mode==='online'?'Resume Online Session':'Start / Log Online'}</button>
    </div>
    <div class="section-head"><h3>Recent activity</h3><button class="link-btn small" id="goHistory">View all</button></div>
    <div class="list">${matches.length?matches.map(m=>{
      const d=deckMap[m.my_deck_id], l=legendMap[m.opponent_legend_id];
      const result=m.result==='me'?'W':m.result==='opponent'?'L':'—';
      return `<div class="list-item"><div><div class="title">${esc(d?.name||'Unknown deck')} <span class="muted">vs</span> ${esc(l?.name||'Unknown')}</div><div class="meta">${titleCase(m.format)} • ${titleCase(m.mode||'paper')} • ${fmtDate(m.started_at)}</div></div><div class="right"><span class="chip ${result==='W'?'good':result==='L'?'warn':''}">${result}</span></div></div>`;
    }).join(''):`<div class="empty">No matches yet. Create a deck, then start your first session.</div>`}</div>`;
  $('#homePaper').onclick=()=>{ if(active?.mode==='paper') setScreen('play'); else openStartSession('paper'); };
  $('#homeOnline').onclick=()=>{ if(active?.mode==='online') setScreen('play'); else openOnlineChoice(); };
  $('#goHistory').onclick=()=>setScreen('history');
}

async function renderDecks(){
  const el=$('#screen-decks');
  const {legends,decks,legendMap}=await lookups();
  const activeDecks=decks.filter(d=>!d.archived).sort((a,b)=>(legendMap[a.legend_id]?.name||'').localeCompare(legendMap[b.legend_id]?.name||'')||a.name.localeCompare(b.name));
  el.innerHTML=`
    <div class="section-head"><div><h2>Your decks</h2><div class="sub">Your deck determines your Legend in every match.</div></div><button class="btn small primary" id="newDeck">+ Deck</button></div>
    <div class="list">${activeDecks.length?activeDecks.map(d=>`<div class="list-item"><div><div class="title">${esc(d.name)} ${d.version?`<span class="chip">${esc(d.version)}</span>`:''}</div><div class="meta">${esc(legendMap[d.legend_id]?.name||'Unknown Legend')}${d.notes?` • ${esc(d.notes)}`:''}</div></div><div class="btn-row" style="flex:0 0 auto"><button class="btn small ghost deckEdit" data-id="${d.id}">Edit</button><button class="btn small deckVersion" data-id="${d.id}">New version</button></div></div>`).join(''):`<div class="empty">No decks yet. Add the deck you are currently testing or playing.</div>`}</div>
    ${decks.some(d=>d.archived)?`<div class="section-head"><h3>Archived</h3></div><div class="list">${decks.filter(d=>d.archived).map(d=>`<div class="list-item"><div><div class="title">${esc(d.name)}</div><div class="meta">${esc(legendMap[d.legend_id]?.name||'Unknown')}</div></div><button class="btn small ghost deckRestore" data-id="${d.id}">Restore</button></div>`).join('')}</div>`:''}`;
  $('#newDeck').onclick=()=>openDeckModal();
  $$('.deckEdit',el).forEach(b=>b.onclick=()=>openDeckModal(b.dataset.id));
  $$('.deckVersion',el).forEach(b=>b.onclick=()=>openDeckVersionModal(b.dataset.id));
  $$('.deckRestore',el).forEach(b=>b.onclick=async()=>{ const d=await get('decks',b.dataset.id); d.archived=false; await save('decks',d); renderDecks(); });
}

async function openDeckModal(id=null){
  const {legends}=await lookups();
  const deck=id?await get('decks',id):null;
  showModal(deck?'Edit deck':'Add deck',`
    <label><span class="label-title">Legend</span><select id="deckLegend">${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value="${l.id}" ${deck?.legend_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class="label-title">Deck name</span><input id="deckName" value="${esc(deck?.name||'')}" placeholder="e.g. Radiance Control"></label>
    <label><span class="label-title">Version</span><input id="deckVersion" value="${esc(deck?.version||'')}" placeholder="e.g. v1, LA list, Sep 27"></label>
    <label><span class="label-title">Notes <span class="muted">(optional)</span></span><textarea id="deckNotes" placeholder="What makes this version different?">${esc(deck?.notes||'')}</textarea></label>
    <div class="btn-row">${deck?`<button type="button" class="btn danger" id="archiveDeck">Archive</button>`:''}<button type="button" class="btn primary" id="saveDeck">Save deck</button></div>`);
  $('#saveDeck').onclick=async()=>{
    const name=$('#deckName').value.trim(); if(!name) return toast('Give the deck a name.');
    const row=deck||stampBase({});
    Object.assign(row,{legend_id:$('#deckLegend').value,name,version:$('#deckVersion').value.trim(),notes:$('#deckNotes').value.trim(),archived:false});
    await save('decks',row); await setMeta('last_deck_id',row.id); closeModal(); renderDecks(); toast('Deck saved.');
  };
  if(deck) $('#archiveDeck').onclick=()=>confirmModal('Archive deck',`Archive ${deck.name}? Historical matches will stay intact.`,async()=>{deck.archived=true;await save('decks',deck);renderDecks();},'Archive');
}

async function openDeckVersionModal(id){
  const old=await get('decks',id); if(!old) return;
  showModal('Create new version',`
    <p class="small muted">This keeps ${esc(old.name)} ${esc(old.version||'')} frozen in history and creates a separate version for future matches.</p>
    <label><span class="label-title">Deck name</span><input id="newVersionName" value="${esc(old.name)}"></label>
    <label><span class="label-title">New version label</span><input id="newVersionLabel" placeholder="e.g. v2"></label>
    <label><span class="label-title">Notes</span><textarea id="newVersionNotes">${esc(old.notes||'')}</textarea></label>
    <button type="button" class="btn primary full" id="createVersion">Create version</button>`);
  $('#createVersion').onclick=async()=>{
    const version=$('#newVersionLabel').value.trim(); if(!version) return toast('Add a version label.');
    const row=stampBase({name:$('#newVersionName').value.trim()||old.name,legend_id:old.legend_id,version,notes:$('#newVersionNotes').value.trim(),archived:false,parent_deck_id:old.id});
