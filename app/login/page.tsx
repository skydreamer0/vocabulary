'use client';
import {useState} from 'react';
import {createBrowserClient} from '@supabase/ssr';

export default function Login(){
  const [email,setEmail]=useState(''),[state,setState]=useState<'idle'|'sending'|'sent'|'error'>('idle'),[message,setMessage]=useState('');
  async function submit(e:React.FormEvent){
    e.preventDefault();setState('sending');
    const supabase=createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:`${location.origin}/auth/callback`}});
    if(error){setState('error');setMessage(error.message)}else setState('sent');
  }
  return <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
    <h1 className="text-2xl font-semibold">English Vocabulary · 我的词汇</h1>
    {state==='sent'?<p>登入连结已寄到 <b>{email}</b>，请到信箱点击连结。<br/>Check your inbox for the sign-in link.</p>:
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm" htmlFor="email">Email</label>
      <input id="email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="rounded-md border bg-background px-3 py-2"/>
      <button disabled={state==='sending'} className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60">{state==='sending'?'寄送中…':'寄送登入连结 Send magic link'}</button>
      {state==='error'&&<p role="alert" className="text-sm text-red-600">{message}</p>}
    </form>}
  </main>
}
