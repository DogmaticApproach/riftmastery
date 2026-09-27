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
    await save('decks',row); await setMeta('last_deck_id',row.id); closeModal(); renderDecks(); toast('New version created.');
  };
}

async function openStartSession(mode){
  await refreshActive();
  if(state.activeSession){ toast('Finish the current session first.'); return setScreen('play'); }
  const {decks}=await lookups();
  if(!decks.filter(d=>!d.archived).length){
    showModal('Create a deck first','<p class="muted small">RiftMastery logs your side by deck, so you need at least one saved deck before starting.</p><button type="button" class="btn primary full" id="makeDeckFirst">Create deck</button>');
    $('#makeDeckFirst').onclick=()=>{closeModal();setScreen('decks');openDeckModal();}; return;
  }
  const contextOptions = mode==='online' ? ['online_ranked','testing','casual','tournament'] : ['testing','local','tournament','casual'];
  showModal(mode==='paper'?'Start paper session':'Start online session',`
    <label><span class="label-title">Session context</span><select id="sessionContext">${contextOptions.map(x=>`<option value="${x}">${titleCase(x)}</option>`).join('')}</select></label>
    <label><span class="label-title">Event / session name <span class="muted">(optional)</span></span><input id="sessionName" placeholder="e.g. Thursday locals, Annie testing"></label>
    <button type="button" class="btn primary full" id="createSession">Start session</button>`);
  $('#createSession').onclick=async()=>{
    const row=stampBase({mode,context:$('#sessionContext').value,event_name:$('#sessionName').value.trim(),started_at:iso(),ended_at:null,pause_intervals:[],paused_at:null,status:'active',active_play_ms:null});
    await save('sessions',row); closeModal(); await refreshActive();
    if(mode==='paper') await openMatchSetup(row); else {setScreen('play'); toast('Online timer started.');}
  };
}

async function openMatchSetup(session=state.activeSession){
  if(!session) return;
  const {legends,decks,legendMap}=await lookups();
  const activeDecks=decks.filter(d=>!d.archived);
  const lastDeck=await getMeta('last_deck_id',''); const lastOpp=await getMeta('last_opp_legend_id',''); const lastFormat=await getMeta('last_format','BO3');
  showModal('New match',`
    <label><span class="label-title">My deck</span><select id="matchDeck">${activeDecks.map(d=>`<option value="${d.id}" ${d.id===lastDeck?'selected':''}>${esc(legendMap[d.legend_id]?.name||'')} — ${esc(d.name)}${d.version?` (${esc(d.version)})`:''}</option>`).join('')}</select></label>
    <label><span class="label-title">Opponent Legend</span><select id="matchOpp">${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value="${l.id}" ${l.id===lastOpp?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class="label-title">Opponent build / archetype <span class="muted">(optional)</span></span><input id="matchOppBuild" placeholder="Only if known"></label>
    <label><span class="label-title">Format</span><select id="matchFormat">${['BO1','BO3','BO5','FREE_PLAY'].map(f=>`<option value="${f}" ${f===lastFormat?'selected':''}>${f==='FREE_PLAY'?'Free Play / Testing':f}</option>`).join('')}</select></label>
    <button type="button" class="btn primary full" id="startMatch">Start match</button>`);
  $('#startMatch').onclick=async()=>{
    const deckId=$('#matchDeck').value, opp=$('#matchOpp').value, format=$('#matchFormat').value;
    const match=stampBase({session_id:session.id,mode:session.mode,context:session.context,my_deck_id:deckId,opponent_legend_id:opp,opponent_build:$('#matchOppBuild').value.trim(),format,started_at:iso(),ended_at:null,result:null,notes:'',active_duration_ms:null});
    await save('matches',match);
    const game=stampBase({match_id:match.id,game_number:1,winner:null,who_started:'unknown',started_at:iso(),ended_at:null,final_my_points:null,final_opponent_points:null});
    await save('games',game);
    await Promise.all([setMeta('last_deck_id',deckId),setMeta('last_opp_legend_id',opp),setMeta('last_format',format)]);
    closeModal(); await refreshActive(); setScreen('play');
  };
}

async function openOnlineChoice(){
  showModal('Online play',`
    <div class="primary-actions"><button type="button" class="btn primary" id="startOnlineSession">Start timed online session</button><button type="button" class="btn" id="logOnlineOnly">Log a match without timer</button></div>`);
  $('#startOnlineSession').onclick=()=>{closeModal();openStartSession('online');};
  $('#logOnlineOnly').onclick=()=>{closeModal();openOnlineMatchModal(null);};
}

async function renderPlay(){
  const el=$('#screen-play'); await refreshActive();
  if(!state.activeSession){
    el.innerHTML=`<div class="hero"><h2>Ready when you are.</h2><p>Start a timed session, or log an online match after the fact.</p></div><div class="primary-actions"><button class="btn primary" id="playStartPaper">Start Paper Session</button><button class="btn" id="playStartOnline">Start Online Session</button><button class="btn ghost" id="playLogOnline">Log Online Match</button></div>`;
    $('#playStartPaper').onclick=()=>openStartSession('paper'); $('#playStartOnline').onclick=()=>openStartSession('online'); $('#playLogOnline').onclick=()=>openOnlineMatchModal(null); return;
  }
  if(state.activeSession.mode==='online') return renderOnlineSession(el);
  if(state.activeMatch && state.activeGame) return renderScorekeeper(el);
  return renderSessionHub(el);
}

async function renderSessionHub(el){
  const s=state.activeSession;
  const sessionMatches=(await byIndex('matches','session_id',s.id)).filter(m=>m.ended_at);
  const {deckMap,legendMap}=await lookups();
  el.innerHTML=`
    <div class="session-strip"><div><div class="strong">${esc(s.event_name||titleCase(s.context))}</div><div class="small muted">Paper • ${s.status==='paused'?'Paused':'Active'}</div></div><div class="time" id="hubTimer">${fmtDuration(sessionActiveMs(s))}</div></div>
    <div class="hero"><h2>${sessionMatches.length} match${sessionMatches.length===1?'':'es'} logged</h2><p>Keep the same session running and switch decks freely between matches.</p></div>
    <div class="primary-actions"><button class="btn primary" id="hubNewMatch">New Match</button><button class="btn" id="hubPause">${s.status==='paused'?'Resume Session':'Pause Session'}</button><button class="btn danger" id="hubEnd">End Session</button></div>
    <div class="section-head"><h3>This session</h3><div class="sub">${fmtHours(sessionActiveMs(s))} active</div></div>
    <div class="list">${sessionMatches.length?sessionMatches.slice().reverse().map(m=>`<div class="list-item"><div><div class="title">${esc(deckMap[m.my_deck_id]?.name||'Deck')} vs ${esc(legendMap[m.opponent_legend_id]?.name||'Unknown')}</div><div class="meta">${titleCase(m.format)} • ${fmtDuration(m.active_duration_ms||0)}</div></div><span class="chip ${m.result==='me'?'good':m.result==='opponent'?'warn':''}">${m.result==='me'?'W':m.result==='opponent'?'L':'—'}</span></div>`).join(''):`<div class="empty">No completed matches yet.</div>`}</div>`;
  $('#hubNewMatch').onclick=()=>openMatchSetup(s); $('#hubPause').onclick=togglePause; $('#hubEnd').onclick=endCurrentSession;
}

async function togglePause(){
  const s=await get('sessions',state.activeSession.id); if(!s) return;
  if(s.status==='active'){
    s.status='paused'; s.paused_at=iso(); s.pause_intervals=[...(s.pause_intervals||[]),{started_at:s.paused_at,ended_at:null}]; toast('Session paused.');
  }else{
    const now=iso(); const arr=[...(s.pause_intervals||[])]; if(arr.length && !arr[arr.length-1].ended_at) arr[arr.length-1].ended_at=now;
    s.pause_intervals=arr; s.status='active'; s.paused_at=null; toast('Session resumed.');
  }
  await save('sessions',s); await refreshActive(); renderPlay();
}

async function endCurrentSession(){
  const s=state.activeSession; if(!s) return;
  if(state.activeMatch) return toast('Finish or abandon the current match first.');
  confirmModal('End session',`End this ${s.mode} session at ${fmtHours(sessionActiveMs(s))} active time?`,async()=>{
    const row=await get('sessions',s.id); const end=iso();
    if(row.status==='paused' && row.pause_intervals?.length && !row.pause_intervals.at(-1).ended_at) row.pause_intervals[row.pause_intervals.length-1].ended_at=end;
    row.ended_at=end; row.active_play_ms=sessionActiveMs(row,ms(end)); row.status='completed'; row.paused_at=null;
    await save('sessions',row); await refreshActive(); setScreen('home'); toast('Session saved.');
  },'End session');
}

async function scoreForGame(gameId){
  const events=(await byIndex('pointEvents','game_id',gameId)).sort((a,b)=>ms(a.timestamp)-ms(b.timestamp));
  let me=0,opp=0; for(const e of events){ if(e.side==='me') me+=Number(e.amount)||0; else opp+=Number(e.amount)||0; }
  return {me,opp,events};
}

async function matchGameRecord(matchId){
  const games=(await byIndex('games','match_id',matchId)).filter(g=>g.ended_at).sort((a,b)=>a.game_number-b.game_number);
  let me=0,opp=0; for(const g of games){ if(g.winner==='me') me++; else if(g.winner==='opponent') opp++; }
  return {games,me,opp};
}

async function renderScorekeeper(el){
  const [s,m,g]=[state.activeSession,state.activeMatch,state.activeGame];
  const {deckMap,legendMap}=await lookups();
  const deck=deckMap[m.my_deck_id], myLegend=legendMap[deck?.legend_id], oppLegend=legendMap[m.opponent_legend_id];
  const score=await scoreForGame(g.id); const rec=await matchGameRecord(m.id); const last=score.events.at(-1);
  el.innerHTML=`
    <div class="session-strip"><div><div class="strong">${esc(deck?.name||'Deck')} ${deck?.version?`• ${esc(deck.version)}`:''}</div><div class="small muted">${esc(myLegend?.name||'')} vs ${esc(oppLegend?.name||'')} • ${m.format==='FREE_PLAY'?'Free Play':m.format}</div></div><div><div class="time" id="liveSessionTimer">${fmtDuration(sessionActiveMs(s))}</div><div class="tiny muted" style="text-align:right">session</div></div></div>
    <div class="score-header"><div><div class="match-meta">Game ${g.game_number} • ${m.format==='FREE_PLAY'?`Games ${rec.me}–${rec.opp}`:`Match ${rec.me}–${rec.opp}`}</div><div class="timer" id="liveMatchTimer">${fmtDuration(Date.now()-ms(m.started_at))}</div></div><span class="chip ${s.status==='paused'?'warn':'accent'}">${s.status==='paused'?'PAUSED':'LIVE'}</span></div>
    <div class="score-board">
      <div class="score-side"><h3>YOU</h3><div class="score">${score.me}</div><div class="score-actions"><button class="conq scoreAdd" data-side="me" data-source="conquer">CONQ +1</button><button class="hold scoreAdd" data-side="me" data-source="hold">HOLD +1</button><button class="effect scoreEffect" data-side="me">EFFECT</button></div></div>
      <div class="score-side"><h3>OPPONENT</h3><div class="score">${score.opp}</div><div class="score-actions"><button class="conq scoreAdd" data-side="opponent" data-source="conquer">CONQ +1</button><button class="hold scoreAdd" data-side="opponent" data-source="hold">HOLD +1</button><button class="effect scoreEffect" data-side="opponent">EFFECT</button></div></div>
    </div>
    <div class="undo-bar"><div class="small">${last?`Last: ${last.side==='me'?'You':'Opponent'} ${last.amount>0?'+':''}${last.amount} • ${titleCase(last.source)}`:'No point events yet'}</div><button id="undoPoint" ${last?'':'disabled'}>Undo</button></div>
    <div class="section-head"><h3>Who started this game?</h3></div>
    <div class="segmented" id="starterSegment"><button data-starter="me" class="${g.who_started==='me'?'active':''}">Me</button><button data-starter="opponent" class="${g.who_started==='opponent'?'active':''}">Opponent</button><button data-starter="unknown" class="${g.who_started==='unknown'?'active':''}">Unknown</button></div>
    <div class="primary-actions"><button class="btn" id="quickNote">Quick Note</button><button class="btn" id="pauseLive">${s.status==='paused'?'Resume Session':'Pause Session'}</button></div>
    <div class="section-head"><h3>End game</h3><div class="sub">You decide when the game is over.</div></div>
    <div class="btn-row"><button class="btn good" id="gameWin">I Won Game</button><button class="btn danger" id="gameLoss">Opponent Won</button></div>
    ${m.format==='FREE_PLAY'?`<button class="btn ghost full" id="finishFree" style="margin-top:10px">Finish Free Play Match</button>`:''}
    <button class="link-btn small" id="abandonMatch" style="margin-top:18px;color:var(--danger)">Abandon current match</button>`;
  $$('.scoreAdd',el).forEach(b=>b.onclick=()=>addPoint(b.dataset.side,b.dataset.source,1));
  $$('.scoreEffect',el).forEach(b=>b.onclick=()=>openEffectModal(b.dataset.side));
  $('#undoPoint').onclick=undoPoint;
  $$('#starterSegment button',el).forEach(b=>b.onclick=()=>setStarter(b.dataset.starter));
  $('#quickNote').onclick=openQuickNote; $('#pauseLive').onclick=togglePause;
  $('#gameWin').onclick=()=>endGame('me'); $('#gameLoss').onclick=()=>endGame('opponent');
  if($('#finishFree')) $('#finishFree').onclick=()=>completeFreePlayMatch();
  $('#abandonMatch').onclick=abandonMatch;
  if(s.status==='paused') $$('.scoreAdd,.scoreEffect,#gameWin,#gameLoss',el).forEach(b=>b.disabled=true);
}

async function addPoint(side,source,amount,effect_note=''){
  if(!state.activeGame || state.activeSession?.status==='paused') return;
  const e=stampBase({game_id:state.activeGame.id,side,amount:Number(amount),source,effect_note,timestamp:iso()});
  await save('pointEvents',e); renderPlay();
}

function openEffectModal(side){
  showModal(`${side==='me'?'Your':'Opponent'} effect points`,`
    <label><span class="label-title">Points</span><input id="effectAmount" type="number" min="-20" max="20" step="1" value="1"></label>
    <label><span class="label-title">Effect / card <span class="muted">(optional)</span></span><input id="effectNote" placeholder="What generated the points?"></label>
    <button type="button" class="btn primary full" id="saveEffect">Add effect points</button>`);
  $('#saveEffect').onclick=async()=>{ let amt=parseInt($('#effectAmount').value,10); if(!Number.isFinite(amt)||amt===0) return toast('Enter a non-zero point amount.'); amt=Math.max(-20,Math.min(20,amt)); closeModal(); await addPoint(side,'effect',amt,$('#effectNote').value.trim()); };
}

async function undoPoint(){
  if(!state.activeGame) return; const events=(await byIndex('pointEvents','game_id',state.activeGame.id)).sort((a,b)=>ms(a.timestamp)-ms(b.timestamp)); const last=events.at(-1); if(!last) return;
  await softDelete('pointEvents',last.id); toast('Last point event undone.'); renderPlay();
}

async function setStarter(value){
  const g=await get('games',state.activeGame.id); g.who_started=value; await save('games',g); state.activeGame=g; renderPlay();
}

function openQuickNote(){
  showModal('Quick note',`<label><span class="label-title">What do you want to remember?</span><textarea id="quickNoteText" placeholder="Keep it fast. The match, game and score are attached automatically."></textarea></label><button type="button" class="btn primary full" id="saveQuickNote">Save note</button>`);
  $('#saveQuickNote').onclick=async()=>{const text=$('#quickNoteText').value.trim();if(!text)return toast('Write a note first.');const sc=await scoreForGame(state.activeGame.id);const n=stampBase({session_id:state.activeSession.id,match_id:state.activeMatch.id,game_id:state.activeGame.id,text,score_snapshot:`${sc.me}-${sc.opp}`,timestamp:iso()});await save('notes',n);closeModal();toast('Note saved.');};
}

async function endGame(winner){
  const g=await get('games',state.activeGame.id); const sc=await scoreForGame(g.id); const end=iso();
  g.winner=winner; g.ended_at=end; g.final_my_points=sc.me; g.final_opponent_points=sc.opp; await save('games',g);
  const m=await get('matches',state.activeMatch.id); const rec=await matchGameRecord(m.id);
  if(m.format==='FREE_PLAY'){
    const next=stampBase({match_id:m.id,game_number:g.game_number+1,winner:null,who_started:'unknown',started_at:iso(),ended_at:null,final_my_points:null,final_opponent_points:null}); await save('games',next); await refreshActive(); renderPlay(); toast(`Game ${g.game_number} saved.`); return;
  }
  const needed={BO1:1,BO3:2,BO5:3}[m.format]||1;
  if(rec.me>=needed||rec.opp>=needed){
    m.ended_at=end; m.result=rec.me>rec.opp?'me':'opponent'; m.active_duration_ms=intervalActiveMs(ms(m.started_at),ms(end),state.activeSession.pause_intervals||[]); await save('matches',m); await refreshActive(); openPostMatchReview(m.id); return;
  }
  const next=stampBase({match_id:m.id,game_number:g.game_number+1,winner:null,who_started:'unknown',started_at:iso(),ended_at:null,final_my_points:null,final_opponent_points:null}); await save('games',next); await refreshActive(); renderPlay(); toast(`Game ${g.game_number} saved.`);
}

async function completeFreePlayMatch(){
  const m=await get('matches',state.activeMatch.id); if(!m) return;
  const openGames=(await byIndex('games','match_id',m.id)).filter(g=>!g.ended_at);
  for(const g of openGames){ if(g.game_number>1 || (await byIndex('pointEvents','game_id',g.id)).length===0) await softDelete('games',g.id); }
  const rec=await matchGameRecord(m.id); m.ended_at=iso(); m.result=null; m.free_play_record=`${rec.me}-${rec.opp}`; m.active_duration_ms=intervalActiveMs(ms(m.started_at),ms(m.ended_at),state.activeSession.pause_intervals||[]); await save('matches',m); await refreshActive(); openPostMatchReview(m.id);
}

function openPostMatchReview(matchId){
  showModal('Match saved',`
    <p class="small muted">Optional 10-second review. Skip it if there is nothing useful to capture.</p>
    <label class="checkline"><input type="checkbox" id="reviewMulligan" style="width:auto;min-height:0"> Mulligan issue</label>
    <label><span class="label-title">Uncertain decision</span><input id="reviewDecision" placeholder="Optional"></label>
    <label><span class="label-title">Unexpected opponent action</span><input id="reviewUnexpected" placeholder="Optional"></label>
    <label><span class="label-title">General note</span><textarea id="reviewGeneral" placeholder="Optional"></textarea></label>
    <div class="btn-row"><button type="button" class="btn ghost" id="skipReview">Skip</button><button type="button" class="btn primary" id="saveReview">Save review</button></div>`);
  $('#skipReview').onclick=async()=>{closeModal();await refreshActive();renderPlay();};
