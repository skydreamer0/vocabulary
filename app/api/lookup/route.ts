import {database} from '@/db';
import {auth,body,boundary,json,id,ApiError,rate} from '@/lib/server';
import {mapWord} from '@/lib/types';
import {lookupDictionary} from '@/lib/dictionary';
import {enrichmentUpdate} from '@/lib/enrichment-sql';

export const dynamic='force-dynamic';
export async function POST(request:Request){return boundary(async()=>{
 const user=await auth(request),d=await body(request),wordId=id(d.id),db=database();
 const word=await db.prepare('SELECT * FROM words WHERE id=? AND user_id=? AND archived_at IS NULL').bind(wordId,user).first();
 if(!word)throw new ApiError(404,'找不到這筆詞彙');
 const cached=mapWord(word);
 if(cached.lookupStatus==='found'&&cached.dictionary.length)return json({word:cached,status:'found',cached:true});
 await rate(user,'lookup',80);
 const term=String(word.term),result=await lookupDictionary(term);
 if(result.status==='unavailable')console.warn('Dictionary lookup unavailable',result.failure);
 const update=enrichmentUpdate(wordId,user,term,result);
 const updated=await db.prepare(update.sql).bind(...update.params).first();
 if(!updated)throw new ApiError(409,'單字已變更或封存，請重新載入');
 const saved=mapWord(updated);
 return json({word:saved,status:saved.lookupStatus,...(result.failure&&saved.lookupStatus!=='found'?{lookupError:result.failure}:{})});
})}
