import type {Metadata,Viewport} from 'next';
import './globals.css';
export const metadata:Metadata={title:'English Vocabulary · 我的词汇',description:'Collect words in context. Remember a little every day.',manifest:'/manifest.webmanifest',icons:{icon:'/favicon.svg',apple:'/icon-192.png'},appleWebApp:{capable:true,title:'Vocabulary',statusBarStyle:'default'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#214bd1'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body>{children}</body></html>}
