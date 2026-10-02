import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {supabaseConfigured} from '@/lib/supabase/config';
import VocabularyApp from './vocabulary-app';
export const dynamic='force-dynamic';
export default async function Page(){
 if(!supabaseConfigured())redirect('/setup-required');
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error&&(error.name==='AuthRetryableFetchError'||(error.status||0)>=500))return <main className="auth-shell"><h1>登入服務暫時無法連線</h1><p>你的資料仍保留在資料庫。請稍後重新載入。</p><a className="primary-button" href="/">重新載入</a></main>;if(error||!user)redirect('/login');
 const {data:allowed,error:membershipError}=await client.rpc('vocab_is_member');
 if(membershipError)return <main className="auth-shell"><h1>資料庫尚未準備好</h1><p>請確認已套用 vocabulary 的資料庫遷移。你的輸入不會送到未設定的資料庫。</p><a href="/">重新載入</a></main>;
 if(!allowed)redirect('/login?reason=not_allowed');
 return <VocabularyApp userKey={user.id}/>;
}
