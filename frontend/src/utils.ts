export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));
export const dateTime = (seconds: number) => new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(seconds*1000);
export const relative = (seconds: number) => { const minutes=Math.max(0,Math.ceil((seconds-Date.now()/1000)/60)); return minutes ? `${minutes} min remaining` : 'Ended'; };
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: {'content-type':'application/json',...(options.headers||{})} });
  if (!response.ok) { let message=`Request failed (${response.status}).`; try { message=(await response.json()).error||message; } catch {} throw new Error(message); }
  return response.json() as Promise<T>;
}
export function setStatus(message: string, tone: 'good'|'bad'|'neutral'='neutral') {
  const node=document.querySelector<HTMLElement>('#global-status'); if(node){node.textContent=message;node.dataset.tone=tone;}
}
