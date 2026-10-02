import {auth,body,boundary,json,str,id,revision,ApiError,dbError} from '@/lib/server';
import {mapWord} from '@/lib/types';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request){return boundary(async()=>{
 const {client,userId}=await auth(request);let q=client.from('vocab_words').select('*').eq('user_id',userId).order('created_at',{ascending:false}).order('id',{ascending:true}).limit(100);
 const cursor=new URL(request.url).searchParams.get('cursor');if(cursor){const parts=cursor.split('|'),time=Number(parts[0]);if(parts.length!==2||!Number.isSafeInteger(time)||time<0)throw new ApiError(400,'Invalid cursor');const wordId=id(parts[1]);q=q.or(`created_at.lt.${time},and(created_at.eq.${time},id.gt.${wordId})`)}
 const {data,error}=await q;dbError(error);const rows=data||[];const last=rows.at(-1);return json({words:rows.map(mapWord),nextCursor:rows.length===100&&last?`${last.created_at}|${last.id}`:null,serverNow:Date.now()});
})}
export async function POST(request:Request){return boundary(async()=>{
 const {client}=await auth(request),data=await body(request);if(!Array.isArray(data.words)||data.words.length<1||data.words.length>100)throw new ApiError(400,'每批請新增 1–100 個詞');
 const entries=data.words.map((w:Record<string,unknown>)=>{if(!w||typeof w!=='object')throw new ApiError(400,'Invalid word');return {term:str(w.term,100,true),context:str(w.context??'',1500),sense:str(w.sense??'',100)}});
 const {data:result,error}=await client.rpc('vocab_import_words',{p_words:entries});dbError(error);return json({...result,words:result.words.map(mapWord)},201);
})}
export async function PATCH(request:Request){return boundary(async()=>{
 const {client}=await auth(request),d=await body(request);const args:Record<string,unknown>={p_id:id(d.id),p_revision:revision(d.revision)};
 if(typeof d.archived==='boolean')args.p_archived=d.archived;else Object.assign(args,{p_term:str(d.term,100,true),p_context:str(d.context,1500),p_sense:str(d.sense,100),p_definition:str(d.definition,2000)});
 const {data,error}=await client.rpc('vocab_edit_word',args);dbError(error);return json({word:mapWord(data)});
})}
