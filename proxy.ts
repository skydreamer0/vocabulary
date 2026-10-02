import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
import {supabaseConfigured,supabaseConfig} from '@/lib/supabase/config';
export async function proxy(request:NextRequest){
 let response=NextResponse.next({request});
 if(!supabaseConfigured())return response;
 const {url,key}=supabaseConfig();
 const client=createServerClient(url,key,{cookies:{getAll:()=>request.cookies.getAll(),setAll(items){items.forEach(({name,value})=>request.cookies.set(name,value));const previous=response.cookies.getAll();response=NextResponse.next({request});previous.forEach(cookie=>response.cookies.set(cookie));items.forEach(({name,value,options})=>response.cookies.set(name,value,options))}}});
 // getUser validates with Supabase Auth. A cookie alone is never authorization.
 try{await client.auth.getUser()}catch{/* Page/API boundaries render a recoverable auth error. */}
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Pragma','no-cache');response.headers.set('Expires','0');return response;
}
export const config={matcher:['/','/login','/api/:path*','/auth/:path*']};
