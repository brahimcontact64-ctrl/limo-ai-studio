'use client';
import {useMemo,useState} from 'react';

type Character={id:string;name:string|null;family_code:string|null;age_group:string|null;gender_code:string|null;reference_status:string|null};
type Scene={id:number;title:string;participants:string[]};
const families=['limo','nova','adam'] as const;
const titles:Record<string,string>={limo:'Limo 🍅',nova:'Nova 🍓',adam:'Adam 🥔'};
const suffixes=['boy','girl','man','woman','elder_man','elder_woman'];
const labels:Record<string,string>={boy:'Boy',girl:'Girl',man:'Man',woman:'Woman',elder_man:'Grandfather',elder_woman:'Grandmother'};

export default function CharacterPicker({characters}:{characters:Character[]}){
 const [selected,setSelected]=useState<string[]>([]);
 const [scenes,setScenes]=useState<Scene[]>([{id:1,title:'Scene 1',participants:[]}]);
 const [notice,setNotice]=useState('');
 const [projectTitle,setProjectTitle]=useState('My character story');
 const [brief,setBrief]=useState('');
 const [language,setLanguage]=useState('ar');
 const [contentType,setContentType]=useState('storytelling');
 const [saving,setSaving]=useState(false);
 const available=useMemo(()=>new Map(characters.map(c=>[c.id,c])),[characters]);
 const toggle=(id:string)=>{
  setSelected(current=>current.includes(id)?current.filter(x=>x!==id):current.length<18?[...current,id]:current);
  if(selected.includes(id)) setScenes(current=>current.map(scene=>({...scene,participants:scene.participants.filter(x=>x!==id)})));
 };
 const setParticipants=(sceneId:number,id:string)=>setScenes(current=>current.map(scene=>scene.id===sceneId?{...scene,participants:scene.participants.includes(id)?scene.participants.filter(x=>x!==id):[...scene.participants,id]}:scene));
 const exportData=()=>({schema_version:1,project_cast:selected,scenes:scenes.map(({title,participants},i)=>({scene_number:i+1,title,participants}))});
 const valid=selected.length>0&&scenes.every(scene=>scene.title.trim().length>0&&scene.participants.length>0&&scene.participants.every(id=>selected.includes(id)));
 const save=async()=>{if(!valid||saving)return;setSaving(true);setNotice('Saving project…');try{
  const response=await fetch('/api/projects/character-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:projectTitle,brief,language_code:language,content_type:contentType,project_cast:selected,scenes:scenes.map((scene,i)=>({scene_number:i+1,title:scene.title,participants:scene.participants}))})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Unable to save project');
  setNotice(`Project saved (${data.project_id}). No video generation or publishing started.`);
 }catch(error){setNotice(error instanceof Error?error.message:'Unable to save project')}finally{setSaving(false)}};
 const copy=async()=>{if(!valid)return;try{await navigator.clipboard.writeText(JSON.stringify(exportData(),null,2));setNotice('Draft configuration copied. No project has been saved.')}catch{setNotice('Clipboard unavailable; use the download option.')}};
 const download=()=>{if(!valid)return;const blob=new Blob([JSON.stringify(exportData(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='limo-scene-cast-draft.json';a.click();URL.revokeObjectURL(url);setNotice('Draft downloaded locally. No project has been saved.');};
 return <div>
  <p aria-live="polite">Selected cast: {selected.length} / 18</p>
  {families.map(family=><section key={family} style={{margin:'28px 0'}}>
   <h2>{titles[family]}</h2>
   <div className="characterGrid">
    {suffixes.map(suffix=>{const id=`${family}_${suffix}`;const c=available.get(id);const checked=selected.includes(id);
     return <button key={id} type="button" disabled={!c} aria-pressed={checked} onClick={()=>toggle(id)} className={'characterOption'+(checked?' isSelected':'')}>
      <strong>{labels[suffix]}</strong><div style={{fontSize:12,marginTop:8}}>{c ? (c.reference_status==='pending'?'Reference image pending':'Catalog available') : 'Not available'}</div>
     </button>})}
   </div>
  </section>)}
  <h2>Project details</h2>
  <label htmlFor="project-title">Project title</label>
  <input id="project-title" value={projectTitle} maxLength={120} onChange={e=>setProjectTitle(e.target.value)} style={{display:'block',padding:8,width:'100%',maxWidth:500,margin:'8px 0'}}/>
  <label htmlFor="project-brief">Story brief (optional)</label>
  <textarea id="project-brief" value={brief} maxLength={4000} onChange={e=>setBrief(e.target.value)} rows={3} style={{display:'block',padding:8,width:'100%',maxWidth:600,margin:'8px 0'}}/>
  <div className="studioFields"><label>Language<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="ar">Arabic</option><option value="en">English</option><option value="fr">French</option><option value="de">German</option></select></label><label>Content type<select value={contentType} onChange={e=>setContentType(e.target.value)}><option value="storytelling">Storytelling</option><option value="education">Education</option><option value="entertainment">Entertainment</option><option value="product_ads">Product ads</option><option value="custom">Custom</option></select></label></div><h2>Scenes ({scenes.length} / 25)</h2>
  <p>Assign one or more selected characters to each scene. Each scene must have at least one participant before export.</p>
  {scenes.map((scene,i)=><section key={scene.id} style={{padding:16,border:'1px solid #8886',borderRadius:12,margin:'12px 0'}}>
   <label htmlFor={`scene-${scene.id}`}>Scene {i+1} title</label>
   <input id={`scene-${scene.id}`} maxLength={120} value={scene.title} onChange={e=>setScenes(s=>s.map(x=>x.id===scene.id?{...x,title:e.target.value}:x))} style={{display:'block',padding:8,width:'100%',maxWidth:500,margin:'8px 0'}}/>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{selected.map(id=><label key={id} style={{padding:8,border:'1px solid #8886',borderRadius:8}}><input type="checkbox" checked={scene.participants.includes(id)} onChange={()=>setParticipants(scene.id,id)}/> {available.get(id)?.name||id} ({id})</label>)}</div>
   {!selected.length&&<p>Select characters above first.</p>}
   {scenes.length>1&&<button type="button" onClick={()=>setScenes(s=>s.filter(x=>x.id!==scene.id))}>Remove scene</button>}
  </section>)}
  <button type="button" disabled={scenes.length>=25} onClick={()=>setScenes(s=>[...s,{id:Math.max(...s.map(x=>x.id))+1,title:`Scene ${s.length+1}`,participants:[]}])}>+ Add scene</button>
  <div style={{display:'flex',gap:12,marginTop:24,flexWrap:'wrap'}}><button type="button" disabled={!valid||!projectTitle.trim()||saving} onClick={save}>{saving?"Saving…":"Save project to Supabase"}</button><button type="button" disabled={!valid} onClick={copy}>Copy draft JSON</button><button type="button" disabled={!valid} onClick={download}>Download draft JSON</button></div>
  {!valid&&<p role="status">Select at least one character and assign a participant to every scene.</p>}
  <p role="status" aria-live="polite">{notice}</p>
  <p style={{fontSize:12,opacity:.8}}>Saving uses your authenticated organization and the database save RPC. No video generation, charge, or publishing is initiated.</p>
 </div>;
}
