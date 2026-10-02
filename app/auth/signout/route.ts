import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {supabaseConfigured} from '@/lib/supabase/config';
import {signOutCompleted} from '@/lib/auth-flow';
export async function POST(request:Request){
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return new Response('Forbidden',{status:403,headers:{'Cache-Control':'private, no-store'}});
 const complete=supabaseConfigured()?await signOutCompleted(await createClient()):false;
 const response=NextResponse.redirect(new URL(complete?'/login':'/auth/signout-error',process.env.NEXT_PUBLIC_SITE_URL||url.origin),303);
 response.headers.set('Cache-Control','private, no-store');return response;
}
