async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null
    const raw = body?.error ?? body?.message
    const message = typeof raw === 'string' ? raw
      : raw && typeof raw === 'object' && 'message' in raw && typeof (raw as { message: unknown }).message === 'string'
        ? (raw as { message: string }).message
        : (response.statusText || `Request failed with ${response.status}`)
    throw new Error(message)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export type SessionUser = {
  discordId: string
  username: string
  globalName: string | null
  avatar: string | null
  clubIds: string[]
  label: string | null
  isManager?: boolean
}

export const api = {
  // Online (Vercel) endpoints
  publicDashboard: () => request<import('./types').PublicData>('/api/public/dashboard'),
  applyClubs: () => request<{ clubs: Array<{ circleId: string; name: string }> }>('/api/apply'),
  submitApplication: (body: unknown) => request<{ ok: true }>('/api/apply', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request<{ authenticated: boolean; user?: SessionUser }>('/api/auth/me'),
  logout: () => request<{ ok: true }>('/api/auth/me', { method: 'POST' }),
  staffApplicants: () => request<{ applicants: import('./types').Applicant[]; user: SessionUser }>('/api/applicants'),
  staffClubs: () => request<{
    clubs: import('./types').Club[]
    memberLinks: Array<{ umaId: string; discordId: string }>
    directory?: import('./types').MemberDirectoryRow[]
    user: SessionUser
  }>('/api/clubs'),
  staffMemberProfile: (umaId: string) =>
    request<import('./types').TrainerMiniProfile>(`/api/clubs?profile=${encodeURIComponent(umaId)}`),
  staffUpdateClub: (circleId: string, body: unknown) =>
    request<import('./types').Club>(`/api/clubs?circleId=${encodeURIComponent(circleId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  staffSaveMemberLink: (umaId: string, discordId: string | null) =>
    request<{ umaId: string; discordId: string | null }>('/api/clubs?link=1', {
      method: 'PUT',
      body: JSON.stringify({ umaId, discordId: discordId || '', link: true }),
    }),
  staffPlan: () =>
    request<{
      board: { status: string; updatedAt?: string | null; confirmedAt?: string | null }
      assignments: import('./types').Assignment[]
      clubs: import('./types').Club[]
      user: SessionUser
    }>('/api/planning'),
  staffSavePlan: (assignments: import('./types').Assignment[]) =>
    request<{
      board: { status: string; updatedAt?: string | null; confirmedAt?: string | null }
      assignments: import('./types').Assignment[]
    }>('/api/planning', { method: 'PUT', body: JSON.stringify({ assignments }) }),
  staffConfirmPlan: () =>
    request<{
      board: { status: string; updatedAt?: string | null; confirmedAt?: string | null }
      assignments: import('./types').Assignment[]
    }>('/api/planning?action=confirm', { method: 'POST' }),
  staffAddApplicant: (body: unknown) => request('/api/applicants', { method: 'POST', body: JSON.stringify(body) }),
  staffUpdateApplicant: (umaId: string, body: unknown) =>
    request(`/api/applicants?umaId=${encodeURIComponent(umaId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  staffDeleteApplicant: (umaId: string) =>
    request<void>(`/api/applicants?umaId=${encodeURIComponent(umaId)}`, { method: 'DELETE' }),
  staffBlacklist: () => request<{ entries: import('./types').BlacklistEntry[]; user: SessionUser }>('/api/blacklist'),
  staffAddBlacklist: (body: unknown) =>
    request<import('./types').BlacklistEntry>('/api/blacklist', { method: 'POST', body: JSON.stringify(body) }),
  staffDeleteBlacklist: (id: number) =>
    request<void>(`/api/blacklist?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
  staffTournaments: () => request<{ tournaments: import('./types').Tournament[]; user: SessionUser }>('/api/tournaments'),
  staffTournament: (id: number) =>
    request<import('./types').TournamentBoard & { user: SessionUser }>(`/api/tournaments?id=${encodeURIComponent(String(id))}`),
  staffCreateTournament: (body: unknown) =>
    request<import('./types').Tournament>('/api/tournaments', { method: 'POST', body: JSON.stringify(body) }),
  staffUpdateTournament: (id: number, body: unknown) =>
    request<import('./types').Tournament>(`/api/tournaments?id=${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  staffDeleteTournament: (id: number) =>
    request<void>(`/api/tournaments?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
  staffSaveTournamentRoster: (id: number, players: unknown[]) =>
    request<{ players: import('./types').TournamentPlayer[] }>(
      `/api/tournaments?id=${encodeURIComponent(String(id))}&roster=1`,
      { method: 'PUT', body: JSON.stringify({ players, roster: true }) },
    ),
  tourneyList: () => request<{ tournaments: import('./types').Tournament[]; user: SessionUser }>('/api/tourney'),
  tourneyBoard: (id: number) =>
    request<import('./types').TournamentBoard & { user: SessionUser; canEditAll: boolean; locked: boolean }>(
      `/api/tourney?id=${encodeURIComponent(String(id))}`,
    ),
  tourneySavePick: (body: unknown) =>
    request<{ ok: true; pick?: import('./types').TournamentPick & { label?: string }; cleared?: boolean }>(
      '/api/tourney',
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  // Local SQLite workspace endpoints
  state: () => request<import('./types').DashboardState>('/api/state'),
  sync: () => request<import('./types').DashboardState>('/api/sync', { method: 'POST' }),
  addClub: (body: unknown) => request('/api/clubs', { method: 'POST', body: JSON.stringify(body) }),
  updateClub: (id: string, body: unknown) => request(`/api/clubs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteClub: (id: string) => request(`/api/clubs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addApplicant: (body: unknown) => request('/api/applicants', { method: 'POST', body: JSON.stringify(body) }),
  updateApplicant: (id: string, body: unknown) => request(`/api/applicants/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteApplicant: (id: string) => request(`/api/applicants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  savePlan: (assignments: import('./types').Assignment[]) => request('/api/planning', { method: 'PUT', body: JSON.stringify({ assignments }) }),
  confirmPlan: () => request('/api/planning/confirm', { method: 'POST' }),
  preview: () => request<{ previous: unknown; next: unknown }>('/api/publication/preview'),
  publish: () => request<{ destination: string }>('/api/publication/publish', { method: 'POST' }),
}
