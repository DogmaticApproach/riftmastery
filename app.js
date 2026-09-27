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
