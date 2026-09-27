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

async function renderLab(){
  const root=$('#riftLab'); if(!root)return;
  const tabs=[
    ['blocks','Testing'],['matchups','Matchups'],['events','Events'],['experiments','A/B'],
    ['goals','Goals'],['skills','Skills'],['tools','Tools']
  ];
  root.innerHTML="<div class='section-head'><div><h2>Development Lab</h2><div class='sub'>Turn match data into deliberate practice.</div></div><span class='chip'>v"+VERSION+"</span></div>"+
    "<div class='lab-tabs'>"+tabs.map(([id,label])=>"<button data-lab-tab='"+id+"' class='"+(labTab===id?'active':'')+"'>"+label+"</button>").join('')+"</div><div id='labPanel' class='lab-panel'></div>";
  $$('.lab-tabs button',root).forEach(b=>b.onclick=()=>{labTab=b.dataset.labTab;renderLab();});
  if(labTab==='blocks')await renderBlocksTab();
  if(labTab==='matchups')await renderMatchupsTab();
  if(labTab==='events')await renderEventsTab();
  if(labTab==='experiments')await renderExperimentsTab();
  if(labTab==='goals')await renderGoalsTab();
  if(labTab==='skills')await renderSkillsTab();
  if(labTab==='tools')await renderToolsTab();
}

async function blockProgress(block){
  const matches=(await all('matches')).filter(m=>m.testing_block_id===block.id&&m.ended_at);
  const ids=new Set(matches.map(m=>m.id));
  const games=(await all('games')).filter(g=>ids.has(g.match_id)&&g.ended_at);
  const rec=recordFor(matches);
  return {matches,games,count:games.length,rec};
}
async function renderBlocksTab(){
  const p=$('#labPanel'); if(!p)return;
  const {deckMap,legendMap}=await maps();
  const blocks=(await all('testingBlocks')).sort((a,b)=>(a.status==='active'?-1:1)-(b.status==='active'?-1:1)||ms(b.created_at)-ms(a.created_at));
  let html="<div class='lab-row'><div><div class='strong'>Testing Blocks</div><div class='small muted'>Define a hypothesis, target reps, and focus matchups.</div></div><button class='btn small primary' id='newBlock'>+ Block</button></div>";
  if(!blocks.length) html+="<div class='empty'>No testing blocks yet.</div>";
  for(const b of blocks){
    const pr=await blockProgress(b),target=Math.max(1,Number(b.target_games)||10),percent=Math.min(100,pr.count/target*100);
    const focus=(b.focus_legend_ids||[]).map(id=>legendMap[id]?.name).filter(Boolean).join(', ');
    html+="<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>"+esc(b.name)+"</div><div class='lab-meta'>"+esc(deckMap[b.deck_id]?.name||'Unknown deck')+(focus?" • Focus: "+esc(focus):'')+"</div></div><span class='lab-chip'>"+title(b.status||'active')+"</span></div>"+
      "<div class='lab-progress'><span style='width:"+percent+"%'></span></div><div class='lab-row' style='margin-top:7px'><div class='small'>"+pr.count+" / "+target+" games • "+pr.rec.w+"–"+pr.rec.l+" matches</div><div class='lab-wrap'><button class='btn small ghost blockReview' data-id='"+b.id+"'>Review</button>"+(b.status==='active'?"<button class='btn small blockStop' data-id='"+b.id+"'>Complete</button>":"")+"</div></div>"+
      (b.hypothesis?"<div class='small muted' style='margin-top:8px'>Hypothesis: "+esc(b.hypothesis)+"</div>":"")+"</div>";
  }
  html+=await readyTenMatchReviewsHtml(deckMap);
  p.innerHTML=html;
  $('#newBlock').onclick=openTestingBlockModal;
  $$('.blockStop',p).forEach(b=>b.onclick=async()=>{const row=await get('testingBlocks',b.dataset.id);row.status='completed';row.ended_at=iso();await save('testingBlocks',row);renderLab();});
  $$('.blockReview',p).forEach(b=>b.onclick=()=>openTestingBlockReview(b.dataset.id));
  $$('.tenReview',p).forEach(b=>b.onclick=()=>openTenMatchReview(b.dataset.deck,b.dataset.number));
}
async function openTestingBlockModal(){
  const {decks,legends,legendMap}=await maps();
  const active=decks.filter(d=>!d.deleted_at&&!d.archived);
  if(!active.length)return toast('Create a deck first.');
  modal('New testing block',`
    <label><span class='label-title'>Block name</span><input id='tbName' placeholder='e.g. Jayce v3 matchup block'></label>
    <label><span class='label-title'>Deck</span><select id='tbDeck'>${active.map(d=>`<option value='${d.id}'>${esc(legendMap[d.legend_id]?.name||'')} — ${esc(d.name)} ${esc(d.version||'')}</option>`).join('')}</select></label>
    <label><span class='label-title'>Target games</span><input id='tbTarget' type='number' min='1' max='500' value='20'></label>
    <label><span class='label-title'>Focus opponent Legends</span><select id='tbFocus' multiple size='6'>${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Hypothesis</span><textarea id='tbHypothesis' placeholder='What do you expect this practice block to improve?'></textarea></label>
    <button class='btn primary full' type='button' id='tbSave'>Create block</button>`);
  $('#tbSave').onclick=async()=>{
    const name=$('#tbName').value.trim();if(!name)return toast('Name the testing block.');
    const focus=[...$('#tbFocus').selectedOptions].map(o=>o.value);
    const row=stampBase({name,deck_id:$('#tbDeck').value,target_games:Number($('#tbTarget').value)||20,focus_legend_ids:focus,hypothesis:$('#tbHypothesis').value.trim(),status:'active',started_at:iso(),ended_at:null});
    await save('testingBlocks',row);closeModal();renderLab();toast('Testing block created.');
  };
}
async function openTestingBlockReview(id){
  const block=await get('testingBlocks',id);if(!block)return;
  const pr=await blockProgress(block),{deckMap}=await maps();
  const leaks=await leakCountsForMatches(pr.matches.map(m=>m.id));
  modal('Testing block review',`
    <div class='grid-2'><div class='card stat-card'><div class='k'>Games</div><div class='v'>${pr.games.length}</div></div><div class='card stat-card'><div class='k'>Match record</div><div class='v'>${pr.rec.w}–${pr.rec.l}</div></div></div>
    <p class='small'><strong>${esc(deckMap[block.deck_id]?.name||'Deck')}</strong>${block.hypothesis?`<br><span class='muted'>Hypothesis: ${esc(block.hypothesis)}</span>`:''}</p>
    ${leaks.length?`<div class='section-head'><h3>Repeated tags</h3></div><div class='lab-wrap'>${leaks.slice(0,5).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>`:''}`);
}
async function readyTenMatchReviewsHtml(deckMap){
  const matches=(await all('matches')).filter(m=>m.ended_at);
  const saved=await all('reviewBlocks');
  let cards='';
  for(const [deckId,deck] of Object.entries(deckMap)){
    if(!deck||deck.deleted_at)continue;
    const dm=matches.filter(m=>m.my_deck_id===deckId).sort((a,b)=>ms(a.started_at)-ms(b.started_at));
    const blocks=Math.floor(dm.length/10);
    for(let n=1;n<=blocks;n++){
      if(saved.some(r=>r.deck_id===deckId&&r.block_number===n))continue;
      cards+=`<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>10-Match Review Ready</div><div class='lab-meta'>${esc(deck.name)} ${esc(deck.version||'')} • Matches ${(n-1)*10+1}–${n*10}</div></div><button class='btn small tenReview' data-deck='${deckId}' data-number='${n}'>Review</button></div></div>`;
    }
  }
  return cards?`<div class='section-head'><h3>Development Reviews</h3></div>${cards}`:'';
}
async function openTenMatchReview(deckId,blockNumber){
  const matches=(await all('matches')).filter(m=>m.my_deck_id===deckId&&m.ended_at).sort((a,b)=>ms(a.started_at)-ms(b.started_at)).slice((blockNumber-1)*10,blockNumber*10);
  const leaks=await leakCountsForMatches(matches.map(m=>m.id));
  modal('10-Match Development Review',`
    ${leaks.length?`<div class='lab-wrap' style='margin-bottom:10px'>${leaks.slice(0,5).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>`:''}
    <label><span class='label-title'>What improved?</span><textarea id='rvImproved'></textarea></label>
    <label><span class='label-title'>What repeated?</span><textarea id='rvRepeated'></textarea></label>
    <label><span class='label-title'>What did stronger opponents punish?</span><textarea id='rvPunished'></textarea></label>
    <label><span class='label-title'>What did you learn?</span><textarea id='rvLearned'></textarea></label>
    <label><span class='label-title'>Next drill / focus</span><textarea id='rvNext'></textarea></label>
    <button class='btn primary full' id='rvSave' type='button'>Save review</button>`);
  $('#rvSave').onclick=async()=>{
    await save('reviewBlocks',stampBase({deck_id:deckId,block_number:Number(blockNumber),match_ids:matches.map(m=>m.id),improved:$('#rvImproved').value.trim(),repeated:$('#rvRepeated').value.trim(),punished:$('#rvPunished').value.trim(),learned:$('#rvLearned').value.trim(),next_drill:$('#rvNext').value.trim(),completed_at:iso()}));
    closeModal();renderLab();toast('10-match review saved.');
  };
}
async function leakCountsForMatches(matchIds){
  const ids=new Set(matchIds),notes=await all('notes'),counts={};
  for(const n of notes){if(n.match_id&&!ids.has(n.match_id))continue;for(const tag of (n.leak_tags||[]))counts[tag]=(counts[tag]||0)+1;}
  return Object.entries(counts).map(([tag,count])=>({tag,count})).sort((a,b)=>b.count-a.count);
}

async function matchupStats(myLegendId,oppId){
  const {deckMap}=await maps();
  const matches=(await all('matches')).filter(m=>m.ended_at&&m.opponent_legend_id===oppId&&deckMap[m.my_deck_id]?.legend_id===myLegendId);
  const ids=new Set(matches.map(m=>m.id));
  const games=(await all('games')).filter(g=>ids.has(g.match_id)&&g.ended_at);
  const rec=recordFor(matches),gameWins=games.filter(g=>g.winner==='me').length;
  const first=games.filter(g=>g.who_started==='me'),second=games.filter(g=>g.who_started==='opponent');
  const pointGames=games.filter(g=>g.final_my_points!=null&&g.final_opponent_points!=null);
  const pf=pointGames.reduce((a,g)=>a+Number(g.final_my_points),0),pa=pointGames.reduce((a,g)=>a+Number(g.final_opponent_points),0);
  return {
    matches,games,rec,gameWins,
    first:{n:first.length,w:first.filter(g=>g.winner==='me').length},
    second:{n:second.length,w:second.filter(g=>g.winner==='me').length},
    avgPf:pointGames.length?(pf/pointGames.length).toFixed(1):'—',
    avgPa:pointGames.length?(pa/pointGames.length).toFixed(1):'—'
  };
}
async function findMatchupNote(myLegendId,oppId){
  return (await all('matchupNotes')).find(x=>x.my_legend_id===myLegendId&&x.opponent_legend_id===oppId)||null;
}
async function renderMatchupsTab(){
  const p=$('#labPanel');if(!p)return;
  const {legends}=await maps();
  const notes=await all('matchupNotes');
  const favorites=notes.filter(n=>n.favorite);
  const leaks=await leakCountsForMatches((await all('matches')).map(m=>m.id));
  p.innerHTML=`
    <div class='lab-row'><div><div class='strong'>Matchup Notebook</div><div class='small muted'>Persistent matchup plans backed by your own results.</div></div><button class='btn small primary' id='openMatchup'>Open matchup</button></div>
    ${favorites.length?`<div class='section-head'><h3>Favorites</h3></div><div class='lab-panel'>${favorites.map(n=>`<button class='lab-card favoriteMatchup' data-me='${n.my_legend_id}' data-opp='${n.opponent_legend_id}' style='text-align:left;color:inherit'><div class='lab-title'>${esc(legends.find(l=>l.id===n.my_legend_id)?.name||'My Legend')} vs ${esc(legends.find(l=>l.id===n.opponent_legend_id)?.name||'Opponent')}</div><div class='lab-meta'>Confidence ${n.confidence||0}/5</div></button>`).join('')}</div>`:''}
    <div class='section-head'><h3>Recurring Leak Tracker</h3><div class='sub'>Based on tagged notes</div></div>
    ${leaks.length?`<div class='lab-card'><div class='lab-wrap'>${leaks.slice(0,9).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>${leaks[0]?.count>=3?`<div class='small muted' style='margin-top:9px'>Most repeated pattern: ${esc(leaks[0].tag)}. Treat this as a review signal, not proof of cause.</div>`:''}</div>`:`<div class='empty'>Tag notes during matches to build your leak tracker.</div>`}
  `;
  $('#openMatchup').onclick=()=>openMatchupPicker();
  $$('.favoriteMatchup',p).forEach(b=>b.onclick=()=>openMatchupPage(b.dataset.me,b.dataset.opp));
}
async function openMatchupPicker(){
  const {legends}=await maps(),active=legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name));
  modal('Open matchup',`
    <label><span class='label-title'>My Legend</span><select id='muMine'>${active.map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Opponent Legend</span><select id='muOpp'>${active.map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <button class='btn primary full' id='muOpen' type='button'>Open matchup page</button>`);
  $('#muOpen').onclick=()=>{const a=$('#muMine').value,b=$('#muOpp').value;closeModal();openMatchupPage(a,b);};
}
async function openMatchupPage(myLegendId,oppId){
  const {legendMap}=await maps(),s=await matchupStats(myLegendId,oppId);
  let note=await findMatchupNote(myLegendId,oppId);
  if(!note) note=stampBase({my_legend_id:myLegendId,opponent_legend_id:oppId,favorite:false,confidence:0,mulligan_priorities:'',key_windows:'',respect_cards:'',what_beats_me:'',tests_next:''});
  modal((legendMap[myLegendId]?.name||'My Legend')+' vs '+(legendMap[oppId]?.name||'Opponent'),`
    <div class='lab-grid'>
      <div class='lab-card'><div class='tiny muted'>MATCH RECORD</div><div class='lab-title'>${s.rec.w}–${s.rec.l} <span class='muted'>${pct(s.rec.w,s.rec.n)}</span></div><div class='lab-meta'>n=${s.rec.n}</div></div>
      <div class='lab-card'><div class='tiny muted'>GAME RECORD</div><div class='lab-title'>${s.gameWins}–${s.games.length-s.gameWins}</div><div class='lab-meta'>n=${s.games.length}</div></div>
      <div class='lab-card'><div class='tiny muted'>GOING FIRST</div><div class='lab-title'>${s.first.w}–${s.first.n-s.first.w}</div><div class='lab-meta'>n=${s.first.n}</div></div>
      <div class='lab-card'><div class='tiny muted'>GOING SECOND</div><div class='lab-title'>${s.second.w}–${s.second.n-s.second.w}</div><div class='lab-meta'>n=${s.second.n}</div></div>
    </div>
    <div class='small muted' style='margin:10px 0'>Avg tracked points: ${s.avgPf} for / ${s.avgPa} against</div>
    <div class='lab-notebook'>
      <label><span class='label-title'>Mulligan priorities</span><textarea id='muMulligan'>${esc(note.mulligan_priorities||'')}</textarea></label>
      <label><span class='label-title'>Key scoring / contest windows</span><textarea id='muWindows'>${esc(note.key_windows||'')}</textarea></label>
      <label><span class='label-title'>Cards / lines to respect</span><textarea id='muRespect'>${esc(note.respect_cards||'')}</textarea></label>
      <label><span class='label-title'>What usually beats me</span><textarea id='muBeats'>${esc(note.what_beats_me||'')}</textarea></label>
      <label><span class='label-title'>Things to test next</span><textarea id='muNext'>${esc(note.tests_next||'')}</textarea></label>
      <label><span class='label-title'>Confidence</span><select id='muConfidence'>${[0,1,2,3,4,5].map(n=>`<option value='${n}' ${Number(note.confidence)===n?'selected':''}>${n}/5</option>`).join('')}</select></label>
      <label style='display:flex;align-items:center;gap:8px'><input type='checkbox' id='muFavorite' style='width:auto;min-height:0' ${note.favorite?'checked':''}> Favorite matchup</label>
    </div>
    <div class='btn-row'><button class='btn primary' id='muSave' type='button'>Save matchup page</button><button class='btn' id='muBrief' type='button'>Copy analysis brief</button></div>`);
  $('#muSave').onclick=async()=>{
    Object.assign(note,{mulligan_priorities:$('#muMulligan').value.trim(),key_windows:$('#muWindows').value.trim(),respect_cards:$('#muRespect').value.trim(),what_beats_me:$('#muBeats').value.trim(),tests_next:$('#muNext').value.trim(),confidence:Number($('#muConfidence').value),favorite:$('#muFavorite').checked});
    await save('matchupNotes',note);closeModal();if(labTab==='matchups')renderLab();toast('Matchup page saved.');
  };
  $('#muBrief').onclick=async()=>{
    const text=`RiftMastery matchup brief
${legendMap[myLegendId]?.name||'My Legend'} vs ${legendMap[oppId]?.name||'Opponent'}
Match record: ${s.rec.w}-${s.rec.l} (n=${s.rec.n})
Game record: ${s.gameWins}-${s.games.length-s.gameWins}
Going first: ${s.first.w}-${s.first.n-s.first.w} (n=${s.first.n})
Going second: ${s.second.w}-${s.second.n-s.second.w} (n=${s.second.n})
Avg tracked points: ${s.avgPf} for / ${s.avgPa} against
Mulligan priorities: ${$('#muMulligan').value.trim()}
Key windows: ${$('#muWindows').value.trim()}
Respect: ${$('#muRespect').value.trim()}
What beats me: ${$('#muBeats').value.trim()}
Tests next: ${$('#muNext').value.trim()}`;
    await copyOrShare(text,'RiftMastery matchup brief');
  };
}
