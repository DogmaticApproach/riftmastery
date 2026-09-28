import { mountCultivation } from './cultivation.js?v=0.13.0';
import { prepareEditor } from './ui.js?v=0.13.0';
export const RIFTMASTERY_LAB_VERSION = '0.13.0';

import { all, get, put, byIndex, stampBase, getMeta, setMeta, softDelete } from './db.js?v=0.13.0';

const VERSION='0.13.0';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeExternalUrl=v=>{try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
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
  $('#modalTitle').textContent=titleText; $('#modalBody').innerHTML=html; prepareEditor(); if(!d.open)d.showModal();
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
let insightTab='positions';
let refreshTimer=null;
let lastMoreKey='';
let lastStatsKey='';

async function ensureLabShell(){
  const more=$('#screen-lab.active')||$('#screen-studio.active');
  if(more&&!$('#riftLab',more)){
    $('#riftLab')?.remove();
    const shell=document.createElement('div');shell.id='riftLab';shell.className='lab-shell';
    more.prepend(shell); await renderLab();
  }
  const stats=$('#screen-stats');
  if(stats?.classList.contains('active')) await enhanceStats(stats);
  await enhanceModal();
  await enhanceLiveScore();
}

const workspaces=[
  ['PRACTICE',[['blocks','Testing blocks'],['matchups','Matchups'],['positions','Position reviews'],['queue','Training queue'],['events','Events'],['experiments','Deck experiments']]],
  ['RESEARCH',[['research','Research board'],['pulse','Format pulse']]],
  ['DEVELOPMENT',[['goals','Goals'],['skills','Skills'],['explorer','Explorer'],['chronicle','Chronicle'],['tools','Tools']]]
];
window.riftmasteryOpenWorkspace=async(name)=>{
  const destination=$('#screen-'+name);
  if(!destination)return;
  let root=$('#riftLab');
  if(!root){root=document.createElement('div');root.id='riftLab';root.className='lab-shell';}
  destination.replaceChildren(root);await renderLab();
};
function polishEmpty(root){
  const content={blocks:['Give every session a question.','Create a testing block with a deck, a target, and one idea to test.'],events:['Prepare for your next event.','Keep your deck, preparation checklist, and round results together.'],experiments:['Find out what the change does.','Compare two saved builds across focused games.'],goals:['Set your next milestone.','Choose a useful target for matches, games, or practice time.'],positions:['Start with one difficult decision.','After a game, compare your lines and record what changed your read.'],research:['Follow a question worth answering.','Save a hypothesis, collect evidence, and decide what to test next.'],pulse:['Stay close to the format.','Capture a question from previews, a rules update, or an upcoming event.'],x:['Turn a lesson into something useful.','Draft from a position review, a research finding, or an idea you want to explore.']};
  const key=root.closest('#screen-studio')?'x':labTab;
  const message=content[key];if(!message)return;
  const empty=root.querySelector('.empty');if(!empty||empty.children.length)return;
  empty.innerHTML=`<span class="empty-glyph" aria-hidden="true">${key==='x'?'↗':'◇'}</span><h3>${message[0]}</h3><p>${message[1]}</p>`;
}
function needsDeck(message='Save a deck to start this workspace.'){
  modal('Start with a deck',`<p class="muted">${message}</p><button type="button" class="btn primary full" id="labGoDecks">Open Decks</button>`);
  $('#labGoDecks').onclick=()=>{closeModal();document.querySelector('[data-nav="decks"]').click();};
}
window.riftmasterySelectTool=async(tool)=>{labTab=tool;await renderLab();};
async function renderLab(){
  const root=$('#riftLab'); if(!root)return;
  const studio=!!root.closest('#screen-studio');
  root.classList.toggle('studio-shell',studio);
  if(studio){
    insightTab='x';root.innerHTML="<div id='labPanel' class='lab-panel'><div id='insightPanel' class='insight-panel'></div></div>";await renderXStudio();polishEmpty(root);return;
  }
  if(labTab==='insights')labTab=insightTab==='x'?'research':insightTab;
  root.innerHTML=`<div class="lab-navigation" aria-label="Lab tools">${workspaces.map(([label,items])=>`<div class="lab-nav-group"><span>${label}</span>${items.map(([id,name])=>`<button data-lab-tab="${id}" class="${labTab===id?'active':''}" aria-current="${labTab===id?'page':'false'}">${name}</button>`).join('')}</div>`).join('')}</div><label class="lab-mobile-picker"><span class="label-title">Lab workspace</span><select id="labToolSelect">${workspaces.map(([label,items])=>`<optgroup label="${label}">${items.map(([id,name])=>`<option value="${id}" ${labTab===id?'selected':''}>${name}</option>`).join('')}</optgroup>`).join('')}</select></label><div id="labPanel" class="lab-panel"></div>`;
  $('#labToolSelect').onchange=e=>{labTab=e.target.value;renderLab();};
  $$('[data-lab-tab]',root).forEach(b=>b.onclick=()=>{labTab=b.dataset.labTab;renderLab();});
  const renders={blocks:renderBlocksTab,matchups:renderMatchupsTab,events:renderEventsTab,experiments:renderExperimentsTab,goals:renderGoalsTab,skills:renderSkillsTab,tools:renderToolsTab};
  if(renders[labTab])await renders[labTab]();else{insightTab=labTab;await renderInsightsTab();}
  polishEmpty(root);
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
  if(!active.length)return needsDeck();
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
    ${leaks.length?`<div class='lab-card'><div class='lab-wrap'>${leaks.slice(0,9).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>${leaks[0]?.count>=3?`<div class='small muted' style='margin-top:9px'>Most repeated pattern: ${esc(leaks[0].tag)}. Treat this as a review signal, not proof of cause.</div>`:''}</div>`:`<div class='empty'>Tag your after-game reviews to discover recurring patterns.</div>`}
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
  if(!active.length)return needsDeck();
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
  if(active.length<2)return needsDeck('Save two active deck versions to compare them in an experiment.');
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

const insightTabs=[['positions','Position Lab'],['research','Research'],['pulse','Format Pulse'],['queue','Training Queue'],['x','X Studio'],['explorer','Explorer'],['chronicle','Chronicle']];
async function renderInsightsTab(){
  const root=$('#labPanel');if(!root)return;
  root.innerHTML="<div id='insightPanel' class='insight-panel'></div>";
  if(insightTab==='positions')await renderPositionReviews();
  if(insightTab==='research')await renderPreviewResearch();
  if(insightTab==='queue')await renderTrainingQueue();
  if(insightTab==='x')await renderXStudio();
  if(insightTab==='pulse')await renderFormatPulse();
  if(insightTab==='explorer')await renderDevelopmentExplorer();
  if(insightTab==='chronicle')await renderPlayerChronicle();
  polishEmpty(root);
}
function insightHeader(titleText,description,buttonId,buttonLabel){return `<div class='lab-row insight-header'><div><div class='lab-title'>${titleText}</div><div class='lab-meta'>${description}</div></div><button class='btn small primary' id='${buttonId}'>${buttonLabel}</button></div>`;}
const positionNotes=async()=> (await all('notes')).filter(n=>n.record_type==='position_review').sort((a,b)=>ms(b.timestamp)-ms(a.timestamp));
async function renderPositionReviews(){
  const p=$('#insightPanel'),notes=await positionNotes(),{deckMap,legendMap}=await maps();
  const cards=await Promise.all(notes.slice(0,30).map(async n=>{const m=n.match_id?await get('matches',n.match_id):null,clip=safeExternalUrl(n.clip_url);return `<article class='insight-card'><div class='lab-row'><div><div class='lab-title'>${esc(n.question||'Position review')}</div><div class='lab-meta'>${m?`${esc(deckMap[m.my_deck_id]?.name||'Deck')} vs ${esc(legendMap[m.opponent_legend_id]?.name||'Opponent')} · `:''}${fmtDate(n.timestamp)} · ${esc(title(n.review_status||'unreviewed'))}</div></div><button class='btn small ghost editPositionReview' data-id='${n.id}'>Open</button></div><div class='insight-pair'><div><b>Your role</b><span>${esc(n.my_role||'Unclear')}</span></div><div><b>Line A</b><span>${esc(n.line_a||'—')}</span></div><div><b>Line B</b><span>${esc(n.line_b||'—')}</span></div></div>${n.opponent_range?`<p><b>Opponent range:</b> ${esc(n.opponent_range)}</p>`:''}${n.range_update?`<p><b>What changed your read:</b> ${esc(n.range_update)}</p>`:''}${n.takeaway?`<p><b>Review takeaway:</b> ${esc(n.takeaway)}</p>`:''}${clip?`<p><a href='${esc(clip)}' target='_blank' rel='noopener'>Open saved VOD / clip ↗</a></p>`:''}<div class='lab-wrap'><button class='btn small draftFromPosition' data-id='${n.id}'>Draft a supported insight</button></div></article>`;}));
  p.innerHTML=insightHeader('Position Lab','After a game, unpack one difficult decision: role, two lines, opponent range, and what changed your read.','newPositionReview','+ Review a Position')+
    (notes.length?cards.join(''):`<div class='empty'>No position reviews yet. Save one tough decision after a game, then revisit your reasoning with the information you had at the time.</div>`);
  $('#newPositionReview').onclick=()=>openPositionReviewModal();
  $$('.editPositionReview',p).forEach(b=>b.onclick=()=>openPositionReviewModal(null,b.dataset.id));
  $$('.draftFromPosition',p).forEach(b=>b.onclick=async()=>{const n=await get('notes',b.dataset.id);openXPostModal({claim:n.takeaway||n.question,evidence:[n.opponent_range,n.range_update].filter(Boolean).join('\n'),source_link:n.clip_url,evidence_status:n.review_status==='reviewed'?'observed':'working_hypothesis',implication:n.line_a&&n.line_b?`Compare ${n.line_a} against ${n.line_b} before committing.`:''});});
}
async function openPositionReviewModal(prefill=null,id=null){
  const existing=id?await get('notes',id):null,{deckMap,legendMap}=await maps();
  const matches=(await all('matches')).filter(m=>m.ended_at).sort((a,b)=>ms(b.started_at)-ms(a.started_at)).slice(0,100);
  modal(existing?'Edit position review':'Review a position',`<p class='small muted'>Write this after the game so it stays quick during play. Judge the choice using what you knew then.</p>
    <label><span class='label-title'>Question / position</span><input id='posQuestion' maxlength='120' placeholder='e.g. Who was favored after the open-board turn?'></label>
    <label><span class='label-title'>Link a match <span class='muted'>(optional)</span></span><select id='posMatch'><option value=''>No linked match</option>${matches.map(m=>`<option value='${m.id}'>${esc(deckMap[m.my_deck_id]?.name||'Deck')} vs ${esc(legendMap[m.opponent_legend_id]?.name||'Opponent')} · ${fmtDate(m.started_at)}</option>`).join('')}</select></label>
    <label><span class='label-title'>Your role / who benefited if nothing changed?</span><select id='posRole'><option value='unclear'>I wasn’t sure</option><option value='me'>I was favored</option><option value='opponent'>Opponent was favored</option><option value='changed'>The role was changing</option></select></label>
    <label><span class='label-title'>Line A</span><textarea id='posLineA' rows='2' placeholder='What was your first reasonable line?'></textarea></label>
    <label><span class='label-title'>Line B</span><textarea id='posLineB' rows='2' placeholder='What other line deserved consideration?'></textarea></label>
    <label><span class='label-title'>What was in the opponent’s plausible range?</span><textarea id='posRange' rows='2' placeholder='Separate likely from merely possible answers.'></textarea></label>
    <label><span class='label-title'>What changed your read?</span><textarea id='posUpdate' rows='2' placeholder='An action, non-action, reveal, resource, or board change.'></textarea></label>
    <label><span class='label-title'>VOD / clip link <span class='muted'>(add after the match)</span></span><input id='posClip' type='url' placeholder='https://...'></label>
    <label><span class='label-title'>What did review teach you?</span><textarea id='posTakeaway' rows='2' placeholder='A decision lesson or next drill.'></textarea></label>
    <label><span class='label-title'>Review status</span><select id='posStatus'><option value='unreviewed'>Needs review</option><option value='reviewed'>Reviewed</option><option value='uncertain'>Still uncertain</option></select></label>
    <button class='btn primary full' id='savePositionReview'>Save position review</button>`);
  const n=existing||prefill||{};
  $('#posQuestion').value=n.question||'';$('#posMatch').value=n.match_id||'';$('#posRole').value=n.my_role||'unclear';$('#posLineA').value=n.line_a||'';$('#posLineB').value=n.line_b||'';$('#posRange').value=n.opponent_range||'';$('#posUpdate').value=n.range_update||'';$('#posClip').value=n.clip_url||'';$('#posTakeaway').value=n.takeaway||'';$('#posStatus').value=n.review_status||'unreviewed';
  $('#savePositionReview').onclick=async()=>{
    const question=$('#posQuestion').value.trim(),lineA=$('#posLineA').value.trim(),lineB=$('#posLineB').value.trim();
    if(!question)return toast('Name the position or question.');if(!lineA||!lineB)return toast('Record two candidate lines.');
    const row=existing||stampBase({record_type:'position_review',timestamp:iso()});
    Object.assign(row,{record_type:'position_review',question,my_role:$('#posRole').value,line_a:lineA,line_b:lineB,opponent_range:$('#posRange').value.trim(),range_update:$('#posUpdate').value.trim(),clip_url:$('#posClip').value.trim(),takeaway:$('#posTakeaway').value.trim(),review_status:$('#posStatus').value,match_id:$('#posMatch').value||null,text:`Position review: ${question}. Line A: ${lineA}. Line B: ${lineB}.`,timestamp:row.timestamp||iso()});
    await save('notes',row);closeModal();await renderInsightsTab();toast('Position review saved.');
  };
}
const researchNotes=async()=> (await all('notes')).filter(n=>n.record_type==='preview_research').sort((a,b)=>ms(b.updated_at||b.timestamp)-ms(a.updated_at||a.timestamp));
async function renderPreviewResearch(){
  const p=$('#insightPanel'),rows=await researchNotes();
  p.innerHTML=insightHeader('Research Board','Track the question, evidence, and next test. Your saved notes stay useful after a release window moves on.','newResearch','+ Research Idea')+
    (rows.length?rows.map(n=>`<article class='insight-card'><div class='lab-row'><div><div class='lab-title'>${esc(n.research_subject||n.question||'Research idea')}</div><div class='lab-meta'>${esc(n.window_label||'Any time')}${n.window_date?' · window ends '+esc(n.window_date):''} · ${esc(n.evidence_status||'working_hypothesis').replaceAll('_',' ')} · ${fmtDate(n.updated_at||n.timestamp)}</div></div><button class='btn small ghost editResearch' data-id='${n.id}'>Update</button></div>${n.question?`<p><b>Question:</b> ${esc(n.question)}</p>`:''}${n.hypothesis?`<p><b>Hypothesis:</b> ${esc(n.hypothesis)}</p>`:''}${n.evidence?`<p><b>Evidence:</b> ${esc(n.evidence)}</p>`:''}${n.finding?`<p><b>Finding:</b> ${esc(n.finding)}</p>`:''}${n.next_test?`<p><b>Next test:</b> ${esc(n.next_test)}</p>`:''}${n.evidence_source?`<p class='tiny muted'>Source: ${esc(n.evidence_source)}</p>`:''}<div class='lab-wrap'><button class='btn small draftFromResearch' data-id='${n.id}'>Draft for X</button><button class='btn small ghost queueResearch' data-id='${n.id}'>Add next test to Training Queue</button></div></article>`).join(''):`<div class='empty'>No research questions saved yet. Capture what players need answered, then mark what your evidence supports.</div>`);
  $('#newResearch').onclick=()=>openResearchModal();
  $$('.editResearch',p).forEach(b=>b.onclick=()=>openResearchModal(b.dataset.id));
  $$('.draftFromResearch',p).forEach(b=>b.onclick=async()=>{const n=await get('notes',b.dataset.id);openXPostModal({audience:'Riftbound players',claim:n.finding||n.hypothesis,evidence:n.evidence||'',source_link:n.evidence_source,evidence_status:n.evidence_status||'working_hypothesis',implication:n.next_test||''});});
  $$('.queueResearch',p).forEach(b=>b.onclick=async()=>{const n=await get('notes',b.dataset.id);queueWeeklyTask(n.next_test||`Test: ${n.research_subject||n.question}`,`Preview research · ${n.research_subject||n.question}`);});
}
async function openResearchModal(id=null){
  const existing=id?await get('notes',id):null;
  modal(existing?'Update research idea':'New preview research',`<label><span class='label-title'>Card, deck, or matchup</span><input id='researchSubject' maxlength='120' placeholder='What are you investigating?'></label>
    <label><span class='label-title'>Information window</span><select id='researchWindow'><option>Any time</option><option>Card previews</option><option>Pre-release testing</option><option>New set launch</option><option>Rules / errata</option><option>Ban announcement</option><option>Major event prep</option><option>Fresh decklist</option><option>Post-event review</option></select></label>
    <label><span class='label-title'>Useful until <span class='muted'>(optional)</span></span><input id='researchWindowDate' type='date'></label>
    <label><span class='label-title'>Question players need answered</span><textarea id='researchQuestion' rows='2' placeholder='Start with the uncertainty, not the post.'></textarea></label>
    <label><span class='label-title'>Working hypothesis</span><textarea id='researchHypothesis' rows='2' placeholder='What do you currently expect?'></textarea></label>
    <label><span class='label-title'>Evidence label</span><select id='researchStatus'><option value='working_hypothesis'>Working hypothesis</option><option value='observed'>Observed</option><option value='unresolved'>Unresolved</option></select></label>
    <label><span class='label-title'>Evidence so far</span><textarea id='researchEvidence' rows='3' placeholder='Games, exact list, card text, VOD, or repeated observation.'></textarea></label>
    <label><span class='label-title'>Evidence source <span class='muted'>(optional)</span></span><input id='researchSource' placeholder='URL, match, VOD timestamp, or event'></label>
    <label><span class='label-title'>What will you test next?</span><textarea id='researchNext' rows='2' placeholder='A focused test or what evidence is still missing.'></textarea></label>
    <label><span class='label-title'>Finding / current conclusion</span><textarea id='researchFinding' rows='2' placeholder='Keep the conclusion as narrow as the evidence.'></textarea></label>
    <button class='btn primary full' id='saveResearch'>Save research</button>`);
  const n=existing||{};$('#researchSubject').value=n.research_subject||'';$('#researchWindow').value=n.window_label||'Any time';$('#researchWindowDate').value=n.window_date||'';$('#researchQuestion').value=n.question||'';$('#researchHypothesis').value=n.hypothesis||'';$('#researchStatus').value=n.evidence_status||'working_hypothesis';$('#researchEvidence').value=n.evidence||'';$('#researchSource').value=n.evidence_source||'';$('#researchNext').value=n.next_test||'';$('#researchFinding').value=n.finding||'';
  $('#saveResearch').onclick=async()=>{
    const subject=$('#researchSubject').value.trim(),question=$('#researchQuestion').value.trim();if(!subject||!question)return toast('Add the subject and the question.');
    const row=existing||stampBase({record_type:'preview_research',timestamp:iso()});
    Object.assign(row,{record_type:'preview_research',research_subject:subject,window_label:$('#researchWindow').value,window_date:$('#researchWindowDate').value||null,question,hypothesis:$('#researchHypothesis').value.trim(),evidence_status:$('#researchStatus').value,evidence:$('#researchEvidence').value.trim(),evidence_source:$('#researchSource').value.trim(),next_test:$('#researchNext').value.trim(),finding:$('#researchFinding').value.trim(),text:`${subject}: ${question}`,timestamp:row.timestamp||iso()});
    await save('notes',row);closeModal();await renderInsightsTab();toast('Research idea saved.');
  };
}
async function renderTrainingQueue(){
  const p=$('#insightPanel'),notes=await all('notes'),reviewBlocks=(await all('reviewBlocks')).sort((a,b)=>ms(b.completed_at)-ms(a.completed_at));
  const counts={};for(const n of notes){for(const tag of new Set(n.leak_tags||[]))counts[tag]=(counts[tag]||0)+1;}
  const recurring=Object.entries(counts).filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]);
  const drills=reviewBlocks.filter(x=>x.next_drill?.trim()).map(x=>({title:x.next_drill.trim(),detail:`From your 10-BO3 review · ${fmtDate(x.completed_at)}`}));
  const suggestions=[...recurring.map(([tag,count])=>({title:`Practice: ${tag}`,detail:`Tagged in ${count} notes. Treat this as a signal to review, then test it.`})),...drills];
  p.innerHTML=`<div class='lab-card'><div class='lab-title'>Turn review signals into deliberate reps</div><div class='lab-meta'>Only repeated tags and saved review drills appear here. A pattern is a prompt to investigate, not a verdict about why you lost.</div></div>
    ${suggestions.length?suggestions.map((x,i)=>`<article class='insight-card'><div class='lab-row'><div><div class='lab-title'>${esc(x.title)}</div><div class='lab-meta'>${esc(x.detail)}</div></div><button class='btn small primary queueWeekly' data-i='${i}'>Add to this week</button></div></article>`).join(''):`<div class='empty'>Your queue will fill from repeated tagged notes and saved 10-BO3 review drills. You can also add a focused task from a research idea.</div>`}
    <div class='lab-wrap' style='margin-top:12px'><button class='btn small ghost' id='queuePosition'>Review a difficult position</button><button class='btn small ghost' id='queueResearch'>Add preview test</button></div>`;
  $$('.queueWeekly',p).forEach(b=>b.onclick=()=>queueWeeklyTask(suggestions[Number(b.dataset.i)].title,suggestions[Number(b.dataset.i)].detail));
  $('#queuePosition').onclick=async()=>{labTab='positions';await renderLab();$('#newPositionReview')?.click();};
  $('#queueResearch').onclick=async()=>{labTab='research';await renderLab();$('#newResearch')?.click();};
}
async function queueWeeklyTask(titleText,detail){
  if(typeof window.riftmasteryAddWeeklyTask!=='function')return toast('Weekly checklist is still loading.');
  const added=await window.riftmasteryAddWeeklyTask(titleText,detail);if(!added)toast('That task is already on this week’s checklist.');
}
async function renderXStudio(){
  const p=$('#insightPanel'),rows=(await all('notes')).filter(n=>n.record_type==='x_post').sort((a,b)=>ms(b.updated_at||b.timestamp)-ms(a.updated_at||a.timestamp));
  p.innerHTML=insightHeader('X Studio','Draft from evidence, then track original posts and substantive replies. Record results to learn what readers save and discuss.','newXPost','+ Draft Insight')+
    (rows.length?rows.map(n=>{const m=n.metrics||{},views=Number(m.views)||0,rate=(v)=>views?`${(Number(v||0)*1000/views).toFixed(1)} / 1k`:'';return `<article class='insight-card'><div class='lab-row'><div><div class='lab-title'>${esc(n.hook||n.claim||'X draft')}</div><div class='lab-meta'>${esc(title(n.post_status||'draft'))} · ${esc(n.post_type||'original')} · ${esc(n.window_label||'Any time')} · ${esc(n.evidence_status||'working_hypothesis').replaceAll('_',' ')}${n.posted_at?' · '+fmtDate(n.posted_at):''}</div></div><button class='btn small ghost editXPost' data-id='${n.id}'>Open</button></div>${n.audience?`<p><b>Audience:</b> ${esc(n.audience)}</p>`:''}${n.claim?`<p><b>Claim:</b> ${esc(n.claim)}</p>`:''}${n.evidence?`<p><b>Proof:</b> ${esc(n.evidence)}</p>`:''}${n.source_link?`<p class='tiny muted'>Evidence link: ${esc(n.source_link)}</p>`:''}${n.post_text?`<div class='x-draft-preview'>${esc(n.post_text)}</div>`:''}${views?`<div class='insight-metrics'><span>${views.toLocaleString()} views</span><span>${rate(m.bookmarks)} bookmarks</span><span>${rate(m.replies)} replies</span><span>${rate(m.reposts)} reposts</span><span>${rate(m.profile_visits)} profile visits</span><span>${rate(m.follows)} follows</span></div>`:''}<div class='lab-wrap'><button class='btn small copyXPost' data-id='${n.id}'>Copy draft</button></div></article>`;}).join(''):`<div class='empty'>No X drafts yet. Start from a supported research finding or save a draft to work on later. Posting stays in your hands.</div>`);
  $('#newXPost').onclick=()=>openXPostModal();
  $$('.editXPost',p).forEach(b=>b.onclick=()=>openXPostModal({},b.dataset.id));
  $$('.copyXPost',p).forEach(b=>b.onclick=async()=>{const n=await get('notes',b.dataset.id);await copyOrShare(n.post_text||n.claim||'','RiftMastery X draft');});
}
async function openXPostModal(prefill={},id=null){
  const existing=id?await get('notes',id):null,n=existing||prefill||{};
  modal(existing?'Edit X insight':'Draft an X insight',`<p class='small muted'>Build from evidence and write for a specific reader. RiftMastery saves a draft; it never posts for you.</p>
    <div class='editor-step-tabs' role='tablist' aria-label='Draft steps'><button type='button' role='tab' aria-selected='true' data-editor-step='idea'>1. Shape the idea</button><button type='button' role='tab' aria-selected='false' data-editor-step='writing'>2. Write the post</button></div><div class='x-evidence'><h3>01 · Shape the idea</h3><label><span class='label-title'>Post type</span><select id='xPostType'><option value='original'>Original post</option><option value='reply'>Substantive reply</option><option value='repost_test'>Rewritten repost test</option></select></label>
    <label><span class='label-title'>Information window</span><select id='xWindow'><option>Any time</option><option>Card previews</option><option>Pre-release testing</option><option>New set launch</option><option>Rules / errata</option><option>Ban announcement</option><option>Major event prep</option><option>Fresh decklist</option><option>Post-event review</option></select></label>
    <label><span class='label-title'>Audience</span><input id='xAudience' maxlength='100' placeholder='e.g. Jayce players preparing for locals'></label>
    <label><span class='label-title'>Hook</span><input id='xHook' maxlength='160' placeholder='Name the reader and the assumption or question'></label>
    <label><span class='label-title'>Claim / finding</span><textarea id='xClaim' rows='2' placeholder='Keep it as narrow as the evidence.'></textarea></label>
    <label><span class='label-title'>Evidence status</span><select id='xEvidenceStatus'><option value='observed'>Observed</option><option value='working_hypothesis'>Working hypothesis</option><option value='unresolved'>Unresolved</option></select></label>
    <label><span class='label-title'>Evidence / proof</span><textarea id='xEvidence' rows='2' placeholder='Specific games, list, clip, or repeated observation.'></textarea></label>
    <label><span class='label-title'>Why should the reader care?</span><textarea id='xImplication' rows='2' placeholder='What should they test, prepare, or change?'></textarea></label>
    <button class='btn small ghost' type='button' id='xBuildDraft'>Build a draft from these fields</button>
    </div><div class='x-writing'><h3>02 · Write your post</h3><label><span class='label-title'>Post text</span><textarea id='xPostText' rows='5' placeholder='Draft or paste the final wording here.'></textarea></label>
    <label><span class='label-title'>Status</span><select id='xPostStatus'><option value='draft'>Draft</option><option value='posted'>Posted</option><option value='parked'>Parked</option></select></label>
    <details id='xPerformance' class='performance-details'><summary>Published results</summary><p class='small muted'>Record these after publishing.</p><div class='lab-grid'><label><span class='label-title'>Views</span><input id='xViews' type='number' min='0' value='0'></label><label><span class='label-title'>Likes</span><input id='xLikes' type='number' min='0' value='0'></label><label><span class='label-title'>Bookmarks</span><input id='xBookmarks' type='number' min='0' value='0'></label><label><span class='label-title'>Replies</span><input id='xReplies' type='number' min='0' value='0'></label><label><span class='label-title'>Reposts</span><input id='xReposts' type='number' min='0' value='0'></label><label><span class='label-title'>Profile visits</span><input id='xProfileVisits' type='number' min='0' value='0'></label><label><span class='label-title'>Follows</span><input id='xFollows' type='number' min='0' value='0'></label></div>
    </details><label><span class='label-title'>Evidence / clip link <span class='muted'>(optional)</span></span><input id='xSourceLink' type='url' placeholder='VOD, decklist, screenshot, or source'></label>
    <label><span class='label-title'>Post URL <span class='muted'>(optional)</span></span><input id='xPostUrl' type='url' placeholder='https://x.com/...'></label>
    </div><button class='btn primary full' id='saveXPost'>Save X record</button>`);
  $('#xPostType').value=n.post_type||'original';$('#xWindow').value=n.window_label||'Any time';$('#xAudience').value=n.audience||'';$('#xHook').value=n.hook||'';$('#xClaim').value=n.claim||'';$('#xEvidenceStatus').value=n.evidence_status||'working_hypothesis';$('#xEvidence').value=n.evidence||'';$('#xImplication').value=n.implication||'';$('#xPostText').value=n.post_text||'';$('#xPostStatus').value=n.post_status||'draft';$('#xViews').value=n.metrics?.views||0;$('#xLikes').value=n.metrics?.likes||0;$('#xBookmarks').value=n.metrics?.bookmarks||0;$('#xReplies').value=n.metrics?.replies||0;$('#xReposts').value=n.metrics?.reposts||0;$('#xProfileVisits').value=n.metrics?.profile_visits||0;$('#xFollows').value=n.metrics?.follows||0;$('#xSourceLink').value=n.source_link||'';$('#xPostUrl').value=n.post_url||'';
  const performance=$('#xPerformance');const updatePerformance=()=>{performance.hidden=$('#xPostStatus').value!=='posted';performance.open=!performance.hidden;$('#xPostUrl').closest('label').hidden=performance.hidden;};$('#xPostStatus').onchange=updatePerformance;updatePerformance();
  const body=$('#modalBody');body.dataset.editorStep='idea';$$('[data-editor-step]',body).forEach(b=>b.onclick=()=>{body.dataset.editorStep=b.dataset.editorStep;$$('[data-editor-step]',body).forEach(t=>t.setAttribute('aria-selected',String(t===b)));$('#modalCard').scrollTop=0;});
  $('#xBuildDraft').onclick=()=>{
    const audience=$('#xAudience').value.trim(),hook=$('#xHook').value.trim(),claim=$('#xClaim').value.trim(),evidence=$('#xEvidence').value.trim(),implication=$('#xImplication').value.trim(),status=$('#xEvidenceStatus').value;
    if(!claim||!evidence)return toast('Add a claim and its evidence before building a draft.');
    const lead=hook||(audience?audience.toUpperCase()+':':'');
    const qualifier=status==='observed'?'Observed: ':status==='unresolved'?'Question I’m still testing: ':'Working hypothesis: ';
    $('#xPostText').value=[lead,qualifier+claim,evidence?'Evidence: '+evidence:'',implication?'Why it matters: '+implication:''].filter(Boolean).join('\n\n');
    $('[data-editor-step=writing]').click();
  };
  $('#saveXPost').onclick=async()=>{
    const claim=$('#xClaim').value.trim(),postText=$('#xPostText').value.trim();if(!claim&&!postText)return toast('Add a claim or draft text.');
    const status=$('#xPostStatus').value,metrics={views:Number($('#xViews').value)||0,likes:Number($('#xLikes').value)||0,bookmarks:Number($('#xBookmarks').value)||0,replies:Number($('#xReplies').value)||0,reposts:Number($('#xReposts').value)||0,profile_visits:Number($('#xProfileVisits').value)||0,follows:Number($('#xFollows').value)||0};
    const row=existing||stampBase({record_type:'x_post',timestamp:iso()});
    Object.assign(row,{record_type:'x_post',post_type:$('#xPostType').value,window_label:$('#xWindow').value,source_link:$('#xSourceLink').value.trim(),audience:$('#xAudience').value.trim(),hook:$('#xHook').value.trim(),claim,evidence_status:$('#xEvidenceStatus').value,evidence:$('#xEvidence').value.trim(),implication:$('#xImplication').value.trim(),post_text:postText,post_status:status,posted_at:status==='posted'?(row.posted_at||iso()):null,post_url:$('#xPostUrl').value.trim(),metrics,text:claim||postText.slice(0,240),timestamp:row.timestamp||iso()});
    await save('notes',row);closeModal();await renderInsightsTab();toast('X record saved.');
  };
}

async function processSnapshot(){
  const [sessions,matches,notes,blocks,reviewBlocks,tournaments,weeks]=await Promise.all([all('sessions'),all('matches'),all('notes'),all('testingBlocks'),all('reviewBlocks'),all('tournaments'),all('weeklyChecklists')]);
  const completedMatches=matches.filter(m=>m.ended_at),completedSessions=sessions.filter(s=>s.status==='completed');
  const positionReviews=notes.filter(n=>n.record_type==='position_review'),research=notes.filter(n=>n.record_type==='preview_research'),posts=notes.filter(n=>n.record_type==='x_post');
  const hours=completedSessions.reduce((sum,s)=>sum+(Number(s.active_play_ms)||0),0)/3600000;
  const required=weeks.flatMap(w=>(w.items||[]).filter(i=>!i.optional)),done=required.filter(i=>i.done).length;
  const tags={};for(const n of notes)for(const tag of new Set(n.leak_tags||[]))tags[tag]=(tags[tag]||0)+1;
  const months=[];for(let i=5;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;months.push({key,label:d.toLocaleDateString([],{month:'short'}),count:completedSessions.filter(s=>String(s.started_at||'').slice(0,7)===key).length});}
  return {sessions,matches:completedMatches,notes,blocks,reviewBlocks,tournaments,weeks,completedSessions,positionReviews,research,posts,hours,done,required:required.length,tags,months};
}
async function renderDevelopmentExplorer(){
  const p=$('#insightPanel'),s=await processSnapshot(),max=Math.max(1,...s.months.map(m=>m.count));
  const tagRows=Object.entries(s.tags).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(!s.completedSessions.length&&!s.positionReviews.length&&!s.research.length&&!s.done&&!s.posts.length){p.innerHTML=`<div class='page-intro'><span class='eyebrow'>DEVELOPMENT</span><h2>Explorer</h2><p>Your practice and review habits, in one place.</p></div><div class='empty-state'><span class='empty-symbol' aria-hidden='true'>↗</span><h3>Build a rhythm worth reviewing.</h3><p>Complete a session, review a position, or finish a weekly task to start seeing your development here.</p><button class='btn primary' id='explorerStart'>Review a position</button></div>`;$('#explorerStart').onclick=()=>openPositionReviewModal();return;}
  p.innerHTML=`<div class='insight-intro'><div class='lab-title'>Development Explorer</div><div class='lab-meta'>See your practice rhythm, review habits, and weekly follow-through.</div></div>
    <div class='insight-stats'><div class='lab-mini'><div class='tiny muted'>COMPLETED SESSIONS</div><div class='big'>${s.completedSessions.length}</div></div><div class='lab-mini'><div class='tiny muted'>PRACTICE HOURS</div><div class='big'>${s.hours.toFixed(1)}</div></div><div class='lab-mini'><div class='tiny muted'>POSITION REVIEWS</div><div class='big'>${s.positionReviews.length}</div></div><div class='lab-mini'><div class='tiny muted'>RESEARCH NOTES</div><div class='big'>${s.research.length}</div></div></div>
    <div class='lab-card'><div class='lab-title'>Practice rhythm</div><div class='lab-meta'>Completed sessions by month</div><div class='insight-bars'>${s.months.map(m=>`<div class='insight-bar'><span>${m.count||''}</span><i><b style='height:${Math.max(m.count?8:0,Math.round(m.count/max*100))}%'></b></i><small>${esc(m.label)}</small></div>`).join('')}</div></div>
    <div class='lab-card'><div class='lab-title'>Follow-through</div><div class='lab-meta'>Required weekly checklist tasks completed across saved weeks</div><div class='lab-row' style='margin-top:9px'><strong>${s.done} / ${s.required}</strong><span class='lab-chip'>${s.required?Math.round(s.done/s.required*100):0}%</span></div><div class='lab-progress'><span style='width:${s.required?Math.round(s.done/s.required*100):0}%'></span></div></div>
    <div class='lab-card'><div class='lab-title'>Repeated review tags</div><div class='lab-meta'>Counts show how often you applied a tag; they are prompts for review, not diagnoses.</div><div class='lab-wrap' style='margin-top:9px'>${tagRows.length?tagRows.map(([tag,count])=>`<span class='lab-chip'>${esc(tag)} · ${count}</span>`).join(''):'<span class="small muted">No tagged review notes yet.</span>'}</div></div>
    <div class='lab-card'><div class='lab-title'>Research and creator work</div><div class='lab-meta'>${s.research.filter(n=>n.evidence_status==='observed').length} research notes marked observed · ${s.posts.filter(n=>n.post_status==='posted').length} posts marked posted · ${s.blocks.filter(b=>b.status==='completed').length} testing blocks completed</div></div>`;
}
function milestoneCard(titleText,detail,earned){return `<article class='milestone-card ${earned?'earned':''}'><span>${earned?'✦':'◇'}</span><div><b>${esc(titleText)}</b><small>${esc(detail)}</small></div><em>${earned?'Earned':'In progress'}</em></article>`;}
async function renderPlayerChronicle(){
  const p=$('#insightPanel'),s=await processSnapshot(),bo3=s.matches.filter(m=>m.format==='BO3').length;
  const earnedBlocks=s.blocks.filter(b=>b.status==='completed'),earnedEvents=s.tournaments.filter(t=>t.status==='completed');
  const achievements=[milestoneCard('First match logged','Start building your own development record.',s.matches.length>=1),milestoneCard('Ten BO3s played','A first meaningful block of competitive reps.',bo3>=10),milestoneCard('Thirty BO3s played','Complete a sustained deck experiment.',bo3>=30),milestoneCard('First position review','Save a decision for honest after-game review.',s.positionReviews.length>=1),milestoneCard('Ten position reviews','Build a body of decision evidence.',s.positionReviews.length>=10),milestoneCard('First testing block complete','Close a focused practice block.',earnedBlocks.length>=1),milestoneCard('First tournament complete','Finish an event and keep the record.',earnedEvents.length>=1),milestoneCard('First useful post','Mark an evidence-based post as published.',s.posts.some(n=>n.post_status==='posted'))];
  const events=[];
  for(const m of s.matches)events.push({at:m.ended_at||m.started_at,title:'Match logged',detail:`${m.format||'Match'} · ${fmtDate(m.started_at)}`});
  for(const x of s.positionReviews)events.push({at:x.updated_at||x.timestamp,title:'Position review saved',detail:`${x.question||'Decision review'} · ${fmtDate(x.updated_at||x.timestamp)}`});
  for(const x of s.research)events.push({at:x.updated_at||x.timestamp,title:'Research updated',detail:`${x.research_subject||x.question} · ${fmtDate(x.updated_at||x.timestamp)}`});
  for(const x of earnedBlocks)events.push({at:x.ended_at||x.updated_at,title:'Testing block completed',detail:`${x.name||'Practice block'} · ${fmtDate(x.ended_at||x.updated_at)}`});
  for(const x of earnedEvents)events.push({at:x.ended_at||x.event_date,title:'Tournament completed',detail:`${x.name} · ${fmtDate(x.ended_at||x.event_date)}`});
  for(const x of s.posts.filter(n=>n.post_status==='posted'))events.push({at:x.posted_at||x.updated_at,title:'Post published',detail:`${x.hook||x.claim||'Competitive insight'} · ${fmtDate(x.posted_at||x.updated_at)}`});
  events.sort((a,b)=>ms(b.at)-ms(a.at));
  p.innerHTML=`<div class='insight-intro'><div class='lab-title'>Your Player Chronicle</div><div class='lab-meta'>A record of the work, experiments, and lessons you can carry forward. Milestones reward process, not wins.</div><button class='btn small primary' id='downloadChronicleCard' style='margin-top:12px'>Create share card</button></div>
    <div class='lab-card'><div class='lab-title'>Milestones</div><div class='milestone-grid'>${achievements.map(x=>x).join('')}</div></div>
    <div class='lab-card'><div class='lab-title'>Recent chapters</div><div class='lab-meta'>Matches, reviews, research, events, and published ideas in one timeline.</div><div class='chronicle-list'>${events.length?events.slice(0,40).map(e=>`<div class='chronicle-event'><i></i><div><b>${esc(e.title)}</b><small>${esc(e.detail)}</small></div></div>`).join(''):'<div class="empty">Your first chapter will appear when you save a match, review, or research note.</div>'}</div></div>`;
  $('#downloadChronicleCard').onclick=openChronicleCardModal;
}
function openChronicleCardModal(){
  const prefs=(()=>{try{return JSON.parse(localStorage.getItem('riftmastery-home-prefs-v1')||'{}');}catch{return {};}})();
  modal('Make a share card',`<p class='small muted'>This creates a downloadable image from process milestones only. Review it before sharing.</p><label><span class='label-title'>Display name</span><input id='chronicleName' maxlength='32' value='Dogma'></label><label><span class='label-title'>Season / chapter</span><input id='chronicleSeason' maxlength='32' value='${esc(prefs.season||'Competitive Development')}'></label><label><span class='label-title'>One-line focus</span><input id='chronicleFocus' maxlength='80' placeholder='Learning to be harder to beat'></label><button class='btn primary full' id='chronicleExport'>Download PNG</button>`);
  $('#chronicleExport').onclick=async()=>{const s=await processSnapshot(),name=$('#chronicleName').value.trim()||'Player',season=$('#chronicleSeason').value.trim()||'Development Chronicle',focus=$('#chronicleFocus').value.trim()||'Play · review · study · test';const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#263f3b"/><stop offset=".55" stop-color="#131f22"/><stop offset="1" stop-color="#0b1114"/></linearGradient><radialGradient id="r"><stop stop-color="#c8a86b" stop-opacity=".27"/><stop offset="1" stop-color="#c8a86b" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="675" rx="36" fill="url(#g)"/><circle cx="1050" cy="70" r="290" fill="url(#r)"/><path d="M68 92h66" stroke="#c8a86b" stroke-width="3"/><text x="68" y="143" fill="#d7c390" font-family="Arial,sans-serif" font-size="22" font-weight="700" letter-spacing="6">RIFTMASTERY · PLAYER CHRONICLE</text><text x="68" y="255" fill="#f2f0e9" font-family="Arial,sans-serif" font-size="82" font-weight="700">${esc(name)}</text><text x="68" y="310" fill="#b2bfba" font-family="Arial,sans-serif" font-size="28">${esc(season)}</text><text x="68" y="402" fill="#e1d2ad" font-family="Arial,sans-serif" font-size="30">${esc(focus)}</text><g font-family="Arial,sans-serif"><text x="68" y="515" fill="#c8a86b" font-size="18" letter-spacing="3">PRACTICE HOURS</text><text x="68" y="575" fill="#f2f0e9" font-size="46" font-weight="700">${s.hours.toFixed(1)}</text><text x="380" y="515" fill="#c8a86b" font-size="18" letter-spacing="3">POSITION REVIEWS</text><text x="380" y="575" fill="#f2f0e9" font-size="46" font-weight="700">${s.positionReviews.length}</text><text x="710" y="515" fill="#c8a86b" font-size="18" letter-spacing="3">TEST BLOCKS</text><text x="710" y="575" fill="#f2f0e9" font-size="46" font-weight="700">${s.blocks.filter(b=>b.status==='completed').length}</text></g><text x="68" y="635" fill="#8b9a95" font-family="Arial,sans-serif" font-size="17">A record of deliberate work. Not a rank, rating, or prediction.</text></svg>`;const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=675;canvas.getContext('2d').drawImage(image,0,0);canvas.toBlob(blob=>{if(!blob)return toast('Could not create the image.');const out=URL.createObjectURL(blob),a=document.createElement('a');a.href=out;a.download='riftmastery-player-chronicle.png';a.click();URL.revokeObjectURL(out);URL.revokeObjectURL(url);},'image/png');};image.onerror=()=>{URL.revokeObjectURL(url);toast('Could not create the image.');};image.src=url;closeModal();};
}
async function renderFormatPulse(){
  const p=$('#insightPanel'),rows=(await researchNotes()).sort((a,b)=>ms(a.window_date||'9999-12-31')-ms(b.window_date||'9999-12-31'));
  const groups=[...new Set(rows.map(n=>n.window_label||'Any time'))];
  p.innerHTML=`<div class='insight-intro'><div class='lab-title'>Format Pulse</div><div class='lab-meta'>Keep track of what the community is asking during previews, rules updates, set launches, and event prep. Save a question and a date to revisit it.</div><button class='btn small primary' id='pulseAdd' style='margin-top:12px'>+ Capture a question</button></div>
    ${rows.length?groups.map(group=>`<div class='lab-card'><div class='lab-title'>${esc(group)}</div><div class='lab-panel' style='margin-top:8px'>${rows.filter(n=>(n.window_label||'Any time')===group).map(n=>`<article class='insight-card'><div class='lab-row'><div><div class='lab-title'>${esc(n.research_subject||n.question)}</div><div class='lab-meta'>${n.window_date?'Useful until '+esc(n.window_date)+' · ':''}${esc(n.evidence_status||'working_hypothesis').replaceAll('_',' ')}</div></div><button class='btn small ghost pulseEdit' data-id='${n.id}'>Update</button></div><p>${esc(n.question||'')}</p>${n.evidence?`<p><b>Evidence:</b> ${esc(n.evidence)}</p>`:''}</article>`).join('')}</div></div>`).join(''):`<div class='empty'>No information windows yet. Capture a question when a preview, event, rules update, or new list gives players something concrete to figure out.</div>`}`;
  $('#pulseAdd').onclick=()=>openResearchModal();$$('.pulseEdit',p).forEach(b=>b.onclick=()=>openResearchModal(b.dataset.id));
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
    <div class='lab-card'><div class='lab-title'>ChatGPT Analysis Brief</div><div class='lab-meta'>Build a structured snapshot of your recent development data to review in ChatGPT.</div><button class='btn full' id='copyAnalysisBrief' type='button' style='margin-top:9px'>Copy analysis brief</button></div>
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
    <div class='lab-row'><div><div class='strong'>Additional training areas</div><div class='small muted'>Your earlier personal ratings are preserved here, separately from the evidence-based skill path.</div></div><button class='btn small primary' id='newTrainingArea'>+ Area</button></div>
    <div class='lab-panel'>${rows.length?rows.map(x=>`<div class='lab-card skill-row'><div class='lab-row'><div><div class='lab-title'>${esc(x.name)}</div><div class='lab-meta'>Current self-rating: ${Number(x.rating)||0}/5</div></div><button class='btn small ghost trainingEdit' data-id='${x.id}'>Edit</button></div><div class='segmented trainingRate' data-id='${x.id}' style='margin-top:9px'>${[1,2,3,4,5].map(n=>`<button data-rate='${n}' aria-label='${esc(x.name)}: ${n} of 5' aria-pressed='${Number(x.rating)===n}' title='${['Learning','Developing','Reliable','Strong','Consistent under pressure'][n-1]}' class='${Number(x.rating)===n?'active':''}'>${n}</button>`).join('')}</div>${x.notes?`<div class='small muted' style='margin-top:8px'>${esc(x.notes)}</div>`:''}</div>`).join(''):`<div class='empty'>No training areas yet.</div>`}</div>`;
  p.innerHTML=`<div id='cultSkills' class='cultivation'></div><details class='cult-legacy'><summary>Additional areas & earlier self-ratings</summary>${p.innerHTML}</details>`;
  await mountCultivation($('#cultSkills'),'skills');
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
  let extra=$('#labStatsExtra',stats);if(!extra){extra=document.createElement('div');extra.id='labStatsExtra';extra.className='lab-shell';(stats.querySelector('#matchAnalytics')||stats).appendChild(extra);}
  const scope=$('#statsScope')?.value||'overall',parts=scope.split(':'),type=parts[0],id=parts[1];
  const {deckMap,legendMap}=await maps();
  let matches=(await all('matches')).filter(m=>m.ended_at).sort((a,b)=>ms(b.started_at)-ms(a.started_at));
  if(type==='legend')matches=matches.filter(m=>deckMap[m.my_deck_id]?.legend_id===id);
  if(type==='deck')matches=matches.filter(m=>m.my_deck_id===id);
  const formal=matches.filter(m=>m.result==='me'||m.result==='opponent');
  const statsNotes=await all('notes'),statsMu=await all('matchupNotes'),statsSessions=await all('sessions');
  const labKey=[scope,matches.length,matches[0]?.updated_at||'',statsNotes.length,statsNotes.at(-1)?.updated_at||'',statsMu.length,statsMu.at(-1)?.updated_at||'',statsSessions.length,statsSessions.at(-1)?.updated_at||''].join('|');
  if(!matches.length&&!statsSessions.length&&!statsNotes.length&&!statsMu.length){extra.innerHTML='';extra.hidden=true;extra.dataset.labKey=labKey;return;}
  extra.hidden=false;
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
    <div class='lab-card'><div class='tiny muted'>PRACTICE DAYS RECORDED</div><div class='lab-title'>${new Set(days).size}</div><p class='small muted'>Return when you can train with intent. Rest days do not erase your work.</p></div>
    <div class='section-head'><h3>Calendar</h3></div>${await calendarHtml()}
    ${fav}
    <div class='section-head'><h3>Repeated Review Tags</h3></div>${leaks.length?`<div class='lab-wrap'>${leaks.slice(0,8).map(x=>`<span class='lab-chip'>${esc(x.tag)} ×${x.count}</span>`).join('')}</div>`:`<div class='empty'>No tagged review patterns in this scope yet.</div>`}
  `;
  const gameIds=new Set(games.map(g=>g.id));
  const pointEvents=(await all('pointEvents')).filter(e=>gameIds.has(e.game_id)&&Number(e.amount)>0);
  const sources=await getMeta('score_sources',scoreDefaults());
  const custom=sources.filter(s=>!['conquer','hold','effect'].includes(s.id)).map(s=>({label:s.label,me:pointEvents.filter(e=>e.side==='me'&&e.source===s.id).reduce((a,e)=>a+Number(e.amount),0),opp:pointEvents.filter(e=>e.side==='opponent'&&e.source===s.id).reduce((a,e)=>a+Number(e.amount),0)})).filter(x=>x.me||x.opp);
  if(custom.length)extra.insertAdjacentHTML('beforeend',`<div class='section-head'><h3>Custom Scoring Sources</h3></div><div class='lab-panel'>${custom.map(x=>`<div class='lab-card lab-row'><span>${esc(x.label)}</span><span class='small muted'>You ${x.me} • Opp ${x.opp}</span></div>`).join('')}</div>`);
  $$('.labFavMu',extra).forEach(b=>b.onclick=()=>openMatchupPage(id,b.dataset.opp));
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
    if(target){const anchor=target.closest('.editor-footer')||target;anchor.parentNode.insertBefore(node,anchor);node.classList.add('editor-span');}
    if(target)target.addEventListener('click',()=>{const tags=$$('#labLeakChooser input:checked',body).map(x=>x.value);queueLeakTags(tags);},{capture:true});
  }

  if((titleText==='Start paper session'||titleText==='Start online session')&&!$('#labSessionTags',body)){
    const btn=$('#createSession',body);if(btn){
      const label=document.createElement('label');
      label.innerHTML="<span class='label-title'>Session tags <span class='muted'>(optional, comma-separated)</span></span><input id='labSessionTags' placeholder='regional prep, new list, matchup lab'>";
      const anchor=btn.closest('.editor-footer')||btn;anchor.parentNode.insertBefore(label,anchor);label.classList.add('editor-span');
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
      await refresh();deckSel.addEventListener('change',refresh);const anchor=btn.closest('.editor-footer')||btn;anchor.parentNode.insertBefore(holder,anchor);holder.classList.add('editor-span');
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
  await refresh();deckSel.addEventListener('change',refresh);const anchor=btn.closest('.editor-footer')||btn;anchor.parentNode.insertBefore(holder,anchor);holder.classList.add('editor-span');
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
