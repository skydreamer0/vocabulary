import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {supabaseConfig} from './config';
// Always create this client per request; never share a user session in module scope.
export async function createClient(){const {url,key}=supabaseConfig();const jar=await cookies();return createServerClient(url,key,{cookies:{getAll(){return jar.getAll()},setAll(items){try{items.forEach(({name,value,options})=>jar.set(name,value,options))}catch{/* Server Components cannot set cookies; proxy refreshes them. */}}}})}
