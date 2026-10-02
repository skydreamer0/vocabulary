import {createClient} from '@/lib/supabase/server';
import {supabaseConfigured} from '@/lib/supabase/config';
export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
export async function auth(request:Request){
 if(!supabaseConfigured())throw new ApiError(503,'Supabase 尚未設定 / Database setup is required');
 if(request.method!=='GET'){
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ApiError(403,'Cross-origin request rejected');
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'Cross-site request rejected');
  if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'JSON required');
 }
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();
 if(error&&(error.name==='AuthRetryableFetchError'||(error.status||0)>=500))throw new ApiError(503,'登入服務暫時無法連線，請稍後再試');
 if(error||!user)throw new ApiError(401,'請重新登入 / Please sign in again');
 const membership=await client.rpc('vocab_is_member');if(membership.error)throw new ApiError(503,'資料庫尚未準備好 / Apply the database migration');if(!membership.data)throw new ApiError(403,'這個帳號未獲授權 / Account not allowed');
 return {client,userId:user.id};
}
export async function body(request:Request){
 if(Number(request.headers.get('content-length')||0)>220000)throw new ApiError(413,'內容太長，請分批新增');
 const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'Missing body');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>220000){await reader.cancel();throw new ApiError(413,'內容太長，請分批新增')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed}catch{throw new ApiError(400,'Invalid JSON')}
}
export function str(v:unknown,max:number,required=false){if(typeof v!=='string'||v.length>max)throw new ApiError(400,'文字長度或格式不正確');const s=v.normalize('NFKC').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');if(required&&!s)throw new ApiError(400,'請輸入單字或短語');return s}
export function id(v:unknown){const s=str(v,36,true);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new ApiError(400,'Invalid identifier');return s}
export function revision(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>2147483647)throw new ApiError(400,'Invalid revision');return Number(v)}
export function dbError(error:{code?:string;message?:string}|null){if(!error)return;const code=error.code||'';if(/^PT(400|401|403|404|409|429)$/.test(code))throw new ApiError(Number(code.slice(2)),error.message||'Request rejected');if(code==='23505')throw new ApiError(409,'相同資料已存在');console.error('Supabase request failed',code);throw new ApiError(503,'暫時無法連接資料庫，輸入仍保留。請稍後重試。')}
export async function boundary(fn:()=>Promise<Response>){try{return await fn()}catch(e){if(e instanceof ApiError)return json({error:e.message},e.status);console.error('Vocabulary API failure',e instanceof Error?e.message:'unknown');return json({error:'暫時無法完成操作，輸入仍保留。請稍後重試。'},503)}}
