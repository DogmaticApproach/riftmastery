// Pure, reproducible progression. XP is derived from evidence, never incremented on clicks.
export const SKILLS=[
 ['open-board','Open-board judgment','Read the position, compare two lines, preserve the next turn.'],
 ['ranges','Ranges & information','Update plausible answers from actions and non-actions.'],
 ['openings','Contingency openings','Build a functional plan when the ideal pieces are missing.'],
 ['sequencing','Sequencing & resources','Work backward from the end state you want.'],
 ['geometry','Battlefields & scoring','Decide when to take, hold, trade, or wait.'],
 ['matchups','Matchup construction','Know your role, sideboard plan, and alternate win condition.'],
 ['discipline','Session discipline','Precommit your block and review without chasing losses.'],
 ['theory','Research & explanation','Test a claim and explain only what the evidence supports.']
];
export const KINDS={study:{label:'Study a decision',xp:30,cap:2,verb:'Study'},drill:{label:'Run a focused drill',xp:30,cap:2,verb:'Drill'},review:{label:'Review two lines',xp:40,cap:2,verb:'Review'},research:{label:'Test a hypothesis',xp:30,cap:2,verb:'Research'},transfer:{label:'Retest a lesson',xp:50,cap:2,verb:'Transfer'},discipline:{label:'Honor a session plan',xp:20,cap:3,verb:'Discipline'},explain:{label:'Explain with evidence',xp:25,cap:2,verb:'Explain'}};
export const REALMS=[['Outer Disciple',0],['Inner Disciple',150],['Jade Adept',400],['Core Disciple',850],['Mountain Keeper',1500],['Dao Seeker',2500]];
export const STATUSES=['Developing','Functional','Reliable','Weapon'];
export function dayKey(value=new Date()){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function weekKey(value=new Date()){const d=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T12:00:00'):new Date(value);d.setDate(d.getDate()-((d.getDay()+6)%7));return dayKey(d);}
const meaningful=v=>typeof v==='string'&&v.trim().length>=8;
export function validateTrial(row,notes=[],today=dayKey()){
 if(!KINDS[row.kind]||!SKILLS.some(s=>s[0]===row.skill))return 'Choose a trial and skill.';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(row.day||'')||dayKey(row.day+'T12:00:00')!==row.day||row.day>today)return 'Choose a valid date, today or earlier.';
 if(!meaningful(row.lesson)||!meaningful(row.next_test))return 'Add a specific observation and next test (at least 8 characters each).';
 if(!['practice','vod','drill','event'].includes(row.context))return 'Choose where you tested this.';
 if(row.kind==='transfer'){
  const source=notes.find(n=>n.id===row.source_id&&!n.deleted_at);
  if(!source||source.id===row.id||!['cultivation_trial','position_review','preview_research'].includes(source.record_type))return 'Link an earlier lesson to retest.';
  if(!meaningful(source.lesson||source.takeaway||source.finding||source.question))return 'The earlier lesson needs a specific observation first.';
  const sourceDay=source.day||dayKey(source.timestamp||source.created_at);
  if(!sourceDay||sourceDay>=row.day)return 'Retest on a later day than the original lesson.';
  if(source.record_type==='cultivation_trial'&&source.skill!==row.skill)return 'Keep the same skill as the linked lesson.';
  if(!['observed','needs_work','uncertain'].includes(row.outcome))return 'Record whether the lesson held up.';
 }
 return '';
}
export function buildProgress(data={},now=new Date()){
 const notes=(data.notes||[]).filter(n=>!n.deleted_at),today=dayKey(now),week=weekKey(now),events=[];
 const add=(row,kind,skill,title,when,extra={})=>{const day=row.day||dayKey(when||row.timestamp||row.created_at);if(!day||day>today)return;events.push({id:row.id,kind,skill,title,day,week:weekKey(day),context:row.context||'practice',...extra});};
 const uniqueNotes=[...new Map(notes.map(n=>[n.id,n])).values()];
 for(const n of uniqueNotes){
  if(n.record_type==='cultivation_trial'&&!validateTrial(n,notes,today))add(n,n.kind,n.skill,n.lesson,null,{outcome:n.outcome,source_id:n.source_id});
  if(n.record_type==='position_review'&&['reviewed','uncertain'].includes(n.review_status)&&meaningful(n.line_a)&&meaningful(n.line_b)&&meaningful(n.takeaway))add(n,'review','open-board',n.question||n.takeaway);
  if(n.record_type==='preview_research'&&meaningful(n.evidence)&&meaningful(n.finding)&&meaningful(n.next_test))add(n,'research','theory',n.question||n.finding);
  if(n.record_type==='x_post'&&meaningful(n.claim)&&meaningful(n.evidence)&&meaningful(n.post_text))add(n,'explain','theory',n.hook||n.claim);
 }
 for(const r of data.reviewBlocks||[])if(!r.deleted_at&&r.completed_at&&meaningful(r.next_drill)&&meaningful(r.repeated))add(r,'review','open-board',r.next_drill,r.completed_at);
 for(const s of data.sessions||[]){const planned=Number(s.planned_bo3_count),matches=(data.matches||[]).filter(m=>!m.deleted_at&&m.session_id===s.id&&m.ended_at&&m.format==='BO3');if(!s.deleted_at&&s.status==='completed'&&s.ended_at&&planned>0&&matches.length===planned)add(s,'discipline','discipline',`Completed the planned ${planned} BO3s`,s.ended_at);}
 events.sort((a,b)=>a.day.localeCompare(b.day)||String(a.id).localeCompare(String(b.id)));
 const caps=new Map();for(const e of events){const k=e.week+':'+e.kind,n=caps.get(k)||0; e.xp=n<KINDS[e.kind].cap?KINDS[e.kind].xp:0;caps.set(k,n+1);}
 const bonuses=[];
 for(const w of data.weeklyChecklists||[]){const required=(w.items||[]).filter(i=>!i.optional);if(!w.deleted_at&&w.week_start<=week&&required.length&&required.every(i=>i.done))bonuses.push({id:'plan:'+w.id,week:w.week_start,xp:40,title:'Weekly plan complete'});}
 for(const n of uniqueNotes.filter(n=>n.record_type==='cultivation_checkpoint')){const we=events.filter(e=>e.week===n.week);if(n.week<=week&&new Set(we.map(e=>e.kind)).size>=3&&we.some(e=>e.kind==='transfer')&&meaningful(n.lesson)&&meaningful(n.next_test)&&!bonuses.some(b=>b.week===n.week&&b.id.startsWith('checkpoint:')))bonuses.push({id:'checkpoint:'+n.id,week:n.week,xp:60,title:'Weekly breakthrough review'});}
 const xp=events.reduce((s,e)=>s+e.xp,0)+bonuses.reduce((s,e)=>s+e.xp,0),realmIndex=REALMS.reduce((i,r,n)=>xp>=r[1]?n:i,0),realm=REALMS[realmIndex],nextRealm=REALMS[realmIndex+1];
 const current=events.filter(e=>e.week===week),weekly=(data.weeklyChecklists||[]).find(w=>w.week_start===week&&!w.deleted_at),phase=weekly?.phase||'preview';
 const routes=phase==='launch'||phase==='ongoing'?['drill','review','discipline','transfer']:['study','drill','research','transfer'];
 const quests=routes.map(kind=>({kind,...KINDS[kind],target:kind==='study'||kind==='drill'?2:1,count:current.filter(e=>e.kind===kind).length}));
 const skills=SKILLS.map(([id,name,cue])=>{const evidence=events.filter(e=>e.skill===id),days=new Set(evidence.map(e=>e.day)).size,contexts=new Set(evidence.map(e=>e.context)).size,transfers=new Set(evidence.filter(e=>e.kind==='transfer'&&e.outcome==='observed').map(e=>e.day)).size,explained=evidence.some(e=>e.kind==='explain'),eligible=[true,days>=2,days>=4&&contexts>=2&&transfers>=2,days>=6&&contexts>=2&&transfers>=3&&explained];const assessment=uniqueNotes.filter(n=>n.record_type==='cultivation_assessment'&&n.skill===id).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0];return {id,name,cue,evidence,days,contexts,transfers,eligible,status:STATUSES.includes(assessment?.status)?assessment.status:'Developing',assessment};});
 const focus=notes.find(n=>n.id==='cultivation-focus')?.skill||'open-board';
 const seals=[['First insight',events.length>=1,'Save your first learning record.'],['Return to the lesson',events.some(e=>e.kind==='transfer'),'Retest a lesson on a later day.'],['Full circle',bonuses.some(b=>b.id.startsWith('checkpoint:')),'Complete a weekly breakthrough review.'],['Steady practice',new Set(events.map(e=>e.week)).size>=4,'Record learning in four different weeks.']];
 return {xp,week,phase,realm,nextRealm,realmIndex,events,current,bonuses,quests,skills,focus,seals,weeklyXP:current.reduce((s,e)=>s+e.xp,0)+bonuses.filter(b=>b.week===week).reduce((s,b)=>s+b.xp,0),checkpointReady:new Set(current.map(e=>e.kind)).size>=3&&current.some(e=>e.kind==='transfer'),checkpointDone:bonuses.some(b=>b.week===week&&b.id.startsWith('checkpoint:'))};
}
