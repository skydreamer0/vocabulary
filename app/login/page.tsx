import {redirect} from 'next/navigation';
import {supabaseConfigured} from '@/lib/supabase/config';
import LoginForm from './login-form';
export const dynamic='force-dynamic';
export default async function Login({searchParams}:{searchParams:Promise<{reason?:string}>}){if(!supabaseConfigured())redirect('/setup-required');const {reason}=await searchParams;return <main className="auth-shell"><div className="brand-icon">v<span>.</span></div><div className="eyebrow">ENGLISH VOCABULARY</div><h1>回到你的私人詞彙本</h1><p>使用已授權的信箱登入，不需要另記一組密碼。</p>{reason==='not_allowed'&&<div className="notice error">這個帳號尚未獲得存取權限。請由專案管理者加入授權名單。</div>}{reason==='expired'&&<div className="notice error">登入連結已失效，或不是在發起登入的瀏覽器開啟。請重新寄送。</div>}<LoginForm/><p className="auth-help">只有專案管理者預先開通的帳號能使用；這裡不會建立新帳號。</p></main>}
