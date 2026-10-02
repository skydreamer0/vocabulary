// Legacy import compatibility only. The app now verifies Supabase Auth sessions.
// Never trust oai-authenticated-* headers in this standalone Vercel application.
import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
export async function getChatGPTUser(){const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return null;return {userId:user.id,email:user.email||'',displayName:user.email||'',fullName:null}}
export async function requireChatGPTUser(_returnTo:string){const user=await getChatGPTUser();if(!user)redirect('/login');return user}
export const chatGPTSignInPath=(_returnTo:string)=>'/login';
