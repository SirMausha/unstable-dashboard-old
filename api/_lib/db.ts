import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let sql: NeonQueryFunction<false, false> | null = null
let ready: Promise<void> | null = null

function getSql() {
  const url = String(process.env.DATABASE_URL || '').trim()
  if (!url) throw new Error('DATABASE_URL is not configured. Create a free Neon database and set it in Vercel env.')
  if (!sql) sql = neon(url)
  return sql
}

export type ClubRow = {
  circleId: string
  name: string
  dailyTarget: number
  promotionRatio: number
  severeRatio: number
  inactiveDays: number
  promotionEnabled: boolean
  rankGrade: string | null
  sortOrder: number
}

export type AssignmentRow = {
  entityType: 'member' | 'applicant'
  entityId: string
  destination: string
  position: number
}

export type BoardRow = {
  status: string
  updatedAt: string | null
  confirmedAt: string | null
}

function mapClub(row: any): ClubRow {
  return {
    circleId: String(row.circle_id),
    name: String(row.name),
    dailyTarget: Number(row.daily_target || 0),
    promotionRatio: Number(row.promotion_ratio || 1.25),
    severeRatio: Number(row.severe_ratio || 0.5),
    inactiveDays: Number(row.inactive_days || 3),
    promotionEnabled: row.promotion_enabled !== false && row.promotion_enabled !== 0,
    rankGrade: row.rank_grade == null || row.rank_grade === '' ? null : String(row.rank_grade),
    sortOrder: Number(row.sort_order || 0),
  }
}

function mapAssignment(row: any): AssignmentRow {
  return {
    entityType: row.entity_type === 'applicant' ? 'applicant' : 'member',
    entityId: String(row.entity_id),
    destination: String(row.destination),
    position: Number(row.position || 0),
  }
}

function seedClubsFromConfig() {
  const file = path.join(process.cwd(), 'config', 'clubs.json')
  const payload = JSON.parse(readFileSync(file, 'utf8')) as {
    clubs: Array<{
      circleId: string
      name: string
      dailyTarget: number
      promotionRatio: number
      severeRatio: number
      inactiveDays: number
      promotionEnabled?: boolean
    }>
  }
  return payload.clubs
}

const SCHEMA_LOCK_KEY = 872_014_401

export async function ensureSchema() {
  if (!ready) {
    const run = (async () => {
      const db = getSql()
      // CREATE TABLE IF NOT EXISTS is not race-safe under concurrent serverless cold starts:
      // two sessions can collide on pg_type and raise pg_type_typname_nsp_index.
      await db.transaction((tx) => [
        tx`SELECT pg_advisory_xact_lock(${SCHEMA_LOCK_KEY})`,
        tx`
          CREATE TABLE IF NOT EXISTS applicants (
            uma_id TEXT PRIMARY KEY,
            ign TEXT NOT NULL,
            discord_username TEXT NOT NULL DEFAULT '',
            target_club_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            private_notes TEXT NOT NULL DEFAULT '',
            publish_publicly BOOLEAN NOT NULL DEFAULT TRUE,
            current_club_id TEXT,
            current_club_name TEXT,
            last_updated_at TIMESTAMPTZ,
            total_fans INTEGER NOT NULL DEFAULT 0,
            monthly_gain INTEGER NOT NULL DEFAULT 0,
            daily_average INTEGER NOT NULL DEFAULT 0,
            today_gain INTEGER NOT NULL DEFAULT 0,
            daily_gains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS clubs (
            circle_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            daily_target INTEGER NOT NULL DEFAULT 0,
            promotion_ratio DOUBLE PRECISION NOT NULL DEFAULT 1.25,
            severe_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            inactive_days INTEGER NOT NULL DEFAULT 3,
            promotion_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            rank_grade TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        tx`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS rank_grade TEXT`,
        tx`
          CREATE TABLE IF NOT EXISTS planning_boards (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'draft',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            confirmed_at TIMESTAMPTZ
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS planning_assignments (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            destination TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (entity_type, entity_id)
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS blacklist_entries (
            id SERIAL PRIMARY KEY,
            uma_id TEXT NOT NULL UNIQUE,
            discord_username TEXT NOT NULL,
            discord_username_normalized TEXT NOT NULL UNIQUE,
            reason TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS tournaments (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            rounds INTEGER NOT NULL DEFAULT 1,
            event_date TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS tournament_players (
            id SERIAL PRIMARY KEY,
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            discord_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            team INTEGER NOT NULL DEFAULT 1,
            distance TEXT NOT NULL DEFAULT 'mile',
            sort_order INTEGER NOT NULL DEFAULT 0,
            uma_id TEXT,
            UNIQUE (tournament_id, discord_id)
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS tournament_picks (
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            player_id INTEGER NOT NULL REFERENCES tournament_players(id) ON DELETE CASCADE,
            round INTEGER NOT NULL,
            team INTEGER NOT NULL,
            character_id TEXT NOT NULL,
            character_name TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (player_id, round),
            UNIQUE (tournament_id, team, round, character_name)
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS member_links (
            uma_id TEXT PRIMARY KEY,
            discord_id TEXT NOT NULL UNIQUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS member_profiles (
            uma_id TEXT PRIMARY KEY,
            ign TEXT NOT NULL,
            current_circle_id TEXT,
            last_circle_id TEXT,
            first_seen_on DATE NOT NULL,
            last_seen_on DATE NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        tx`
          CREATE TABLE IF NOT EXISTS member_sightings (
            uma_id TEXT NOT NULL,
            circle_id TEXT NOT NULL,
            seen_on DATE NOT NULL,
            PRIMARY KEY (uma_id, circle_id, seen_on)
          )
        `,
        tx`
          INSERT INTO planning_boards (id, status, updated_at)
          VALUES (1, 'draft', NOW())
          ON CONFLICT (id) DO NOTHING
        `,
      ])

      await db`
        INSERT INTO member_links (uma_id, discord_id, updated_at)
        SELECT DISTINCT ON (uma_id) uma_id, discord_id, NOW()
        FROM tournament_players
        WHERE uma_id IS NOT NULL AND btrim(uma_id) <> ''
        ORDER BY uma_id, id DESC
        ON CONFLICT DO NOTHING
      `

      const seeds = seedClubsFromConfig()
      for (const [index, club] of seeds.entries()) {
        await db`
          INSERT INTO clubs (
            circle_id, name, daily_target, promotion_ratio, severe_ratio,
            inactive_days, promotion_enabled, sort_order, updated_at
          ) VALUES (
            ${club.circleId}, ${club.name}, ${club.dailyTarget}, ${club.promotionRatio},
            ${club.severeRatio}, ${club.inactiveDays}, ${club.promotionEnabled !== false},
            ${index}, NOW()
          )
          ON CONFLICT (circle_id) DO NOTHING
        `
      }
    })()

    ready = run.catch((error) => {
      ready = null
      throw error
    })
  }
  await ready
}

function mapApplicant(row: any) {
  return {
    umaId: String(row.uma_id),
    ign: String(row.ign),
    discordUsername: String(row.discord_username || ''),
    targetClubId: String(row.target_club_id),
    status: row.status as 'pending' | 'approved' | 'waitlisted' | 'rejected',
    privateNotes: String(row.private_notes || ''),
    publishPublicly: Boolean(row.publish_publicly),
    currentClubId: row.current_club_id == null ? null : String(row.current_club_id),
    currentClubName: row.current_club_name == null ? null : String(row.current_club_name),
    lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : null,
    totalFans: Number(row.total_fans || 0),
    monthlyGain: Number(row.monthly_gain || 0),
    dailyAverage: Number(row.daily_average || 0),
    todayGain: Number(row.today_gain || 0),
    dailyGains: Array.isArray(row.daily_gains_json) ? row.daily_gains_json : [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

export async function listClubs(clubIds?: string[]) {
  await ensureSchema()
  const db = getSql()
  if (clubIds && clubIds.length) {
    const rows = await db`
      SELECT * FROM clubs
      WHERE circle_id = ANY(${clubIds})
      ORDER BY sort_order ASC, name ASC
    `
    return rows.map(mapClub)
  }
  const rows = await db`SELECT * FROM clubs ORDER BY sort_order ASC, name ASC`
  return rows.map(mapClub)
}

export type MemberLink = {
  umaId: string
  discordId: string
}

export async function listMemberLinks(): Promise<MemberLink[]> {
  await ensureSchema()
  const db = getSql()
  const rows = await db`SELECT uma_id, discord_id FROM member_links ORDER BY uma_id ASC`
  return rows.map((row) => ({
    umaId: String(row.uma_id),
    discordId: String(row.discord_id),
  }))
}

export async function upsertMemberLink(umaId: string, discordId: string | null): Promise<MemberLink | null> {
  await ensureSchema()
  const db = getSql()
  const id = String(umaId || '').trim()
  const discord = String(discordId || '').trim()
  if (!id) throw new Error('Uma ID is required.')
  if (!discord) {
    await db`DELETE FROM member_links WHERE uma_id = ${id}`
    return null
  }
  if (!/^\d{5,32}$/.test(discord)) throw new Error('Discord ID must be a numeric snowflake.')
  await db`DELETE FROM member_links WHERE discord_id = ${discord} AND uma_id <> ${id}`
  await db`
    INSERT INTO member_links (uma_id, discord_id, updated_at)
    VALUES (${id}, ${discord}, NOW())
    ON CONFLICT (uma_id) DO UPDATE SET
      discord_id = EXCLUDED.discord_id,
      updated_at = NOW()
  `
  return { umaId: id, discordId: discord }
}

function jstDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now)
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

function asDay(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10)
  const text = String(value || '')
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : text.slice(0, 10)
}

function mapDirectoryRow(row: any): MemberDirectoryRow {
  return {
    umaId: String(row.uma_id),
    ign: String(row.ign),
    currentCircleId: row.current_circle_id == null ? null : String(row.current_circle_id),
    lastCircleId: row.last_circle_id == null ? null : String(row.last_circle_id),
    firstSeenOn: asDay(row.first_seen_on),
    lastSeenOn: asDay(row.last_seen_on),
    observedDays: Number(row.observed_days || 0),
    status: row.current_circle_id ? 'current' : 'former',
    discordId: row.discord_id == null ? null : String(row.discord_id),
  }
}

export async function recordManagedRoster(circleId: string, members: Array<{ umaId: string; ign: string }>) {
  await ensureSchema()
  const db = getSql()
  const today = jstDate()
  const club = String(circleId || '').trim()
  if (!club) return
  const present = members
    .map((member) => ({ umaId: String(member.umaId || '').trim(), ign: String(member.ign || '').trim() || 'Unknown' }))
    .filter((member) => member.umaId)
  const umaIds = present.map((member) => member.umaId)
  const igns = present.map((member) => member.ign)

  if (present.length) {
    const idsJson = JSON.stringify(umaIds)
    const ignsJson = JSON.stringify(igns)
    await db`
      INSERT INTO member_sightings (uma_id, circle_id, seen_on)
      SELECT x.uma_id, ${club}, ${today}::date
      FROM json_array_elements_text(${idsJson}::json) AS x(uma_id)
      ON CONFLICT (uma_id, circle_id, seen_on) DO NOTHING
    `
    await db`
      INSERT INTO member_profiles (
        uma_id, ign, current_circle_id, last_circle_id, first_seen_on, last_seen_on, updated_at
      )
      SELECT a.uma_id, b.ign, ${club}, ${club}, ${today}::date, ${today}::date, NOW()
      FROM json_array_elements_text(${idsJson}::json) WITH ORDINALITY AS a(uma_id, n)
      JOIN json_array_elements_text(${ignsJson}::json) WITH ORDINALITY AS b(ign, n) ON a.n = b.n
      ON CONFLICT (uma_id) DO UPDATE SET
        ign = EXCLUDED.ign,
        current_circle_id = EXCLUDED.current_circle_id,
        last_circle_id = EXCLUDED.last_circle_id,
        last_seen_on = EXCLUDED.last_seen_on,
        first_seen_on = LEAST(member_profiles.first_seen_on, EXCLUDED.first_seen_on),
        updated_at = NOW()
    `
  }

  if (umaIds.length) {
    await db`
      UPDATE member_profiles
      SET current_circle_id = NULL, updated_at = NOW()
      WHERE current_circle_id = ${club}
        AND NOT (uma_id = ANY(${umaIds}))
    `
  } else {
    await db`
      UPDATE member_profiles
      SET current_circle_id = NULL, updated_at = NOW()
      WHERE current_circle_id = ${club}
    `
  }
}

export async function listMemberDirectory(): Promise<MemberDirectoryRow[]> {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT
      p.uma_id,
      p.ign,
      p.current_circle_id,
      p.last_circle_id,
      p.first_seen_on,
      p.last_seen_on,
      COALESCE(s.observed_days, 0) AS observed_days,
      l.discord_id
    FROM member_profiles p
    LEFT JOIN (
      SELECT uma_id, COUNT(DISTINCT seen_on)::int AS observed_days
      FROM member_sightings
      GROUP BY uma_id
    ) s ON s.uma_id = p.uma_id
    LEFT JOIN member_links l ON l.uma_id = p.uma_id
    ORDER BY p.ign ASC
  `
  return rows.map(mapDirectoryRow)
}

export async function getMemberProfileRecord(umaId: string) {
  await ensureSchema()
  const db = getSql()
  const id = String(umaId || '').trim()
  if (!id) return null
  const rows = await db`
    SELECT
      p.uma_id,
      p.ign,
      p.current_circle_id,
      p.last_circle_id,
      p.first_seen_on,
      p.last_seen_on,
      COALESCE(s.observed_days, 0) AS observed_days,
      l.discord_id
    FROM member_profiles p
    LEFT JOIN (
      SELECT uma_id, COUNT(DISTINCT seen_on)::int AS observed_days
      FROM member_sightings
      GROUP BY uma_id
    ) s ON s.uma_id = p.uma_id
    LEFT JOIN member_links l ON l.uma_id = p.uma_id
    WHERE p.uma_id = ${id}
  `
  const profile = rows[0] ? mapDirectoryRow(rows[0]) : null
  const clubDays = await db`
    SELECT circle_id, COUNT(DISTINCT seen_on)::int AS days, MIN(seen_on) AS first_seen, MAX(seen_on) AS last_seen
    FROM member_sightings
    WHERE uma_id = ${id}
    GROUP BY circle_id
    ORDER BY MAX(seen_on) DESC
  `
  const tournaments = await db`
    SELECT DISTINCT t.id, t.name, t.event_date
    FROM tournament_players p
    JOIN tournaments t ON t.id = p.tournament_id
    WHERE p.uma_id = ${id}
    ORDER BY t.event_date DESC
  `
  return {
    profile,
    clubDays: clubDays.map((row) => ({
      circleId: String(row.circle_id),
      days: Number(row.days || 0),
      firstSeenOn: asDay(row.first_seen),
      lastSeenOn: asDay(row.last_seen),
    })),
    tournaments: tournaments.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      eventDate: row.event_date ? new Date(row.event_date).toISOString() : null,
    })),
  }
}

export async function updateClub(
  circleId: string,
  clubIds: string[],
  input: {
    name: string
    dailyTarget: number
    promotionRatio: number
    severeRatio: number
    inactiveDays: number
    promotionEnabled: boolean
    rankGrade: string | null
  },
) {
  await ensureSchema()
  if (!clubIds.includes(circleId)) return null
  const db = getSql()
  const rows = await db`
    UPDATE clubs SET
      name = ${input.name},
      daily_target = ${input.dailyTarget},
      promotion_ratio = ${input.promotionRatio},
      severe_ratio = ${input.severeRatio},
      inactive_days = ${input.inactiveDays},
      promotion_enabled = ${input.promotionEnabled},
      rank_grade = ${input.rankGrade},
      updated_at = NOW()
    WHERE circle_id = ${circleId} AND circle_id = ANY(${clubIds})
    RETURNING *
  `
  return rows[0] ? mapClub(rows[0]) : null
}

export async function getPlanningBoard(): Promise<BoardRow> {
  await ensureSchema()
  const db = getSql()
  const rows = await db`SELECT status, updated_at, confirmed_at FROM planning_boards WHERE id = 1`
  const row = rows[0]
  return {
    status: String(row?.status || 'draft'),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    confirmedAt: row?.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
  }
}

export async function listAssignments() {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT entity_type, entity_id, destination, position
    FROM planning_assignments
    ORDER BY destination, position
  `
  return rows.map(mapAssignment)
}

export async function saveAssignments(assignments: AssignmentRow[]) {
  await ensureSchema()
  const db = getSql()
  const unique = new Map<string, AssignmentRow>()
  for (const item of assignments) {
    unique.set(`${item.entityType}:${item.entityId}`, item)
  }
  const rows = [...unique.values()]
  await db.transaction((tx) => [
    tx`DELETE FROM planning_assignments`,
    ...rows.map((item) => tx`
      INSERT INTO planning_assignments (entity_type, entity_id, destination, position, updated_at)
      VALUES (${item.entityType}, ${item.entityId}, ${item.destination}, ${item.position}, NOW())
    `),
    tx`
      UPDATE planning_boards
      SET status = 'draft', updated_at = NOW()
      WHERE id = 1
    `,
  ])
  return listAssignments()
}

export async function confirmPlan() {
  await ensureSchema()
  const db = getSql()
  await db`
    UPDATE planning_boards
    SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
    WHERE id = 1
  `
  const board = await getPlanningBoard()
  const assignments = await listAssignments()
  return { board, assignments }
}

export async function listApplicants(clubIds?: string[]) {
  await ensureSchema()
  const db = getSql()
  if (clubIds && clubIds.length) {
    const rows = await db`
      SELECT * FROM applicants
      WHERE target_club_id = ANY(${clubIds})
      ORDER BY updated_at DESC
    `
    return rows.map(mapApplicant)
  }
  const rows = await db`SELECT * FROM applicants ORDER BY updated_at DESC`
  return rows.map(mapApplicant)
}

export async function listPublicApplicants() {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT * FROM applicants
    WHERE publish_publicly = TRUE AND status <> 'rejected'
    ORDER BY updated_at DESC
  `
  return rows.map(mapApplicant).map((applicant) => ({
    umaId: applicant.umaId,
    ign: applicant.ign,
    targetClubId: applicant.targetClubId,
    status: applicant.status,
    currentClubId: applicant.currentClubId,
    currentClubName: applicant.currentClubName,
    lastUpdatedAt: applicant.lastUpdatedAt,
    totalFans: applicant.totalFans,
    monthlyGain: applicant.monthlyGain,
    dailyAverage: applicant.dailyAverage,
    todayGain: applicant.todayGain,
    dailyGains: applicant.dailyGains,
  }))
}

export async function upsertApplicant(input: {
  umaId: string
  ign: string
  discordUsername: string
  targetClubId: string
  status: string
  privateNotes: string
  publishPublicly: boolean
  currentClubId: string | null
  currentClubName: string | null
  lastUpdatedAt: string | null
  totalFans: number
  monthlyGain: number
  dailyAverage: number
  todayGain: number
  dailyGains: number[]
}) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    INSERT INTO applicants (
      uma_id, ign, discord_username, target_club_id, status, private_notes, publish_publicly,
      current_club_id, current_club_name, last_updated_at, total_fans, monthly_gain, daily_average,
      today_gain, daily_gains_json, created_at, updated_at
    ) VALUES (
      ${input.umaId}, ${input.ign}, ${input.discordUsername}, ${input.targetClubId}, ${input.status},
      ${input.privateNotes}, ${input.publishPublicly}, ${input.currentClubId}, ${input.currentClubName},
      ${input.lastUpdatedAt}, ${input.totalFans}, ${input.monthlyGain}, ${input.dailyAverage},
      ${input.todayGain}, ${JSON.stringify(input.dailyGains)}, NOW(), NOW()
    )
    ON CONFLICT (uma_id) DO UPDATE SET
      ign = EXCLUDED.ign,
      discord_username = EXCLUDED.discord_username,
      target_club_id = EXCLUDED.target_club_id,
      status = EXCLUDED.status,
      private_notes = EXCLUDED.private_notes,
      publish_publicly = EXCLUDED.publish_publicly,
      current_club_id = EXCLUDED.current_club_id,
      current_club_name = EXCLUDED.current_club_name,
      last_updated_at = EXCLUDED.last_updated_at,
      total_fans = EXCLUDED.total_fans,
      monthly_gain = EXCLUDED.monthly_gain,
      daily_average = EXCLUDED.daily_average,
      today_gain = EXCLUDED.today_gain,
      daily_gains_json = EXCLUDED.daily_gains_json,
      updated_at = NOW()
    RETURNING *
  `
  return mapApplicant(rows[0])
}

export async function updateApplicantStatus(umaId: string, status: string, clubIds: string[]) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    UPDATE applicants
    SET status = ${status}, updated_at = NOW()
    WHERE uma_id = ${umaId} AND target_club_id = ANY(${clubIds})
    RETURNING *
  `
  return rows[0] ? mapApplicant(rows[0]) : null
}

export async function updateApplicantFields(
  umaId: string,
  clubIds: string[],
  fields: {
    status?: string
    privateNotes?: string
    publishPublicly?: boolean
    targetClubId?: string
    discordUsername?: string
  },
) {
  await ensureSchema()
  const current = (await listApplicants(clubIds)).find((item) => item.umaId === umaId)
  if (!current) return null
  return upsertApplicant({
    ...current,
    status: fields.status ?? current.status,
    privateNotes: fields.privateNotes ?? current.privateNotes,
    publishPublicly: fields.publishPublicly ?? current.publishPublicly,
    targetClubId: fields.targetClubId ?? current.targetClubId,
    discordUsername: fields.discordUsername ?? current.discordUsername,
  })
}

export async function deleteApplicant(umaId: string, clubIds: string[]) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    DELETE FROM applicants
    WHERE uma_id = ${umaId} AND target_club_id = ANY(${clubIds})
    RETURNING uma_id
  `
  return rows.length > 0
}

export type BlacklistRow = {
  id: number
  umaId: string
  discordUsername: string
  reason: string
  createdBy: string
  createdAt: string | null
}

function mapBlacklist(row: any): BlacklistRow {
  return {
    id: Number(row.id),
    umaId: String(row.uma_id),
    discordUsername: String(row.discord_username || ''),
    reason: String(row.reason || ''),
    createdBy: String(row.created_by || ''),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

export function normalizeDiscordUsername(value: string) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
}

export async function listBlacklist() {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT * FROM blacklist_entries
    ORDER BY created_at DESC, id DESC
  `
  return rows.map(mapBlacklist)
}

export async function findBlacklistMatch(umaId: string, discordUsername: string) {
  await ensureSchema()
  const db = getSql()
  const normalized = normalizeDiscordUsername(discordUsername)
  const rows = await db`
    SELECT * FROM blacklist_entries
    WHERE uma_id = ${umaId}
       OR (${normalized} <> '' AND discord_username_normalized = ${normalized})
    LIMIT 1
  `
  return rows[0] ? mapBlacklist(rows[0]) : null
}

export async function addBlacklistEntry(input: {
  umaId: string
  discordUsername: string
  reason?: string
  createdBy?: string
}) {
  await ensureSchema()
  const db = getSql()
  const discordUsername = String(input.discordUsername || '').trim()
  const normalized = normalizeDiscordUsername(discordUsername)
  if (!normalized) throw new Error('Discord username is required.')

  const discordTaken = await db`
    SELECT id FROM blacklist_entries
    WHERE discord_username_normalized = ${normalized} AND uma_id <> ${input.umaId}
    LIMIT 1
  `
  if (discordTaken.length) throw new Error('That Discord username is already on the blacklist.')

  const rows = await db`
    INSERT INTO blacklist_entries (
      uma_id, discord_username, discord_username_normalized, reason, created_by, created_at
    ) VALUES (
      ${input.umaId},
      ${discordUsername},
      ${normalized},
      ${String(input.reason || '').trim()},
      ${String(input.createdBy || '').trim()},
      NOW()
    )
    ON CONFLICT (uma_id) DO UPDATE SET
      discord_username = EXCLUDED.discord_username,
      discord_username_normalized = EXCLUDED.discord_username_normalized,
      reason = EXCLUDED.reason,
      created_by = EXCLUDED.created_by,
      created_at = NOW()
    RETURNING *
  `
  return mapBlacklist(rows[0])
}

export async function deleteBlacklistEntry(id: number) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    DELETE FROM blacklist_entries
    WHERE id = ${id}
    RETURNING id
  `
  return rows.length > 0
}

export type TournamentDistance = 'sprint' | 'mile' | 'medium' | 'long' | 'dirt'

export type TournamentRow = {
  id: number
  name: string
  rounds: number
  eventDate: string
  createdAt: string | null
  updatedAt: string | null
  locked: boolean
  playerCount?: number
}

export type TournamentPlayerRow = {
  id: number
  tournamentId: number
  discordId: string
  displayName: string
  team: number
  distance: TournamentDistance
  sortOrder: number
  umaId: string | null
}

export type TournamentPickRow = {
  playerId: number
  round: number
  team: number
  characterId: string
  characterName: string
  updatedAt: string | null
  updatedBy: string
}

function endOfDayUtc(dateInput: string | Date) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (Number.isNaN(date.getTime())) throw new Error('Invalid tournament date.')
  // If date-only (YYYY-MM-DD), lock at end of that UTC day.
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return new Date(`${dateInput}T23:59:59.999Z`)
  }
  return date
}

function isTournamentLocked(eventDate: string | Date) {
  return Date.now() > endOfDayUtc(eventDate).getTime()
}

function mapTournament(row: any): TournamentRow {
  const eventDate = row.event_date ? new Date(row.event_date).toISOString() : new Date().toISOString()
  return {
    id: Number(row.id),
    name: String(row.name),
    rounds: Math.max(1, Number(row.rounds || 1)),
    eventDate,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    locked: isTournamentLocked(eventDate),
    playerCount: row.player_count == null ? undefined : Number(row.player_count),
  }
}

function mapTournamentPlayer(row: any): TournamentPlayerRow {
  const distance = String(row.distance || 'mile')
  const allowed: TournamentDistance[] = ['sprint', 'mile', 'medium', 'long', 'dirt']
  return {
    id: Number(row.id),
    tournamentId: Number(row.tournament_id),
    discordId: String(row.discord_id),
    displayName: String(row.display_name),
    team: Math.max(1, Number(row.team || 1)),
    distance: (allowed.includes(distance as TournamentDistance) ? distance : 'mile') as TournamentDistance,
    sortOrder: Number(row.sort_order || 0),
    umaId: row.uma_id == null || row.uma_id === '' ? null : String(row.uma_id),
  }
}

function mapTournamentPick(row: any): TournamentPickRow {
  return {
    playerId: Number(row.player_id),
    round: Number(row.round),
    team: Number(row.team),
    characterId: String(row.character_id),
    characterName: String(row.character_name),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: String(row.updated_by || ''),
  }
}

export async function listTournaments() {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT t.*, COUNT(p.id)::int AS player_count
    FROM tournaments t
    LEFT JOIN tournament_players p ON p.tournament_id = t.id
    GROUP BY t.id
    ORDER BY t.event_date DESC, t.id DESC
  `
  return rows.map(mapTournament)
}

export async function listTournamentsForUser(discordId: string, isManager: boolean) {
  await ensureSchema()
  const db = getSql()
  if (isManager) return listTournaments()
  const rows = await db`
    SELECT t.*, COUNT(p2.id)::int AS player_count
    FROM tournaments t
    INNER JOIN tournament_players p ON p.tournament_id = t.id AND p.discord_id = ${discordId}
    LEFT JOIN tournament_players p2 ON p2.tournament_id = t.id
    GROUP BY t.id
    ORDER BY t.event_date DESC, t.id DESC
  `
  return rows.map(mapTournament)
}

export async function getTournament(id: number) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`SELECT * FROM tournaments WHERE id = ${id} LIMIT 1`
  return rows[0] ? mapTournament(rows[0]) : null
}

export async function createTournament(input: { name: string; rounds: number; eventDate: string }) {
  await ensureSchema()
  const db = getSql()
  const eventDate = endOfDayUtc(input.eventDate)
  const rounds = Math.max(1, Math.min(8, Math.floor(input.rounds)))
  const rows = await db`
    INSERT INTO tournaments (name, rounds, event_date, created_at, updated_at)
    VALUES (${input.name.trim()}, ${rounds}, ${eventDate.toISOString()}, NOW(), NOW())
    RETURNING *
  `
  return mapTournament(rows[0])
}

export async function updateTournament(id: number, input: { name: string; rounds: number; eventDate: string }) {
  await ensureSchema()
  const db = getSql()
  const eventDate = endOfDayUtc(input.eventDate)
  const rounds = Math.max(1, Math.min(8, Math.floor(input.rounds)))
  const rows = await db`
    UPDATE tournaments
    SET name = ${input.name.trim()},
        rounds = ${rounds},
        event_date = ${eventDate.toISOString()},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] ? mapTournament(rows[0]) : null
}

export async function deleteTournament(id: number) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`DELETE FROM tournaments WHERE id = ${id} RETURNING id`
  return rows.length > 0
}

export async function listTournamentPlayers(tournamentId: number) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT * FROM tournament_players
    WHERE tournament_id = ${tournamentId}
    ORDER BY team ASC, sort_order ASC, id ASC
  `
  return rows.map(mapTournamentPlayer)
}

export async function listTournamentPicks(tournamentId: number) {
  await ensureSchema()
  const db = getSql()
  const rows = await db`
    SELECT * FROM tournament_picks
    WHERE tournament_id = ${tournamentId}
  `
  return rows.map(mapTournamentPick)
}

export async function replaceTournamentRoster(
  tournamentId: number,
  players: Array<{
    discordId: string
    displayName: string
    team: number
    distance: TournamentDistance
    sortOrder: number
    umaId?: string | null
  }>,
) {
  await ensureSchema()
  const tournament = await getTournament(tournamentId)
  if (!tournament) throw new Error('Tournament not found.')
  const db = getSql()

  const existing = await listTournamentPlayers(tournamentId)
  const existingByDiscord = new Map(existing.map((player) => [player.discordId, player]))
  const keepDiscord = new Set(players.map((player) => String(player.discordId).trim()))

  for (const player of existing) {
    if (!keepDiscord.has(player.discordId)) {
      await db`DELETE FROM tournament_players WHERE id = ${player.id}`
    }
  }

  const result: TournamentPlayerRow[] = []
  for (const [index, player] of players.entries()) {
    const discordId = String(player.discordId).trim()
    const displayName = String(player.displayName).trim()
    if (!discordId || !displayName) throw new Error('Each player needs a Discord ID and display name.')
    const team = Math.max(1, Math.floor(player.team || 1))
    const distance = player.distance
    const sortOrder = Number.isFinite(player.sortOrder) ? player.sortOrder : index
    const umaId = player.umaId ? String(player.umaId).trim() : null
    const prior = existingByDiscord.get(discordId)
    if (prior) {
      const rows = await db`
        UPDATE tournament_players
        SET display_name = ${displayName},
            team = ${team},
            distance = ${distance},
            sort_order = ${sortOrder},
            uma_id = ${umaId}
        WHERE id = ${prior.id}
        RETURNING *
      `
      // Keep picks in sync if team changed
      if (prior.team !== team) {
        await db`
          UPDATE tournament_picks
          SET team = ${team}
          WHERE player_id = ${prior.id}
        `
      }
      result.push(mapTournamentPlayer(rows[0]))
    } else {
      const rows = await db`
        INSERT INTO tournament_players (
          tournament_id, discord_id, display_name, team, distance, sort_order, uma_id
        ) VALUES (
          ${tournamentId}, ${discordId}, ${displayName}, ${team}, ${distance}, ${sortOrder}, ${umaId}
        )
        RETURNING *
      `
      result.push(mapTournamentPlayer(rows[0]))
    }
  }
  for (const player of result) {
    if (player.umaId) await upsertMemberLink(player.umaId, player.discordId)
  }
  return result
}

export async function getTournamentBoard(tournamentId: number) {
  const tournament = await getTournament(tournamentId)
  if (!tournament) return null
  const [players, picks] = await Promise.all([
    listTournamentPlayers(tournamentId),
    listTournamentPicks(tournamentId),
  ])
  return { tournament, players, picks }
}

export async function saveTournamentPick(input: {
  tournamentId: number
  playerId: number
  round: number
  characterId: string
  characterName: string
  updatedBy: string
  actorDiscordId: string
  isManager: boolean
}) {
  await ensureSchema()
  const board = await getTournamentBoard(input.tournamentId)
  if (!board) throw new Error('Tournament not found.')
  const { tournament, players } = board
  if (input.round < 1 || input.round > tournament.rounds) {
    throw new Error(`Round must be between 1 and ${tournament.rounds}.`)
  }
  const player = players.find((item) => item.id === input.playerId)
  if (!player) throw new Error('Player not found on this tournament.')
  if (!input.isManager) {
    if (tournament.locked) throw new Error('This tournament is locked. Picks can no longer be changed.')
    if (player.discordId !== input.actorDiscordId) {
      throw new Error('You can only edit your own picks.')
    }
  }

  const db = getSql()
  try {
    const rows = await db`
      INSERT INTO tournament_picks (
        tournament_id, player_id, round, team, character_id, character_name, updated_at, updated_by
      ) VALUES (
        ${input.tournamentId},
        ${input.playerId},
        ${input.round},
        ${player.team},
        ${input.characterId},
        ${input.characterName},
        NOW(),
        ${input.updatedBy}
      )
      ON CONFLICT (player_id, round) DO UPDATE SET
        team = EXCLUDED.team,
        character_id = EXCLUDED.character_id,
        character_name = EXCLUDED.character_name,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING *
    `
    return mapTournamentPick(rows[0])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique|duplicate/i.test(message)) {
      throw new Error(`A teammate already picked ${input.characterName} for round ${input.round}.`)
    }
    throw error
  }
}

export async function clearTournamentPick(input: {
  tournamentId: number
  playerId: number
  round: number
  actorDiscordId: string
  isManager: boolean
}) {
  await ensureSchema()
  const board = await getTournamentBoard(input.tournamentId)
  if (!board) throw new Error('Tournament not found.')
  const { tournament, players } = board
  const player = players.find((item) => item.id === input.playerId)
  if (!player) throw new Error('Player not found on this tournament.')
  if (!input.isManager) {
    if (tournament.locked) throw new Error('This tournament is locked. Picks can no longer be changed.')
    if (player.discordId !== input.actorDiscordId) {
      throw new Error('You can only edit your own picks.')
    }
  }
  const db = getSql()
  await db`
    DELETE FROM tournament_picks
    WHERE tournament_id = ${input.tournamentId}
      AND player_id = ${input.playerId}
      AND round = ${input.round}
  `
  return true
}
