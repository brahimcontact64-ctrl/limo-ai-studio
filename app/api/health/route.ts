import {NextResponse} from 'next/server';import {serverEnvStatus} from '../../../lib/env';
export const dynamic='force-dynamic';export async function GET(){return NextResponse.json({ok:true,service:'limo-ai-studio',version:'0.4.0',environment:serverEnvStatus(),time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}})}
