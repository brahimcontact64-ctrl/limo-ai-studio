import {NextResponse} from 'next/server';import {addons,characters,languages,plans,platforms} from '../../../lib/catalog';
export async function GET(){return NextResponse.json({plans,addons,characters,languages,platforms},{headers:{'Cache-Control':'public, max-age=300, stale-while-revalidate=3600'}})}
