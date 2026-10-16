import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
export async function middleware(request:NextRequest){
 let response=NextResponse.next({request});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return response;
 const supabase=createServerClient(url,key,{cookies:{getAll(){return request.cookies.getAll()},setAll(items){items.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});items.forEach(({name,value,options})=>response.cookies.set(name,value,options))}}});
 const {data:{user}}=await supabase.auth.getUser();
 const path=request.nextUrl.pathname;
 if(path.startsWith('/app')&&!user){const next=request.nextUrl.clone();next.pathname='/login';next.searchParams.set('next',path);return NextResponse.redirect(next)}
 if(path==='/login'&&user){const next=request.nextUrl.clone();next.pathname='/app';next.search='';return NextResponse.redirect(next)}
 return response;
}
export const config={matcher:['/app/:path*','/login']};
