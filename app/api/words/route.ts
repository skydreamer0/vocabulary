import {database} from '@/db';
import {auth,body,boundary,json,str,id,revision,ApiError,rate} from '@/lib/server';
import {normal,mapWord} from '@/lib/types';
export const dynamic='force-dynamic';
export async function GET(request:Request){return boundary(async()=>{const user=await auth(request);await rate(user,'read',180);const db=database();const rows=await db.prepare('SELECT * FROM words WHERE user_id=? ORDER BY created_at DESC').bind(user).all();return json({words:rows.results.map(mapWord),serverNow:Date.now()})})}
export async function POST(request:Request){return boundary(async()=>{
 const user=await auth(request);await rate(user,'import',15);const data=await body(request);
 if(!Array.isArray(data.words)||data.words.length<1||data.words.length>100)throw new ApiError(400,'每批请添加 1–100 个词');
 const entries=data.words.map((w:Record<string,unknown>)=>{if(!w||typeof w!=='object')throw new ApiError(400,'Invalid word');return {term:str(w.term,100,true),context:str(w.context??'',1500),sense:normal(str(w.sense??'',100))}});
 if(entries.some((w:{term:string})=>!/[a-zA-Z]/.test(w.term)))throw new ApiError(400,'请输入英文单词或短语');
 const db=database();
 const now=Date.now();const statements=[];
 for(let i=0;i<entries.length;i+=10){const chunk=entries.slice(i,i+10);const values=chunk.map(()=>'(?,?,?,?,?,?,?,?,?)').join(',');const params=chunk.flatMap((w:{term:string;context:string;sense:string})=>[crypto.randomUUID(),user,w.term,normal(w.term),w.context,normal(w.context),w.sense,now,now]);statements.push(db.prepare(`INSERT INTO words (id,user_id,term,norm_term,context,norm_context,sense,created_at,due_at) VALUES ${values} ON CONFLICT(user_id,norm_term,norm_context,sense) DO NOTHING RETURNING *`).bind(...params))}
 const results=await db.batch(statements);
 const saved=results.flatMap(r=>r.results??[]).map(r=>mapWord(r as Record<string,unknown>));return json({words:saved,added:saved.length,duplicates:entries.length-saved.length},201)
})}
export async function PATCH(request:Request){return boundary(async()=>{
 const user=await auth(request);await rate(user,'edit',60);const d=await body(request),wordId=id(d.id),rev=revision(d.revision),db=database();
 const old=await db.prepare('SELECT * FROM words WHERE id=? AND user_id=?').bind(wordId,user).first();if(!old)throw new ApiError(404,'找不到这笔词汇');
 let r;if(typeof d.archived==='boolean'){r=await db.prepare('UPDATE words SET archived_at=?,revision=revision+1 WHERE id=? AND user_id=? AND revision=? RETURNING *').bind(d.archived?Date.now():null,wordId,user,rev).first()}
 else{const term=str(d.term,100,true),context=str(d.context,1500),sense=normal(str(d.sense,100)),definition=str(d.definition,2000);if(!/[a-zA-Z]/.test(term))throw new ApiError(400,'请输入英文单词或短语');
 const duplicate=await db.prepare('SELECT id FROM words WHERE user_id=? AND norm_term=? AND norm_context=? AND sense=? AND id<>?').bind(user,normal(term),normal(context),sense,wordId).first();if(duplicate)throw new ApiError(409,'同一个词、原句与词义已经存在');
 r=await db.prepare("UPDATE words SET term=?,norm_term=?,context=?,norm_context=?,sense=?,definition=?,dictionary=CASE WHEN norm_term<>? THEN '[]' ELSE dictionary END,phonetic=CASE WHEN norm_term<>? THEN '' ELSE phonetic END,lookup_status=CASE WHEN norm_term<>? THEN 'pending' ELSE lookup_status END,revision=revision+1 WHERE id=? AND user_id=? AND revision=? RETURNING *").bind(term,normal(term),context,normal(context),sense,definition,normal(term),normal(term),normal(term),wordId,user,rev).first();}
 if(!r)throw new ApiError(409,'这笔词汇已在其他分页更新，请重新载入');return json({word:mapWord(r)})
})}
