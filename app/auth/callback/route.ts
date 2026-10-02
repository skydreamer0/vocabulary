import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {supabaseConfigured} from '@/lib/supabase/config';
import {signInDestination} from '@/lib/auth-flow';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),code=url.searchParams.get('code');const origin=process.env.NEXT_PUBLIC_SITE_URL||url.origin;
 let target='/login?reason=expired';
 if(!supabaseConfigured())target='/setup-required';
 else if(code&&code.length<2048)target=await signInDestination(await createClient(),code);
 const response=NextResponse.redirect(new URL(target,origin));response.headers.set('Cache-Control','private, no-store');return response;
}
