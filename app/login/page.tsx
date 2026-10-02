'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      if (!sent) {
        const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
        if (error) throw new Error(error.message || '驗證碼寄送失敗，請稍後再試。');
        setSent(true);
      } else {
        const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: otp.trim() });
        if (error) throw new Error(error.message || '驗證碼不正確或已過期，請重試。');
        router.replace('/');
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '暫時無法登入，請稍後再試。');
    } finally {
      setPending(false);
    }
  }

  return <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
    <h1 className="text-2xl font-semibold">English Vocabulary · 我的詞彙</h1>
    <p className="text-sm text-muted-foreground">使用 Email 驗證碼登入，第一次使用會自動建立帳號。</p>
    <form onSubmit={submit} className="flex flex-col gap-3" aria-busy={pending}>
      <label className="text-sm" htmlFor="email">Email</label>
      <input id="email" type="email" required autoComplete="email" maxLength={254} readOnly={sent} disabled={pending} value={email} onChange={event => setEmail(event.target.value)} className="rounded-md border bg-background px-3 py-2" />
      {sent && <>
        <p role="status" className="text-sm">驗證碼已寄到你的信箱，請一併檢查垃圾郵件。</p>
        <label className="text-sm" htmlFor="otp">驗證碼 Verification code</label>
        <input id="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus disabled={pending} value={otp} onChange={event => setOtp(event.target.value)} className="rounded-md border bg-background px-3 py-2 tracking-widest" />
      </>}
      <button disabled={pending} className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60">
        {pending ? '處理中…' : sent ? '驗證並登入 Sign in' : '寄送驗證碼 Send code'}
      </button>
      {sent && <button type="button" disabled={pending} onClick={() => { setSent(false); setOtp(''); setMessage(''); }} className="text-sm text-muted-foreground underline">更換 Email 或重新寄送</button>}
      {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
    </form>
  </main>;
}
