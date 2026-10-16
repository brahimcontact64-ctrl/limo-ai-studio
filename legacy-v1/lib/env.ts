export function publicEnvReady(){return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)}
export function serverEnvStatus(){return {
 supabase:publicEnvReady(),
 serviceRole:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
 facebook:Boolean(process.env.META_APP_ID&&process.env.META_APP_SECRET&&process.env.META_REDIRECT_URI),
 openai:Boolean(process.env.OPENAI_API_KEY),
 voice:Boolean(process.env.ELEVENLABS_API_KEY),
 runway:Boolean(process.env.RUNWAY_API_KEY),
 heygen:Boolean(process.env.HEYGEN_API_KEY)
}}
