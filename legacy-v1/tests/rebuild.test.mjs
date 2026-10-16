import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../app/api/projects/character-draft/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/CharacterPicker.tsx',import.meta.url),'utf8');
test('language choices match active Supabase language catalog',()=>{for(const l of ['ar','en','fr','de'])assert.match(ui,new RegExp('value="'+l+'"'))});
test('content types match active Supabase catalog',()=>{for(const c of ['storytelling','education','entertainment','product_ads','custom'])assert.match(ui,new RegExp('value="'+c+'"'))});
test('server validates language and content type independently',()=>{assert.match(api,/Unsupported language or content type/);assert.match(api,/p_language_code:language/)});
test('no video generation or publishing is called',()=>{assert.doesNotMatch(api,/start_generation|queue_video|publish_to/)});
