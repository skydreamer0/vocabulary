import test from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse} from '../lib/http-response.ts';

test('HTTP 200 aborted or malformed JSON rejects instead of becoming a success-shaped error',async()=>{
 for(const json of [async()=>{throw new DOMException('aborted','AbortError')},async()=>{throw new SyntaxError('bad json')}])await assert.rejects(readApiResponse({ok:true,status:200,json}),error=>error.status===502&&error.code==='invalid_response');
});
test('successful API response must be an object',async()=>{
 for(const value of [null,[],42,'text'])await assert.rejects(readApiResponse({ok:true,status:200,json:async()=>value}),error=>error.status===502);
 assert.deepEqual(await readApiResponse({ok:true,status:200,json:async()=>({words:[]})}),{words:[]});
});
test('real HTTP failures retain their status for bounded queue backoff',async()=>{
 for(const status of [401,403,429,503])await assert.rejects(readApiResponse({ok:false,status,json:async()=>({error:'retry'})}),error=>error.status===status&&error.message==='retry');
});
