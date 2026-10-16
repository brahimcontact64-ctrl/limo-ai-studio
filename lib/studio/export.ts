import { toSaveRequest } from './draft';
import type { ProjectDraft } from './types';

/** Client-side JSON export of a project draft (no server round-trip). */
export function downloadProjectJson(draft: ProjectDraft) {
  const data = { schema: 'limo.project.v1', exported_at: new Date().toISOString(), project: toSaveRequest(draft) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(draft.title.trim() || 'limo-project').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
