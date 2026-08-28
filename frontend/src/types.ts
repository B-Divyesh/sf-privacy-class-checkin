export interface IssuedRoster { id: string; alias: string; token: string }
export interface ClassData {
  id: string; name: string; retentionDays: number;
  roster: { id: string; alias: string }[];
  sessions: { id: string; startedAt: number; endsAt: number; closedAt: number | null }[];
}
export interface SessionData {
  id: string; code: string; codeExpiresIn: number; startedAt: number; lateAt: number; endsAt: number; closedAt: number | null; active: boolean;
  roster: { id: string; alias: string; status: 'present'|'late'|'absent'; checkedAt: number|null; source: string|null }[];
}
