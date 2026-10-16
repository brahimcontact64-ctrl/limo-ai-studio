import {NextResponse} from 'next/server';
import {getSupabaseServer} from '../../../../lib/supabase/server';

export async function POST(request:Request){
 try{
  const supabase=await getSupabaseServer();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:'Sign in required'},{status:401});
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>30000)return NextResponse.json({error:'Request too large'},{status:413});
  let body: any;
  try { body=JSON.parse(raw); } catch { return NextResponse.json({error:'Invalid JSON'},{status:400}); }
  const title=body?.title,brief=body?.brief??'',cast=body?.project_cast,scenes=body?.scenes;
  const language=body?.language_code??'ar',contentType=body?.content_type??'storytelling';
  if(!['ar','en','fr','de'].includes(language)||!['storytelling','education','entertainment','product_ads','custom'].includes(contentType))return NextResponse.json({error:'Unsupported language or content type'},{status:400});
  if(typeof title!=='string'||!title.trim()||title.length>120||typeof brief!=='string'||brief.length>4000||!Array.isArray(cast)||cast.length<1||cast.length>18||new Set(cast).size!==cast.length||!cast.every((id:unknown)=>typeof id==='string'&&/^(limo|nova|adam)_(boy|girl|man|woman|elder_man|elder_woman)$/.test(id))||!Array.isArray(scenes)||scenes.length<1||scenes.length>25||!scenes.every((s:any)=>s&&typeof s.title==='string'&&s.title.trim().length>0&&s.title.length<=120&&Array.isArray(s.participants)&&s.participants.length>0&&s.participants.every((id:unknown)=>typeof id==='string'&&cast.includes(id))&&new Set(s.participants).size===s.participants.length))return NextResponse.json({error:'Invalid project or scene selection'},{status:400});
  const {data:memberships,error:membershipError}=await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).limit(2);
  if(membershipError)return NextResponse.json({error:'Membership lookup failed'},{status:500});
  if(!memberships||memberships.length!==1)return NextResponse.json({error:'Select a single organization before saving'},{status:403});
  const payload={p_organization_id:memberships[0].organization_id,p_project_id:null,p_title:title.trim(),p_content_type:contentType,p_language_code:language,p_brief:brief,p_goal:'',p_visual_style:'3d',p_series_id:null,p_continuation_mode:false,p_project_cast:cast.map((id:string)=>({id})),p_scenes:scenes.map((s:any,i:number)=>({scene_number:i+1,title:s.title,participants:s.participants,duration_seconds:10,action_prompt:s.title})),p_export_presets:[]};
  const {data,error}=await supabase.rpc('save_studio_project',payload);
  if(error)return NextResponse.json({error:'Database rejected project. Verify subscription and project schema.'},{status:422});
  return NextResponse.json({project_id:data},{status:201});
 }catch{return NextResponse.json({error:'Unable to process project save'},{status:400})}
}
