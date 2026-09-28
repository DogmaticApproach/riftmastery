export const RIFTMASTERY_LAB_VERSION = '0.3';

import { all, get, put, byIndex, stampBase, getMeta, setMeta, softDelete } from './db.js?v=0.4.13';

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
async function save(store,row){row.updated_at=iso();row.sync_status=row.sync_status||'local';await put(store,row);window.dispatchEvent(new Event('riftmastery:localchange'));return row;}
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
window.riftmasterySeedLabDefaults=seedLab;
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
  const matches=(await all('matches')).filter(m=>m.testing_block_id===block.id&&m.ended_at&&(!block.target_matches||(m.format==='BO3'&&m.context==='online_ranked')));
  const ids=new Set(matches.map(m=>m.id));
  const games=(await all('games')).filter(g=>ids.has(g.match_id)&&g.ended_at);
  const rec=recordFor(matches);
  return {matches,games,count:games.length,matchCount:matches.length,rec};
}
async function renderBlocksTab(){
  const p=$('#labPanel'); if(!p)return;
  const {deckMap,legendMap}=await maps();
  const blocks=(await all('testingBlocks')).sort((a,b)=>(a.status==='active'?-1:1)-(b.status==='active'?-1:1)||ms(b.created_at)-ms(a.created_at));
  let html="<div class='lab-row'><div><div class='strong'>Testing Blocks</div><div class='small muted'>Precommit a target, hypothesis, and matchup focus.</div></div><button class='btn small primary' id='newBlock'>+ Block</button></div>";
  if(!blocks.length) html+="<div class='empty'>No testing blocks yet.</div>";
  for(const b of blocks){
    const pr=await blockProgress(b),targetMatches=Boolean(b.target_matches),target=Math.max(1,Number(targetMatches?b.target_matches:b.target_games)||10),progress=targetMatches?pr.matchCount:pr.count,percent=Math.min(100,progress/target*100);
    const focus=(b.focus_legend_ids||[]).map(id=>legendMap[id]?.name).filter(Boolean).join(', ');
    html+="<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>"+esc(b.name)+"</div><div class='lab-meta'>"+esc(deckMap[b.deck_id]?.name||'Unknown deck')+(focus?" • Focus: "+esc(focus):'')+"</div></div><span class='lab-chip'>"+title(b.status||'active')+"</span></div>"+
      "<div class='lab-progress'><span style='width:"+percent+"%'></span></div><div class='lab-row' style='margin-top:7px'><div class='small'>"+progress+" / "+target+(targetMatches?" BO3s":" games")+" • "+pr.rec.w+"–"+pr.rec.l+" matches</div><div class='lab-wrap'><button class='btn small ghost blockReview' data-id='"+b.id+"'>Review</button>"+(b.status==='active'?"<button class='btn small blockStop' data-id='"+b.id+"'>Complete</button>":"")+"</div></div>"+
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
    <label><span class='label-title'>Track by</span><select id='tbTargetType'><option value='bo3'>Ranked BO3 matches</option><option value='games'>Individual games</option></select></label>
    <label><span class='label-title'>Target</span><input id='tbTarget' type='number' min='1' max='500' value='10'></label>
    <label><span class='label-title'>Focus opponent Legends</span><select id='tbFocus' multiple size='6'>${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Hypothesis</span><textarea id='tbHypothesis' placeholder='What do you expect this practice block to improve?'></textarea></label>
    <button class='btn primary full' type='button' id='tbSave'>Create block</button>`);
  $('#tbSave').onclick=async()=>{
    const name=$('#tbName').value.trim();if(!name)return toast('Name the testing block.');
    const focus=[...$('#tbFocus').selectedOptions].map(o=>o.value);
    const target=Math.max(1,Number($('#tbTarget').value)||10),targetType=$('#tbTargetType').value;
    const row=stampBase({name,deck_id:$('#tbDeck').value,...(targetType==='bo3'?{target_matches:target}:{target_games:target}),focus_legend_ids:focus,hypothesis:$('#tbHypothesis').value.trim(),status:'active',started_at:iso(),ended_at:null});
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
      const matches=(await all('matches')).filter(m=>m.ended_at&&m.format==='BO3'&&m.context==='online_ranked');
  const saved=await all('reviewBlocks');
  let cards='';
  for(const [deckId,deck] of Object.entries(deckMap)){
    if(!deck||deck.deleted_at)continue;
    const dm=matches.filter(m=>m.my_deck_id===deckId).sort((a,b)=>ms(a.started_at)-ms(b.started_at));
    const blocks=Math.floor(dm.length/10);
    for(let n=1;n<=blocks;n++){
      if(saved.some(r=>r.deck_id===deckId&&r.block_number===n))continue;
      cards+=`<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>10-BO3 Review Ready</div><div class='lab-meta'>${esc(deck.name)} ${esc(deck.version||'')} • Ranked BO3s ${(n-1)*10+1}–${n*10}</div></div><button class='btn small tenReview' data-deck='${deckId}' data-number='${n}'>Review</button></div></div>`;
    }
  }
  return cards?`<div class='section-head'><h3>Development Reviews</h3></div>${cards}`:'';
}
async function openTenMatchReview(deckId,blockNumber){
  const matches=(await all('matches')).filter(m=>m.my_deck_id===deckId&&m.ended_at&&m.format==='BO3'&&m.context==='online_ranked').sort((a,b)=>ms(a.started_at)-ms(b.started_at)).slice((blockNumber-1)*10,blockNumber*10);
  const leaks=await leakCountsForMatches(matches.map(m=>m.id));
  modal('10-BO3 Development Review',`
    <p class='small muted'>Judge decisions using what was known at the time. The match record is context, not the verdict.</p>
    ${leaks.length?`<div class='lab-wrap' style='margin-bottom:10px'>${leaks.slice(0,5).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>`:''}
    <label><span class='label-title'>What improved independent of results?</span><textarea id='rvImproved'></textarea></label>
    <label><span class='label-title'>What repeated?</span><textarea id='rvRepeated'></textarea></label>
    <label><span class='label-title'>What did stronger opponents punish?</span><textarea id='rvPunished'></textarea></label>
    <label><span class='label-title'>What did you learn?</span><textarea id='rvLearned'></textarea></label>
    <label><span class='label-title'>Next drill / focus</span><textarea id='rvNext'></textarea></label>
    <button class='btn primary full' id='rvSave' type='button'>Save review</button>`);
  $('#rvSave').onclick=async()=>{
    await save('reviewBlocks',stampBase({deck_id:deckId,block_number:Number(blockNumber),format:'BO3',context:'online_ranked',match_ids:matches.map(m=>m.id),improved:$('#rvImproved').value.trim(),repeated:$('#rvRepeated').value.trim(),punished:$('#rvPunished').value.trim(),learned:$('#rvLearned').value.trim(),next_drill:$('#rvNext').value.trim(),completed_at:iso()}));
    closeModal();renderLab();toast('10-BO3 review saved.');
  };
}
function inferLeakTags(text){
  const s=String(text||'').toLowerCase(),out=[];
  const rules=[
    ['Mulligan',/mulligan|keep hand|opening hand/],
    ['Sequencing',/sequenc|order of|played .* first|played .* before/],
    ['Resource Use',/resource|mana|spent too|overpay|underpay/],
    ['Contest Choice',/contest|battlefield|fight for|gave up point/],
    ['Missed Hold',/missed hold|should have held|hold point/],
    ['Overextension',/overextend|overcommitted|too many units/],
    ['Scoring Timing',/score too|scoring window|point timing|should have scored/],
    ['Unknown Card',/didn.?t know|unknown card|forgot .* card/],
    ['Opponent Read',/misread|read opponent|expected .* but/]
  ];
  for(const [tag,re] of rules)if(re.test(s))out.push(tag);
  return out;
}
async function leakCountsForMatches(matchIds){
  const ids=new Set(matchIds),notes=await all('notes'),counts={};
  for(const n of notes){
    if(n.match_id&&!ids.has(n.match_id))continue;
    const tags=[...new Set([...(n.leak_tags||[]),...inferLeakTags(n.text)])];
    for(const tag of tags)counts[tag]=(counts[tag]||0)+1;
  }
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

async function tournamentProgress(t){
  const matches=(await all('matches')).filter(m=>m.tournament_id===t.id&&m.ended_at).sort((a,b)=>(a.round_number||999)-(b.round_number||999));
  const rec=recordFor(matches);return {matches,rec};
}
async function renderEventsTab(){
  const p=$('#labPanel');if(!p)return;
  const {deckMap,legendMap}=await maps();
  const events=(await all('tournaments')).sort((a,b)=>ms(b.event_date||b.created_at)-ms(a.event_date||a.created_at));
  let html="<div class='lab-row'><div><div class='strong'>Tournament Mode</div><div class='small muted'>Rounds, fixed deck, event record, and prep checklist.</div></div><button class='btn small primary' id='newEvent'>+ Event</button></div>";
  if(!events.length)html+="<div class='empty'>No tournament events yet.</div>";
  for(const t of events){
    const pr=await tournamentProgress(t),deck=deckMap[t.deck_id],done=(t.checklist||[]).filter(x=>x.done).length,total=(t.checklist||[]).length;
    html+=`<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>${esc(t.name)}</div><div class='lab-meta'>${fmtDate(t.event_date)} • ${esc(deck?.name||'Deck')} ${esc(deck?.version||'')} • ${esc(t.format||'BO3')}</div></div><span class='lab-chip'>${title(t.status||'planned')}</span></div>
      <div class='lab-row' style='margin-top:9px'><div class='small'>${pr.rec.w}–${pr.rec.l} • ${pr.matches.length}/${t.total_rounds||'?'} rounds • Prep ${done}/${total}</div><div class='lab-wrap'><button class='btn small ghost eventChecklist' data-id='${t.id}'>Prep</button><button class='btn small ghost eventView' data-id='${t.id}'>View</button>${t.status==='planned'?`<button class='btn small primary eventStart' data-id='${t.id}'>Start Event</button>`:''}${t.status==='active'?`<button class='btn small eventComplete' data-id='${t.id}'>Complete</button>`:''}</div></div></div>`;
  }
  p.innerHTML=html;
  $('#newEvent').onclick=openTournamentModal;
  $$('.eventChecklist',p).forEach(b=>b.onclick=()=>openTournamentChecklist(b.dataset.id));
  $$('.eventView',p).forEach(b=>b.onclick=()=>openTournamentSummary(b.dataset.id));
  $$('.eventStart',p).forEach(b=>b.onclick=()=>startTournament(b.dataset.id));
  $$('.eventComplete',p).forEach(b=>b.onclick=async()=>{const t=await get('tournaments',b.dataset.id);t.status='completed';t.ended_at=iso();await save('tournaments',t);await setMeta('active_tournament_id','');renderLab();});
}
async function openTournamentModal(){
  const {decks,legendMap}=await maps(),active=decks.filter(d=>!d.deleted_at&&!d.archived);
  if(!active.length)return toast('Create a deck first.');
  const date=new Date(),pad=n=>String(n).padStart(2,'0'),dateValue=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  modal('Create tournament event',`
    <label><span class='label-title'>Event name</span><input id='evName' placeholder='e.g. Dallas Regional'></label>
    <label><span class='label-title'>Event date</span><input id='evDate' type='date' value='${dateValue}'></label>
    <label><span class='label-title'>Registered deck</span><select id='evDeck'>${active.map(d=>`<option value='${d.id}'>${esc(legendMap[d.legend_id]?.name||'')} — ${esc(d.name)} ${esc(d.version||'')}</option>`).join('')}</select></label>
    <div class='grid-2'><label><span class='label-title'>Format</span><select id='evFormat'><option>BO3</option><option>BO1</option><option>BO5</option></select></label><label><span class='label-title'>Rounds</span><input id='evRounds' type='number' min='1' max='30' value='7'></label></div>
    <label><span class='label-title'>Notes <span class='muted'>(optional)</span></span><textarea id='evNotes'></textarea></label>
    <button class='btn primary full' id='evSave' type='button'>Save event</button>`);
  $('#evSave').onclick=async()=>{
    const name=$('#evName').value.trim();if(!name)return toast('Name the event.');
    const checklist=checklistDefaults().map(text=>({id:crypto.randomUUID(),text,done:false}));
    const row=stampBase({name,event_date:new Date($('#evDate').value+'T09:00:00').toISOString(),deck_id:$('#evDeck').value,format:$('#evFormat').value,total_rounds:Number($('#evRounds').value)||7,notes:$('#evNotes').value.trim(),status:'planned',checklist,started_at:null,ended_at:null});
    await save('tournaments',row);closeModal();renderLab();toast('Tournament event saved.');
  };
}
async function openTournamentChecklist(id){
  const t=await get('tournaments',id);if(!t)return;
  const items=t.checklist?.length?t.checklist:checklistDefaults().map(text=>({id:crypto.randomUUID(),text,done:false}));
  modal('Event prep checklist',`
    <div class='lab-panel'>${items.map((x,i)=>`<label class='lab-card' style='display:flex;align-items:center;gap:9px;margin:0'><input type='checkbox' class='evCheck' data-i='${i}' style='width:auto;min-height:0' ${x.done?'checked':''}><span>${esc(x.text)}</span></label>`).join('')}</div>
    <button class='btn primary full' style='margin-top:10px' id='evCheckSave' type='button'>Save checklist</button>`);
  $('#evCheckSave').onclick=async()=>{items.forEach((x,i)=>x.done=$(`.evCheck[data-i='${i}']`)?.checked||false);t.checklist=items;await save('tournaments',t);closeModal();renderLab();};
}
async function startTournament(id){
  const active=await latestActiveSession();if(active)return toast('End the current session before starting a tournament.');
  const t=await get('tournaments',id);if(!t)return;
  const deck=await get('decks',t.deck_id);if(!deck||deck.deleted_at||deck.archived)return toast('The registered deck is not active.');
  t.status='active';t.started_at=iso();await save('tournaments',t);
  const session=stampBase({mode:'paper',context:'tournament',event_name:t.name,tournament_id:t.id,started_at:iso(),ended_at:null,pause_intervals:[],paused_at:null,status:'active',active_play_ms:null,tags:['tournament']});
  await save('sessions',session);await setMeta('active_tournament_id',t.id);toast('Tournament started.');setTimeout(()=>location.reload(),250);
}
async function openTournamentSummary(id){
  const t=await get('tournaments',id);if(!t)return;
  const pr=await tournamentProgress(t),{deckMap,legendMap}=await maps();
  modal(t.name,`
    <div class='grid-2'><div class='card stat-card'><div class='k'>Record</div><div class='v'>${pr.rec.w}–${pr.rec.l}</div></div><div class='card stat-card'><div class='k'>Rounds</div><div class='v'>${pr.matches.length}/${t.total_rounds||'?'}</div></div></div>
    <p class='small'><strong>Deck:</strong> ${esc(deckMap[t.deck_id]?.name||'Unknown')} ${esc(deckMap[t.deck_id]?.version||'')}</p>
    <div class='list'>${pr.matches.length?pr.matches.map(m=>`<div class='list-item'><div><div class='title'>Round ${m.round_number||'?'} vs ${esc(legendMap[m.opponent_legend_id]?.name||'Unknown')}</div><div class='meta'>${m.result==='me'?'Win':'Loss'} • ${fmtDate(m.started_at)}</div></div></div>`).join(''):`<div class='empty'>No rounds logged yet.</div>`}</div>
    ${t.notes?`<div class='note' style='margin-top:10px'>${esc(t.notes)}</div>`:''}`);
}

function deckListDiff(a,b){
  const clean=t=>(t||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const count=list=>{const m=new Map();for(const line of list)m.set(line,(m.get(line)||0)+1);return m;};
  const am=count(clean(a)),bm=count(clean(b)),added=[],removed=[];
  for(const [line,n] of bm){const d=n-(am.get(line)||0);for(let i=0;i<d;i++)added.push(line);}
  for(const [line,n] of am){const d=n-(bm.get(line)||0);for(let i=0;i<d;i++)removed.push(line);}
  return {added,removed};
}
async function experimentDeckStats(deckId,targetOppId,startAt){
  let matches=(await all('matches')).filter(m=>m.my_deck_id===deckId&&m.ended_at&&ms(m.started_at)>=ms(startAt));
  if(targetOppId)matches=matches.filter(m=>m.opponent_legend_id===targetOppId);
  return {...recordFor(matches),matches};
}
async function renderExperimentsTab(){
  const p=$('#labPanel');if(!p)return;
  const {deckMap,legendMap}=await maps();
  const rows=(await all('experiments')).sort((a,b)=>(a.status==='active'?-1:1)-(b.status==='active'?-1:1)||ms(b.created_at)-ms(a.created_at));
  let html="<div class='lab-row'><div><div class='strong'>Deck Experiments</div><div class='small muted'>Compare samples without treating correlation as causation.</div></div><button class='btn small primary' id='newExperiment'>+ Experiment</button></div>";
  if(!rows.length)html+="<div class='empty'>No A/B deck experiments yet.</div>";
  for(const e of rows){
    const a=await experimentDeckStats(e.baseline_deck_id,e.target_legend_id,e.started_at),b=await experimentDeckStats(e.variant_deck_id,e.target_legend_id,e.started_at);
    const base=deckMap[e.baseline_deck_id],variant=deckMap[e.variant_deck_id],target=e.target_legend_id?legendMap[e.target_legend_id]?.name:'All matchups';
    html+=`<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>${esc(e.name||'Deck experiment')}</div><div class='lab-meta'>${esc(base?.name||'Baseline')} → ${esc(variant?.name||'Variant')} • ${esc(target||'')}</div></div><span class='lab-chip'>${title(e.status||'active')}</span></div>
      <div class='lab-grid' style='margin-top:10px'><div class='lab-mini'><div class='tiny muted'>BASELINE</div><div class='big'>${a.w}–${a.l}</div><div class='tiny muted'>n=${a.n}</div></div><div class='lab-mini'><div class='tiny muted'>VARIANT</div><div class='big'>${b.w}–${b.l}</div><div class='tiny muted'>n=${b.n}</div></div></div>
      ${e.hypothesis?`<div class='small muted' style='margin-top:8px'>Hypothesis: ${esc(e.hypothesis)}</div>`:''}
      <div class='lab-wrap' style='margin-top:9px'><button class='btn small ghost expCompare' data-id='${e.id}'>Compare lists</button>${e.status==='active'?`<button class='btn small expComplete' data-id='${e.id}'>Complete</button>`:''}</div></div>`;
  }
  p.innerHTML=html;
  $('#newExperiment').onclick=openExperimentModal;
  $$('.expCompare',p).forEach(b=>b.onclick=()=>openExperimentComparison(b.dataset.id));
  $$('.expComplete',p).forEach(b=>b.onclick=async()=>{const e=await get('experiments',b.dataset.id);e.status='completed';e.ended_at=iso();await save('experiments',e);renderLab();});
}
async function openExperimentModal(){
  const {decks,legends,legendMap}=await maps(),active=decks.filter(d=>!d.deleted_at&&!d.archived);
  if(active.length<2)return toast('You need at least two active deck versions/builds.');
  const opts=active.map(d=>`<option value='${d.id}'>${esc(legendMap[d.legend_id]?.name||'')} — ${esc(d.name)} ${esc(d.version||'')}</option>`).join('');
  modal('New deck experiment',`
    <label><span class='label-title'>Experiment name</span><input id='exName' placeholder='e.g. Jayce v3 vs v4'></label>
    <label><span class='label-title'>Baseline deck</span><select id='exBase'>${opts}</select></label>
    <label><span class='label-title'>Variant deck</span><select id='exVariant'>${opts}</select></label>
    <label><span class='label-title'>Target opponent <span class='muted'>(optional)</span></span><select id='exTarget'><option value=''>All matchups</option>${legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Hypothesis</span><textarea id='exHypothesis' placeholder='What should this version improve?'></textarea></label>
    <button class='btn primary full' id='exSave' type='button'>Start experiment</button>`);
  $('#exSave').onclick=async()=>{
    const base=$('#exBase').value,variant=$('#exVariant').value;if(base===variant)return toast('Choose two different decks.');
    const baseDeck=await get('decks',base),variantDeck=await get('decks',variant);
    if(baseDeck?.legend_id!==variantDeck?.legend_id)return toast('A/B experiments should compare decks from the same Legend.');
    const row=stampBase({name:$('#exName').value.trim()||'Deck experiment',baseline_deck_id:base,variant_deck_id:variant,target_legend_id:$('#exTarget').value||null,hypothesis:$('#exHypothesis').value.trim(),status:'active',started_at:iso(),ended_at:null});
    await save('experiments',row);closeModal();renderLab();toast('Experiment started.');
  };
}
async function openExperimentComparison(id){
  const e=await get('experiments',id);if(!e)return;
  const {deckMap}=await maps(),a=deckMap[e.baseline_deck_id],b=deckMap[e.variant_deck_id],diff=deckListDiff(a?.deck_list,b?.deck_list);
  modal('Deck experiment comparison',`
    <p class='small muted'>${esc(a?.name||'Baseline')} ${esc(a?.version||'')} → ${esc(b?.name||'Variant')} ${esc(b?.version||'')}</p>
    <div class='lab-grid'><div class='lab-card'><div class='strong'>Added</div><div class='small' style='white-space:pre-wrap;margin-top:8px'>${diff.added.length?diff.added.map(x=>'+ '+esc(x)).join('\n'):'No added lines'}</div></div><div class='lab-card'><div class='strong'>Removed</div><div class='small' style='white-space:pre-wrap;margin-top:8px'>${diff.removed.length?diff.removed.map(x=>'− '+esc(x)).join('\n'):'No removed lines'}</div></div></div>
    <div class='small muted' style='margin-top:10px'>Use the samples as evidence to investigate. RiftMastery does not assume the deck change caused a result difference.</div>`);
}

async function goalProgress(g){
  const {deckMap}=await maps();
  const start=ms(g.started_at||g.created_at),end=g.end_date?new Date(g.end_date+'T23:59:59').getTime():Infinity;
  let matches=(await all('matches')).filter(m=>m.ended_at&&ms(m.started_at)>=start&&ms(m.started_at)<=end);
  if(g.deck_id)matches=matches.filter(m=>m.my_deck_id===g.deck_id);
  if(g.my_legend_id)matches=matches.filter(m=>deckMap[m.my_deck_id]?.legend_id===g.my_legend_id);
  if(g.opponent_legend_id)matches=matches.filter(m=>m.opponent_legend_id===g.opponent_legend_id);
  const ids=new Set(matches.map(m=>m.id));
  const games=(await all('games')).filter(x=>ids.has(x.match_id)&&x.ended_at);
  let value=0;
  if(g.goal_type==='matches')value=matches.length;
  if(g.goal_type==='games'||g.goal_type==='matchup_games')value=games.length;
  if(g.goal_type==='hours'){
    if(g.deck_id||g.my_legend_id||g.opponent_legend_id)value=matches.reduce((a,m)=>a+(m.active_duration_ms||0),0)/3600000;
    else value=(await all('sessions')).filter(s=>s.status==='completed'&&ms(s.started_at)>=start&&ms(s.started_at)<=end).reduce((a,s)=>a+(s.active_play_ms||0),0)/3600000;
  }
  return {value,matches,games};
}
async function renderGoalsTab(){
  const p=$('#labPanel');if(!p)return;
  const goals=(await all('goals')).sort((a,b)=>(a.status==='active'?-1:1)-(b.status==='active'?-1:1)||ms(b.created_at)-ms(a.created_at));
  const {deckMap,legendMap}=await maps();
  let html="<div class='lab-row'><div><div class='strong'>Goals & Milestones</div><div class='small muted'>Track useful reps, not app-opening streaks.</div></div><button class='btn small primary' id='newGoal'>+ Goal</button></div>";
  if(!goals.length)html+="<div class='empty'>No goals yet.</div>";
  for(const g of goals){
    const pr=await goalProgress(g),target=Math.max(.01,Number(g.target_value)||1),pc=Math.min(100,pr.value/target*100),unit=g.goal_type==='hours'?'h':'';
    const scope=[g.deck_id?deckMap[g.deck_id]?.name:null,g.my_legend_id?legendMap[g.my_legend_id]?.name:null,g.opponent_legend_id?('vs '+legendMap[g.opponent_legend_id]?.name):null].filter(Boolean).join(' • ');
    html+=`<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>${esc(g.label)}</div><div class='lab-meta'>${esc(scope||title(g.goal_type))}${g.end_date?' • by '+esc(g.end_date):''}</div></div><span class='lab-chip'>${title(g.status||'active')}</span></div><div class='lab-progress'><span style='width:${pc}%'></span></div><div class='lab-row' style='margin-top:7px'><span class='small'>${g.goal_type==='hours'?pr.value.toFixed(1):Math.floor(pr.value)}${unit} / ${target}${unit}</span>${g.status==='active'?`<button class='btn small ghost goalDone' data-id='${g.id}'>Complete</button>`:''}</div></div>`;
  }
  p.innerHTML=html;
  $('#newGoal').onclick=openGoalModal;
  $$('.goalDone',p).forEach(b=>b.onclick=async()=>{const g=await get('goals',b.dataset.id);g.status='completed';g.completed_at=iso();await save('goals',g);renderLab();});
}
async function openGoalModal(){
  const {decks,legends,legendMap}=await maps(),activeDecks=decks.filter(d=>!d.deleted_at&&!d.archived),activeLegends=legends.filter(l=>!l.archived).sort((a,b)=>a.name.localeCompare(b.name));
  modal('New development goal',`
    <label><span class='label-title'>Goal name</span><input id='goalLabel' placeholder='e.g. 20 games vs Annie'></label>
    <label><span class='label-title'>Measure</span><select id='goalType'><option value='matches'>Matches</option><option value='games'>Games</option><option value='matchup_games'>Matchup games</option><option value='hours'>Hours</option></select></label>
    <label><span class='label-title'>Target</span><input id='goalTarget' type='number' min='1' step='1' value='20'></label>
    <label><span class='label-title'>Deck <span class='muted'>(optional)</span></span><select id='goalDeck'><option value=''>Any deck</option>${activeDecks.map(d=>`<option value='${d.id}'>${esc(legendMap[d.legend_id]?.name||'')} — ${esc(d.name)} ${esc(d.version||'')}</option>`).join('')}</select></label>
    <label><span class='label-title'>My Legend <span class='muted'>(optional)</span></span><select id='goalMine'><option value=''>Any Legend</option>${activeLegends.map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Opponent Legend <span class='muted'>(optional)</span></span><select id='goalOpp'><option value=''>Any opponent</option>${activeLegends.map(l=>`<option value='${l.id}'>${esc(l.name)}</option>`).join('')}</select></label>
    <label><span class='label-title'>End date <span class='muted'>(optional)</span></span><input id='goalEnd' type='date'></label>
    <button class='btn primary full' id='goalSave' type='button'>Create goal</button>`);
  $('#goalSave').onclick=async()=>{
    const label=$('#goalLabel').value.trim();if(!label)return toast('Name the goal.');
    await save('goals',stampBase({label,goal_type:$('#goalType').value,target_value:Number($('#goalTarget').value)||1,deck_id:$('#goalDeck').value||null,my_legend_id:$('#goalMine').value||null,opponent_legend_id:$('#goalOpp').value||null,end_date:$('#goalEnd').value||null,status:'active',started_at:iso()}));
    closeModal();renderLab();toast('Goal created.');
  };
}

async function renderToolsTab(){
  const p=$('#labPanel');if(!p)return;
  const scoreSources=await getMeta('score_sources',scoreDefaults());
  const leakTags=await getMeta('leak_tags',leakDefaults());
  p.innerHTML=`
    <div class='lab-card'>
      <div class='lab-title'>Global Search</div><div class='lab-meta'>Search decks, notes, opponents, events, and testing blocks.</div>
      <div class='btn-row' style='margin-top:9px'><input id='globalSearch' placeholder='Search RiftMastery'><button class='btn primary' id='globalSearchGo' type='button'>Search</button></div>
    </div>
    <div class='lab-card'><div class='lab-title'>ChatGPT Analysis Brief</div><div class='lab-meta'>Build a structured snapshot of your recent development data without paying for an in-app AI API.</div><button class='btn full' id='copyAnalysisBrief' type='button' style='margin-top:9px'>Copy analysis brief</button></div>
    <div class='lab-card'><div class='lab-title'>Old Match Import</div><div class='lab-meta'>Import a RiftMastery-format CSV or a CSV with matching column names.</div><button class='btn full' id='importMatchCsv' type='button' style='margin-top:9px'>Import match CSV</button></div>
    <div class='lab-card'><div class='lab-row'><div><div class='lab-title'>Scoring Sources</div><div class='lab-meta'>Conquer / Hold / Effect stay built in. Add extra labels for special scoring.</div></div><button class='btn small primary' id='addScoreSource' type='button'>+ Source</button></div><div class='lab-wrap' style='margin-top:9px'>${scoreSources.map(s=>`<span class='lab-chip'>${esc(s.label)}${['conquer','hold','effect'].includes(s.id)?'':` <button class='link-btn removeScoreSource' data-id='${s.id}' type='button'>×</button>`}</span>`).join('')}</div></div>
    <div class='lab-card'><div class='lab-row'><div><div class='lab-title'>Review Tags</div><div class='lab-meta'>Tags feed the recurring-pattern tracker.</div></div><button class='btn small primary' id='addLeakTag' type='button'>+ Tag</button></div><div class='lab-wrap' style='margin-top:9px'>${leakTags.map(t=>`<span class='lab-chip'>${esc(t)}</span>`).join('')}</div></div>
  `;
  $('#globalSearchGo').onclick=()=>openGlobalSearch($('#globalSearch').value);
  $('#globalSearch').onkeydown=e=>{if(e.key==='Enter')openGlobalSearch(e.target.value);};
  $('#copyAnalysisBrief').onclick=copyDevelopmentAnalysisBrief;
  $('#importMatchCsv').onclick=importMatchCsv;
  $('#addScoreSource').onclick=openScoreSourceModal;
  $$('.removeScoreSource',p).forEach(b=>b.onclick=()=>removeScoreSource(b.dataset.id));
  $('#addLeakTag').onclick=openLeakTagModal;
}

async function copyDevelopmentAnalysisBrief(){
  const {deckMap,legendMap}=await maps();
  const matches=(await all('matches')).filter(m=>m.ended_at).sort((a,b)=>ms(b.started_at)-ms(a.started_at)).slice(0,50);
  const rec=recordFor(matches),leaks=await leakCountsForMatches(matches.map(m=>m.id));
  const goals=(await all('goals')).filter(g=>g.status==='active');
  const experiments=(await all('experiments')).filter(e=>e.status==='active');
  const notes=(await all('matchupNotes')).filter(n=>n.favorite||Number(n.confidence)>0);
  const byDeck={};
  for(const m of matches){const d=deckMap[m.my_deck_id],key=d?(d.name+' '+(d.version||'')):'Unknown';byDeck[key]=byDeck[key]||[];byDeck[key].push(m);}
  const lines=[
    'RiftMastery Development Analysis Brief',
    'Recent formal record: '+rec.w+'-'+rec.l+' across '+rec.n+' matches',
    '',
    'Recent deck samples:'
  ];
  for(const [name,rows] of Object.entries(byDeck)){const r=recordFor(rows);lines.push('- '+name+': '+r.w+'-'+r.l+' (n='+r.n+')');}
  lines.push('','Recurring review patterns:');
  if(leaks.length)for(const x of leaks.slice(0,8))lines.push('- '+x.tag+': '+x.count);else lines.push('- None tagged/inferred yet');
  lines.push('','Active goals:');
  if(goals.length)for(const g of goals)lines.push('- '+g.label+' — target '+g.target_value+' '+g.goal_type);else lines.push('- None');
  lines.push('','Active deck experiments:');
  if(experiments.length)for(const e of experiments)lines.push('- '+e.name+': '+(deckMap[e.baseline_deck_id]?.name||'baseline')+' vs '+(deckMap[e.variant_deck_id]?.name||'variant')+' — '+(e.hypothesis||'no hypothesis noted'));else lines.push('- None');
  lines.push('','Saved matchup confidence:');
  if(notes.length)for(const n of notes)lines.push('- '+(legendMap[n.my_legend_id]?.name||'Mine')+' vs '+(legendMap[n.opponent_legend_id]?.name||'Opp')+': '+(n.confidence||0)+'/5');else lines.push('- None');
  lines.push('','Please identify repeated development patterns, questions worth investigating, and drills to test next. Do not assume correlation proves causation.');
  await copyOrShare(lines.join('\n'),'RiftMastery analysis brief');
}
async function openGlobalSearch(query){
  const q=(query||'').trim().toLowerCase();if(!q)return toast('Enter something to search.');
  const {deckMap,legendMap}=await maps();
  const [decks,notes,matches,events,blocks,sessions]=await Promise.all([all('decks',{includeDeleted:true}),all('notes'),all('matches'),all('tournaments'),all('testingBlocks'),all('sessions')]);
  const results=[];
  for(const d of decks)if([d.name,d.version,d.notes,d.deck_list].some(x=>String(x||'').toLowerCase().includes(q)))results.push({type:'Deck',title:d.name+(d.version?' '+d.version:''),meta:legendMap[d.legend_id]?.name||''});
  for(const n of notes)if(String(n.text||'').toLowerCase().includes(q))results.push({type:'Note',title:n.text.slice(0,90),meta:fmtDate(n.timestamp)});
  for(const m of matches){const hay=[deckMap[m.my_deck_id]?.name,legendMap[m.opponent_legend_id]?.name,m.notes,m.context,m.format].join(' ').toLowerCase();if(hay.includes(q))results.push({type:'Match',title:(deckMap[m.my_deck_id]?.name||'Deck')+' vs '+(legendMap[m.opponent_legend_id]?.name||'Opponent'),meta:fmtDate(m.started_at)});}
  for(const e of events)if([e.name,e.notes].some(x=>String(x||'').toLowerCase().includes(q)))results.push({type:'Event',title:e.name,meta:fmtDate(e.event_date)});
  for(const b of blocks)if([b.name,b.hypothesis].some(x=>String(x||'').toLowerCase().includes(q)))results.push({type:'Testing',title:b.name,meta:title(b.status)});
  for(const s of sessions){const hay=[s.event_name,s.context,...(s.tags||[])].join(' ').toLowerCase();if(hay.includes(q))results.push({type:'Session',title:s.event_name||title(s.context),meta:fmtDate(s.started_at)});}
  modal('Search results',results.length?`<div class='list'>${results.slice(0,100).map(r=>`<div class='list-item'><div><div class='title'>${esc(r.title)}</div><div class='meta'>${esc(r.type)} • ${esc(r.meta)}</div></div></div>`).join('')}</div>`:`<div class='empty'>No results for “${esc(query)}”.</div>`);
}
async function openScoreSourceModal(){
  modal('Add scoring source',`<label><span class='label-title'>Label</span><input id='scoreSourceLabel' placeholder='e.g. Champion Effect'></label><button class='btn primary full' id='scoreSourceSave' type='button'>Add source</button>`);
  $('#scoreSourceSave').onclick=async()=>{
    const label=$('#scoreSourceLabel').value.trim();if(!label)return toast('Name the scoring source.');
    const list=await getMeta('score_sources',scoreDefaults());const id='custom_'+crypto.randomUUID().slice(0,8);list.push({id,label});await setMeta('score_sources',list);closeModal();renderLab();toast('Scoring source added.');
  };
}
async function removeScoreSource(id){
  const list=await getMeta('score_sources',scoreDefaults());await setMeta('score_sources',list.filter(x=>x.id!==id));renderLab();
}
async function openLeakTagModal(){
  modal('Add review tag',`<label><span class='label-title'>Tag</span><input id='leakTagName' placeholder='e.g. Greedy Keep'></label><button class='btn primary full' id='leakTagSave' type='button'>Add tag</button>`);
  $('#leakTagSave').onclick=async()=>{const tag=$('#leakTagName').value.trim();if(!tag)return;const list=await getMeta('leak_tags',leakDefaults());if(!list.some(x=>x.toLowerCase()===tag.toLowerCase()))list.push(tag);await setMeta('leak_tags',list);closeModal();renderLab();};
}
async function importMatchCsv(){
  const input=document.createElement('input');input.type='file';input.accept='.csv,text/csv';
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;const rows=csvParse(await file.text());if(rows.length<2)return toast('CSV has no match rows.');
    const headers=rows[0].map(x=>x.trim());const required=['date','mode','context','format','my_deck','my_legend','opponent_legend','result'];if(required.some(h=>!headers.includes(h)))return toast('CSV is missing required RiftMastery columns.');
    const getCell=(row,key)=>row[headers.indexOf(key)]||'';
    const {legends,decks}=await maps();let imported=0;
    for(const row of rows.slice(1)){
      const myLegendName=getCell(row,'my_legend').trim(),oppName=getCell(row,'opponent_legend').trim(),deckName=getCell(row,'my_deck').trim();if(!myLegendName||!oppName||!deckName)continue;
      let myLegend=legends.find(l=>l.name.toLowerCase()===myLegendName.toLowerCase());if(!myLegend){myLegend=stampBase({name:myLegendName,archived:false});await save('legends',myLegend);legends.push(myLegend);}
      let opp=legends.find(l=>l.name.toLowerCase()===oppName.toLowerCase());if(!opp){opp=stampBase({name:oppName,archived:false});await save('legends',opp);legends.push(opp);}
      const version=getCell(row,'my_deck_version').trim();let deck=decks.find(d=>!d.deleted_at&&d.legend_id===myLegend.id&&d.name.toLowerCase()===deckName.toLowerCase()&&String(d.version||'').toLowerCase()===version.toLowerCase());
      if(!deck){deck=stampBase({name:deckName,version,legend_id:myLegend.id,deck_list:'',notes:'Imported from CSV',archived:false});await save('decks',deck);decks.push(deck);}
      const start=new Date(getCell(row,'date'));if(Number.isNaN(start.getTime()))continue;const dur=Math.max(0,Number(getCell(row,'active_minutes'))||0)*60000,end=new Date(start.getTime()+dur).toISOString();
      const session=stampBase({mode:getCell(row,'mode')||'paper',context:getCell(row,'context')||'testing',event_name:'CSV import',started_at:start.toISOString(),ended_at:end,pause_intervals:[],status:'completed',active_play_ms:dur});await save('sessions',session);
      const resultRaw=getCell(row,'result').toLowerCase();const result=resultRaw==='me'||resultRaw==='win'||resultRaw==='w'?'me':resultRaw==='opponent'||resultRaw==='loss'||resultRaw==='l'?'opponent':null;
      const match=stampBase({session_id:session.id,mode:session.mode,context:session.context,my_deck_id:deck.id,opponent_legend_id:opp.id,format:getCell(row,'format')||'BO3',started_at:start.toISOString(),ended_at:end,result,notes:getCell(row,'notes'),active_duration_ms:dur});await save('matches',match);
      const gw=Math.max(0,Number(getCell(row,'games_won'))||0),gl=Math.max(0,Number(getCell(row,'games_lost'))||0);let n=1;
      for(let i=0;i<gw;i++)await save('games',stampBase({match_id:match.id,game_number:n++,winner:'me',who_started:'unknown',started_at:start.toISOString(),ended_at:end,final_my_points:null,final_opponent_points:null}));
      for(let i=0;i<gl;i++)await save('games',stampBase({match_id:match.id,game_number:n++,winner:'opponent',who_started:'unknown',started_at:start.toISOString(),ended_at:end,final_my_points:null,final_opponent_points:null}));
      imported++;
    }
    toast('Imported '+imported+' matches.');if($('#screen-history')?.classList.contains('active'))document.querySelector('[data-nav="history"]')?.click();
  };
  input.click();
}

async function renderSkillsTab(){
  const p=$('#labPanel');if(!p)return;
  const rows=(await all('skillAreas')).filter(x=>!x.archived).sort((a,b)=>a.name.localeCompare(b.name));
  p.innerHTML=`
    <div class='lab-row'><div><div class='strong'>Training Areas</div><div class='small muted'>Use these as personal progress markers.</div></div><button class='btn small primary' id='newTrainingArea'>+ Area</button></div>
    <div class='lab-panel'>${rows.length?rows.map(x=>`<div class='lab-card'><div class='lab-row'><div><div class='lab-title'>${esc(x.name)}</div><div class='lab-meta'>Current self-rating: ${Number(x.rating)||0}/5</div></div><button class='btn small ghost trainingEdit' data-id='${x.id}'>Edit</button></div><div class='segmented trainingRate' data-id='${x.id}' style='margin-top:9px'>${[1,2,3,4,5].map(n=>`<button data-rate='${n}' class='${Number(x.rating)===n?'active':''}'>${n}</button>`).join('')}</div>${x.notes?`<div class='small muted' style='margin-top:8px'>${esc(x.notes)}</div>`:''}</div>`).join(''):`<div class='empty'>No training areas yet.</div>`}</div>`;
  $('#newTrainingArea').onclick=()=>openTrainingAreaModal();
  $$('.trainingEdit',p).forEach(b=>b.onclick=()=>openTrainingAreaModal(b.dataset.id));
  $$('.trainingRate button',p).forEach(b=>b.onclick=async()=>{const id=b.closest('.trainingRate').dataset.id,row=await get('skillAreas',id);row.rating=Number(b.dataset.rate);await save('skillAreas',row);renderLab();});
}
async function openTrainingAreaModal(id=null){
  const row=id?await get('skillAreas',id):null;
  modal(row?'Edit training area':'Add training area',`
    <label><span class='label-title'>Name</span><input id='trainingName' value='${esc(row?.name||'')}'></label>
    <label><span class='label-title'>Notes</span><textarea id='trainingNotes'>${esc(row?.notes||'')}</textarea></label>
    <div class='btn-row'>${row?`<button class='btn danger' id='trainingArchive' type='button'>Archive</button>`:''}<button class='btn primary' id='trainingSave' type='button'>Save</button></div>`);
  $('#trainingSave').onclick=async()=>{const name=$('#trainingName').value.trim();if(!name)return toast('Name the training area.');const x=row||stampBase({rating:0,archived:false});x.name=name;x.notes=$('#trainingNotes').value.trim();await save('skillAreas',x);closeModal();renderLab();};
  if(row)$('#trainingArchive').onclick=async()=>{row.archived=true;await save('skillAreas',row);closeModal();renderLab();};
}

function localDayKey(v){
  const d=new Date(v),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function streakStats(days){
  const sorted=[...new Set(days)].sort();
  if(!sorted.length)return {current:0,longest:0};
  let longest=1,run=1;
  for(let i=1;i<sorted.length;i++){
    const prev=new Date(sorted[i-1]+'T12:00:00'),cur=new Date(sorted[i]+'T12:00:00');
    if((cur-prev)/86400000===1){run++;longest=Math.max(longest,run);}else run=1;
  }
  const set=new Set(sorted),today=new Date(),todayKey=localDayKey(today),y=new Date(today);y.setDate(y.getDate()-1);let cursor=set.has(todayKey)?today:set.has(localDayKey(y))?y:null,current=0;
  while(cursor&&set.has(localDayKey(cursor))){current++;const n=new Date(cursor);n.setDate(n.getDate()-1);cursor=n;}
  return {current,longest};
}
async function calendarHtml(){
  const sessions=(await all('sessions')).filter(s=>s.started_at);
  const matches=await all('matches');
  const now=new Date(),year=now.getFullYear(),month=now.getMonth();
  const first=new Date(year,month,1),daysIn=new Date(year,month+1,0).getDate(),offset=first.getDay();
  const byDay={};
  for(const s of sessions){
    const d=new Date(s.started_at);if(d.getFullYear()!==year||d.getMonth()!==month)continue;
    const k=d.getDate();byDay[k]=byDay[k]||{ms:0,matches:0};byDay[k].ms+=s.active_play_ms||0;
  }
  for(const m of matches){const d=new Date(m.started_at);if(d.getFullYear()!==year||d.getMonth()!==month)continue;const k=d.getDate();byDay[k]=byDay[k]||{ms:0,matches:0};byDay[k].matches++;}
  let cells='';for(let i=0;i<offset;i++)cells+="<div class='lab-day' style='opacity:.25'></div>";
  for(let d=1;d<=daysIn;d++){const x=byDay[d];cells+=`<div class='lab-day ${x?'active':''}'><strong>${d}</strong>${x?`<span>${x.matches}m</span><br><span>${Math.round(x.ms/60000)} min</span>`:''}</div>`;}
  return `<div class='small muted' style='margin-bottom:6px'>${first.toLocaleString([], {month:'long',year:'numeric'})}</div><div class='lab-calendar'>${cells}</div>`;
}
async function enhanceStats(stats){
  let extra=$('#labStatsExtra',stats);if(!extra){extra=document.createElement('div');extra.id='labStatsExtra';extra.className='lab-shell';stats.appendChild(extra);}
  const scope=$('#statsScope')?.value||'overall',parts=scope.split(':'),type=parts[0],id=parts[1];
  const {deckMap,legendMap}=await maps();
  let matches=(await all('matches')).filter(m=>m.ended_at).sort((a,b)=>ms(b.started_at)-ms(a.started_at));
  if(type==='legend')matches=matches.filter(m=>deckMap[m.my_deck_id]?.legend_id===id);
  if(type==='deck')matches=matches.filter(m=>m.my_deck_id===id);
  const formal=matches.filter(m=>m.result==='me'||m.result==='opponent');
  const statsNotes=await all('notes'),statsMu=await all('matchupNotes'),statsSessions=await all('sessions');
  const labKey=[scope,matches.length,matches[0]?.updated_at||'',statsNotes.length,statsNotes.at(-1)?.updated_at||'',statsMu.length,statsMu.at(-1)?.updated_at||'',statsSessions.length,statsSessions.at(-1)?.updated_at||''].join('|');
  if(extra.dataset.labKey===labKey)return;
  extra.dataset.labKey=labKey;
  const matchIds=new Set(matches.map(m=>m.id)),games=(await all('games')).filter(g=>matchIds.has(g.match_id)&&g.ended_at);
  const first=games.filter(g=>g.who_started==='me'),second=games.filter(g=>g.who_started==='opponent');
  const trend=n=>{const rows=formal.slice(0,n),w=rows.filter(m=>m.result==='me').length;return {n:rows.length,w,l:rows.length-w};};
  const t10=trend(10),t25=trend(25),t50=trend(50);
  const sessions=(await all('sessions')).filter(s=>(s.active_play_ms||0)>0||s.status==='active'),days=sessions.map(s=>localDayKey(s.started_at)),streak=streakStats(days);
  const leaks=await leakCountsForMatches(matches.map(m=>m.id));
  let fav='';
  if(type==='legend'){
    const notes=(await all('matchupNotes')).filter(n=>n.my_legend_id===id&&n.favorite);
    if(notes.length)fav=`<div class='section-head'><h3>Favorite Matchups</h3></div><div class='lab-wrap'>${notes.map(n=>`<button class='btn small ghost labFavMu' data-opp='${n.opponent_legend_id}'>${esc(legendMap[n.opponent_legend_id]?.name||'Opponent')} • ${n.confidence||0}/5</button>`).join('')}</div>`;
  }
  extra.innerHTML=`
    <div class='section-head'><h3>Rolling Form</h3><div class='sub'>Recent formal matches</div></div>
    <div class='lab-trend'>${[[10,t10],[25,t25],[50,t50]].map(([n,x])=>`<div class='lab-mini'><div class='tiny muted'>LAST ${n}</div><div class='big'>${x.w}–${x.l}</div><div class='tiny muted'>${pct(x.w,x.n)} • n=${x.n}</div></div>`).join('')}</div>
    <div class='section-head'><h3>First / Second</h3><div class='sub'>Game results</div></div>
    <div class='grid-2'><div class='lab-card'><div class='tiny muted'>GOING FIRST</div><div class='lab-title'>${first.filter(g=>g.winner==='me').length}–${first.filter(g=>g.winner==='opponent').length}</div><div class='lab-meta'>n=${first.length}</div></div><div class='lab-card'><div class='tiny muted'>GOING SECOND</div><div class='lab-title'>${second.filter(g=>g.winner==='me').length}–${second.filter(g=>g.winner==='opponent').length}</div><div class='lab-meta'>n=${second.length}</div></div></div>
    <div class='section-head'><h3>Development Rhythm</h3></div>
    <div class='grid-2'><div class='lab-card'><div class='tiny muted'>CURRENT STREAK</div><div class='lab-title'>${streak.current} day${streak.current===1?'':'s'}</div></div><div class='lab-card'><div class='tiny muted'>LONGEST STREAK</div><div class='lab-title'>${streak.longest} day${streak.longest===1?'':'s'}</div></div></div>
    <div class='section-head'><h3>Calendar</h3></div>${await calendarHtml()}
    ${fav}
    <div class='section-head'><h3>Repeated Review Tags</h3></div>${leaks.length?`<div class='lab-wrap'>${leaks.slice(0,8).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>`:`<div class='empty'>No tagged review patterns in this scope yet.</div>`}
  `;
  const gameIds=new Set(games.map(g=>g.id));
  const pointEvents=(await all('pointEvents')).filter(e=>gameIds.has(e.game_id)&&Number(e.amount)>0);
  const sources=await getMeta('score_sources',scoreDefaults());
  const custom=sources.filter(s=>!['conquer','hold','effect'].includes(s.id)).map(s=>({label:s.label,me:pointEvents.filter(e=>e.side==='me'&&e.source===s.id).reduce((a,e)=>a+Number(e.amount),0),opp:pointEvents.filter(e=>e.side==='opponent'&&e.source===s.id).reduce((a,e)=>a+Number(e.amount),0)})).filter(x=>x.me||x.opp);
  if(custom.length)extra.insertAdjacentHTML('beforeend',`<div class='section-head'><h3>Custom Scoring Sources</h3></div><div class='lab-panel'>${custom.map(x=>`<div class='lab-card lab-row'><span>${esc(x.label)}</span><span class='small muted'>You ${x.me} • Opp ${x.opp}</span></div>`).join('')}</div>`);
  $('.labFavMu',extra).forEach(b=>b.onclick=()=>openMatchupPage(id,b.dataset.opp));
  if(type==='legend'){
    $$('.matrixRow',stats).forEach(row=>{
      if(row.dataset.labBound)return;row.dataset.labBound='1';
      row.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openMatchupPage(id,row.dataset.opp);},true);
    });
  }
}

async function activeGameContext(){
  const session=await latestActiveSession();if(!session)return {};
  const matches=(await byIndex('matches','session_id',session.id)).filter(m=>!m.ended_at).sort((a,b)=>ms(b.started_at)-ms(a.started_at));
  const match=matches[0]||null;if(!match)return {session};
  const games=(await byIndex('games','match_id',match.id)).filter(g=>!g.ended_at).sort((a,b)=>a.game_number-b.game_number);
  return {session,match,game:games[0]||null};
}
async function leakChooserHtml(){
  const tags=await getMeta('leak_tags',leakDefaults());
  return `<div id='labLeakChooser'><div class='small muted' style='margin:10px 0 6px'>Review tags</div><div class='lab-tag-grid'>${tags.map(t=>`<label><input type='checkbox' value='${esc(t)}'>${esc(t)}</label>`).join('')}</div></div>`;
}
async function queueLeakTags(tags){
  if(!tags.length)return;
  const ctx=await activeGameContext();
  await setMeta('pending_leak_tags',{tags,at:Date.now(),session_id:ctx.session?.id||null,match_id:ctx.match?.id||null,game_id:ctx.game?.id||null});
  setTimeout(resolvePendingLeakTags,900);
}
async function resolvePendingLeakTags(){
  const pending=await getMeta('pending_leak_tags',null);if(!pending)return;
  const notes=(await all('notes')).filter(n=>ms(n.created_at||n.timestamp)>=pending.at-2500).sort((a,b)=>ms(b.created_at||b.timestamp)-ms(a.created_at||a.timestamp));
  let note=notes.find(n=>(!pending.match_id||n.match_id===pending.match_id)&&(!pending.game_id||!n.game_id||n.game_id===pending.game_id));
  if(note){note.leak_tags=[...new Set([...(note.leak_tags||[]),...pending.tags])];await save('notes',note);}
  else await save('notes',stampBase({session_id:pending.session_id,match_id:pending.match_id,game_id:pending.game_id,text:'Tagged review: '+pending.tags.join(', '),leak_tags:pending.tags,timestamp:iso(),review_type:'tag_only'}));
  await setMeta('pending_leak_tags',null);
}
async function assignPendingSessionTags(){
  const pending=await getMeta('pending_session_tags',null);if(!pending)return;
  const session=await latestActiveSession();if(!session)return;
  session.tags=[...new Set([...(session.tags||[]),...pending.tags])];await save('sessions',session);await setMeta('pending_session_tags',null);
}
async function assignPendingMatchContext(){
  const pending=await getMeta('pending_match_context',null);if(!pending)return;
  const session=await latestActiveSession();if(!session)return;
  const matches=(await byIndex('matches','session_id',session.id)).sort((a,b)=>ms(b.started_at)-ms(a.started_at));
  const match=matches[0];if(!match||ms(match.started_at)<pending.at-4000)return;
  if(pending.testing_block_id){
    const block=await get('testingBlocks',pending.testing_block_id);
    if(block&&block.deck_id===match.my_deck_id)match.testing_block_id=block.id;
  }
  if(session.tournament_id){
    match.tournament_id=session.tournament_id;
    const eventMatches=(await all('matches')).filter(m=>m.tournament_id===session.tournament_id&&m.id!==match.id).sort((a,b)=>ms(a.started_at)-ms(b.started_at));
    match.round_number=eventMatches.length+1;
  }
  if(pending.tags?.length)match.tags=[...new Set([...(match.tags||[]),...pending.tags])];
  await save('matches',match);await setMeta('pending_match_context',null);
}
async function syncTournamentAssignments(){
  const sessions=(await all('sessions')).filter(s=>s.tournament_id);
  for(const session of sessions){
    const matches=(await byIndex('matches','session_id',session.id)).sort((a,b)=>ms(a.started_at)-ms(b.started_at));
    for(let i=0;i<matches.length;i++){
      const m=matches[i];if(m.tournament_id!==session.tournament_id||m.round_number!==i+1){m.tournament_id=session.tournament_id;m.round_number=i+1;await save('matches',m);}
    }
    if(session.status==='completed'){
      const t=await get('tournaments',session.tournament_id);
      if(t&&t.status==='active'){t.status='completed';t.ended_at=session.ended_at||iso();await save('tournaments',t);if((await getMeta('active_tournament_id',''))===t.id)await setMeta('active_tournament_id','');}
    }
  }
}
async function syncTestingTargets(){
  const blocks=(await all('testingBlocks')).filter(b=>b.status==='active');
  for(const b of blocks){const pr=await blockProgress(b),target=Number(b.target_matches||b.target_games)||10,progress=b.target_matches?pr.matchCount:pr.count;if(progress>=target&&!b.target_reached_at){b.target_reached_at=iso();await save('testingBlocks',b);}}
}

async function enhanceModal(){
  const d=$('#modal');if(!d?.open)return;
  const titleText=$('#modalTitle')?.textContent||'',body=$('#modalBody');if(!body)return;

  if((titleText==='Quick note'||titleText==='Match saved')&&!$('#labLeakChooser',body)){
    const wrap=document.createElement('div');wrap.innerHTML=await leakChooserHtml();const node=wrap.firstElementChild;
    const target=titleText==='Quick note'?$('#saveQuickNote',body):$('#saveReview',body);
    target?.parentNode?.insertBefore(node,target);
    if(target)target.addEventListener('click',()=>{const tags=$$('#labLeakChooser input:checked',body).map(x=>x.value);queueLeakTags(tags);},{capture:true});
  }

  if((titleText==='Start paper session'||titleText==='Start online session')&&!$('#labSessionTags',body)){
    const btn=$('#createSession',body);if(btn){
      const label=document.createElement('label');
      label.innerHTML="<span class='label-title'>Session tags <span class='muted'>(optional, comma-separated)</span></span><input id='labSessionTags' placeholder='regional prep, new list, matchup lab'>";
      btn.parentNode.insertBefore(label,btn);
      btn.addEventListener('click',()=>{
        const tags=$('#labSessionTags',body).value.split(',').map(x=>x.trim()).filter(Boolean);
        if(tags.length)setMeta('pending_session_tags',{tags,at:Date.now()}).then(()=>setTimeout(assignPendingSessionTags,700));
      },{capture:true});
    }
  }

  if(titleText==='New match'&&!$('#labMatchExtras',body)){
    const deckSel=$('#matchDeck',body),formatSel=$('#matchFormat',body),btn=$('#startMatch',body);
    if(deckSel&&btn){
      const session=await latestActiveSession(),blocks=(await all('testingBlocks')).filter(b=>b.status==='active');
      const holder=document.createElement('div');holder.id='labMatchExtras';
      const refresh=async()=>{
        const deckId=deckSel.value,matching=blocks.filter(b=>b.deck_id===deckId);
        holder.innerHTML=`<label><span class='label-title'>Testing block <span class='muted'>(optional)</span></span><select id='labTestingBlock'><option value=''>None</option>${matching.map((b,i)=>`<option value='${b.id}' ${matching.length===1||i===0?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label>
        <label><span class='label-title'>Match tags <span class='muted'>(optional)</span></span><input id='labMatchTags' placeholder='mulligan focus, tempo test'></label>`;
        if(session?.tournament_id){
          const t=await get('tournaments',session.tournament_id);
          if(t){
            deckSel.value=t.deck_id;deckSel.disabled=true;
            formatSel.value=t.format||'BO3';formatSel.disabled=true;
            const count=(await all('matches')).filter(m=>m.tournament_id===t.id).length;
            holder.insertAdjacentHTML('afterbegin',`<div class='lab-card' style='margin-bottom:9px'><div class='lab-title'>${esc(t.name)}</div><div class='lab-meta'>Round ${count+1} • Tournament deck locked</div></div>`);
          }
        }
      };
      await refresh();deckSel.addEventListener('change',refresh);btn.parentNode.insertBefore(holder,btn);
      btn.addEventListener('click',()=>{
        const blockId=$('#labTestingBlock',body)?.value||'';
        const tags=($('#labMatchTags',body)?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
        setMeta('pending_match_context',{testing_block_id:blockId||null,tags,at:Date.now()}).then(()=>setTimeout(assignPendingMatchContext,700));
      },{capture:true});
    }
  }
}

async function enhanceLiveScore(){
  const play=$('#screen-play');if(!play?.classList.contains('active'))return;
  const sources=(await getMeta('score_sources',scoreDefaults())).filter(s=>!['conquer','hold','effect'].includes(s.id));
  if(!sources.length)return;
  const sides=$$('.score-side',play);
  for(let i=0;i<sides.length;i++){
    const side=sides[i];if($('.lab-score-more',side))continue;
    const b=document.createElement('button');b.className='lab-score-more';b.textContent='MORE +';b.type='button';
    b.onclick=()=>openCustomScoreModal(i===0?'me':'opponent',sources);side.appendChild(b);
  }
}
async function openCustomScoreModal(side,sources){
  modal((side==='me'?'Your':'Opponent')+' custom points',`
    <label><span class='label-title'>Source</span><select id='customPointSource'>${sources.map(s=>`<option value='${s.id}'>${esc(s.label)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Points</span><input id='customPointAmount' type='number' min='-20' max='20' value='1'></label>
    <label><span class='label-title'>Note <span class='muted'>(optional)</span></span><input id='customPointNote'></label>
    <button class='btn primary full' id='customPointSave' type='button'>Add points</button>`);
  $('#customPointSave').onclick=async()=>{
    const ctx=await activeGameContext();if(!ctx.game)return toast('No active game.');
    const amount=Number($('#customPointAmount').value);if(!Number.isFinite(amount)||amount===0)return toast('Enter a non-zero amount.');
    await save('pointEvents',stampBase({game_id:ctx.game.id,side,amount,source:$('#customPointSource').value,effect_note:$('#customPointNote').value.trim(),timestamp:iso()}));
    closeModal();document.querySelector('[data-nav="play"]')?.click();
  };
}
async function sessionSummaryText(sessionId){
  const session=await get('sessions',sessionId),{deckMap,legendMap}=await maps();
  const matches=(await byIndex('matches','session_id',sessionId)).filter(m=>m.ended_at).sort((a,b)=>ms(a.started_at)-ms(b.started_at)),rec=recordFor(matches);
  const ids=new Set(matches.map(m=>m.id)),games=(await all('games')).filter(g=>ids.has(g.match_id)&&g.ended_at),gw=games.filter(g=>g.winner==='me').length;
  const decks=[...new Set(matches.map(m=>deckMap[m.my_deck_id]?.name).filter(Boolean))],opps=[...new Set(matches.map(m=>legendMap[m.opponent_legend_id]?.name).filter(Boolean))];
  return `RiftMastery Session
${session.event_name||title(session.context)}
${fmtDate(session.started_at)}
Active time: ${fmtHours(session.active_play_ms||0)}
Match record: ${rec.w}-${rec.l} (n=${rec.n})
Game record: ${gw}-${games.length-gw} (n=${games.length})
Decks: ${decks.join(', ')||'—'}
Opponents: ${opps.join(', ')||'—'}\nTags: ${(session.tags||[]).join(', ')||'—'}`;
}
async function enhanceSessionSummaryShare(){
  const d=$('#modal');if(!d?.open||$('#modalTitle')?.textContent!=='Session summary')return;
  const body=$('#modalBody');if(!body||$('#labShareSummary',body))return;
  const sessions=(await all('sessions')).filter(s=>s.status==='completed').sort((a,b)=>ms(b.ended_at)-ms(a.ended_at)),session=sessions[0];if(!session)return;
  const row=document.createElement('div');row.id='labShareSummary';row.className='btn-row';row.style.marginTop='10px';row.innerHTML="<button class='btn' id='labShareText' type='button'>Share Text</button><button class='btn' id='labDownloadSummary' type='button'>Save Summary Image</button>";body.appendChild(row);
  $('#labShareText',body).onclick=async()=>copyOrShare(await sessionSummaryText(session.id),'RiftMastery session');
  $('#labDownloadSummary',body).onclick=()=>downloadSessionImage(session.id);
}
async function downloadSessionImage(sessionId){
  const text=await sessionSummaryText(sessionId),canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#0b1114';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#d5b779';ctx.font='bold 52px system-ui';ctx.fillText('RIFTMASTERY',70,100);ctx.fillStyle='#f2f0e9';ctx.font='38px system-ui';
  let y=190;
  for(const raw of text.split('\n').slice(1)){
    const words=raw.split(' ');let line='';
    for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>930){ctx.fillText(line,70,y);y+=58;line=word;}else line=test;}
    if(line){ctx.fillText(line,70,y);y+=58;}y+=18;
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)downloadBlob(blob,'riftmastery-session.png');
}

async function assignPendingOnlineBlock(){
  const pending=await getMeta('pending_online_block',null);if(!pending)return;
  const matches=(await all('matches')).filter(m=>ms(m.created_at||m.started_at)>=pending.at-4000).sort((a,b)=>ms(b.created_at||b.started_at)-ms(a.created_at||a.started_at));
  const match=matches[0];if(!match)return;
  if(pending.testing_block_id){
    const block=await get('testingBlocks',pending.testing_block_id);
    if(block&&block.deck_id===match.my_deck_id){match.testing_block_id=block.id;await save('matches',match);}
  }
  await setMeta('pending_online_block',null);
}
async function enhanceOnlineLogModal(){
  const d=$('#modal');if(!d?.open||$('#modalTitle')?.textContent!=='Log online match')return;
  const body=$('#modalBody');if(!body||$('#labOnlineExtras',body))return;
  const deckSel=$('#onlineDeck',body),btn=$('#saveOnlineMatch',body);if(!deckSel||!btn)return;
  const holder=document.createElement('div');holder.id='labOnlineExtras';
  const refresh=async()=>{
    const blocks=(await all('testingBlocks')).filter(b=>b.status==='active'&&b.deck_id===deckSel.value);
    const tags=await getMeta('leak_tags',leakDefaults());
    holder.innerHTML=`<label><span class='label-title'>Testing block <span class='muted'>(optional)</span></span><select id='labOnlineBlock'><option value=''>None</option>${blocks.map(b=>`<option value='${b.id}'>${esc(b.name)}</option>`).join('')}</select></label>
      <div class='small muted' style='margin:8px 0 5px'>Review tags</div><div class='lab-tag-grid' id='labOnlineTags'>${tags.map(t=>`<label><input type='checkbox' value='${esc(t)}'>${esc(t)}</label>`).join('')}</div>`;
  };
  await refresh();deckSel.addEventListener('change',refresh);btn.parentNode.insertBefore(holder,btn);
  btn.addEventListener('click',async()=>{
    const blockId=$('#labOnlineBlock',body)?.value||'',tags=$$('#labOnlineTags input:checked',body).map(x=>x.value);
    if(blockId)await setMeta('pending_online_block',{testing_block_id:blockId,at:Date.now()});
    if(tags.length)await setMeta('pending_leak_tags',{tags,at:Date.now(),session_id:(await latestActiveSession())?.id||null,match_id:null,game_id:null});
    setTimeout(assignPendingOnlineBlock,900);if(tags.length)setTimeout(resolvePendingLeakTags,1100);
  },{capture:true});
}
async function periodicSync(){
  try{
    await assignPendingSessionTags();
    await assignPendingMatchContext();
    await assignPendingOnlineBlock();
    await resolvePendingLeakTags();
    await syncTournamentAssignments();
    await syncTestingTargets();
  }catch(err){console.warn('RiftMastery lab sync',err);}
}
async function labTick(){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(async()=>{
    try{
      await ensureLabShell();
      await enhanceOnlineLogModal();
      await enhanceSessionSummaryShare();
    }catch(err){console.warn('RiftMastery lab UI',err);}
  },80);
}
async function labInit(){
  await seedLab();
  await periodicSync();
  await ensureLabShell();
  await enhanceOnlineLogModal();
  await enhanceSessionSummaryShare();
  const observer=new MutationObserver(labTick);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','open']});
  setInterval(periodicSync,1800);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){periodicSync();labTick();}});
}
labInit().catch(err=>console.error('RiftMastery Development Lab failed',err));
