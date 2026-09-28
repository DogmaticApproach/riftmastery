Warning: truncated output (original token count: 23967)
Total output lines: 1045

import { openDB, all, get, put, byIndex, softDelete, clearAll, exportAll, stampBase, uid, getMeta, setMeta } from './db.js?v=0.4.6';

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
  deckFilters: {query:'',legend:''},
  statsScope: 'overall',
  notesQuery: '',
  globalSearch: '',
  wakeLock: null,
  wakeWanted: false
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
function toLocalInput(v){ if(!v)return ''; const d=new Date(v); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function optionOrder(items, preferred){ return [...items].sort((a,b)=>(a===preferred?-1:b===preferred?1:0)); }
function validateManualRecord(format,gw,gl){
  if(format==='FREE_PLAY') return null;
  const needed={BO1:1,BO3:2,BO5:3}[format]||1;
  if(Math.max(gw,gl)!==needed || Math.min(gw,gl)>=needed) return `${format} should end when one player reaches ${needed} game win${needed===1?'':'s'}.`;
  return null;
}
function applyFormatDefaults(format,gwInput,glInput){
  const defaults={BO1:[1,0],BO3:[2,1],BO5:[3,2],FREE_PLAY:[1,1]}[format]||[1,0];
  if(gwInput)gwInput.value=defaults[0]; if(glInput)glInput.value=defaults[1];
}
function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove('show'),1800); }
function markSaved(){ saveStatus.textContent='Saved on this device'; saveStatus.style.color='var(--good)'; }
function markSaving(){ saveStatus.textContent='Saving…'; saveStatus.style.color='var(--warn)'; }
async function save(store,row){ markSaving(); await put(store,row); markSaved(); window.dispatchEvent(new Event('riftmastery:localchange')); return row; }
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
  const titles={home:'Training Hall',play:'Train',decks:'Decks',history:'Review',stats:'Progress',more:'Journal & Lab'};
  $('#screenTitle').textContent=titles[name]||'RiftMastery';
  renderCurrent();
}

$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setScreen(b.dataset.nav)));

async function lookups(){
  const [legends,decks]=await Promise.all([all('legends'),all('decks',{includeDeleted:true})]);
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
  const [allMatches,allGames,blocks]=await Promise.all([all('matches'),all('games'),all('testingBlocks')]);
  const matches=allMatches.sort((a,b)=>ms(b.started_at)-ms(a.started_at)).slice(0,4);
  const active=state.activeSession;
  const activeBlock=blocks.filter(b=>b.status==='active').sort((a,b)=>ms(b.started_at||b.created_at)-ms(a.started_at||a.created_at))[0];
  const blockMatches=activeBlock?allMatches.filter(m=>m.testing_block_id===activeBlock.id&&m.ended_at):[];
  const blockMatchIds=new Set(blockMatches.map(m=>m.id));
  const blockGames=activeBlock?allGames.filter(g=>blockMatchIds.has(g.match_id)&&g.ended_at):[];
  const target=Math.max(1,Number(activeBlock?.target_games)||10),blockPct=activeBlock?Math.min(100,Math.round(blockGames.length/target*100)):0;
  const activeDeck=activeBlock?deckMap[activeBlock.deck_id]:null;
  const focusTitle=activeBlock?.name||'Compare before committing';
  const focusDescription=activeBlock?.hypothesis||'Evaluate the open board, name your role, compare two viable lines, then update the opponent’s range when new information appears.';
  el.innerHTML=`
    <section class="hero">
      <div class="hero-copy"><div class="hero-kicker">Riftbound • Player development</div><h2>${active?'Your session is underway':'Build the edge.'}</h2><p>${active?`${titleCase(active.mode)} • ${titleCase(active.context)} • ${fmtDuration(sessionActiveMs(active))}`:'Train with intent. Review with honesty. Carry one lesson into the next game.'}</p></div>
      ${active?`<div class="session-strip"><div><div class="strong">${active.event_name?esc(active.event_name):titleCase(active.context)}</div><div class="small muted">${active.status==='paused'?'Paused':'Active'} • ${titleCase(active.mode)}</div></div><div class="time">${fmtDuration(sessionActiveMs(active))}</div></div>`:''}
      <div class="primary-actions">
        <button class="btn primary" id="homePaper">${active?.mode==='paper'?'Resume Paper Session':'Start Paper Session'}</button>
        <button class="btn" id="homeOnline">${active?.mode==='online'?'Resume Online Session':'Log Online Match'}</button>
      </div>
    </section>
    <div class="section-head"><div><h3>Your development</h3><div class="sub">Progress is built through deliberate reps.</div></div></div>
    <div class="grid-2">
      <div class="card stat-card"><div class="k">Active development</div><div class="v">${fmtHours(s.total)}</div></div>
      <div class="card stat-card"><div class="k">Formal record</div><div class="v">${s.wins}–${s.losses}</div></div>
      <div class="card stat-card"><div class="k">Matches</div><div class="v">${s.matches}</div></div>
      <div class="card stat-card"><div class="k">Games</div><div class="v">${s.games}</div></div>
    </div>
    <section class="focus-panel">
      <div class="focus-topline"><div class="focus-kicker">${activeBlock?'Active testing block':'Today’s development focus'}</div><span class="focus-mark" aria-hidden="true">✦</span></div>
      <h3>${esc(focusTitle)}</h3>
      <p>${esc(focusDescription)}</p>
      ${activeBlock?`<div class="focus-meta"><span>${esc(activeDeck?.name||'Deck not found')}</span><span>${blockGames.length} / ${target} games</span></div><div class="focus-progress" role="progressbar" aria-label="Testing block progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(blockGames.length,target)}"><span style="width:${blockPct}%"></span></div>`:`<div class="focus-steps"><span>Read the board</span><b>›</b><span>Compare lines</span><b>›</b><span>Update the range</span></div>`}
      <button class="focus-link" id="homeLab">${activeBlock?'Review your training block':'Open the Development Lab'} <span aria-hidden="true">↗</span></button>
    </section>
    <div class="section-head"><h3>Recent activity</h3><button class="link-btn small" id="goHistory">View all</button></div>
    <div class="list">${matches.length?matches.map(m=>{
      const d=deckMap[m.my_deck_id], l=legendMap[m.opponent_legend_id];
      const result=m.result==='me'?'W':m.result==='opponent'?'L':'—';
      return `<div class="list-item"><div><div class="title">${esc(d?.name||'Unknown deck')} <span class="muted">vs</span> ${esc(l?.name||'Unknown')}</div><div class="meta">${titleCase(m.format)} • ${titleCase(m.mode||'paper')} • ${fmtDate(m.started_at)}</div></div><div class="right"><span class="chip ${result==='W'?'good':result==='L'?'warn':''}">${result}</span></div></div>`;
    }).join(''):`<div class="empty">No matches yet. Create a deck, then start your first session.</div>`}</div>`;
  $('#homePaper').onclick=()=>{ if(active?.mode==='paper') setScreen('play'); else openStartSession('paper'); };
  $('#homeOnline').onclick=()=>{ if(active?.mode==='online') setScreen('play'); else openOnlineChoice(); };
  $('#homeLab').onclick=()=>document.querySelector('.nav-item[data-nav="more"]')?.click();
  $('#goHistory').onclick=()=>setScreen('history');
}

async function renderDecks(){
  const el=$('#screen-decks');
  const {legends,decks,legendMap}=await lookups();
  const q=(state.deckFilters.query||'').toLowerCase().trim();
  const legendFilter=state.deckFilters.legend||'';
  const activeDecks=decks.filter(d=>!d.deleted_at&&!d.archived).filter(d=>{
    if(legendFilter && d.legend_id!==legendFilter) return false;
    if(!q) return true;
    const hay=[d.name,d.version,d.notes,legendMap[d.legend_id]?.name].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||(ms(b.last_used_at)-ms(a.last_used_at))||((legendMap[a.legend_id]?.name||'').localeCompare(legendMap[b.legend_id]?.name||''))||a.name.localeCompare(b.name));
  const archived=decks.filter(d=>!d.deleted_at&&d.archived);
  el.innerHTML=`
    <div class='section-head'><div><h2>Your decks</h2><div class='sub'>Pin current builds, branch versions, and keep historical results separated.</div></div><div class='btn-row' style='flex:0 0 auto'><button class='btn small ghost' id='importDeck'>Import</button><button class='btn small primary' id='newDeck'>+ Deck</button></div></div>
    <div class='grid-2' style='margin-bottom:10px'><input id='deckSearch' placeholder='Search decks' value='${esc(state.deckFilters.query||'')}'><select id='deckLegendFilter'><option value=''>All Legends</option>${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value='${l.id}' ${legendFilter===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></div>
    <div class='list'>${activeDecks.length?activeDecks.map(d=>`<div class='list-item deck-library-item'><div style='min-width:0;flex:1'><div class='title'>${d.pinned?'★ ':''}${esc(d.name)} ${d.version?`<span class='chip'>${esc(d.version)}</span>`:''}</div><div class='meta'>${esc(legendMap[d.legend_id]?.name||'Unknown Legend')}${d.parent_deck_id?' • versioned':''}${d.deck_list?` • ${d.deck_list.split(/\n/).filter(Boolean).length} list lines`:''}${d.notes?` • ${esc(d.notes)}`:''}</div><div class='deck-action-row'><button class='btn small ghost deckView' data-id='${d.id}'>View list</button><button class='btn small ghost deckPin' data-id='${d.id}'>${d.pinned?'Unpin':'Pin'}</button><button class='btn small ghost deckDuplicate' data-id='${d.id}'>Duplicate</button><button class='btn small deckVersion' data-id='${d.id}'>New version</button><button class='btn small ghost deckEdit' data-id='${d.id}'>Edit</button><button class='btn small danger deckDelete' data-id='${d.id}'>Delete</button></div></div></div>`).join(''):`<div class='empty'>No decks match this filter.</div>`}</div>
    ${archived.length?`<div class='section-head'><h3>Archived</h3></div><div class='list'>${archived.map(d=>`<div class='list-item'><div><div class='title'>${esc(d.name)} ${d.version?`<span class='chip'>${esc(d.version)}</span>`:''}</div><div class='meta'>${esc(legendMap[d.legend_id]?.name||'Unknown')}</div></div><button class='btn small ghost deckRestore' data-id='${d.id}'>Restore</button></div>`).join('')}</div>`:''}`;
  $('#importDeck').onclick=()=>openDeckImportModal();
  $('#newDeck').onclick=()=>openDeckModal();
  $('#deckSearch').oninput=e=>{const pos=e.target.selectionStart;state.deckFilters.query=e.target.value;clearTimeout(state._deckSearchTimer);state._deckSearchTimer=setTimeout(async()=>{await renderDecks();const n=$('#deckSearch');if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch{}}},140);};
  $('#deckLegendFilter').onchange=e=>{state.deckFilters.legend=e.target.value;renderDecks();};
  $$('.deckView',el).forEach(b=>b.onclick=()=>openDeckViewModal(b.dataset.id));
  $$('.deckPin',el).forEach(b=>b.onclick=()=>toggleDeckPin(b.dataset.id));
  $$('.deckDuplicate',el).forEach(b=>b.onclick=()=>openDuplicateDeckModal(b.dataset.id));
  $$('.deckEdit',el).forEach(b=>b.onclick=()=>openDeckModal(b.dataset.id));
  $$('.deckVersion',el).forEach(b=>b.onclick=()=>openDeckVersionModal(b.dataset.id));
  $$('.deckDelete',el).forEach(b=>b.onclick=()=>deleteDeck(b.dataset.id));
  $$('.deckRestore',el).forEach(b=>b.onclick=async()=>{ const d=await get('decks',b.dataset.id); d.archived=false; await save('decks',d); renderDecks(); });
}
async function deleteDeck(id){
  const deck=await get('decks',id);
  if(!deck) return;
  if(state.activeMatch?.my_deck_id===id) return toast('Finish or abandon the current match before deleting this deck.');
  const used=(await all('matches')).filter(m=>m.my_deck_id===id).length;
  const message=used
    ? 'Delete '+deck.name+' from your active deck library? Its '+used+' historical match'+(used===1?'':'es')+' will stay intact in History and Stats.'
    : 'Delete '+deck.name+'? This removes it from your deck library.';
  confirmModal('Delete deck',message,async()=>{
    await softDelete('decks',id);
    if((await getMeta('last_deck_id',''))===id) await setMeta('last_deck_id','');
    await renderDecks();
    toast('Deck deleted.');
  },'Delete deck');
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); }
  catch{
    showModal('Copy deck list',`<label><span class='label-title'>Select and copy</span><textarea rows='14' readonly id='copyFallback'>${esc(text)}</textarea></label>`);
    setTimeout(()=>{const t=$('#copyFallback');if(t){t.focus();t.select();}},50);
  }
}

function diffDeckLists(previous,current){
  const clean=t=>(t||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const a=clean(previous), b=clean(current);
  const count=list=>{const m=new Map();for(const line of list)m.set(line,(m.get(line)||0)+1);return m;};
  const am=count(a), bm=count(b), added=[], removed=[];
  for(const [line,n] of bm){const d=n-(am.get(line)||0);for(let i=0;i<d;i++)added.push(line);}
  for(const [line,n] of am){const d=n-(bm.get(line)||0);for(let i=0;i<d;i++)removed.push(line);}
  return {added,removed};
}

async function openDeckViewModal(id){
  const deck=await get('decks',id); if(!deck)return;
  const {legendMap}=await lookups();
  let parent=null; if(deck.parent_deck_id) parent=await get('decks',deck.parent_deck_id);
  showModal(deck.name+(deck.version?' • '+deck.version:''),`
    <div class='btn-row' style='margin-bottom:10px'><span class='chip'>${esc(legendMap[deck.legend_id]?.name||'Unknown Legend')}</span>${deck.pinned?`<span class='chip accent'>Pinned</span>`:''}${deck.import_source?`<span class='chip'>Imported: ${esc(titleCase(deck.import_source))}</span>`:''}</div>
    ${parent?`<div class='small muted' style='margin-bottom:10px'>Version lineage: ${esc(parent.name)} ${esc(parent.version||'previous')} → ${esc(deck.version||'current')}</div>`:''}
    <label><span class='label-title'>Deck list</span><textarea rows='16' readonly id='viewDeckList'>${esc(deck.deck_list||'No deck list saved.')}</textarea></label>
    ${deck.notes?`<div class='note'>${esc(deck.notes)}</div>`:''}
    <div class='btn-row' style='margin-top:10px'><button type='button' class='btn primary' id='copyDeckList'>Copy list</button>${parent?`<button type='button' class='btn' id='comparePrevious'>Compare previous</button>`:''}<button type='button' class='btn ghost' id='editFromView'>Edit</button></div>`);
  $('#copyDeckList').onclick=()=>copyText(deck.deck_list||'');
  $('#editFromView').onclick=()=>{closeModal();openDeckModal(id);};
  if(parent) $('#comparePrevious').onclick=()=>openDeckComparison(parent,deck);
}

function openDeckComparison(previous,current){
  const diff=diffDeckLists(previous.deck_list,current.deck_list);
  showModal('Version comparison',`
    <p class='small muted'>${esc(previous.name)} ${esc(previous.version||'previous')} → ${esc(current.version||'current')}</p>
    <div class='grid-2'><div class='card'><div class='strong'>Added</div><div class='small' style='white-space:pre-wrap;margin-top:8px'>${diff.added.length?diff.added.map(x=>'+ '+esc(x)).join('\n'):'No added lines'}</div></div><div class='card'><div class='strong'>Removed</div><div class='small' style='white-space:pre-wrap;margin-top:8px'>${diff.removed.length?diff.removed.map(x=>'− '+esc(x)).join('\n'):'No removed lines'}</div></div></div>`);
}

async function toggleDeckPin(id){
  const deck=await get('decks',id); if(!deck)return;
  deck.pinned=!deck.pinned; await save('decks',deck); await renderDecks(); toast(deck.pinned?'Deck pinned.':'Deck unpinned.');
}

async function openDuplicateDeckModal(id){
  const old=await get('decks',id); if(!old)return;
  showModal('Duplicate deck',`
    <p class='small muted'>Create a separate experiment from this list without linking it as the next version.</p>
    <label><span class='label-title'>Deck name</span><input id='dupDeckName' value='${esc(old.name)} copy'></label>
    <label><span class='label-title'>Version <span class='muted'>(optional)</span></span><input id='dupDeckVersion' value='${esc(old.version||'')}'></label>
    <label><span class='label-title'>Deck list</span><textarea id='dupDeckList' rows='12'>${esc(old.deck_list||'')}</textarea></label>
    <label><span class='label-title'>Notes</span><textarea id='dupDeckNotes'>${esc(old.notes||'')}</textarea></label>
    <button type='button' class='btn primary full' id='saveDuplicateDeck'>Create duplicate</button>`);
  $('#saveDuplicateDeck').onclick=async()=>{
    const name=$('#dupDeckName').value.trim();if(!name)return toast('Give the duplicate a name.');
    const row=stampBase({name,legend_id:old.legend_id,version:$('#dupDeckVersion').value.trim(),deck_list:$('#dupDeckList').value.trim(),notes:$('#dupDeckNotes').value.trim(),archived:false,pinned:false,forked_from_deck_id:old.id});
    await save('decks',row);await setMeta('last_deck_id',row.id);closeModal();renderDecks();toast('Deck duplicated.');
  };
}
function detectLegendFromImportedText(text, legends){
  const hay=(text||'').toLowerCase();
  const matches=legends.filter(l=>!l.archived && hay.includes(l.name.toLowerCase())).sort((a,b)=>b.name.length-a.name.length);
  return matches[0]?.id||'';
}

async function decodeCompactDeckCodeToText(code){
  const mod=await import('https://cdn.jsdelivr.net/npm/@piltoverarchive/riftbound-deck-codes@1.5.0/+esm');
  const decoded=mod.getDeckFromCode(code);
  const lines=[];
  if(decoded.chosenChampion){ lines.push('Champion'); lines.push('1 '+decoded.chosenChampion); lines.push(''); }
  if(decoded.additionalLegends?.length){ lines.push('Additional Legends'); for(const cardCode of decoded.additionalLegends) lines.push('1 '+cardCode); lines.push(''); }
  lines.push('Main Deck');
  for(const card of (decoded.mainDeck||[])) lines.push(card.count+' '+card.cardCode);
  if(decoded.sideboard?.length){ lines.push(''); lines.push('Sideboard'); for(const card of decoded.sideboard) lines.push(card.count+' '+card.cardCode); }
  return lines.join('\n');
}
async function openDeckImportModal(){
  const data=await lookups();
  const legends=data.legends;
  const activeLegends=legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name));
  let options='<option value="">Select Legend…</option>';
  for(const l of activeLegends) options+='<option value="'+l.id+'">'+esc(l.name)+'</option>';
  const html=
    '<label><span class="label-title">Import from</span><select id="deckImportSource">'+
      '<option value="riftatlas">Rift Atlas</option>'+
      '<option value="riftdecks">RiftDecks</option>'+
      '<option value="piltover">Piltover Archive</option>'+
    '</select></label>'+
    '<div class="card" id="deckImportHelp" style="margin-bottom:12px"></div>'+
    '<label><span class="label-title">Deck export / code</span><textarea id="deckImportRaw" rows="13" placeholder="Paste the deck list or deck code from the selected site."></textarea></label>'+
    '<label><span class="label-title">Deck name</span><input id="deckImportName" placeholder="e.g. Radiance Control"></label>'+
    '<label><span class="label-title">Version <span class="muted">(optional)</span></span><input id="deckImportVersion" placeholder="e.g. v1, Sep 27"></label>'+
    '<label><span class="label-title">My Legend</span><select id="deckImportLegend">'+options+'</select></label>'+
    '<div class="small muted" id="deckImportStatus"></div>'+
    '<button type="button" class="btn primary full" id="doDeckImport">Import deck</button>';
  showModal('Import deck',html);

  const renderHelp=()=>{
    const source=$('#deckImportSource').value;
    const help={
      riftatlas:'Paste the exported deck text or compact deck code from Rift Atlas.',
      riftdecks:'Use RiftDecks → Text Decklist / Export this Deck, then paste the exported text here.',
      piltover:'Paste a Piltover Archive text export, deck code, or a deckbuilder link containing ?code=…'
    };
    $('#deckImportHelp').innerHTML='<div class="small">'+help[source]+'</div>';
  };
  renderHelp();
  $('#deckImportSource').onchange=renderHelp;

  $('#deckImportRaw').oninput=()=>{
    const raw=$('#deckImportRaw').value;
    const detected=detectLegendFromImportedText(raw,legends);
    if(detected && !$('#deckImportLegend').value){
      $('#deckImportLegend').value=detected;
      $('#deckImportStatus').textContent='Legend detected from the pasted deck list.';
    }
  };

  $('#doDeckImport').onclick=async()=>{
    const source=$('#deckImportSource').value;
    const raw=$('#deckImportRaw').value.trim();
    const name=$('#deckImportName').value.trim();
    let legendId=$('#deckImportLegend').value;
    if(!raw) return toast('Paste a deck export or deck code.');
    if(!name) return toast('Give the imported deck a name.');
    if(!legendId) legendId=detectLegendFromImportedText(raw,legends);
    if(!legendId) return toast('Choose the Legend for this deck.');

    let deckList=raw;
    let sourceUrl='';
    let compactCode='';
    if(/^https?:\/\//i.test(raw)){
      sourceUrl=raw;
      try{
        const u=new URL(raw);
        compactCode=(u.searchParams.get('code')||'').trim();
        if(!compactCode) return toast('That link has no embedded deck code. Use the site export and paste the text here.');
      }catch{ return toast('That link could not be read.'); }
    }else{
      const squeezed=raw.replace(/\s+/g,'');
      if(squeezed.length>30 && /^[A-Z2-7]+$/i.test(squeezed)) compactCode=squeezed.toUpperCase();
    }
    if(compactCode){
      $('#deckImportStatus').textContent='Decoding compact deck code…';
      try{
        deckList=await decodeCompactDeckCodeToText(compactCode);
      }catch(err){
        console.error(err);
        return toast('Could not decode that deck code. Paste the text export instead.');
      }
    }

    const row=stampBase({
      legend_id:legendId,
      name:name,
      version:$('#deckImportVersion').value.trim(),
      deck_list:deckList,
      notes:'',
      archived:false,
      import_source:source,
      import_raw:raw,
      import_url:sourceUrl
    });
    await save('decks',row);
    await setMeta('last_deck_id',row.id);
    closeModal();
    renderDecks();
    toast('Deck imported from '+(source==='riftatlas'?'Rift Atlas':source==='riftdecks'?'RiftDecks':'Piltover Archive')+'.');
  };
}
async function openDeckModal(id=null){
  const {legends}=await lookups();
  const deck=id?await get('decks',id):null;
  showModal(deck?'Edit deck':'Add deck',`
    <label><span class="label-title">Legend</span><select id="deckLegend">${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value="${l.id}" ${deck?.legend_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class="label-title">Deck name</span><input id="deckName" value="${esc(deck?.name||'')}" placeholder="e.g. Radiance Control"></label>
    <label><span class="label-title">Version</span><input id="deckVersion" value="${esc(deck?.version||'')}" placeholder="e.g. v1, LA list, Sep 27"></label>
    <label><span class="label-title">Deck list <span class="muted">(paste the full list)</span></span><textarea id="deckList" rows="12" placeholder="Paste your deck list here exactly as exported from your deck builder or client.">${esc(deck?.deck_list||'')}</textarea></label>\n    <label><span class="label-title">Notes <span class="muted">(optional)</span></span><textarea id="deckNotes" placeholder="What makes this version different?">${esc(deck?.notes||'')}</textarea></label>
    <div class="btn-row">${deck?`<button type="button" class="btn danger" id="archiveDeck">Archive</button>`:''}<button type="button" class="btn primary" id="saveDeck">Save deck</button></div>`);
  $('#saveDeck').onclick=async()=>{
    const name=$('#deckName').value.trim(); if(!name) return toast('Give the deck a name.');
    const row=deck||stampBase({});
    Object.assign(row,{legend_id:$('#deckLegend').value,name,version:$('#deckVersion').value.trim(),deck_list:$('#deckList').value.trim(),notes:$('#deckNotes').value.trim(),archived:false});
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
    <label><span class="label-title">Deck list</span><textarea id="newVersionList" rows="12" placeholder="Paste or edit the full list for this version.">${esc(old.deck_list||'')}</textarea></label>\n    <label><span class="label-title">Notes</span><textarea id="newVersionNotes">${esc(old.notes||'')}</textarea></label>
    <button type="button" class="btn primary full" id="createVersion">Create version</button>`);
  $('#createVersion').onclick=async()=>{
    const version=$('#newVersionLabel').value.trim(); if(!version) return toast('Add a version label.');
    const row=stampBase({name:$('#newVersionName').value.trim()||old.name,legend_id:old.legend_id,version,deck_list:$('#newVersionList').value.trim(),notes:$('#newVersionNotes').value.trim(),archived:false,parent_deck_id:old.id});
    await save('decks',row); await setMeta('last_deck_id',row.id); closeModal(); renderDecks(); toast('New version created.');
  };
}

async function updateRecentOpponent(id){
  const recent=await getMeta('recent_opponents',[]);
  const next=[id,...recent.filter(x=>x!==id)].slice(0,8);
  await setMeta('recent_opponents',next);
}

function orderDeckChoices(decks,preferred){
  return [...decks].sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||(a.id===preferred?-1:b.id===preferred?1:0)||(ms(b.last_used_at)-ms(a.last_used_at))||a.name.localeCompare(b.name));
}

function orderOpponentChoices(legends,preferred,recent=[]){
  const rank=id=>id===preferred?-100:(recent.indexOf(id)>=0?recent.indexOf(id):999);
  return [...legends].sort((a,b)=>rank(a.id)-rank(b.id)||a.name.localeCompare(b.name));
}

async function createLiveMatch(session,setup){
  const started=setup.started_at||iso();
  const match=stampBase({session_id:session.id,mode:session.mode,context:session.context,my_deck_id:setup.my_deck_id,opponent_legend_id:setup.opponent_legend_id,opponent_build:setup.opponent_build||'',format:setup.format||'BO3',started_at:started,ended_at:null,result:null,notes:'',active_duration_ms:null});
  await save('matches',match);
  const game=stampBase({match_id:match.id,game_number:1,winner:null,who_started:'unknown',started_at:started,ended_at:null,final_my_points:null,final_opponent_points:null});
  await save('games',game);
  const deck=await get('decks',setup.my_deck_id); if(deck){deck.last_used_at=started;await …7967 tokens truncated…(0,parseInt($('#onlineGW').value||'0',10)); const gl=Math.max(0,parseInt($('#onlineGL').value||'0',10)); const recordError=validateManualRecord(format,gw,gl); if(recordError)return toast(recordError);
    let sess=session; let started=iso(), ended=iso(), durationMin=0;
    if(!sess){
      durationMin=Math.max(0,parseInt($('#onlineDuration')?.value||'0',10));
      const chosen=new Date($('#onlineDate').value); if(Number.isNaN(chosen.getTime()))return toast('Choose a valid date.');
      started=chosen.toISOString(); ended=new Date(chosen.getTime()+durationMin*60000).toISOString();
      const context=$('#onlineContext').value; sess=stampBase({mode:'online',context,event_name:'',started_at:started,ended_at:ended,pause_intervals:[],paused_at:null,status:'completed',active_play_ms:durationMin*60000}); await save('sessions',sess); await setMeta('last_session_context_online',context);
    }
    const deckId=$('#onlineDeck').value, opp=$('#onlineOpp').value;
    const match=stampBase({session_id:sess.id,mode:'online',context:sess.context,my_deck_id:deckId,opponent_legend_id:opp,opponent_build:'',format,started_at:started,ended_at:ended,result:format==='FREE_PLAY'?null:(gw>gl?'me':'opponent'),free_play_record:format==='FREE_PLAY'?`${gw}-${gl}`:null,notes:$('#onlineMatchNotes').value.trim(),active_duration_ms:session?0:(durationMin*60000)}); await save('matches',match);
    let n=1; for(let i=0;i<gw;i++) await save('games',stampBase({match_id:match.id,game_number:n++,winner:'me',who_started:'unknown',started_at:started,ended_at:ended,final_my_points:null,final_opponent_points:null})); for(let i=0;i<gl;i++) await save('games',stampBase({match_id:match.id,game_number:n++,winner:'opponent',who_started:'unknown',started_at:started,ended_at:ended,final_my_points:null,final_opponent_points:null}));
    if(match.notes) await save('notes',stampBase({session_id:sess.id,match_id:match.id,game_id:null,text:match.notes,timestamp:started}));
    const deck=await get('decks',deckId);if(deck){deck.last_used_at=started;await save('decks',deck);}
    await Promise.all([setMeta('last_deck_id',deckId),setMeta('last_opp_legend_id',opp),setMeta('last_format',format),updateRecentOpponent(opp)]); closeModal(); await refreshActive(); if(state.screen==='play')renderPlay(); toast('Online match saved.');
  };
}
async function renderHistory(){
  const el=$('#screen-history'); const {legends,decks,legendMap,deckMap}=await lookups(); const sessions=await all('sessions'); const sessionMap=Object.fromEntries(sessions.map(s=>[s.id,s]));
  const f=state.historyFilters;
  let matches=(await all('matches')).sort((a,b)=>ms(b.started_at)-ms(a.started_at));
  matches=matches.filter(m=>{
    const d=deckMap[m.my_deck_id]; const sess=sessionMap[m.session_id];
    if(f.legend && d?.legend_id!==f.legend)return false; if(f.deck&&m.my_deck_id!==f.deck)return false; if(f.opp&&m.opponent_legend_id!==f.opp)return false; if(f.mode&&m.mode!==f.mode)return false; if(f.context&&(m.context||sess?.context)!==f.context)return false; if(f.format&&m.format!==f.format)return false; if(f.result&&m.result!==f.result)return false;
    if(f.from && ms(m.started_at)<new Date(`${f.from}T00:00:00`).getTime())return false; if(f.to && ms(m.started_at)>new Date(`${f.to}T23:59:59`).getTime())return false; return true;
  });
  el.innerHTML=`
    <div class="section-head"><div><h2>Match history</h2><div class="sub">${matches.length} matching record${matches.length===1?'':'s'}</div></div><div class="btn-row" style="flex:0 0 auto"><button class="btn small primary" id="logPastMatch">+ Past Match</button><button class="btn small ghost" id="toggleFilters">Filters</button></div></div>
    <div id="historyFilterBox" class="card filters" style="display:${f._open?'grid':'none'}">
      <div class="row"><select id="hfLegend"><option value="">My Legend — all</option>${legends.map(l=>`<option value="${l.id}" ${f.legend===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><select id="hfDeck"><option value="">My Deck — all</option>${decks.map(d=>`<option value="${d.id}" ${f.deck===d.id?'selected':''}>${esc(d.name)} ${esc(d.version||'')}${d.deleted_at?' (deleted)':''}</option>`).join('')}</select></div>
      <div class="row"><select id="hfOpp"><option value="">Opponent — all</option>${legends.map(l=>`<option value="${l.id}" ${f.opp===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><select id="hfMode"><option value="">Paper/Online — all</option><option value="paper" ${f.mode==='paper'?'selected':''}>Paper</option><option value="online" ${f.mode==='online'?'selected':''}>Online</option></select></div>
      <div class="row"><select id="hfContext"><option value="">Context — all</option>${['testing','local','tournament','online_ranked','casual'].map(x=>`<option value="${x}" ${f.context===x?'selected':''}>${titleCase(x)}</option>`).join('')}</select><select id="hfFormat"><option value="">Format — all</option>${['BO1','BO3','BO5','FREE_PLAY'].map(x=>`<option value="${x}" ${f.format===x?'selected':''}>${x==='FREE_PLAY'?'Free Play':x}</option>`).join('')}</select></div>
      <div class="row"><select id="hfResult"><option value="">Result — all</option><option value="me" ${f.result==='me'?'selected':''}>Win</option><option value="opponent" ${f.result==='opponent'?'selected':''}>Loss</option></select><button class="btn small ghost" id="clearFilters">Clear</button></div>
      <div class="row"><label><span class="label-title">From</span><input id="hfFrom" type="date" value="${esc(f.from||'')}"></label><label><span class="label-title">To</span><input id="hfTo" type="date" value="${esc(f.to||'')}"></label></div>
    </div>
    <div class="list" style="margin-top:10px">${matches.length?matches.map(m=>{const d=deckMap[m.my_deck_id],opp=legendMap[m.opponent_legend_id];const result=m.result==='me'?'W':m.result==='opponent'?'L':m.format==='FREE_PLAY'?(m.free_play_record||'FP'):'—';return `<button class="list-item historyOpen" data-id="${m.id}" style="width:100%;text-align:left;color:inherit"><div><div class="title">${esc(d?.name||'Unknown')} ${d?.version?`<span class="chip">${esc(d.version)}</span>`:''} <span class="muted">vs</span> ${esc(opp?.name||'Unknown')}</div><div class="meta">${titleCase(m.mode||'paper')} • ${titleCase(m.context||sessionMap[m.session_id]?.context||'')} • ${m.format==='FREE_PLAY'?'Free Play':m.format} • ${fmtDate(m.started_at)}</div></div><div class="right"><span class="chip ${result==='W'?'good':result==='L'?'warn':''}">${result}</span></div></button>`}).join(''):`<div class="empty">No matches match these filters.</div>`}</div>`;
  $('#logPastMatch').onclick=openPastMatchModal;
  $('#toggleFilters').onclick=()=>{state.historyFilters._open=!state.historyFilters._open;renderHistory();};
  ['Legend','Deck','Opp','Mode','Context','Format','Result'].forEach(key=>{const n=$(`#hf${key}`);if(n)n.onchange=()=>{state.historyFilters[key.toLowerCase()]=n.value;renderHistory();};});
  if($('#hfFrom')) $('#hfFrom').onchange=e=>{state.historyFilters.from=e.target.value;renderHistory();}; if($('#hfTo')) $('#hfTo').onchange=e=>{state.historyFilters.to=e.target.value;renderHistory();};
  if($('#clearFilters')) $('#clearFilters').onclick=()=>{state.historyFilters={_open:true};renderHistory();};
  $$('.historyOpen',el).forEach(b=>b.onclick=()=>openMatchDetail(b.dataset.id));
}

async function openPastMatchModal(){
  const {decks,legends,legendMap}=await lookups();
  const lastDeck=await getMeta('last_deck_id',''), lastOpp=await getMeta('last_opp_legend_id',''), lastFormat=await getMeta('last_format','BO3');
  const recentOpps=await getMeta('recent_opponents',[]);
  const activeDecks=orderDeckChoices(decks.filter(d=>!d.deleted_at&&!d.archived),lastDeck);
  if(!activeDecks.length){toast('Create a deck first.');setScreen('decks');return;}
  const oppChoices=orderOpponentChoices(legends.filter(l=>!l.archived),lastOpp,recentOpps);
  const formats=optionOrder(['BO1','BO3','BO5','FREE_PLAY'],lastFormat);
  const defaultDate=toLocalInput(new Date());
  showModal('Log past match',`
    <div class='grid-2'><label><span class='label-title'>Mode</span><select id='pastMode'><option value='paper'>Paper</option><option value='online'>Online</option></select></label><label><span class='label-title'>Context</span><select id='pastContext'><option value='testing'>Testing</option><option value='local'>Local</option><option value='tournament'>Tournament</option><option value='online_ranked'>Online Ranked</option><option value='casual'>Casual</option></select></label></div>
    <label><span class='label-title'>Date & time</span><input id='pastDate' type='datetime-local' value='${defaultDate}'></label>
    <label><span class='label-title'>My deck</span><select id='pastDeck'>${activeDecks.map(d=>`<option value='${d.id}'>${d.pinned?'★ ':''}${esc(legendMap[d.legend_id]?.name||'')} — ${esc(d.name)}${d.version?` (${esc(d.version)})`:''}</option>`).join('')}</select></label>
    <label><span class='label-title'>Opponent Legend</span><select id='pastOpp'>${oppChoices.map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Format</span><select id='pastFormat'>${formats.map(x=>`<option value='${x}'>${x==='FREE_PLAY'?'Free Play':x}</option>`).join('')}</select></label>
    <div class='grid-2'><label><span class='label-title'>Games won</span><input id='pastGW' type='number' min='0' max='20' value='2'></label><label><span class='label-title'>Games lost</span><input id='pastGL' type='number' min='0' max='20' value='1'></label></div>
    <label><span class='label-title'>Active duration (minutes)</span><input id='pastDuration' type='number' min='0' max='600' value='35'></label>
    <label><span class='label-title'>Notes <span class='muted'>(optional)</span></span><textarea id='pastNotes'></textarea></label>
    <button type='button' class='btn primary full' id='savePastMatch'>Save past match</button>`);
  $('#pastFormat').onchange=()=>applyFormatDefaults($('#pastFormat').value,$('#pastGW'),$('#pastGL'));
  $('#pastMode').onchange=()=>{if($('#pastMode').value==='online'&&['local'].includes($('#pastContext').value))$('#pastContext').value='online_ranked';if($('#pastMode').value==='paper'&&$('#pastContext').value==='online_ranked')$('#pastContext').value='testing';};
  applyFormatDefaults($('#pastFormat').value,$('#pastGW'),$('#pastGL'));
  $('#savePastMatch').onclick=async()=>{
    const format=$('#pastFormat').value, gw=Math.max(0,parseInt($('#pastGW').value||'0',10)), gl=Math.max(0,parseInt($('#pastGL').value||'0',10));
    const recordError=validateManualRecord(format,gw,gl); if(recordError)return toast(recordError);
    const startValue=$('#pastDate').value; if(!startValue)return toast('Choose the date and time.');
    const start=new Date(startValue); if(Number.isNaN(start.getTime()))return toast('Invalid date.');
    const duration=Math.max(0,parseInt($('#pastDuration').value||'0',10))*60000; const end=new Date(start.getTime()+duration).toISOString(); const started=start.toISOString();
    const mode=$('#pastMode').value, context=$('#pastContext').value, deckId=$('#pastDeck').value, opp=$('#pastOpp').value;
    const session=stampBase({mode,context,event_name:'Backdated match',started_at:started,ended_at:end,pause_intervals:[],paused_at:null,status:'completed',active_play_ms:duration}); await save('sessions',session);
    const match=stampBase({session_id:session.id,mode,context,my_deck_id:deckId,opponent_legend_id:opp,opponent_build:'',format,started_at:started,ended_at:end,result:format==='FREE_PLAY'?null:(gw>gl?'me':'opponent'),free_play_record:format==='FREE_PLAY'?`${gw}-${gl}`:null,notes:$('#pastNotes').value.trim(),active_duration_ms:duration}); await save('matches',match);
    let n=1;for(let i=0;i<gw;i++)await save('games',stampBase({match_id:match.id,game_number:n++,winner:'me',who_started:'unknown',started_at:started,ended_at:end,final_my_points:null,final_opponent_points:null}));for(let i=0;i<gl;i++)await save('games',stampBase({match_id:match.id,game_number:n++,winner:'opponent',who_started:'unknown',started_at:started,ended_at:end,final_my_points:null,final_opponent_points:null}));
    if(match.notes)await save('notes',stampBase({session_id:session.id,match_id:match.id,game_id:null,text:match.notes,timestamp:started}));
    const deck=await get('decks',deckId);if(deck){deck.last_used_at=started;await save('decks',deck);}await Promise.all([setMeta('last_deck_id',deckId),setMeta('last_opp_legend_id',opp),setMeta('last_format',format),updateRecentOpponent(opp)]);
    closeModal();renderHistory();toast('Past match saved.');
  };
}
async function openMatchDetail(id){
  const m=await get('matches',id); if(!m)return; const {deckMap,legendMap}=await lookups(); const games=(await byIndex('games','match_id',id)).filter(g=>g.ended_at).sort((a,b)=>a.game_number-b.game_number); const notes=(await all('notes')).filter(n=>n.match_id===id); const deck=deckMap[m.my_deck_id],opp=legendMap[m.opponent_legend_id];
  let gameHtml=''; for(const g of games){ const ev=(await byIndex('pointEvents','game_id',g.id)).sort((a,b)=>ms(a.timestamp)-ms(b.timestamp)); gameHtml+=`<div class="match-detail-game"><div class="head"><span>Game ${g.game_number} • ${g.winner==='me'?'Win':'Loss'}</span><span>${g.final_my_points??'—'}–${g.final_opponent_points??'—'}</span></div><div class="small muted">Started by: ${titleCase(g.who_started||'unknown')}</div>${ev.length?`<div class="event-list">${ev.map(e=>`<div class="event-row"><span>${e.side==='me'?'You':'Opponent'} • ${titleCase(e.source)}${e.effect_note?` • ${esc(e.effect_note)}`:''}</span><span>${e.amount>0?'+':''}${e.amount}</span></div>`).join('')}</div>`:''}</div>`; }
  showModal(`${deck?.name||'Deck'} vs ${opp?.name||'Opponent'}`,`
    <div class="btn-row" style="margin-bottom:10px"><span class="chip">${m.format==='FREE_PLAY'?'Free Play':m.format}</span><span class="chip">${titleCase(m.mode||'')}</span><span class="chip">${titleCase(m.context||'')}</span></div>
    <div class="small muted">${fmtDate(m.started_at)} • ${fmtDuration(m.active_duration_ms||0)} tracked match time</div>
    ${m.opponent_build?`<p class="small"><strong>Opponent build:</strong> ${esc(m.opponent_build)}</p>`:''}
    ${gameHtml||'<div class="empty">No completed game detail.</div>'}
    ${notes.length?`<div class="section-head"><h3>Notes</h3></div>${notes.map(n=>`<div class="note">${esc(n.text)}<div class="context">${fmtDate(n.timestamp)}</div></div>`).join('')}`:''}
    <div class="divider"></div><div class="btn-row"><button type="button" class="btn ghost" id="editMatch">Edit</button><button type="button" class="btn danger" id="deleteMatch">Delete</button></div>`);
  $('#editMatch').onclick=()=>openEditMatch(id); $('#deleteMatch').onclick=()=>confirmModal('Delete match','Remove this match from normal history and stats? The local record will be soft-deleted so future sync can respect the deletion.',async()=>{await softDelete('matches',id);closeModal();renderHistory();toast('Match deleted.');},'Delete');
}

async function openEditMatch(id){
  const m=await get('matches',id); const {legends}=await lookups();
  showModal('Edit match',`
    <label><span class='label-title'>Date & time</span><input id='editMatchDate' type='datetime-local' value='${toLocalInput(m.started_at)}'></label>
    <label><span class='label-title'>Opponent Legend</span><select id='editOpp'>${legends.map(l=>`<option value='${l.id}' ${l.id===m.opponent_legend_id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Opponent build</span><input id='editOppBuild' value='${esc(m.opponent_build||'')}'></label>
    <label><span class='label-title'>Notes</span><textarea id='editMatchNotes'>${esc(m.notes||'')}</textarea></label>
    <button type='button' class='btn primary full' id='saveMatchEdit'>Save changes</button>`);
  $('#saveMatchEdit').onclick=async()=>{
    const oldStart=ms(m.started_at); const chosen=new Date($('#editMatchDate').value); if(Number.isNaN(chosen.getTime()))return toast('Choose a valid date.');
    const delta=chosen.getTime()-oldStart; m.started_at=chosen.toISOString(); if(m.ended_at)m.ended_at=new Date(ms(m.ended_at)+delta).toISOString();
    m.opponent_legend_id=$('#editOpp').value;m.opponent_build=$('#editOppBuild').value.trim();m.notes=$('#editMatchNotes').value.trim();await save('matches',m);
    const games=await byIndex('games','match_id',m.id); for(const g of games){if(g.started_at)g.started_at=new Date(ms(g.started_at)+delta).toISOString();if(g.ended_at)g.ended_at=new Date(ms(g.ended_at)+delta).toISOString();await save('games',g);}
    closeModal();renderHistory();toast('Match updated.');
  };
}
async function renderStats(){
  const el=$('#screen-stats'); const {legends,decks,deckMap,legendMap}=await lookups(); const [matches,games,events,sessions]=await Promise.all([all('matches'),all('games'),all('pointEvents'),all('sessions')]);
  if(state.statsScope==='overall' && !state._statsInit){ state._statsInit=true; }
  const parts=state.statsScope.split(':'); const type=parts[0], id=parts[1];
  let scoped=matches;
  if(type==='legend') scoped=matches.filter(m=>deckMap[m.my_deck_id]?.legend_id===id); if(type==='deck') scoped=matches.filter(m=>m.my_deck_id===id);
  const matchIds=new Set(scoped.map(m=>m.id)); const scopedGames=games.filter(g=>matchIds.has(g.match_id)&&g.ended_at); const gameIds=new Set(scopedGames.map(g=>g.id)); const scopedEvents=events.filter(e=>gameIds.has(e.game_id));
  const formal=scoped.filter(m=>m.result==='me'||m.result==='opponent'); const wins=formal.filter(m=>m.result==='me').length; const gameWins=scopedGames.filter(g=>g.winner==='me').length;
  const pointGames=scopedGames.filter(g=>g.final_my_points!=null&&g.final_opponent_points!=null);
  const pointsFor=pointGames.reduce((a,g)=>a+Number(g.final_my_points),0), pointsAgainst=pointGames.reduce((a,g)=>a+Number(g.final_opponent_points),0);
  let timeMs=0; if(type==='overall'){timeMs=sessions.filter(s=>s.status==='completed').reduce((a,s)=>a+(s.active_play_ms??sessionActiveMs(s)),0)+(state.activeSession?sessionActiveMs(state.activeSession):0);} else timeMs=scoped.reduce((a,m)=>a+(m.active_duration_ms||0),0);
  const mySource={conquer:0,hold:0,effect:0}, oppSource={conquer:0,hold:0,effect:0}; for(const e of scopedEvents){if(!['conquer','hold','effect'].includes(e.source)||e.amount<=0)continue;(e.side==='me'?mySource:oppSource)[e.source]+=e.amount;}
  const myTotal=mySource.conquer+mySource.hold+mySource.effect,oppTotal=oppSource.conquer+oppSource.hold+oppSource.effect;
  const scopeOptions=[`<option value="overall" ${state.statsScope==='overall'?'selected':''}>Overall</option>`,...legends.map(l=>`<option value="legend:${l.id}" ${state.statsScope===`legend:${l.id}`?'selected':''}>Legend — ${esc(l.name)}</option>`),...decks.map(d=>`<option value="deck:${d.id}" ${state.statsScope===`deck:${d.id}`?'selected':''}>Deck — ${esc(d.name)} ${esc(d.version||'')}${d.deleted_at?' (deleted)':''}</option>`)].join('');
  let matrix=''; if(type==='legend'){
    const rows=legends.map(opp=>{const msx=scoped.filter(m=>m.opponent_legend_id===opp.id);if(!msx.length)return null;const f=msx.filter(m=>m.result);const w=f.filter(m=>m.result==='me').length;const ids=new Set(msx.map(m=>m.id));const gs=scopedGames.filter(g=>ids.has(g.match_id));const gw=gs.filter(g=>g.winner==='me').length;const pgs=gs.filter(g=>g.final_my_points!=null&&g.final_opponent_points!=null),pf=pgs.reduce((a,g)=>a+Number(g.final_my_points),0),pa=pgs.reduce((a,g)=>a+Number(g.final_opponent_points),0);return `<tr class="matrixRow" data-opp="${opp.id}"><td>${esc(opp.name)}</td><td>${msx.length}</td><td>${w}–${f.length-w}</td><td>${gs.length}</td><td>${gw}–${gs.length-gw}</td><td>${avg(pf,pgs.length)}</td><td>${avg(pa,pgs.length)}</td></tr>`;}).filter(Boolean).join(''); matrix=rows?`<div class="section-head"><h3>Matchup matrix</h3><div class="sub">Tap a row for filtered history</div></div><div class="table-wrap"><table class="matrix"><thead><tr><th>Opponent</th><th>Matches</th><th>W-L</th><th>Games</th><th>Game W-L</th><th>Avg PF</th><th>Avg PA</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty">No matchup data for this Legend yet.</div>`; }
  el.innerHTML=`
    <label><span class="label-title">Stats scope</span><select id="statsScope">${scopeOptions}</select></label>
    <div class="grid-2"><div class="card stat-card"><div class="k">Tracked time</div><div class="v">${fmtHours(timeMs)}</div></div><div class="card stat-card"><div class="k">Match record</div><div class="v">${wins}–${formal.length-wins}</div><div class="tiny muted">${pct(wins,formal.length)} • n=${formal.length}</div></div><div class="card stat-card"><div class="k">Game record</div><div class="v">${gameWins}–${scopedGames.length-gameWins}</div><div class="tiny muted">${pct(gameWins,scopedGames.length)} • n=${scopedGames.length}</div></div><div class="card stat-card"><div class="k">Avg points</div><div class="v">${avg(pointsFor,pointGames.length)}–${avg(pointsAgainst,pointGames.length)}</div><div class="tiny muted">For / Against • scored n=${pointGames.length}</div></div></div>
    <div class="section-head"><h3>Your point sources</h3><div class="sub">${myTotal} tracked points</div></div>${sourceBars(mySource,myTotal)}
    <div class="section-head"><h3>Opponent point sources</h3><div class="sub">${oppTotal} tracked points</div></div>${sourceBars(oppSource,oppTotal)}
    ${matrix}`;
  $('#statsScope').onchange=e=>{state.statsScope=e.target.value;renderStats();};
  $$('.matrixRow',el).forEach(r=>r.onclick=()=>{state.historyFilters={legend:id,opp:r.dataset.opp,_open:true};setScreen('history');});
}

function sourceBars(obj,total){ return `<div class="card source-bars">${['conquer','hold','effect'].map(k=>{const v=obj[k]||0,p=total?v/total*100:0;return `<div class="source-row"><span>${titleCase(k)}</span><div class="progress"><span style="width:${p}%"></span></div><strong>${total?`${p.toFixed(0)}%`:'—'}</strong></div>`}).join('')}</div>`; }

async function renderMore(){
  const el=$('#screen-more'); const notes=(await all('notes')).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)); const q=state.notesQuery.toLowerCase(); const shown=q?notes.filter(n=>n.text.toLowerCase().includes(q)):notes; const legends=(await all('legends')).sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=`
    <div class="section-head"><div><h2>Journal</h2><div class="sub">Quick notes stay attached to their original context.</div></div></div>
    <input id="noteSearch" placeholder="Search notes" value="${esc(state.notesQuery)}">
    <div class="list" style="margin-top:10px">${shown.length?shown.slice(0,50).map(n=>`<div class="note">${esc(n.text)}<div class="context">${n.score_snapshot?`Score ${esc(n.score_snapshot)} • `:''}${fmtDate(n.timestamp)}</div></div>`).join(''):`<div class="empty">No notes${q?' match that search':' yet'}.</div>`}</div>
    <div class="section-head"><div><h2>Legends</h2><div class="sub">Editable so new releases never require a rebuild.</div></div><button class="btn small primary" id="addLegend">+ Legend</button></div>
    <div class="list">${legends.map(l=>`<div class="list-item"><div><div class="title">${esc(l.name)}</div><div class="meta">${l.archived?'Archived':'Active'}</div></div><button class="btn small ghost legendToggle" data-id="${l.id}">${l.archived?'Restore':'Archive'}</button></div>`).join('')}</div>
    <div class="section-head"><h2>Cloud</h2></div>
    <div id="cloudSyncMount"><div class="card"><div class="section-head" style="margin:0"><div><h3>Cloud Sync</h3><div class="sub">Loading account status…</div></div><span class="chip">Cloud</span></div></div></div>
    <div class="section-head"><h2>Data</h2></div>
    <div class="card"><div class="btn-row"><button class="btn" id="exportJson">Export JSON backup</button><button class="btn" id="importJson">Import JSON backup</button><button class="btn" id="exportCsv">Export CSV</button></div><p class="tiny muted">Local-first + private cloud sync. JSON export remains your manual backup.</p></div>
    <div class="section-head"><h2>App</h2></div><div class="card"><div class="list-item" style="border:0;padding:0;background:transparent"><div><div class="title">RiftMastery</div><div class="meta">Version 0.4.9 • Cloud Sync</div></div><span class="chip">Personal build</span></div></div>
    <div class="section-head"><h2>Danger zone</h2></div><div class="card danger-zone"><p class="small muted">This permanently clears the local database on this device.</p><button class="btn danger full" id="resetData">Reset all local data</button></div>`;
  $('#noteSearch').oninput=e=>{state.notesQuery=e.target.value;clearTimeout(state._noteTimer);state._noteTimer=setTimeout(renderMore,180);};
  $('#addLegend').onclick=()=>openLegendModal(); $$('.legendToggle',el).forEach(b=>b.onclick=async()=>{const l=await get('legends',b.dataset.id);l.archived=!l.archived;await save('legends',l);renderMore();});
  $('#exportJson').onclick=downloadJSON; $('#importJson').onclick=openImportBackup; $('#exportCsv').onclick=downloadCSV; $('#resetData').onclick=()=>confirmModal('Reset all data','This deletes every local Legend, deck, session, match, game, point event and note from this browser. Export a backup first if you care about the data.',async()=>{await clearAll();await seedLegends();state.activeSession=state.activeMatch=state.activeGame=null;setScreen('home');toast('Local data reset.');},'Delete everything');
  window.dispatchEvent(new Event('riftmastery:more-rendered'));
}

function openLegendModal(){
  showModal('Add Legend','<label><span class="label-title">Legend name</span><input id="legendName" placeholder="New Legend"></label><button type="button" class="btn primary full" id="saveLegend">Add Legend</button>');
  $('#saveLegend').onclick=async()=>{const name=$('#legendName').value.trim();if(!name)return toast('Enter a Legend name.');const existing=(await all('legends')).some(l=>l.name.toLowerCase()===name.toLowerCase());if(existing)return toast('That Legend already exists.');await save('legends',stampBase({name,archived:false}));closeModal();renderMore();};
}

function downloadBlob(blob,name){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function downloadJSON(){ const data=await exportAll(); downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`riftmastery-backup-${new Date().toISOString().slice(0,10)}.json`); }
async function openImportBackup(){
  const input=document.createElement('input');
  input.type='file';
  input.accept='application/json,.json';
  input.onchange=async()=>{
    const file=input.files?.[0]; if(!file) return;
    let payload;
    try{ payload=JSON.parse(await file.text()); }catch{ return toast('That file is not valid JSON.'); }
    if(!payload?.data || typeof payload.data!=='object') return toast('Not a RiftMastery backup.');
    const allowed=['legends','decks','sessions','matches','games','pointEvents','notes','testingBlocks','matchupNotes','tournaments','experiments','goals','reviewBlocks','skillAreas','meta'];
    const counts=allowed.reduce((n,k)=>n+(Array.isArray(payload.data[k])?payload.data[k].length:0),0);
    showModal('Import backup',
      '<p class="small muted">Found <strong>'+counts+'</strong> records in <strong>'+esc(file.name)+'</strong>.</p>'+
      '<p class="small muted"><strong>Merge</strong> keeps your current data and updates matching IDs. <strong>Replace</strong> clears this device first, then restores the backup.</p>'+
      '<div class="btn-row"><button type="button" class="btn" id="mergeBackup">Merge</button><button type="button" class="btn danger" id="replaceBackup">Replace local data</button></div>'
    );
    const runImport=async replace=>{
      closeModal(); markSaving();
      try{
        if(replace) await clearAll();
        for(const store of allowed){
          const rows=Array.isArray(payload.data[store])?payload.data[store]:[];
          for(const row of rows){ if(row?.id) await put(store,row); }
        }
        await seedLegends(); await refreshActive(); markSaved(); await renderCurrent();
        toast(replace?'Backup restored.':'Backup merged.');
      }catch(err){ console.error(err); markSaved(); toast('Import failed.'); }
    };
    $('#mergeBackup').onclick=()=>runImport(false);
    $('#replaceBackup').onclick=()=>confirmModal('Replace local data','This clears the current RiftMastery database on this device and restores the selected backup.',()=>runImport(true),'Replace & restore');
  };
  input.click();
}
async function downloadCSV(){
  const {deckMap,legendMap}=await lookups(); const matches=await all('matches'); const games=await all('games'); const rows=[['match_id','date','mode','context','format','my_deck','my_deck_version','my_legend','opponent_legend','result','games_won','games_lost','active_minutes','notes']];
  for(const m of matches){const d=deckMap[m.my_deck_id],gs=games.filter(g=>g.match_id===m.id&&g.ended_at),gw=gs.filter(g=>g.winner==='me').length,gl=gs.filter(g=>g.winner==='opponent').length;rows.push([m.id,m.started_at,m.mode,m.context,m.format,d?.name||'',d?.version||'',legendMap[d?.legend_id]?.name||'',legendMap[m.opponent_legend_id]?.name||'',m.result||'',gw,gl,Math.round((m.active_duration_ms||0)/60000),m.notes||'']);}
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n'); downloadBlob(new Blob([csv],{type:'text/csv'}),`riftmastery-matches-${new Date().toISOString().slice(0,10)}.csv`);
}

async function renderCurrent(){
  if(state.screen==='home') return renderHome(); if(state.screen==='play') return renderPlay(); if(state.screen==='decks') return renderDecks(); if(state.screen==='history') return renderHistory(); if(state.screen==='stats') return renderStats(); if(state.screen==='more') return renderMore();
}

async function tick(){
  if(!state.activeSession) return;
  if(state.screen==='home'){
    const strip=$('#screen-home .session-strip .time'); if(strip) strip.textContent=fmtDuration(sessionActiveMs(state.activeSession));
  }
  if(state.screen==='play'){
    const live=$('#liveSessionTimer'), hub=$('#hubTimer'), online=$('#onlineSessionTimer'); [live,hub,online].forEach(x=>{if(x)x.textContent=fmtDuration(sessionActiveMs(state.activeSession));});
    const mt=$('#liveMatchTimer'); if(mt&&state.activeMatch) mt.textContent=fmtDuration(Date.now()-ms(state.activeMatch.started_at));
  }
}

async function init(){
  await openDB(); await seedLegends(); await refreshActive();
  state.wakeWanted=Boolean(await getMeta('keep_awake',false));

  // Render the app before service-worker setup. A slow/failed SW must never blank the UI.
  state.tick=setInterval(tick,1000);
  if(state.activeSession) state.screen='play';
  setScreen(state.screen);
  if(state.wakeWanted && state.activeSession?.mode==='paper' && state.activeGame) requestWakeLock();

  // Service worker temporarily disabled while cloud sync stabilizes.\n
}

document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='visible' && state.wakeWanted && state.activeSession?.mode==='paper'){
    await requestWakeLock();
    if(state.screen==='play') renderPlay();
  }
});

window.addEventListener('riftmastery:cloudsync',()=>renderCurrent());
window.addEventListener('online',()=>{saveStatus.textContent='Online • local data safe';setTimeout(markSaved,1200)});
window.addEventListener('offline',()=>{saveStatus.textContent='Offline • saving locally';saveStatus.style.color='var(--warn)';});

init().catch(err=>{console.error(err);$('#screen-home').innerHTML=`<div class="card danger-zone"><h2>RiftMastery could not open its local database.</h2><p class="small muted">${esc(err.message||String(err))}</p></div>`;});
