import { redirect } from 'next/navigation';
import { getSupabaseServer } from '../../../lib/supabase/server';
import CharacterPicker from '../../../components/CharacterPicker';

export default async function CharactersPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: memberships } = await supabase.from('organization_members')
    .select('organization_id').eq('user_id', user.id).limit(1);
  if (!memberships?.length) redirect('/app');
  const { data, error } = await supabase.from('character_catalog')
    .select('id,name,family_code,age_group,gender_code,reference_status')
    .eq('active',true);
  return <main style={{maxWidth:1100,margin:'0 auto',padding:'32px 20px'}}>
    <h1>Character Cast Studio</h1>
    <p>Choose one or more characters for your story. Saving requires an active organization subscription. No generation, charges or publishing.</p>
    {error ? <p role="alert">Character catalog is temporarily unavailable.</p> : <CharacterPicker characters={data || []}/>}
  </main>;
}
