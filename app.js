Warning: truncated output (original token count: 28692)
Total output lines: 1202

import { openDB, all, get, put, byIndex, softDelete, clearAll, exportAll, stampBase, uid, getMeta, setMeta } from './db.js?v=0.6.1';

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

const HOME_PREFS_KEY='riftmastery-home-prefs-v1';
function homePreferences(){try{return JSON.parse(localStorage.getItem(HOME_PREFS_KEY)||'{}');}catch{return {};}}
function applyHomeTheme(theme='grove'){document.body.dataset.homeTheme=['grove','ember','moon'].includes(theme)?theme:'grove';}
function openHomeCustomizer(){
  const prefs=homePreferences(),widgets=prefs.widgets||{stats:true,focus:true,weekly:true,recent:true};
  showModal('Shape your command center',`<p class='small muted'>Choose what stays on your home screen. These settings apply on this device.</p>
    <label><span class='label-title'>Atmosphere</span><select id='homeTheme'><option value='grove'>Verdant grove</option><option value='ember'>Ember dusk</option><option value='moon'>Moonlit field</option></select></label>
    ${[['stats','Development snapshot'],['focus','Current focus'],['weekly','Weekly checklist'],['recent','Recent activity']].map(([id,label])=>`<label class='home-pref-row'><input type='checkbox' data-home-pref='${id}' ${widgets[id]!==false?'checked':''}><span>${label}</span></label>`).join('')}
    <label><span class='label-title'>Season / chapter name</span><input id='homeSeason' maxlength='32' placeholder='e.g. Radiance testing' value='${esc(prefs.season||'')}'></label>
    <button class='btn primary full' id='homePrefsSave'>Save home layout</button>`);
  $('#homeTheme').value=prefs.theme||'grove';
  $('#homePrefsSave').onclick=()=>{const next={theme:$('#homeTheme').value,season:$('#homeSeason').value.trim(),widgets:Object.fromEntries($$('[data-home-pref]',modalBody).map(x=>[x.dataset.homePref,x.checked]))};localStorage.setItem(HOME_PREFS_KEY,JSON.stringify(next));applyHomeTheme(next.theme);closeModal();renderHome();toast('Command center updated.');};
}

function currentWeekKey(){
  const d=new Date(),daysSinceMonday=(d.getDay()+6)%7;
  d.setDate(d.getDate()-daysSinceMonday);d.setHours(0,0,0,0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const weeklyPhaseTemplates={
  preview:{label:'Preview season',focus:'Read the whole board, compare two lines, and update the opponent’s range.',items:[
    {id:'preview-question',title:'Pick one question the previews raise',detail:'What are competitive players trying to figure out right now?'},
    {id:'preview-test',title:'Test one new-set idea',detail:'Theorycraft or proxy a card, deck, or matchup idea; record what you observed.'},
    {id:'board-drill',title:'Run one open-board decision drill',detail:'Name both roles, compare two lines, and say what changes your read.'},
    {id:'vod-1',title:'Study a high-level VOD',detail:'Follow one concept that connects to your focus.'},
    {id:'vod-2',title:'Study a second high-level VOD',detail:'Pause before a key decision and compare your line.'},
    {id:'preview-share',title:'Share a useful, evidence-backed finding',detail:'Optional. A relevant reply counts; skip it when you have nothing defensible to add.',optional:true},
    {id:'preview-ranked',title:'Play ranked for a specific question',detail:'Optional. Keep ladder reps purposeful during previews.',optional:true},
    {id:'preview-local',title:'Get local tournament reps',detail:'Optional. Mark this when an event is available.',optional:true}
  ]},
  prerift:{label:'Pre-release testing',focus:'Turn preview hypotheses into tested game plans and identify what still needs evidence.',items:[
    {id:'prerift-deck',title:'Choose a deck or matchup to test',detail:'Write down what you expect before the reps.'},
    {id:'prerift-reps',title:'Run focused games or a matchup lab',detail:'Test the plan, opening hands, and bad-draw branches.'},
    {id:'board-drill',title:'Run one open-board decision drill',detail:'Compare at least two lines before committing.'},
    {id:'vod-1',title:'Study a high-level VOD',detail:'Look for evidence that supports or challenges your hypothesis.'},
    {id:'vod-2',title:'Study a second high-level VOD',detail:'Track one concept across the game.'},
    {id:'prerift-notes',title:'Update your evidence and unresolved questions',detail:'Separate what you observed from what you still suspect.'},
    {id:'preview-share',title:'Share a useful, evidence-backed finding',detail:'Optional. No post quota; share when the evidence is ready.',optional:true},
    {id:'preview-local',title:'Get local tournament reps',detail:'Optional. Mark this when an event is available.',optional:true}
  ]},
  launch:{label:'Set launch',focus:'Lock one enjoyable, viable archetype for the first 30 ranked BO3s; review at 10, 20, and 30.',items:[
    {id:'launch-ranked',title:'Complete this week’s planned ranked reps',detail:'Choose 2 or 3 BO3s before each ranked session.'},
    {id:'launch-lab',title:'Run one matchup or bad-draw lab',detail:'Practice a specific branch from the current deck.'},
    {id:'vod-1',title:'Study a high-level VOD',detail:'Focus on one decision skill or matchup.'},
    {id:'vod-2',title:'Study a second high-level VOD',detail:'Track the same concept or compare a different line.'},
    {id:'launch-review',title:'Check your 10-BO3 review point',detail:'At 10, 20, and 30 BO3s, choose one next skill target.'},
    {id:'preview-local',title:'Get local tournament reps',detail:'Optional. Treat events as tournament-execution practice.',optional:true},
    {id:'launch-share',title:'Explain one lesson you learned',detail:'Optional. Share when you have a clear, useful takeaway.',optional:true}
  ]},
  ongoing:{label:'Ongoing practice / event prep',focus:'Keep one skill target active and adapt the week to your next event or current format.',items:[
    {id:'ongoing-focus',title:'Choose one skill target for the week',detail:'Use a recurring leak or upcoming event to set the focus.'},
    {id:'ongoing-reps',title:'Complete deliberate reps for that target',detail:'Choose ranked, paper games, or a focused lab.'},
    {id:'ongoing-review',title:'Review a match or testing block',detail:'Separate decision quality from the result.'},
    {id:'vod-1',title:'Study a high-level VOD',detail:'Pause before a decision connected to your target.'},
    {id:'ongoing-event',title:'Prepare for a local event',detail:'Optional. Skip when no event is coming up.',optional:true}
  ]},
  custom:{label:'Custom week',focus:'Choose one focus that makes this week useful to your development.',items:[
    {id:'custom-focus',title:'Choose this week’s focus',detail:'Edit this checklist to fit your schedule and goals.'}
  ]}
};
const weeklyPhaseOptions=Object.entries(weeklyPhaseTemplates).map(([id,x])=>({id,label:x.label}));
function weeklyItemsFor(phase,existing=[]){
  const prior=new Map(existing.map(item=>[item.id,item]));
  return (weeklyPhaseTemplates[phase]||weeklyPhaseTemplates.custom).items.map(item=>({...item,done:Boolean(prior.get(item.id)?.done)}));
}
function previousWeekKey(week){const d=new Date(`${week}T12:00:00`);d.setDate(d.getDate()-7);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
async function getWeeklyChecklist(week=currentWeekKey()){
  let row=await get('weeklyChecklists',week);
  if(!row){
    const prior=await get('weeklyChecklists',previousWeekKey(week));
    const phase=weeklyPhaseTemplates[prior?.phase]?prior.phase:'preview';
    const items=prior?.phase&&prior?.items?.length?prior.items.map(item=>({...item,done:false})):weeklyItemsFor(phase,prior?.items||[]);
    row=stampBase({id:week,week_start:week,phase,focus:prior?.focus||weeklyPhaseTemplates[phase].focus,items});
    await save('weeklyChecklists',row);return row;
  }
  if(!row.phase){row.phase='preview';row.focus=weeklyPhaseTemplates.preview.focus;row.items=weeklyItemsFor('preview',row.items||[]);await save('weeklyChecklists',row);}
  return row;
}
window.riftmasteryAddWeeklyTask=async(title,detail='Suggested by your reviews.')=>{
  const row=await getWeeklyChecklist();
  if(row.items.some(item=>item.title.toLowerCase()===String(title).trim().toLowerCase()))return false;
  row.items.push({id:`queue-${crypto.randomUUID()}`,title:String(title).trim(),detail:String(detail).trim(),optional:false,done:false});
  await save('weeklyChecklists',row);
  if(state.screen==='home')renderHome();
  toast('Added to this week’s checklist.');return true;
};

function weeklyEditorRow(item={}){
  return `<div class="weekly-edit-row" data-weekly-edit-row data-id="${esc(item.id||`custom-${uid()}`)}">
    <label class="weekly-edit-field"><span class="label-title">Task</span><input data-weekly-title maxlength="90" value="${esc(item.title||'')}" placeholder="What do you want to do?"></label>
    <label class="weekly-edit-field"><span class="label-title">Note</span><input data-weekly-detail maxlength="140" value="${esc(item.detail||'')}" placeholder="Optional reminder"></label>
    <div class="weekly-edit-actions"><label class="weekly-optional"><input type="checkbox" data-weekly-optional ${item.optional?'checked':''}> Optional</label><button type="button" class="link-btn small danger-text" data-weekly-remove>Remove</button></div>
  </div>`;
}
function readWeeklyEditorItems(){return $$('[data-weekly-edit-row]',modalBody).map(row=>({id:row.dataset.id,title:row.querySelector('[data-weekly-title]').value.trim(),detail:row.querySelector('[data-weekly-detail]').value.trim(),optional:row.querySelector('[data-weekly-optional]').checked,done:false})).filter(item=>item.title);}
function weeklyEditorBody(row){
  const phase=row.phase||'preview';
  return `<p class="small muted">Each week is saved separately. Changing the phase loads that phase’s starter checklist; you can edit every task.</p>
    <label><span class="label-title">Week type</span><select id="weeklyPhase">${weeklyPhaseOptions.map(x=>`<option value="${x.id}" ${x.id===phase?'selected':''}>${x.label}</option>`).join('')}</select></label>
    <label><span class="label-title">This week’s focus</span><textarea id="weeklyFocus" rows="2" maxlength="180" placeholder="One skill or question to carry through the week">${esc(row.focus||'')}</textarea></label>
    <div class="weekly-editor-head"><span class="label-title">Checklist items</span><button type="button" class="link-btn small" id="weeklyAddItem">+ Add item</button></div>
    <div class="weekly-editor-items" id="weeklyEditorItems">${(row.items||[]).map(weeklyEditorRow).join('')}</div>
    <button type="button" class="btn primary full" id="weeklySave">Save this week</button>`;
}
function bindWeeklyEditor(row){
  const list=$('#weeklyEditorItems',modalBody);
  $('#weeklyPhase',modalBody).onchange=()=>{
    const phase=$('#weeklyPhase',modalBody).value,prior=readWeeklyEditorItems();
    list.innerHTML=weeklyItemsFor(phase,prior).map(weeklyEditorRow).join('');
    $('#weeklyFocus',modalBody).value=weeklyPhaseTemplates[phase].focus;
  };
  $('#weeklyAddItem',modalBody).onclick=()=>{list.insertAdjacentHTML('beforeend',weeklyEditorRow({id:`custom-${uid()}`,title:'',detail:'',optional:false}));list.lastElementChild?.querySelector('[data-weekly-title]')?.focus();};
  list.onclick=e=>{if(e.target.closest('[data-weekly-remove]'))e.target.closest('[data-weekly-edit-row]').remove();};
  $('#weeklySave',modalBody).onclick=async()=>{
    const phase=$('#weeklyPhase',modalBody).value,items=readWeeklyEditorItems();
    if(!items.length)return toast('Add at least one checklist item.');
    const prior=new Map((row.items||[]).map(item=>[item.id,item]));
    row.phase=phase;row.focus=$('#weeklyFocus',modalBody).value.trim()||weeklyPhaseTemplates[phase].focus;
    row.items=items.map(item=>({...item,done:Boolean(prior.get(item.id)?.done)}));
    await save('weeklyChecklists',row);closeModal();await renderHome();toast('Weekly checklist saved.');
  };
}
async function openWeeklyEditor(row){showModal('Edit weekly plan',weeklyEditorBody(row));bindWeeklyEditor(row);}
async function openWeeklyHistory(){
  const now=currentWeekKey(),rows=(await all('weeklyChecklists')).filter(row=>row.week_start<now).sort((a,b)=>b.week_start.localeCompare(a.week_start)).slice(0,12);
  showModal('Past weeks',rows.length?`<p class="small muted">Your completed and in-progress weekly checklists stay here.</p><div class="weekly-history">${rows.map(row=>{
    const required=(row.items||[]).filter(i=>!i.optional),done=required.filter(i=>i.done).length,label=weeklyPhaseTemplates[row.phase]?.label||'Custom week';
    return `<div class="weekly-history-row"><div><strong>Week of ${new Date(row.week_start+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})}</strong><small>${esc(label)}${row.focus?` · ${esc(row.focus)}`:''}</small></div><span>${done}/${required.length}</span></div>`;
  }).join('')}</div>`:'<div class="empty">Your past weekly checklists will appear here.</div>');
}

async function renderHome(){
  const el=$('#screen-home');
  const homePrefs=homePreferences();applyHomeTheme(homePrefs.theme||'grove');
  const s=await homeStats();
  const {legendMap,deckMap}=await lookups();
  const [allMatches,allGames,blocks,weeklyChecklist]=await Promise.all([all('matches'),all('games'),all('testingBlocks'),getWeeklyChecklist()]);
  const matches=allMatches.sort((a,b)=>ms(b.started_at)-ms(a.started_at)).slice(0,4);
  const active=state.activeSession;
  const activeBlock=blocks.filter(b=>b.status==='active').sort((a,b)=>ms(b.started_at||b.created_at)-ms(a.started_at||a.created_at))[0];
  const blockMatches=activeBlock?allMatches.filter(m=>m.testing_block_id===activeBlock.id&&m.ended_at&&(!activeBlock.target_matches||(m.format==='BO3'&&m.context==='online_ranked'))):[];
  const blockMatchIds=new Set(blockMatches.map(m=>m.id));
  const blockGames=activeBlock?allGames.filter(g=>blockMatchIds.has(g.match_id)&&g.ended_at):[];
  const targetMatches=Boolean(activeBlock?.target_matches),target=Math.max(1,Number(targetMatches?activeBlock.target_matches:activeBlock?.target_games)||10),blockProgress=targetMatches?blockMatches.length:blockGames.length,blockPct=activeBlock?Math.min(100,Math.round(blockProgress/target*100)):0;
  const activeDeck=activeBlock?deckMap[activeBlock.deck_id]:null;
  const focusTitle=activeBlock?.name||'Compare before committing';
  const focusDescription=activeBlock?.hypothesis||'Evaluate the open board, name your role, compare two viable lines, then update the opponent’s range when new information appears.';
  el.innerHTML=`
    <section class="hero">
      <div class="hero-copy"><div class="hero-kicker">Riftbound • Player development</div><h2>${active?'Your session is underway':'Build the edge.'}</h2><p>${active?`${titleCase(active.mode)} • ${titleCase(active.context)} • ${fmtDuration(sessionActiveMs(active))}`:'Train with intent. Review with honesty. Carry one lesson into the next game.'}</p></div>
      ${active?`<div class="session-strip"><div><div class="strong">${active.event_name?esc(active.event_name):titleCase(active.context)}</div><div class="small muted">${active.status==='paused'?'Paused':'Active'} • ${titleCase(active.mode)}${active.planned_bo3_count?` • Committed: ${active.planned_bo3_count} BO3s`:''}</div></div><div class="time">${fmtDuration(sessionActiveMs(active))}</div></div>`:''}
      <div class="primary-actions">
        <button class="btn primary" id="homePaper">${active?.mode==='paper'?'Resume Paper Session':'Start Paper Session'}</button>
        <button class="btn" id="homeOnline">${active?.mode==='online'?'Resume Online Session':'Log Online Match'}</button>
      </div>
    </section>
    ${homePrefs.season?`<div class="home-season-label">${esc(homePrefs.season)} <span>FIELD JOURNAL</span></div>`:''}
    <div class="home-toolbar"><span>YOUR COMMAND CENTER</span><button class="btn small ghost" id="homeCustomize">Customize</button></div>
    <div class="section-head" data-home-widget="stats"><div><h3>Your development</h3><div class="sub">Progress is built through deliberate reps.</div></div></div>
    <div class="grid-2 home-widget" data-home-widget="stats">
      <div class="card stat-card"><div class="k">Active development</div><div class="v">${fmtHours(s.total)}</div></div>
      <div class="card stat-card"><div class="k">Formal record</div><div class="v">${s.wins}–${s.losses}</div></div>
      <div class="card stat-card"><div class="k">Matches</div><div class="v">${s.matches}</div></div>
      <div class="card stat-card"><div class="k">Games</div><div class="v">${s.games}</div></div>
    </div>
    <section class="focus-panel home-widget" data-home-widget="focus">
      <div class="focus-topline"><div class="focus-kicker">${activeBlock?'Active testing block':'Today’s development focus'}</div><span class="focus-mark" aria-hidden="true">✦</span></div>
      <h3>${esc(focusTitle)}</h3>
      <p>${esc(focusDescription)}</p>
      ${activeBlock?`<div class="focus-meta"><span>${esc(activeDeck?.name||'Deck not found')}</span><span>${blockProgress} / ${target} ${targetMatches?'BO3s':'games'}</span></div><div class="focus-progress" role="progressbar" aria-label="Testing block progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(blockProgr…16692 tokens truncated…pponent Legend</span><select id='pastOpp'>${oppChoices.map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
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
  const el=$('#screen-more'); const legendsOpen=$('#legendLibrary')?.open||false; const notes=(await all('notes')).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)); const q=state.notesQuery.toLowerCase(); const shown=q?notes.filter(n=>n.text.toLowerCase().includes(q)):notes; const legends=(await all('legends')).sort((a,b)=>a.name.localeCompare(b.name)); const activeLegends=legends.filter(l=>!l.archived).length; const archivedLegends=legends.length-activeLegends;
  el.innerHTML=`
    <div class="section-head"><div><h2>Journal</h2><div class="sub">Quick notes stay attached to their original context.</div></div></div>
    <input id="noteSearch" placeholder="Search notes" value="${esc(state.notesQuery)}">
    <div class="list" style="margin-top:10px">${shown.length?shown.slice(0,50).map(n=>`<div class="note">${esc(n.text)}<div class="context">${n.score_snapshot?`Score ${esc(n.score_snapshot)} • `:''}${fmtDate(n.timestamp)}</div></div>`).join(''):`<div class="empty">No notes${q?' match that search':' yet'}.</div>`}</div>
    <div class="section-head"><div><h2>Legends</h2><div class="sub">Editable so new releases never require a rebuild.</div></div><button class="btn small primary" id="addLegend">+ Legend</button></div>
    <details id="legendLibrary" class="legend-library" ${legendsOpen?'open':''}>
      <summary><span>Legend library</span><span class="chip">${activeLegends} active · ${archivedLegends} archived</span></summary>
      <div class="list">${legends.map(l=>`<div class="list-item"><div><div class="title">${esc(l.name)}</div><div class="meta">${l.archived?'Archived':'Active'}</div></div><button class="btn small ghost legendToggle" data-id="${l.id}">${l.archived?'Restore':'Archive'}</button></div>`).join('')}</div>
    </details>
    <div class="section-head"><h2>Cloud</h2></div>
    <div id="cloudSyncMount"><div class="card"><div class="section-head" style="margin:0"><div><h3>Cloud Sync</h3><div class="sub">Loading account status…</div></div><span class="chip">Cloud</span></div></div></div>
    <div class="section-head"><h2>Data</h2></div>
    <div class="card"><div class="btn-row"><button class="btn" id="exportJson">Export JSON backup</button><button class="btn" id="importJson">Import JSON backup</button><button class="btn" id="exportCsv">Export CSV</button></div><p class="tiny muted">Local-first + private cloud sync. JSON export remains your manual backup.</p></div>
    <div class="section-head"><h2>App</h2></div><div class="card"><div class="list-item" style="border:0;padding:0;background:transparent"><div><div class="title">RiftMastery</div><div class="meta">Version 0.6.1 • Cloud Sync</div></div><span class="chip">Personal build</span></div></div>
    <div class="section-head"><h2>Danger zone</h2></div><div class="card danger-zone"><p class="small muted">Clears activity and testing records on this device and in your signed-in cloud account. Built-in Legends and skill categories stay.</p><button class="btn danger full" id="resetData">Reset device + cloud data</button></div>`;
  $('#noteSearch').oninput=e=>{state.notesQuery=e.target.value;clearTimeout(state._noteTimer);state._noteTimer=setTimeout(renderMore,180);};
  $('#addLegend').onclick=()=>openLegendModal(); $$('.legendToggle',el).forEach(b=>b.onclick=async()=>{const l=await get('legends',b.dataset.id);l.archived=!l.archived;await save('legends',l);renderMore();});
  $('#exportJson').onclick=downloadJSON; $('#importJson').onclick=openImportBackup; $('#exportCsv').onclick=downloadCSV; $('#resetData').onclick=()=>confirmModal('Reset RiftMastery data','This clears decks, sessions, matches, games, point events, notes, and Lab records on this device and in your signed-in cloud account. Your account, Legend library, and skill categories stay.',async()=>{try{if(typeof window.riftmasteryResetCloudData!=='function')throw new Error('Cloud reset is still loading. Try again in a moment.');const cloud=await window.riftmasteryResetCloudData();await clearAll();await seedLegends();await window.riftmasterySeedLabDefaults?.();state.activeSession=state.activeMatch=state.activeGame=null;window.dispatchEvent(new Event('riftmastery:localchange'));setScreen('home');toast(cloud?.signedIn?`Reset complete • ${cloud.cleared} cloud records cleared.`:'Device reset complete • sign in to clear cloud data.');}catch(err){toast(`Reset failed: ${err?.message||'Cloud sync error.'}`);}},'Reset data');
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
    const allowed=['legends','decks','sessions','matches','games','pointEvents','notes','testingBlocks','matchupNotes','tournaments','experiments','goals','reviewBlocks','weeklyChecklists','skillAreas','meta'];
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
