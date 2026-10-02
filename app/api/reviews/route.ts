import {auth,body,boundary,json,str,id,revision,ApiError,dbError} from '@/lib/server';
import {mapWord} from '@/lib/types';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request){return boundary(async()=>{const {client,userId}=await auth(request);const {data,error}=await client.from('vocab_reviews').select('id,term,rating,reviewed_at,due_after,timezone').eq('user_id',userId).order('reviewed_at',{ascending:false}).limit(300);dbError(error);return json({reviews:(data||[]).map(r=>({id:r.id,term:r.term,rating:r.rating,reviewedAt:Number(r.reviewed_at),dueAfter:Number(r.due_after),timezone:r.timezone}))})})}
export async function POST(request:Request){return boundary(async()=>{
 const {client}=await auth(request),d=await body(request),rating=str(d.rating,10,true),timezone=str(d.timezone,100,true);if(!['again','hard','good','easy'].includes(rating))throw new ApiError(400,'Invalid rating');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{throw new ApiError(400,'Invalid timezone')}
 const {data,error}=await client.rpc('vocab_review_word',{p_id:id(d.wordId),p_revision:revision(d.revision),p_event_key:id(d.eventKey),p_rating:rating,p_timezone:timezone});dbError(error);return json({...data,...(data.word?{word:mapWord(data.word)}:{})});
})}
