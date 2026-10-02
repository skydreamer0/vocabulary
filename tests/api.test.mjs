// Runs against a running server (npm run build && npm start) and a Postgres with db/migrations applied.
// Env: BASE_URL (default http://localhost:3000), TEST_AUTH_SECRET (must match the server).
import assert from "node:assert/strict";
import postgres from 'postgres';
const base=process.env.BASE_URL||"http://localhost:3000",secret=process.env.TEST_AUTH_SECRET;
if(!secret)throw new Error("Set TEST_AUTH_SECRET (same value as the server)");
const run=Date.now().toString(36),A="qa-a-"+run,B="qa-b-"+run;
const req=async(path,method="GET",data,user=A,extra={})=>{const headers={"Content-Type":"application/json",...extra};if(user){headers["x-test-auth"]=secret;headers["x-test-user"]=user}const r=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});const text=await r.text();let json;try{json=JSON.parse(text)}catch{json={text:text.slice(0,200)}}return {status:r.status,data:json,headers:r.headers}};
try {
let r=await req('/api/words','GET',undefined,null);assert.equal(r.status,401);console.log('PASS missing identity 401');
r=await req('/api/words','POST',{words:[{term:' bank ',context:'',sense:''},{term:'BANK',context:'',sense:''},{term:'bank',context:'river bank',sense:'river'},{term:'bank',context:'river bank',sense:'money'}]});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.added,3);assert.equal(r.data.duplicates,1);const words=r.data.words;console.log('PASS normalized dedup and distinct senses');
r=await req('/api/words','GET',undefined,B);assert.equal(r.data.words.length,0);for(const [path,method,data] of [['/api/words','PATCH',{id:words[0].id,revision:0,archived:true}],['/api/lookup','POST',{id:words[0].id}],['/api/reviews','POST',{wordId:words[0].id,revision:0,eventKey:crypto.randomUUID(),rating:'good',timezone:'UTC'}]]){r=await req(path,method,data,B);assert.equal(r.status,404,JSON.stringify(r))}console.log('PASS cross-user list/edit/review/lookup isolation');
r=await req('/api/words','POST',{words:[{term:'x'}]},A,{origin:'https://evil.example'});assert.equal(r.status,403);console.log('PASS cross-origin write rejected');
const eventKey=crypto.randomUUID(),review={wordId:words[0].id,revision:0,eventKey,rating:'good',timezone:'America/New_York'};
const twins=await Promise.all([req('/api/reviews','POST',review),req('/api/reviews','POST',review)]);assert(twins.every(x=>x.status===200),JSON.stringify(twins));r=await req('/api/reviews');assert.equal(r.data.reviews.length,1);r=await req('/api/words');assert.equal(r.data.words.find(w=>w.id===words[0].id).revision,1);console.log('PASS concurrent same-key ratings commit once');
r=await req('/api/reviews','POST',{...review,rating:'easy'});assert.equal(r.status,409);r=await req('/api/reviews','POST',review);assert.equal(r.status,200);assert.equal(r.data.replayed,true);console.log('PASS payload-bound idempotent retry after commit');
const nextWord=words[1];const races=await Promise.all([req('/api/reviews','POST',{...review,wordId:nextWord.id,eventKey:crypto.randomUUID()}),req('/api/reviews','POST',{...review,wordId:nextWord.id,eventKey:crypto.randomUUID()})]);assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);console.log('PASS different-key stale-revision race');
r=await req('/api/words','POST',{words:Array.from({length:100},(_,i)=>({term:`testword${i}`,context:'',sense:''}))},B);assert.equal(r.status,201);assert.equal(r.data.added,100);console.log('PASS 100-word batch within parameter/query bounds');
r=await req('/api/words','POST',{words:[null]});assert.equal(r.status,400);r=await req('/api/words','POST',null);assert.equal(r.status,400);r=await req('/api/reviews','POST',{...review,timezone:'not/a-zone'});assert.equal(r.status,400);console.log('PASS malformed inputs and timezone validation');
r=await req('/api/words','PATCH',{id:words[2].id,revision:0,archived:true});assert.equal(r.status,200);r=await req('/api/words','POST',{words:[{term:words[2].term,context:words[2].context,sense:words[2].sense}]});assert.equal(r.data.added,0);r=await req('/api/words');assert(r.data.words.find(w=>w.id===words[2].id).archivedAt);assert.equal(r.headers.get('cache-control'),'private, no-store');console.log('PASS archive preserved on re-import and private no-store responses');
r=await req('/api/lookup','POST',{id:words[2].id});assert.equal(r.status,404);console.log('PASS archived words cannot be enriched');
r=await req('/api/lookup','POST',{id:words[0].id});assert.equal(r.status,200);assert(['found','unavailable','not_found'].includes(r.data.word.lookupStatus));assert.equal(r.data.word.id,words[0].id);console.log('PASS dictionary enrichment preserves saved word (live API)');
if(r.data.word.lookupStatus==='found'){r=await req('/api/lookup','POST',{id:words[0].id});assert.equal(r.data.cached,true);console.log('PASS successful definition served from database cache')}
console.log('ALL API TESTS PASSED');
} finally {
 const url=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
 if(url){const sql=postgres(url,{max:1,prepare:false});try{await sql.begin(async tx=>{
  await tx`DELETE FROM reviews WHERE user_id IN (${A},${B})`;
  await tx`DELETE FROM words WHERE user_id IN (${A},${B})`;
  await tx`DELETE FROM rate_limits WHERE key LIKE ${A+':%'} OR key LIKE ${B+':%'}`;
 });console.log('Removed this run’s exact test fixtures')}finally{await sql.end()}}
}
