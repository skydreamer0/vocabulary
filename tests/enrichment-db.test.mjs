import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import {enrichmentUpdate} from '../lib/enrichment-sql.ts';

test('Neon enrichment preserves successful definitions and rejects stale/foreign writes',async()=>{
 const url=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
 assert.ok(url,'Set a Postgres connection URL');
 const sql=postgres(url,{max:1,prepare:false});
 try{
  await sql.begin(async tx=>{
   // Temporary relation shadows public.words only on this connection; no user rows touched.
   await tx`CREATE TEMP TABLE words (LIKE public.words INCLUDING DEFAULTS) ON COMMIT DROP`;
   await tx`INSERT INTO words (id,user_id,term,norm_term,created_at,due_at) VALUES ('one','owner','bank','bank',0,0)`;
   const save=async(result,{user='owner',term='bank'}={})=>{
    const query=enrichmentUpdate('one',user,term,result);let index=0;
    return tx.unsafe(query.sql.replace(/\?/g,()=>'$'+(++index)),query.params);
   };
   const found={status:'found',phonetic:'/bank/',meanings:[{partOfSpeech:'noun',definition:'A river bank.',example:''}]};
   const unavailable={status:'unavailable',phonetic:'',meanings:[]};
   let [row]=await save(found);assert.equal(row.lookup_status,'found');
   for(const status of ['unavailable','not_found']){
    [row]=await save({...unavailable,status});
    assert.equal(row.lookup_status,'found');assert.equal(row.phonetic,found.phonetic);
    assert.deepEqual(JSON.parse(row.dictionary),found.meanings);
   }
   assert.equal((await save(unavailable,{user:'someone-else'})).length,0);
   await tx`UPDATE words SET term='pear',dictionary='[]',phonetic='',lookup_status='pending',revision=1`;
   assert.equal((await save(found)).length,0);
   [row]=await save(unavailable,{term:'pear'});assert.equal(row.lookup_status,'unavailable');assert.equal(row.revision,1);
   [row]=await save(found,{term:'pear'});assert.equal(row.lookup_status,'found');
   await tx`UPDATE words SET archived_at=1`;
   assert.equal((await save(found,{term:'pear'})).length,0);
  });
 }finally{await sql.end()}
});
