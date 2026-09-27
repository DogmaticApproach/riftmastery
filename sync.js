
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { all, get, putRaw, stampBase, clearStore } from './db.js?v=0.4.3';

const SUPABASE_URL='https://suhdbimnvqirehjkqlgu.supabase.co';
const SUPABASE_KEY='sb_publishable_8HJTgiAzoEKgB3dkjIi-2w_kXBfIVl7';
const APP_URL='https://dogmaticapproach.github.io/riftmastery/';
const SYNC_STORES=[
  'legends','decks','sessions','matches','games','pointEvents','notes',
  'testingBlocks','matchupNotes','tournaments','experiments','goals',
  'reviewBlocks','skillAreas'
];

const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const $=(s,r=document)=>r.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ts=v=>v?new Date(v).getTime():0;

let currentUser=null;
let syncing=false;
let lastSyncAt=null;
let lastError='';
let syncTimer=null;

function toast(msg){
  const t=$('#toast');if(!t)return;
  t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2200);
}
function showModal(title,html){
  const d=$('#modal');if(!d)return;
  $('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;if(!d.open)d.showModal();
}
function closeModal(){const d=$('#modal');if(d?.open)d.close();}
function humanTime(v){
  if(!v)return 'Not synced yet';
  const d=new Date(v),seconds=Math.max(0,Math.round((Date.now()-d.getTime())/1000));
  if(seconds<10)return 'Synced just now';
  if(seconds<60)return 'Synced '+seconds+'s ago';
  const m=Math.floor(seconds/60);if(m<60)return 'Synced '+m+'m ago';
  return 'Synced '+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
}
function setTopStatus(textValue,kind=''){
  const el=$('#saveStatus');if(!el)return;
  el.textContent=textValue;
  if(kind==='good')el.style.color='var(--good)';
  else if(kind==='warn')el.style.color='var(--warn)';
  else el.style.color='';
}
function syncCardHtml(){
  if(!currentUser){
    return `
      <div class="card" id="cloudSyncCard">
        <div class="section-head"><div><h3>Cloud Sync</h3><div class="sub">Sign in to keep the same RiftMastery data on phone and web.</div></div><span class="chip">Cloud</span></div>
        <button class="btn primary full" id="cloudSignIn">Sign in / Create account</button>
        <div class="tiny muted" style="margin-top:8px">Local data stays on this device until you sign in.</div>
      </div>`;
  }
  const stateText=syncing?'Syncing…':lastError?'Sync issue':humanTime(lastSyncAt);
  return `
    <div class="card" id="cloudSyncCard">
      <div class="section-head"><div><h3>Cloud Sync</h3><div class="sub">${esc(currentUser.email||'Signed in')}</div></div><span class="chip ${lastError?'warn':'good'}">${esc(stateText)}</span></div>
      ${lastError?`<div class="small" style="color:var(--warn);margin-bottom:9px">${esc(lastError)}</div>`:''}
      <div class="btn-row"><button class="btn primary" id="cloudSyncNow" ${syncing?'disabled':''}>${syncing?'Syncing…':'Sync now'}</button><button class="btn ghost" id="cloudAccount">Account</button></div>
      <div class="tiny muted" style="margin-top:8px">Changes save locally first, then sync to your private cloud account.</div>
    </div>`;
}
function renderCloudCard(){
  const more=$('#screen-more');if(!more)return;
  let card=$('#cloudSyncCard',more);
  const wrap=document.createElement('div');wrap.innerHTML=syncCardHtml();const next=wrap.firstElementChild;
  if(card)card.replaceWith(next);else more.prepend(next);
  if(!currentUser){
    $('#cloudSignIn',more)?.addEventListener('click',openAuthModal);
  }else{
    $('#cloudSyncNow',more)?.addEventListener('click',()=>syncNow({manual:true}));
    $('#cloudAccount',more)?.addEventListener('click',openAccountModal);
  }
}
function openAuthModal(){
  showModal('RiftMastery account',`
    <p class="small muted">Use the same email and password on your iPhone and computer.</p>
    <label><span class="label-title">Email</span><input id="cloudEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <label><span class="label-title">Password</span><input id="cloudPassword" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></label>
    <div class="btn-row"><button class="btn primary" id="cloudLogin" type="button">Sign in</button><button class="btn" id="cloudSignup" type="button">Create account</button></div>
    <button class="link-btn small" id="cloudForgot" type="button" style="margin-top:10px">Forgot password?</button>
    <div id="cloudAuthMsg" class="small muted" style="margin-top:10px"></div>`);
  $('#cloudLogin').onclick=signIn;
  $('#cloudSignup').onclick=signUp;
  $('#cloudForgot').onclick=sendPasswordReset;
}
async function signIn(){
  const email=$('#cloudEmail').value.trim(),password=$('#cloudPassword').value;
  if(!email||!password)return setAuthMsg('Enter your email and password.');
  setAuthMsg('Signing in…');
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error)return setAuthMsg(error.message,true);
  closeModal();toast('Signed in. Syncing your data…');
}
async function signUp(){
  const email=$('#cloudEmail').value.trim(),password=$('#cloudPassword').value;
  if(!email||password.length<8)return setAuthMsg('Use a valid email and a password of at least 8 characters.');
  setAuthMsg('Creating account…');
  const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:APP_URL}});
  if(error)return setAuthMsg(error.message,true);
  if(data.session){
    closeModal();toast('Account created. Syncing your data…');
  }else{
    setAuthMsg('Account created. Check your email to confirm it, then come back and sign in.');
  }
}
async function sendPasswordReset(){
  const email=$('#cloudEmail').value.trim();
  if(!email)return setAuthMsg('Enter your email first.');
  const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:APP_URL});
  if(error)return setAuthMsg(error.message,true);
  setAuthMsg('Password reset email sent.');
}

function openRecoveryModal(){
  showModal('Set new password',`
    <p class="small muted">Choose a new password for your RiftMastery account.</p>
    <label><span class="label-title">New password</span><input id="cloudNewPassword" type="password" minlength="8" autocomplete="new-password"></label>
    <label><span class="label-title">Confirm password</span><input id="cloudNewPassword2" type="password" minlength="8" autocomplete="new-password"></label>
    <button class="btn primary full" id="cloudSavePassword" type="button">Update password</button>
    <div id="cloudRecoveryMsg" class="small muted" style="margin-top:10px"></div>`);
  $('#cloudSavePassword').onclick=async()=>{
    const p1=$('#cloudNewPassword').value,p2=$('#cloudNewPassword2').value,msg=$('#cloudRecoveryMsg');
    if(p1.length<8){msg.textContent='Use at least 8 characters.';return;}
    if(p1!==p2){msg.textContent='Passwords do not match.';return;}
    msg.textContent='Updating password…';
    const {error}=await supabase.auth.updateUser({password:p1});
    if(error){msg.textContent=error.message;msg.style.color='var(--warn)';return;}
    closeModal();toast('Password updated.');
  };
}
function setAuthMsg(msg,isError=false){
  const el=$('#cloudAuthMsg');if(!el)return;
  el.textContent=msg;el.style.color=isError?'var(--warn)':'var(--muted)';
}
function openAccountModal(){
  showModal('Cloud account',`
    <p class="small"><strong>${esc(currentUser?.email||'')}</strong></p>
    <p class="small muted">${esc(humanTime(lastSyncAt))}</p>
    <div class="btn-row"><button class="btn" id="accountSync" type="button">Sync now</button><button class="btn danger" id="accountSignOut" type="button">Sign out</button></div>
    <div class="tiny muted" style="margin-top:10px">Signing out does not erase this device. Local data stays here unless you reset RiftMastery separately.</div>`);
  $('#accountSync').onclick=async()=>{await syncNow({manual:true});closeModal();};
  $('#accountSignOut').onclick=async()=>{await supabase.auth.signOut();closeModal();toast('Signed out. Local data remains on this device.');};
}

async function fetchRemoteRows(){
  const rows=[];let from=0;
  while(true){
    const {data,error}=await supabase.from('riftmastery_records')
      .select('store_name,record_id,payload,record_updated_at,deleted_at,server_updated_at')
      .order('server_updated_at',{ascending:true})
      .range(from,from+999);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<1000)break;
    from+=1000;
  }
  return rows;
}
async function localSnapshot(){
  const map=new Map();
  for(const store of SYNC_STORES){
    const rows=await all(store,{includeDeleted:true});
    for(const row of rows)map.set(store+'::'+row.id,{store,row});
  }
  return map;
}
async function applyRemoteNewer(remoteRows,localMap){
  let pulled=0;
  for(const remote of remoteRows){
    const key=remote.store_name+'::'+remote.record_id;
    const local=localMap.get(key)?.row;
    if(!local||ts(remote.record_updated_at)>ts(local.updated_at)){
      const payload={...remote.payload,id:remote.record_id,updated_at:remote.record_updated_at,deleted_at:remote.deleted_at||remote.payload?.deleted_at||null,sync_status:'synced'};
      await putRaw(remote.store_name,payload);
      pulled++;
    }
  }
  return pulled;
}
async function pushLocalNewer(remoteRows){
  const remoteMap=new Map(remoteRows.map(r=>[r.store_name+'::'+r.record_id,r]));
  const localMap=await localSnapshot();
  const changes=[];
  for(const {store,row} of localMap.values()){
    if(!row?.id)continue;
    const remote=remoteMap.get(store+'::'+row.id);
    if(!remote||ts(row.updated_at)>ts(remote.record_updated_at)){
      changes.push({
        user_id:currentUser.id,
        store_name:store,
        record_id:row.id,
        payload:row,
        record_updated_at:row.updated_at||row.created_at||new Date().toISOString(),
        deleted_at:row.deleted_at||null,
        server_updated_at:new Date().toISOString()
      });
    }
  }
  for(let i=0;i<changes.length;i+=200){
    const {error}=await supabase.from('riftmastery_records')
      .upsert(changes.slice(i,i+200),{onConflict:'user_id,store_name,record_id'});
    if(error)throw error;
  }
  return changes.length;
}
async function syncNow({manual=false}={}){
  if(syncing||!currentUser||!navigator.onLine)return;
  syncing=true;lastError='';renderCloudCard();setTopStatus('Syncing…','warn');
  try{
    let localBefore=await localSnapshot();
    const remote=await fetchRemoteRows();

    // On a brand-new device, replace generated starter data with the cloud copy
    // instead of merging duplicate default Legends / training areas.
    const substantiveStores=new Set(['decks','sessions','matches','games','pointEvents','notes','testingBlocks','matchupNotes','tournaments','experiments','goals','reviewBlocks']);
    const hasSubstantiveLocal=[...localBefore.values()].some(x=>substantiveStores.has(x.store));
    if(remote.length && !hasSubstantiveLocal){
      for(const store of SYNC_STORES) await clearStore(store);
      localBefore=await localSnapshot();
    }

    const pulled=await applyRemoteNewer(remote,localBefore);
    const pushed=await pushLocalNewer(remote);
    lastSyncAt=new Date().toISOString();
    localStorage.setItem('riftmastery-last-sync',lastSyncAt);
    setTopStatus('Synced','good');
    renderCloudCard();
    if(pulled>0)window.dispatchEvent(new CustomEvent('riftmastery:cloudsync',{detail:{pulled,pushed}}));
    if(manual)toast(`Sync complete${pulled||pushed?` • ${pulled} pulled • ${pushed} pushed`:''}.`);
  }catch(err){
    console.error('RiftMastery cloud sync',err);
    lastError=err?.message||'Cloud sync failed.';
    setTopStatus('Saved locally • sync issue','warn');
    renderCloudCard();
    if(manual)toast('Cloud sync failed. Your local data is still safe.');
  }finally{
    syncing=false;renderCloudCard();
  }
}
async function requestPersistentStorage(){
  try{
    if(navigator.storage?.persist)await navigator.storage.persist();
  }catch{}
}
async function initAuth(){
  lastSyncAt=localStorage.getItem('riftmastery-last-sync')||null;
  const {data}=await supabase.auth.getSession();
  currentUser=data.session?.user||null;
  renderCloudCard();
  if(currentUser){await requestPersistentStorage();await syncNow();}
  supabase.auth.onAuthStateChange(async(event,session)=>{
    currentUser=session?.user||null;
    lastError='';
    renderCloudCard();
    if(event==='PASSWORD_RECOVERY'){
      setTimeout(openRecoveryModal,50);
    }
    if(currentUser){
      await requestPersistentStorage();
      setTimeout(()=>syncNow(),50);
    }else{
      setTopStatus('Saved on this device','good');
    }
  });
}
function watchUi(){
  const observer=new MutationObserver(()=>renderCloudCard());
  const more=$('#screen-more');
  if(more)observer.observe(more,{childList:true});
  window.addEventListener('online',()=>{if(currentUser)syncNow();});
  window.addEventListener('riftmastery:localchange',()=>{if(currentUser){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),1200);}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentUser)syncNow();});
  setInterval(()=>{if(currentUser&&navigator.onLine)syncNow();},15000);
}
initAuth().then(watchUi).catch(err=>console.error('RiftMastery cloud init failed',err));
