import {database} from '@/db';import {auth,body,boundary,json,id,ApiError,rate} from '@/lib/server';import {mapWord,type Meaning} from '@/lib/types';
export const dynamic='force-dynamic';
export async function POST(request:Request){return boundary(async()=>{
 const user=await auth(request);await rate(user,'lookup',80);const d=await body(request),wordId=id(d.id),db=database();const word=await db.prepare('SELECT * FROM words WHERE id=? AND user_id=?').bind(wordId,user).first();if(!word)throw new ApiError(404,'找不到这笔词汇');
 const term=String(word.term);let status='not_found',phonetic='',meanings:Meaning[]=[];
 if(/^[A-Za-z][A-Za-z' -]{0,79}$/.test(term)){
 try{const response=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`,{signal:AbortSignal.timeout(6000),redirect:'manual',headers:{Accept:'application/json'}});
 if(response.ok){const reader=response.body?.getReader();if(!reader)throw new Error('Empty response');let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>200000){await reader.cancel();throw new Error('Oversized dictionary response')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}const raw=new TextDecoder().decode(bytes);const data=JSON.parse(raw);if(!Array.isArray(data))throw new Error('Invalid dictionary response');
 for(const entry of data.slice(0,4)){if(typeof entry.phonetic==='string'&&!phonetic)phonetic=entry.phonetic.slice(0,150);if(Array.isArray(entry.meanings))for(const meaning of entry.meanings.slice(0,8))if(Array.isArray(meaning.definitions))for(const def of meaning.definitions.slice(0,3))if(typeof def.definition==='string')meanings.push({partOfSpeech:String(meaning.partOfSpeech||'').slice(0,30),definition:def.definition.slice(0,1200),example:typeof def.example==='string'?def.example.slice(0,1000):''})}meanings=meanings.slice(0,16);status=meanings.length?'found':'not_found';
 }else if(response.status!==404)status='unavailable';
 }catch(error){console.warn('Dictionary lookup failed',error instanceof Error?error.message:'unknown');status='unavailable'}
 }
 // A concurrent edit of the term must not receive the previous term's definition.
 const updated=await db.prepare('UPDATE words SET dictionary=?,phonetic=?,lookup_status=? WHERE id=? AND user_id=? AND term=? RETURNING *').bind(JSON.stringify(meanings),phonetic,status,wordId,user,term).first();
 if(!updated)throw new ApiError(409,'单词已变更，请重新查询');return json({word:mapWord(updated),status})
})}
