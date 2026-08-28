const slug = 'privacy-class-checkin';
const key = `sb_license:${slug}`;
const verdictKey = `${key}:verdict`;
const billingBase = location.hostname === 'privacy-class-checkin.sociobot.in' ? 'https://api.sociobot.in' : 'https://pilot-api.sociobot.in';
export const buyUrl = `${billingBase}/api/v1/products/${slug}/checkout`;

export interface LicenseState { unlocked: boolean; notice?: string }

export function initializeLicense(): LicenseState {
  const params = new URLSearchParams(location.search);
  const returned = params.get('license');
  if (returned) {
    localStorage.setItem(key, returned.trim());
    params.delete('license');
    history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  }
  const token = localStorage.getItem(key);
  if (!token) return { unlocked: false };
  let cached: { valid: boolean; checkedAt: number } | null = null;
  try { cached = JSON.parse(localStorage.getItem(verdictKey) || 'null'); } catch { /* ignore */ }
  const optimistic = cached?.valid === true;
  if (!cached || Date.now() - cached.checkedAt >= 86_400_000) {
    void fetch(`${billingBase}/api/v1/products/${slug}/verify?license=${encodeURIComponent(token)}`)
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ valid: boolean }>; })
      .then(result => {
        localStorage.setItem(verdictKey, JSON.stringify({ valid: result.valid, checkedAt: Date.now() }));
        dispatchEvent(new CustomEvent('license-updated', { detail: { unlocked: result.valid, notice: result.valid ? undefined : 'This license is no longer active.' } }));
      })
      .catch(() => dispatchEvent(new CustomEvent('license-updated', { detail: { unlocked: optimistic, notice: optimistic ? undefined : 'License verification is unavailable. The free check-in still works.' } })));
  }
  return { unlocked: optimistic };
}

export function restoreLicense(token: string) {
  if (token.trim().length < 12) throw new Error('Paste the complete license token.');
  localStorage.setItem(key, token.trim()); localStorage.removeItem(verdictKey);
}
