import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupDictionary} from '../lib/dictionary.ts';

const valid=[{word:'apple',phonetics:[{text:'/ˈæpəl/'}],meanings:[{partOfSpeech:'noun',definitions:[{definition:'A round fruit.',example:'She ate an apple.'}]}]}];
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('looks up English definitions with the fixed endpoint and preserves provider text',async()=>{
 let url,options;const result=await lookupDictionary('Apple',{fetcher:async(u,o)=>{url=u;options=o;return response(valid)}});
 assert.equal(url,'https://api.dictionaryapi.dev/api/v2/entries/en/apple');assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);
 assert.equal(result.status,'found');assert.equal(result.phonetic,'/ˈæpəl/');assert.deepEqual(result.meanings,[{partOfSpeech:'noun',definition:'A round fruit.',example:'She ate an apple.'}]);
});
test('malformed nested entries do not discard other valid definitions',async()=>{
 const result=await lookupDictionary('apple',{fetcher:async()=>response([null,{meanings:[null,{definitions:[null]}]},...valid])});assert.equal(result.status,'found');
});
test('404 and a valid empty result are not-found rather than retry storms',async()=>{
 for(const [body,status] of [[{},404],[[],200]])assert.equal((await lookupDictionary('missing',{fetcher:async()=>response(body,status)})).status,'not_found');
});
test('provider HTTP failures expose bounded status categories',async()=>{
 for(const status of [429,500,503]){const result=await lookupDictionary('apple',{fetcher:async()=>response({},status)});assert.equal(result.status,'unavailable');assert.deepEqual(result.failure,{code:'provider_http',retryable:true,upstreamStatus:status})}
});
test('redirects are not followed',async()=>{
 let calls=0;const result=await lookupDictionary('apple',{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://untrusted.example/'}})}});assert.equal(calls,1);assert.equal(result.failure.code,'provider_redirect');
});
test('timeouts and network failures are distinguishable without disclosing request details',async()=>{
 for(const [name,code] of [['TimeoutError','timeout'],['AbortError','timeout'],['TypeError','network_error']]){
  const result=await lookupDictionary('private-term',{fetcher:async()=>{throw Object.assign(new Error('sensitive raw request detail'),{name})}});assert.equal(result.failure.code,code);assert.doesNotMatch(JSON.stringify(result),/private-term|sensitive/);
 }
});
test('invalid JSON/schema and empty bodies have distinct error categories',async()=>{
 for(const body of ['<html>oops</html>',JSON.stringify({unexpected:true}),JSON.stringify([null]),JSON.stringify([{}]),JSON.stringify([{meanings:[{}]}]),JSON.stringify([{meanings:[{definitions:[{}]}]}])]){const result=await lookupDictionary('apple',{fetcher:async()=>new Response(body)});assert.equal(result.failure.code,'invalid_response')}
 assert.equal((await lookupDictionary('apple',{fetcher:async()=>new Response(null)})).failure.code,'empty_response');
});
test('response byte and meaning field bounds are enforced',async()=>{
 assert.equal((await lookupDictionary('apple',{fetcher:async()=>new Response('x'.repeat(200001))})).failure.code,'response_too_large');
 const result=await lookupDictionary('apple',{fetcher:async()=>response([{phonetic:'p'.repeat(200),meanings:Array.from({length:8},()=>({partOfSpeech:'n'.repeat(100),definitions:Array.from({length:4},()=>({definition:'d'.repeat(1500),example:'e'.repeat(1200)}))}))}])});
 assert.equal(result.meanings.length,16);assert.equal(result.phonetic.length,150);assert.equal(result.meanings[0].definition.length,1200);assert.equal(result.meanings[0].example.length,1000);assert.equal(result.meanings[0].partOfSpeech.length,30);
});
test('unsupported text cannot become a request URL',async()=>{
 for(const term of ['https://example.com/','../../secret','中文','a'.repeat(81)]){let called=false;const result=await lookupDictionary(term,{fetcher:async()=>{called=true;return response(valid)}});assert.equal(called,false);assert.equal(result.failure.code,'unsupported_term');assert.equal(result.failure.retryable,false)}
});
test('typographic apostrophes normalize only the lookup query, not the saved term',async()=>{
 const term='isn’t';let url;await lookupDictionary(term,{fetcher:async u=>{url=u;return response(valid)}});assert.equal(url,"https://api.dictionaryapi.dev/api/v2/entries/en/isn't");assert.equal(term,'isn’t');
});
