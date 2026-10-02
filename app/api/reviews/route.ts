import {database} from '@/db';import {auth,body,boundary,json,str,id,revision,ApiError,rate} from '@/lib/server';import {schedule,mapWord} from '@/lib/types';
export const dynamic='force-dynamic';
export async function GET(request:Request){return boundary(async()=>{const user=await auth(request);await rate(user,'read',180);const rows=await database().prepare('SELECT id,term,rating,reviewed_at AS "reviewedAt",due_after AS "dueAfter",timezone FROM reviews WHERE user_id=? ORDER BY reviewed_at DESC LIMIT 300').bind(user).all();return json({reviews:rows.results})})}
export async function POST(request:Request){return boundary(async()=>{
 const user=await auth(request);await rate(user,'review',90);const d=await body(request),wordId=id(d.wordId),eventKey=id(d.eventKey),rev=revision(d.revision),rating=str(d.rating,10,true),timezone=str(d.timezone,100,true);
 if(!['again','hard','good','easy'].includes(rating))throw new ApiError(400,'Invalid rating');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{throw new ApiError(400,'Invalid timezone')}
 const fingerprint=JSON.stringify([wordId,rev,rating,timezone]),db=database();const existing=await db.prepare('SELECT * FROM reviews WHERE user_id=? AND event_key=?').bind(user,eventKey).first();
 if(existing){if(existing.fingerprint!==fingerprint)throw new ApiError(409,'这次评分已送出，请重新载入');return json({replayed:true,review:existing})}
 const word=await db.prepare('SELECT * FROM words WHERE id=? AND user_id=? AND archived_at IS NULL').bind(wordId,user).first();if(!word)throw new ApiError(404,'词汇不存在或已封存');if(word.revision!==rev)throw new ApiError(409,'这张卡片已更新，请重新载入后复习');
 const now=Date.now(),next=schedule(rating,Number(word.interval_days),Number(word.streak),now),reviewId=crypto.randomUUID();
 await db.batch([
 db.prepare('INSERT INTO reviews (id,user_id,event_key,fingerprint,word_id,term,rating,reviewed_at,due_before,due_after,interval_after,streak_after,word_revision,timezone) SELECT ?::text,?::text,?::text,?::text,?::text,term,?::text,?::bigint,?::bigint,?::bigint,?::double precision,?::integer,?::integer,?::text FROM words WHERE id=? AND user_id=? AND revision=? AND archived_at IS NULL FOR UPDATE ON CONFLICT(user_id,event_key) DO NOTHING').bind(reviewId,user,eventKey,fingerprint,wordId,rating,now,word.due_at,next.dueAt,next.intervalDays,next.streak,rev,timezone,wordId,user,rev),
 db.prepare('UPDATE words SET due_at=?,interval_days=?,streak=?,revision=revision+1 WHERE id=? AND user_id=? AND revision=? AND EXISTS (SELECT 1 FROM reviews WHERE id=? AND user_id=? AND word_id=? AND word_revision=?)').bind(next.dueAt,next.intervalDays,next.streak,wordId,user,rev,reviewId,user,wordId,rev)
 ]);
 const saved=await db.prepare('SELECT * FROM reviews WHERE user_id=? AND event_key=?').bind(user,eventKey).first();if(!saved)throw new ApiError(409,'这张卡片刚刚已被复习，请重新载入');if(saved.fingerprint!==fingerprint)throw new ApiError(409,'评分编号冲突，请重新载入');
 const updated=await db.prepare('SELECT * FROM words WHERE id=? AND user_id=?').bind(wordId,user).first();return json({review:saved,word:updated?mapWord(updated):null});
})}
