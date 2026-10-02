import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
export async function POST(request:Request){const url=new URL(request.url),origin=request.headers.get('origin');if(origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return new Response('Forbidden',{status:403});const client=await createClient();await client.auth.signOut({scope:'local'});return NextResponse.redirect(new URL('/login',process.env.NEXT_PUBLIC_SITE_URL||url.origin),303)}
