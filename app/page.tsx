import {redirect} from 'next/navigation';
import {getUser} from '@/lib/auth/server';
import VocabularyApp from './vocabulary-app';
export const dynamic='force-dynamic';
export default async function Page(){
  let user;
  try{user=await getUser()}catch{return <main className="mx-auto max-w-sm p-6"><h1>登入服務暫時無法連線</h1><p>你的資料仍保留在資料庫，請稍後重新整理。</p></main>}
  if(!user)redirect('/login');
  return <VocabularyApp userKey={user.userId}/>;
}
