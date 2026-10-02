import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){const url=new URL(request.url),code=url.searchParams.get('code');const origin=process.env.NEXT_PUBLIC_SITE_URL||url.origin;let target='/login?reason=expired';if(code&&code.length<2048){const client=await createClient();const {error}=await client.auth.exchangeCodeForSession(code);if(!error){const {data:{user}}=await client.auth.getUser();const {data:allowed}=await client.rpc('vocab_is_member');target=user&&allowed?'/':'/login?reason=not_allowed'}}const response=NextResponse.redirect(new URL(target,origin));response.headers.set('Cache-Control','private, no-store');return response;}
