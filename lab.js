export const RIFTMASTERY_LAB_VERSION = '0.3';

import { all, get, put, byIndex, stampBase, getMeta, setMeta, softDelete } from './db.js';

const VERSION='0.3';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ms=v=>v?new Date(v).getTime():0;
const iso=()=>new Date().toISOString();
const fmtDate=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const fmtHours=v=>{const m=Math.floor(Math.max(0,v||0)/60000);return Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m';};
const pct=(n,d)=>d?((n/d*100).toFixed(d<10?0:1)+'%'):'—';
const title=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

const leakDefaults=()=>['Mulligan','Sequencing','Resource Use','Contest Choice','Missed Hold','Overextension','Scoring Timing','Unknown Card','Opponent Read'];
const skillDefaults=()=>['Mulligan','Sequencing','Resource Management','Scoring Windows','Matchup Knowledge','Tempo Planning','Event Discipline'];
const scoreDefaults=()=>[{id:'conquer',label:'Conquer'},{id:'hold',label:'Hold'},{id:'effect',label:'Effect'}];
const checklistDefaults=()=>['Deck locked','Deck list verified','Matchup notes reviewed','Supplies packed','Arrival plan'];

function toast(msg){
  const t=$('#toast'); if(!t)return;
  t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),1800);
}
function modal(titleText,html){
  const d=$('#modal'); if(!d)return;
  $('#modalTitle').textContent=titleText; $('#modalBody').innerHTML=html; if(!d.open)d.showModal();
}
function closeModal(){const d=$('#modal');if(d?.open)d.close();}
async function save(store,row){row.updated_at=iso();row.sync_status=row.sync_status||'local';await put(store,row);return row;}
async function latestActiveSession(){
  return (await all('sessions')).filter(s=>s.status==='active'||s.status==='paused').sort((a,b)=>ms(b.started_at)-ms(a.started_at))[0]||null;
}
async function maps(){
  const [legends,decks]=await Promise.all([all('legends'),all('decks',{includeDeleted:true})]);
  return {legends,decks,legendMap:Object.fromEntries(legends.map(x=>[x.id,x])),deckMap:Object.fromEntries(decks.map(x=>[x.id,x]))};
}
async function seedLab(){
  const skills=await all('skillAreas');
  if(!skills.length) for(const name of skillDefaults()) await put('skillAreas',stampBase({name,rating:0,notes:'',archived:false}));
  if(await getMeta('score_sources',null)===null) await setMeta('score_sources',scoreDefaults());
  if(await getMeta('leak_tags',null)===null) await setMeta('leak_tags',leakDefaults());
}
function recordFor(matches){
  const formal=matches.filter(m=>m.result==='me'||m.result==='opponent');
  const w=formal.filter(m=>m.result==='me').length;
  return {w,l:formal.length-w,n:formal.length};
}
function csvParse(text){
  const rows=[]; let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(q&&ch==='"'&&next==='"'){cell+='"';i++;continue;}
    if(ch==='"'){q=!q;continue;}
    if(!q&&ch===','){row.push(cell);cell='';continue;}
    if(!q&&(ch==='\n'||ch==='\r')){
      if(ch==='\r'&&next==='\n')i++;
      row.push(cell); if(row.some(x=>x!==''))rows.push(row); row=[];cell='';continue;
    }
    cell+=ch;
  }
  row.push(cell); if(row.some(x=>x!==''))rows.push(row); return rows;
}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function copyOrShare(text,titleText='RiftMastery'){
  if(navigator.share){try{await navigator.share({title:titleText,text});return;}catch{}}
  try{await navigator.clipboard.writeText(text);toast('Copied.');}catch{modal('Copy',"<textarea rows='16' id='labCopy'>"+esc(text)+"</textarea>");setTimeout(()=>{$('#labCopy')?.select();},30);}
}

let labTab='blocks';
let refreshTimer=null;
let lastMoreKey='';
let lastStatsKey='';

async function ensureLabShell(){
  const more=$('#screen-more');
  if(more?.classList.contains('active')&&!$('#riftLab',more)){
    const shell=document.createElement('div');shell.id='riftLab';shell.className='lab-shell';
    more.prepend(shell); await renderLab();
  }
  const stats=$('#screen-stats');
  if(stats?.classList.contains('active')) await enhanceStats(stats);
  await enhanceModal();
  await enhanceLiveScore();
}
