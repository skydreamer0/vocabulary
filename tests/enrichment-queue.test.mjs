import test from 'node:test';
import assert from 'node:assert/strict';
import {EnrichmentQueue,readLookupAttempts} from '../lib/enrichment-queue.ts';

const word=(id,status='pending',term=id)=>({id,term,lookupStatus:status,archivedAt:null,dictionary:[],phonetic:'',definition:'',revision:0});
function harness({words=[word('apple')],lookup,attempts,nextRequestAt}={}){
 let now=0,sequence=0,saved={},savedNext=0;const timers=new Map(),calls=[],updates=[],notices=[];
 const queue=new EnrichmentQueue({attempts,nextRequestAt,now:()=>now,setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,fn});return id},clearTimer:id=>timers.delete(id),persist:(a,next)=>{saved=structuredClone(a);savedNext=next},onWord:w=>updates.push(w),onBusy:()=>{},onFailure:m=>notices.push(m),lookup:async id=>{calls.push({id,at:now});return lookup?lookup(id):{word:word(id,'found'),status:'found'}}});
 queue.sync(words);queue.setOnline(true);
 const step=async()=>{assert.ok(timers.size,'expected a scheduled job');const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=t.at;await t.fn()};
 return {queue,timers,calls,updates,notices,step,get saved(){return saved},get nextRequestAt(){return savedNext},get now(){return now}};
}

test('opening resumes pending words but never re-fetches completed definitions',async()=>{
 const h=harness({words:[word('apple'),word('book','found'),word('missing','not_found')]});await h.step();
 assert.deepEqual(h.calls.map(c=>c.id),['apple']);assert.equal(h.timers.size,0);assert.deepEqual(h.saved,{});
});
test('100-card import stays below the per-minute lookup budget and completes',async()=>{
 const h=harness({words:Array.from({length:100},(_,i)=>word(`word${i}`))});
 while(h.timers.size)await h.step();assert.equal(h.calls.length,100);
 const buckets=new Map();for(const c of h.calls)buckets.set(Math.floor(c.at/60000),(buckets.get(Math.floor(c.at/60000))||0)+1);
 assert.ok([...buckets.values()].every(n=>n<=40));
});
test('unavailable responses back off five times, persist the stop, and allow explicit retry',async()=>{
 const fail=id=>({word:word(id,'unavailable'),status:'unavailable'});const h=harness({lookup:fail});
 while(h.timers.size)await h.step();assert.equal(h.calls.length,5);assert.deepEqual(h.calls.map(c=>c.at),[0,60000,360000,1260000,4860000]);
 const restored=harness({words:[word('apple','unavailable')],attempts:h.saved,lookup:fail});assert.equal(restored.timers.size,0);
 restored.queue.retry(['apple']);await restored.step();assert.equal(restored.calls.length,1);assert.equal(restored.saved.apple.count,1);
});
test('real not-found is terminal rather than an endless automatic retry',async()=>{
 const h=harness({lookup:id=>({word:word(id,'not_found'),status:'not_found'})});await h.step();assert.equal(h.timers.size,0);
});
test('offline cancels pending timers and reconnect resumes without another import',async()=>{
 const h=harness();h.queue.setOnline(false);assert.equal(h.timers.size,0);h.queue.setOnline(true);await h.step();assert.equal(h.calls.length,1);
});
test('closing during a request preserves retry timing and does not mutate an unmounted UI',async()=>{
 let resolve;const h=harness({lookup:()=>new Promise(r=>resolve=r)});const active=h.step();
 assert.equal(h.saved.apple.count,1);h.queue.dispose();resolve({word:word('apple','found'),status:'found'});await active;
 assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);
 const restored=harness({attempts:h.saved});await restored.step();assert.equal(restored.calls[0].at,60000);
});
test('repeated sync and clicks coalesce an in-flight lookup',async()=>{
 let resolve;const h=harness({lookup:()=>new Promise(r=>resolve=r)});const active=h.step();h.queue.sync([word('apple')]);h.queue.retry(['apple','apple']);
 resolve({word:word('apple','found'),status:'found'});await active;assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
test('renaming during lookup discards the old result and looks up the new term',async()=>{
 let resolve;let n=0;const h=harness({lookup:id=>++n===1?new Promise(r=>resolve=r):{word:word(id,'found','pear'),status:'found'}});
 const active=h.step();h.queue.sync([word('apple','pending','pear')]);resolve({word:word('apple','found'),status:'found'});await active;
 assert.equal(h.updates.length,0);await h.step();assert.equal(h.updates[0].term,'pear');
});
test('archiving while in flight does not replace the archived UI record',async()=>{
 let resolve;const h=harness({lookup:()=>new Promise(r=>resolve=r)});const active=h.step();h.queue.sync([{...word('apple'),archivedAt:1}]);resolve({word:word('apple','found'),status:'found'});await active;
 assert.equal(h.updates.length,0);assert.equal(h.timers.size,0);
});
test('429 pauses the whole queue for a minute instead of hammering every card',async()=>{
 let n=0;const h=harness({words:[word('apple'),word('book')],lookup:id=>{if(++n===1)throw Object.assign(new Error('rate limited'),{status:429});return {word:word(id,'found'),status:'found'}}});
 await h.step();await h.step();assert.equal(h.calls[1].at,60000);assert.equal(h.notices.length,1);
});
test('authentication errors pause the queue until a validated refresh or explicit retry',async()=>{
 const h=harness({words:[word('apple'),word('book')],lookup:()=>{throw Object.assign(new Error('sign in'),{status:401})}});await h.step();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
test('upstream 429 inside a successful app response also pauses the whole queue',async()=>{
 let n=0;const h=harness({words:[word('apple'),word('book')],lookup:id=>++n===1?{word:word(id,'unavailable'),status:'unavailable',lookupError:{code:'provider_http',retryable:true,upstreamStatus:429}}:{word:word(id,'found'),status:'found'}});
 await h.step();await h.step();assert.equal(h.calls[1].at,60000);
});
test('reopening preserves whole-queue cooldown before looking up a different card',async()=>{
 const h=harness({lookup:()=>{throw Object.assign(new Error('rate limited'),{status:429})}});await h.step();
 const restored=harness({words:[word('book')],attempts:h.saved,nextRequestAt:h.nextRequestAt});await restored.step();assert.equal(restored.calls[0].at,60000);
});
test('cached successful SQL result stops retries even if this upstream attempt failed',async()=>{
 const h=harness({lookup:id=>({word:word(id,'found'),status:'unavailable'})});await h.step();assert.equal(h.timers.size,0);assert.deepEqual(h.saved,{});
});
test('malformed success payload cannot insert undefined into the queue or UI',async()=>{
 for(const invalid of [undefined,{error:'connection interrupted'},{word:word('wrong-id','found'),status:'found'}]){
  const h=harness({lookup:async()=>invalid});await h.step();assert.equal(h.updates.length,0);assert.equal(h.saved.apple.count,1);assert.ok(h.timers.size);
 }
});
test('corrupt retry metadata is ignored and future timestamps are bounded',()=>{
 assert.deepEqual(readLookupAttempts([]),{});assert.deepEqual(readLookupAttempts({x:{term:'apple',count:-1,nextAt:Infinity}}),{});
 assert.equal(readLookupAttempts({x:{term:'apple',count:2,nextAt:9e15}},0).x.nextAt,86400000);
 assert.deepEqual(readLookupAttempts(JSON.parse('{"__proto__":{"term":"apple","count":1,"nextAt":0}}')),{});
});
