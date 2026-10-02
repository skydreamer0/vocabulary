import {redirect} from 'next/navigation';
import {getUser} from '@/lib/supabase/server';
import VocabularyApp from './vocabulary-app';
export const dynamic='force-dynamic';
export default async function Page(){
  const user=await getUser();if(!user)redirect('/login');
  return <>
    <form action="/auth/signout" method="post" className="fixed right-3 top-3 z-50 text-xs"><button type="submit" className="rounded-md border bg-background/80 px-2 py-1 text-muted-foreground backdrop-blur hover:text-foreground" title={user.email}>登出 Sign out</button></form>
    <VocabularyApp userKey={user.userId}/>
  </>
}
