import type {NextConfig} from 'next';
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(publicKey?.startsWith('sb_secret_'))throw new Error('A secret Supabase key must never be configured as NEXT_PUBLIC');
if(publicKey?.split('.').length===3){try{const role=JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url').toString()).role;if(role!=='anon')throw new Error('Only the anon role key may be public')}catch{throw new Error('The configured public Supabase key is not a valid anon key')}}
const config:NextConfig={poweredByHeader:false,async headers(){return [{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'DENY'}]},{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache'}]}]}};
export default config;
