import {auth,body,boundary,json,id,ApiError,dbError} from '@/lib/server';
import {mapWord} from '@/lib/types';
import {lookupDictionary} from '@/lib/dictionary';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function POST(request:Request){return boundary(async()=>{
 const {client,userId}=await auth(request),d=await body(request),wordId=id(d.id);
 const {data:word,error}=await client.from('vocab_words').select('*').eq('id',wordId).eq('user_id',userId).is('archived_at',null).maybeSingle();dbError(error);if(!word)throw new ApiError(404,'找不到這筆詞彙');
 // Reopening a completed card must not depend on another external lookup.
 if(word.lookup_status==='found'&&Array.isArray(word.dictionary)&&word.dictionary.length)return json({word:mapWord(word),status:'found',cached:true});
 const budget=await client.rpc('vocab_lookup_budget');dbError(budget.error);
 const term=String(word.term),result=await lookupDictionary(term);
 // Log a bounded category only, never the user's word, sentence, URL or credentials.
 if(result.status==='unavailable')console.warn('Dictionary lookup unavailable',result.failure);
 const {data:updated,error:updateError}=await client.rpc('vocab_enrich_word',{p_id:wordId,p_term:term,p_dictionary:result.meanings,p_phonetic:result.phonetic,p_status:result.status});dbError(updateError);
 const saved=mapWord(updated);
 return json({word:saved,status:saved.lookupStatus,...(result.failure&&saved.lookupStatus!=='found'?{lookupError:result.failure}:{})});
})}
