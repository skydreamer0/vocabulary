import Link from 'next/link';

export default function SignOutError(){
 return <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
  <h1 className="text-2xl font-semibold">登出尚未完成</h1>
  <p>登入服務暫時無法連線。這台裝置可能仍保留登入狀態，請連線恢復後再試。</p>
  <form action="/auth/signout" method="post"><button className="primary-button" type="submit">重試登出</button></form>
  <Link className="text-button" href="/">回到詞彙本</Link>
 </main>;
}
