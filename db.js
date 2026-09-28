const DB_NAME = 'riftmastery-db';
const DB_VERSION = 3;
const STORES = ['legends','decks','sessions','matches','games','pointEvents','notes','testingBlocks','matchupNotes','tournaments','experiments','goals','reviewBlocks','weeklyChecklists','skillAreas','meta'];

let dbPromise;

export function uid(){
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function stampBase(extra={}){
  const now = new Date().toISOString();
  return { id: uid(), created_at: now, updated_at: now, deleted_at: null, sync_status: 'local', ...extra };
}

export function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for(const name of STORES){
        if(!db.objectStoreNames.contains(name)){
          const store = db.createObjectStore(name,{keyPath:'id'});
          if(name !== 'meta'){
            store.createIndex('updated_at','updated_at',{unique:false});
            store.createIndex('deleted_at','deleted_at',{unique:false});
          }
          if(name === 'decks') store.createIndex('legend_id','legend_id',{unique:false});
          if(name === 'matches'){
            store.createIndex('session_id','session_id',{unique:false});
            store.createIndex('my_deck_id','my_deck_id',{unique:false});
            store.createIndex('opponent_legend_id','opponent_legend_id',{unique:false});
          }
          if(name === 'games') store.createIndex('match_id','match_id',{unique:false});
          if(name === 'pointEvents') store.createIndex('game_id','game_id',{unique:false});
          if(name === 'notes'){
            store.createIndex('session_id','session_id',{unique:false});
            store.createIndex('match_id','match_id',{unique:false});
            store.createIndex('game_id','game_id',{unique:false});
          }
          if(name === 'testingBlocks') store.createIndex('deck_id','deck_id',{unique:false});
          if(name === 'matchupNotes'){
            store.createIndex('my_legend_id','my_legend_id',{unique:false});
            store.createIndex('opponent_legend_id','opponent_legend_id',{unique:false});
          }
          if(name === 'tournaments') store.createIndex('started_at','started_at',{unique:false});
          if(name === 'experiments') store.createIndex('baseline_deck_id','baseline_deck_id',{unique:false});
          if(name === 'goals') store.createIndex('status','status',{unique:false});
          if(name === 'reviewBlocks') store.createIndex('deck_id','deck_id',{unique:false});
        }
      }
    };
    req.onsuccess = () => {
      const db=req.result;
      db.onversionchange=()=>db.close();
      resolve(db);
    };
    req.onblocked = () => reject(new Error('RiftMastery storage upgrade is blocked by another open RiftMastery tab or Home Screen app. Close other copies, then reload.'));
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode='readonly'){
  return openDB().then(db => db.transaction(storeName,mode).objectStore(storeName));
}

export async function put(storeName, value){
  const store = await tx(storeName,'readwrite');
  if(storeName !== 'meta'){
    value.updated_at = new Date().toISOString();
    value.sync_status = value.sync_status || 'local';
  }
  return new Promise((resolve,reject)=>{
    const req = store.put(value);
    req.onsuccess=()=>resolve(value);
    req.onerror=()=>reject(req.error);
  });
}


export async function putRaw(storeName, value){
  const store = await tx(storeName,'readwrite');
  return new Promise((resolve,reject)=>{
    const req = store.put(value);
    req.onsuccess=()=>resolve(value);
    req.onerror=()=>reject(req.error);
  });
}

export async function add(storeName, value){ return put(storeName,value); }

export async function get(storeName,id){
  const store = await tx(storeName);
  return new Promise((resolve,reject)=>{
    const req = store.get(id);
    req.onsuccess=()=>resolve(req.result || null);
    req.onerror=()=>reject(req.error);
  });
}

export async function all(storeName,{includeDeleted=false}={}){
  const store = await tx(storeName);
  return new Promise((resolve,reject)=>{
    const req = store.getAll();
    req.onsuccess=()=>{
      const rows=req.result || [];
      resolve(includeDeleted ? rows : rows.filter(r=>!r.deleted_at));
    };
    req.onerror=()=>reject(req.error);
  });
}

export async function byIndex(storeName,indexName,value,{includeDeleted=false}={}){
  const store = await tx(storeName);
  return new Promise((resolve,reject)=>{
    const index=store.index(indexName);
    const req=index.getAll(value);
    req.onsuccess=()=>{
      const rows=req.result || [];
      resolve(includeDeleted ? rows : rows.filter(r=>!r.deleted_at));
    };
    req.onerror=()=>reject(req.error);
  });
}

export async function softDelete(storeName,id){
  const row = await get(storeName,id);
  if(!row) return;
  row.deleted_at = new Date().toISOString();
  return put(storeName,row);
}

export async function hardDelete(storeName,id){
  const store = await tx(storeName,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.delete(id);
    req.onsuccess=()=>resolve(); req.onerror=()=>reject(req.error);
  });
}

export async function clearStore(storeName){
  const store=await tx(storeName,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.clear(); req.onsuccess=()=>resolve(); req.onerror=()=>reject(req.error);
  });
}

export async function clearAll(){
  for(const s of STORES) await clearStore(s);
}

export async function exportAll(){
  const out={schema_version:2,exported_at:new Date().toISOString(),data:{}};
  for(const s of STORES) out.data[s]=await all(s,{includeDeleted:true});
  return out;
}

export async function setMeta(key,value){
  return put('meta',{id:key,value});
}

export async function getMeta(key,fallback=null){
  const row=await get('meta',key); return row ? row.value : fallback;
}
