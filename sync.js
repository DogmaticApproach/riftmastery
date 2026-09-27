
import { all, putRaw, clearStore } from './db.js?v=0.4.5';

const SUPABASE_URL='https://suhdbimnvqirehjkqlgu.supabase.co';
const SUPABASE_KEY='sb_publishable_8HJTgiAzoEKgB3dkjIi-2w_kXBfIVl7';
const APP_URL='https://dogmaticapproach.github.io/riftmastery/';
const SESSION_KEY='riftmastery-supabase-session-v1';
const SYNC_STORES=[
  'legends','decks','sessions','matches','games','pointEvents','notes',
  'testingBlocks','matchupNotes','tournaments','experiments','goals',
  'reviewBlocks','skillAreas'
];

const $=(s,r=document)=>r.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ts=v=>v?new Date(v).getTime():0;

let session=null;
let currentUser=null;
let syncing=false;
let lastSyncAt=localStorage.getItem('riftmastery-last-sync')||null;
let lastError='';
let syncTimer=null;
let recoveryMode=false;

function toast(msg){
  const t=$('#toast');if(!t)return;
  t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2200);
}
function showModal(title,html){
  const d=$('#modal');if(!d)return;
  $('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;if(!d.open)d.showModal();
}
function closeModal(){const d=$('#modal');if(d?.open)d.close();}
function setTopStatus(textValue,kind=''){
  const el=$('#saveStatus');if(!el)return;
  el.textContent=textValue;
  el.style.color=kind==='good'?'var(--good)':kind==='warn'?'var(--warn)':'';
}
function humanTime(v){
  if(!v)return 'Not synced yet';
  const d=new Date(v),seconds=Math.max(0,Math.round((Date.now()-d.getTime())/1000));
  if(seconds<10)return 'Synced just now';
  if(seconds<60)return 'Synced '+seconds+'s ago';
  const m=Math.floor(seconds/60);if(m<60)return 'Synced '+m+'m ago';
  return 'Synced '+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
}
function saveSession(next){
  session=next||null;
  currentUser=session?.user||null;
  if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
function loadSession(){
  try{
    const raw=localStorage.getItem(SESSION_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(!parsed?.access_token||!parsed?.refresh_token)return null;
    return parsed;
  }catch{return null;}
}
function normalizeAuth(data){
  if(!data?.access_token)return null;
  return {
    access_token:data.access_token,
    refresh_token:data.refresh_token,
    expires_at:Date.now()+Math.max(60,Number(data.expires_in)||3600)*1000,
    token_type:data.token_type||'bearer',
    user:data.user||null
  };
}
async function parseResponse(res){
  const text=await res.text();
  let body=null;
  try{body=text?JSON.parse(text):null;}catch{body=text||null;}
  if(!res.ok){
    const message=body?.msg||body?.message||body?.error_description||body?.error||(`Request failed (${res.status})`);
    const err=new Error(message);err.status=res.status;err.body=body;throw err;
  }
  return body;
}
async function authRequest(path,{method='POST',body=null,accessToken=null}={}){
  const headers={'apikey':SUPABASE_KEY,'Content-Type':'application/json'};
  if(accessToken)headers.Authorization='Bearer '+accessToken;
  const res=await fetch(SUPABASE_URL+path,{method,headers,body:body==null?undefined:JSON.stringify(body),cache:'no-store'});
  return parseResponse(res);
}
async function getUser(accessToken){
  return authRequest('/auth/v1/user',{method:'GET',accessToken});
}
async function refreshAuthSession(){
  if(!session?.refresh_token)return false;
  try{
    const data=await authRequest('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}});
    const next=normalizeAuth(data);
    if(!next)return false;
    saveSession(next);
    return true;
  }catch(err){
    console.warn('RiftMastery auth refresh failed',err);
    saveSession(null);
    return false;
  }
}
async function ensureSession(){
  if(!session)return false;
  if((session.expires_at||0)>Date.now()+60000)return true;
  return refreshAuthSession();
}
async function apiFetch(path,{method='GET',body=null,prefer='',retry=true}={}){
  const ready=await ensureSession();
  if(!ready)throw new Error('Sign in again to sync.');
  const headers={'apikey':SUPABASE_KEY,'Authorization':'Bearer '+session.access_token};
  if(body!=null)headers['Content-Type']='application/json';
  if(prefer)headers['Prefer']=prefer;
  const res=await fetch(SUPABASE_URL+path,{method,headers,body:body==null?undefined:JSON.stringify(body),cache:'no-store'});
  if(res.status===401&&retry&&await refreshAuthSession())return apiFetch(path,{method,body,prefer,retry:false});
  return parseResponse(res);
}
async function handleAuthRedirect(){
  if(!location.hash||!location.hash.includes('access_token='))return;
  const params=new URLSearchParams(location.hash.slice(1));
  const access_token=params.get('access_token'),refresh_token=params.get('refresh_token');
  if(!access_token||!refresh_token)return;
  let user=null;
  try{user=await getUser(access_token);}catch{}
  const next={
    access_token,
    refresh_token,
    expires_at:Date.now()+Math.max(60,Number(params.get('expires_in'))||3600)*1000,
    token_type:params.get('token_type')||'bearer',
    user
  };
  saveSession(next);
  recoveryMode=params.get('type')==='recovery';
  history.replaceState(null,'',location.pathname+location.search);
}
function cloudCardHtml(){
  if(!currentUser){
    return `
      <div class="card" id="cloudSyncCard">
        <div class="section-head" style="margin:0 0 10px"><div><h3>Cloud Sync</h3><div class="sub">Use one account on phone and web.</div></div><span class="chip">Cloud</span></div>
        <button class="btn primary full" id="cloudSignIn" type="button">Sign in / Create account</button>
        <div class="tiny muted" style="margin-top:8px">Your local data stays on this device until you sign in. First sync uploads it to your private account.</div>
      </div>`;
  }
  const stateText=syncing?'Syncing…':lastError?'Sync issue':humanTime(lastSyncAt);
  return `
    <div class="card" id="cloudSyncCard">
      <div class="section-head" style="margin:0 0 10px"><div><h3>Cloud Sync</h3><div class="sub">${esc(currentUser.email||'Signed in')}</div></div><span class="chip ${lastError?'warn':'good'}">${esc(stateText)}</span></div>
      ${lastError?`<div class="small" style="color:var(--warn);margin-bottom:9px">${esc(lastError)}</div>`:''}
      <div class="btn-row"><button class="btn primary" id="cloudSyncNow" type="button" ${syncing?'disabled':''}>${syncing?'Syncing…':'Sync now'}</button><button class="btn ghost" id="cloudAccount" type="button">Account</button></div>
      <div class="tiny muted" style="margin-top:8px">Changes save locally first, then sync to your private Supabase account.</div>
    </div>`;
}
function renderCloudCard(){
  const mount=$('#cloudSyncMount');
  if(!mount)return;
  const sig=JSON.stringify([currentUser?.id||'',currentUser?.email||'',syncing,lastError,lastSyncAt]);
  if(mount.dataset.cloudSig===sig)return;
  mount.dataset.cloudSig=sig;
  mount.innerHTML=cloudCardHtml();
  if(!currentUser){
    $('#cloudSignIn',mount)?.addEventListener('click',openAuthModal);
  }else{
    $('#cloudSyncNow',mount)?.addEventListener('click',()=>syncNow({manual:true}));
    $('#cloudAccount',mount)?.addEventListener('click',openAccountModal);
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
function setAuthMsg(msg,isError=false){
  const el=$('#cloudAuthMsg');if(!el)return;
  el.textContent=msg;el.style.color=isError?'var(--warn)':'var(--muted)';
}
async function signIn(){
  const email=$('#cloudEmail').value.trim(),password=$('#cloudPassword').value;
  if(!email||!password)return setAuthMsg('Enter your email and password.');
  setAuthMsg('Signing in…');
  try{
    const data=await authRequest('/auth/v1/token?grant_type=password',{body:{email,password}});
    const next=normalizeAuth(data);if(!next)throw new Error('Supabase did not return a session.');
    saveSession(next);
    closeModal();renderCloudCard();toast('Signed in. Syncing your data…');await requestPersistentStorage();syncNow();
  }catch(err){setAuthMsg(err.message,true);}
}
async function signUp(){
  const email=$('#cloudEmail').value.trim(),password=$('#cloudPassword').value;
  if(!email||password.length<8)return setAuthMsg('Use a valid email and a password of at least 8 characters.');
  setAuthMsg('Creating account…');
  try{
    const path='/auth/v1/signup?redirect_to='+encodeURIComponent(APP_URL);
    const data=await authRequest(path,{body:{email,password}});
    const next=normalizeAuth(data);
    if(next){
      saveSession(next);closeModal();renderCloudCard();toast('Account created. Syncing your data…');await requestPersistentStorage();syncNow();
    }else{
      setAuthMsg('Account created. Check your email to confirm it, then return here and sign in.');
    }
  }catch(err){setAuthMsg(err.message,true);}
}
async function sendPasswordReset(){
  const email=$('#cloudEmail').value.trim();
  if(!email)return setAuthMsg('Enter your email first.');
  try{
    await authRequest('/auth/v1/recover?redirect_to='+encodeURIComponent(APP_URL),{body:{email}});
    setAuthMsg('Password reset email sent.');
  }catch(err){setAuthMsg(err.message,true);}
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
    try{
      await authRequest('/auth/v1/user',{method:'PUT',body:{password:p1},accessToken:session.access_token});
      recoveryMode=false;closeModal();toast('Password updated.');
    }catch(err){msg.textContent=err.message;msg.style.color='var(--warn)';}
  };
}
function openAccountModal(){
  showModal('Cloud account',`
    <p class="small"><strong>${esc(currentUser?.email||'')}</strong></p>
    <p class="small muted">${esc(humanTime(lastSyncAt))}</p>
    <div class="btn-row"><button class="btn" id="accountSync" type="button">Sync now</button><button class="btn danger" id="accountSignOut" type="button">Sign out</button></div>
    <div class="tiny muted" style="margin-top:10px">Signing out does not erase this device. Local data stays here unless you reset RiftMastery separately.</div>`);
  $('#accountSync').onclick=async()=>{await syncNow({manual:true});closeModal();};
  $('#accountSignOut').onclick=signOut;
}
async function signOut(){
  try{if(session?.access_token)await authRequest('/auth/v1/logout',{body:{},accessToken:session.access_token});}catch{}
  saveSession(null);lastError='';closeModal();renderCloudCard();setTopStatus('Saved on this device','good');toast('Signed out. Local data remains on this device.');
}
async function fetchRemoteRows(){
  const rows=[];let offset=0;
  while(true){
    const qs=new URLSearchParams({
      select:'store_name,record_id,payload,record_updated_at,deleted_at,server_updated_at',
      order:'server_updated_at.asc',
      limit:'1000',
      offset:String(offset)
    });
    const data=await apiFetch('/rest/v1/riftmastery_records?'+qs.toString());
    rows.push(...(Array.isArray(data)?data:[]));
    if(!Array.isArray(data)||data.length<1000)break;
    offset+=1000;
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
    const qs=new URLSearchParams({on_conflict:'user_id,store_name,record_id'});
    await apiFetch('/rest/v1/riftmastery_records?'+qs.toString(),{
      method:'POST',
      body:changes.slice(i,i+200),
      prefer:'resolution=merge-duplicates,return=minimal'
    });
  }
  return changes.length;
}
async function syncNow({manual=false}={}){
  if(syncing||!currentUser||!navigator.onLine)return;
  syncing=true;lastError='';renderCloudCard();setTopStatus('Syncing…','warn');
  try{
    let localBefore=await localSnapshot();
    const remote=await fetchRemoteRows();
    const substantiveStores=new Set(['decks','sessions','matches','games','pointEvents','notes','testingBlocks','matchupNotes','tournaments','experiments','goals','reviewBlocks']);
    const hasSubstantiveLocal=[...localBefore.values()].some(x=>substantiveStores.has(x.store));
    if(remote.length&&!hasSubstantiveLocal){
      for(const store of SYNC_STORES)await clearStore(store);
      localBefore=await localSnapshot();
    }
    const pulled=await applyRemoteNewer(remote,localBefore);
    const pushed=await pushLocalNewer(remote);
    lastSyncAt=new Date().toISOString();
    localStorage.setItem('riftmastery-last-sync',lastSyncAt);
    lastError='';setTopStatus('Synced','good');renderCloudCard();
    if(pulled>0)window.dispatchEvent(new CustomEvent('riftmastery:cloudsync',{detail:{pulled,pushed}}));
    if(manual)toast(`Sync complete${pulled||pushed?` • ${pulled} pulled • ${pushed} pushed`:''}.`);
  }catch(err){
    console.error('RiftMastery cloud sync',err);
    lastError=err?.message||'Cloud sync failed.';
    setTopStatus('Saved locally • sync issue','warn');renderCloudCard();
    if(manual)toast('Cloud sync failed. Your local data is still safe.');
  }finally{
    syncing=false;renderCloudCard();
  }
}
async function requestPersistentStorage(){
  try{if(navigator.storage?.persist)await navigator.storage.persist();}catch{}
}
async function initCloud(){
  await handleAuthRedirect();
  if(!session)saveSession(loadSession());
  if(session){
    if(!(await ensureSession()))saveSession(null);
    else if(!currentUser){
      try{session.user=await getUser(session.access_token);saveSession(session);}catch{}
    }
  }
  renderCloudCard();
  if(currentUser){
    setTopStatus(lastSyncAt?humanTime(lastSyncAt):'Cloud ready','good');
    await requestPersistentStorage();
    syncNow();
  }else{
    setTopStatus('Saved on this device','good');
  }
  if(recoveryMode)setTimeout(openRecoveryModal,50);
}
window.addEventListener('riftmastery:more-rendered',renderCloudCard);
window.addEventListener('online',()=>{if(currentUser)syncNow();});
window.addEventListener('riftmastery:localchange',()=>{if(currentUser){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),1200);}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentUser)syncNow();});
setInterval(()=>{if(currentUser&&navigator.onLine)syncNow();},15000);
initCloud().catch(err=>{
  console.error('RiftMastery cloud init failed',err);
  lastError=err?.message||'Cloud sync could not start.';
  renderCloudCard();
});
