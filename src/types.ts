export type Status = 'pending' | 'approved' | 'waitlisted' | 'rejected'
export type Band = 'promotion' | 'meeting' | 'under' | 'severe' | 'inactive'

export type Club = {
  circleId: string
  name: string
  dailyTarget: number
  promotionRatio: number
  severeRatio: number
  inactiveDays: number
  promotionEnabled?: boolean
  rank?: number | null
  yesterdayRank?: number | null
  /** Positions gained today (positive = rose). live vs yesterday. */
  rankDelta?: number | null
  lastMonthRank?: number | null
  /** Current monthly fan total (live_points). */
  monthlyFans?: number | null
  /** Fans gained since yesterday (live_points - yesterday_points). */
  fansSinceYesterday?: number | null
  /** Letter grade for rank badge image (SS/S/A/…). */
  rankGrade?: string | null
  sourceUpdatedAt?: string | null
  syncedAt?: string | null
  members?: Member[]
}

export type Member = {
  umaId: string
  circleId?: string
  ign: string
  lastUpdatedAt?: string | null
  totalFans: number
  monthlyGain: number
  dailyAverage: number
  todayGain: number
  dailyGains: number[]
  band: Band
  reason: string
  discordId?: string | null
  former?: boolean
  observedDays?: number
  firstSeenOn?: string | null
  lastSeenOn?: string | null
}

export type Applicant = {
  umaId: string
  ign: string
  discordUsername?: string
  targetClubId: string
  status: Status
  privateNotes?: string
  publishPublicly?: boolean
  currentClubId?: string | null
  currentClubName?: string | null
  lastUpdatedAt?: string | null
  totalFans: number
  monthlyGain: number
  dailyAverage: number
  todayGain: number
  dailyGains: number[]
}

export type BlacklistEntry = {
  id: number
  umaId: string
  discordUsername: string
  reason: string
  createdBy: string
  createdAt: string | null
}

export type TournamentDistance = 'sprint' | 'mile' | 'medium' | 'long' | 'dirt'

export type Tournament = {
  id: number
  name: string
  rounds: number
  eventDate: string
  createdAt: string | null
  updatedAt: string | null
  locked: boolean
  playerCount?: number
}

export type TournamentPlayer = {
  id: number
  tournamentId: number
  discordId: string
  displayName: string
  team: number
  distance: TournamentDistance
  sortOrder: number
  umaId: string | null
}

export type TournamentPick = {
  playerId: number
  round: number
  team: number
  characterId: string
  characterName: string
  updatedAt: string | null
  updatedBy: string
}

export type TournamentBoard = {
  tournament: Tournament
  players: TournamentPlayer[]
  picks: TournamentPick[]
  canEditAll?: boolean
  locked?: boolean
}

export type Assignment = {
  entityType: 'member' | 'applicant'
  entityId: string
  destination: string
  position: number
}

export type SyncError = {
  id: string
  error: string
}

export type DashboardState = {
  clubs: Club[]
  members: Member[]
  applicants: Applicant[]
  assignments: Assignment[]
  board?: { status: string; updated_at?: string; confirmed_at?: string | null }
  publications?: Array<Record<string, unknown>>
  syncErrors?: SyncError[]
}

export type MemberDirectoryRow = {
  umaId: string
  ign: string
  currentCircleId: string | null
  lastCircleId: string | null
  firstSeenOn: string
  lastSeenOn: string
  observedDays: number
  status: 'current' | 'former'
  discordId: string | null
}

export type TrainerMiniProfile = {
  umaId: string
  ign: string
  discordId: string | null
  status: 'current' | 'former' | 'unknown'
  currentCircleId: string | null
  currentClubName: string | null
  lastCircleId: string | null
  lastClubName: string | null
  firstSeenOn: string | null
  lastSeenOn: string | null
  observedDays: number
  networkMonths: number
  firstNetworkMonth: string | null
  lastNetworkMonth: string | null
  stints: Array<{
    circleId: string
    circleName: string
    startYear: number
    startMonth: number
    endYear: number
    endMonth: number
    monthCount: number
  }>
  clubDays: Array<{ circleId: string; circleName: string; days: number; firstSeenOn: string; lastSeenOn: string }>
  tournaments: Array<{ id: number; name: string; eventDate: string | null }>
  umaMoeUrl: string
}

export type PublicData = {
  schemaVersion: number
  generatedAt: string
  source: string
  clubs: Array<Club & { members: Member[] }>
  applicants: Applicant[]
}
