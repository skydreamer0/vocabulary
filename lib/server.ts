import {getUser} from '@/lib/supabase/server';
import {database} from '@/db';
export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
// Test-only identity for the API suite; never honoured on Vercel production.
async function testUser(request:Request){const secret=process.env.TEST_AUTH_SECRET;if(!secret||process.env.VERCEL_ENV==='production'||request.headers.get('x-test-auth')!==secret)return null;const id=request.headers.get('x-test-user');return id?{userId:id,email:`${id}@example.test`}:null}
export async function auth(request:Request){
  const user=await testUser(request)??await getUser();if(!user)throw new ApiError(401,'请重新登录后再试 / Please sign in again');
  if(request.method!=='GET'){
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw new ApiError(403,'Cross-origin request rejected');
    if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'Cross-site request rejected');
    if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'JSON required');
  }return user.userId;
}
export async function body(request:Request){
  if(Number(request.headers.get('content-length')||0)>220000)throw new ApiError(413,'内容太长，请分批添加');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'Missing body');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>220000){await reader.cancel();throw new ApiError(413,'内容太长，请分批添加')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  try{const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid body');return parsed}catch{throw new ApiError(400,'Invalid JSON')}
}
export function str(v:unknown,max:number,required=false){if(typeof v!=='string'||v.length>max)throw new ApiError(400,'文字长度或格式不正确');const s=v.normalize('NFKC').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');if(required&&!s)throw new ApiError(400,'请输入单词或短语');return s}
export function id(v:unknown){const s=str(v,80,true);if(!/^[\w-]+$/.test(s))throw new ApiError(400,'Invalid identifier');return s}
export function revision(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0)throw new ApiError(400,'Invalid revision');return Number(v)}
export async function rate(user:string,action:string,limit:number){const db=database(),now=Date.now(),key=`${user}:${action}:${Math.floor(now/60000)}`;const row=await db.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count').bind(key,now+120000).first<{count:number}>();if(Number(row?.count)>limit)throw new ApiError(429,'操作太快了，请稍等一分钟再试');await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).exec();}
export async function boundary(fn:()=>Promise<Response>){try{return await fn()}catch(e){if(e instanceof ApiError)return json({error:e.message},e.status);console.error('Vocabulary API failure',e instanceof Error?e.message:'unknown');return json({error:'暂时无法连接资料库，输入仍保留。请稍后重试。'},503)}}
