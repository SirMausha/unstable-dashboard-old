import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

type SqliteDb = Database.Database

export type ClubInput = {
  circleId: string
  name: string
  dailyTarget: number
  promotionRatio: number
  severeRatio: number
  inactiveDays: number
  promotionEnabled: boolean
}

export type ApplicantInput = {
  umaId: string
  ign: string
  targetClubId: string
  status: 'pending' | 'approved' | 'waitlisted' | 'rejected'
  privateNotes: string
  publishPublicly: boolean
}

function migrateMembersPrimaryKey(db: SqliteDb) {
  const columns = db.prepare('PRAGMA table_info(members)').all() as Array<{ name: string; pk: number }>
  if (!columns.length) return
  const viewerPk = columns.find((column) => column.name === 'viewer_id')?.pk === 1
  const circlePk = columns.find((column) => column.name === 'circle_id')?.pk === 1
  if (!viewerPk || circlePk) return

  db.exec(`
    CREATE TABLE members_v2 (
      viewer_id TEXT NOT NULL,
      circle_id TEXT NOT NULL REFERENCES clubs(circle_id) ON DELETE CASCADE,
      ign TEXT NOT NULL,
      last_updated_at TEXT,
      total_fans INTEGER NOT NULL DEFAULT 0,
      monthly_gain INTEGER NOT NULL DEFAULT 0,
      daily_average INTEGER NOT NULL DEFAULT 0,
      today_gain INTEGER NOT NULL DEFAULT 0,
      daily_gains_json TEXT NOT NULL DEFAULT '[]',
      decision_band TEXT NOT NULL DEFAULT 'inactive',
      decision_reason TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL,
      PRIMARY KEY(circle_id, viewer_id)
    );
    INSERT OR IGNORE INTO members_v2
      (viewer_id,circle_id,ign,last_updated_at,total_fans,monthly_gain,daily_average,today_gain,daily_gains_json,decision_band,decision_reason,synced_at)
      SELECT viewer_id,circle_id,ign,last_updated_at,total_fans,monthly_gain,daily_average,today_gain,daily_gains_json,decision_band,decision_reason,synced_at
      FROM members;
    DROP TABLE members;
    ALTER TABLE members_v2 RENAME TO members;
  `)
}

function ensureClubColumns(db: SqliteDb) {
  const columns = db.prepare('PRAGMA table_info(clubs)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'promotion_enabled')) {
    db.exec('ALTER TABLE clubs ADD COLUMN promotion_enabled INTEGER NOT NULL DEFAULT 1')
  }
}

export function createStore(filename = process.env.DATABASE_PATH || 'data/dashboard.sqlite') {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true })
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS clubs (
      circle_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      daily_target INTEGER NOT NULL CHECK(daily_target >= 0),
      promotion_ratio REAL NOT NULL DEFAULT 1.25,
      severe_ratio REAL NOT NULL DEFAULT 0.5,
      inactive_days INTEGER NOT NULL DEFAULT 3,
      promotion_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      source_updated_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS members (
      viewer_id TEXT NOT NULL,
      circle_id TEXT NOT NULL REFERENCES clubs(circle_id) ON DELETE CASCADE,
      ign TEXT NOT NULL,
      last_updated_at TEXT,
      total_fans INTEGER NOT NULL DEFAULT 0,
      monthly_gain INTEGER NOT NULL DEFAULT 0,
      daily_average INTEGER NOT NULL DEFAULT 0,
      today_gain INTEGER NOT NULL DEFAULT 0,
      daily_gains_json TEXT NOT NULL DEFAULT '[]',
      decision_band TEXT NOT NULL DEFAULT 'inactive',
      decision_reason TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL,
      PRIMARY KEY(circle_id, viewer_id)
    );
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      circle_id TEXT NOT NULL REFERENCES clubs(circle_id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL,
      ign TEXT NOT NULL,
      total_fans INTEGER NOT NULL,
      monthly_gain INTEGER NOT NULL,
      daily_average INTEGER NOT NULL,
      today_gain INTEGER NOT NULL,
      decision_band TEXT NOT NULL,
      UNIQUE(snapshot_date, circle_id, viewer_id)
    );
    CREATE TABLE IF NOT EXISTS applicants (
      uma_id TEXT PRIMARY KEY,
      ign TEXT NOT NULL,
      target_club_id TEXT NOT NULL REFERENCES clubs(circle_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','waitlisted','rejected')),
      private_notes TEXT NOT NULL DEFAULT '',
      publish_publicly INTEGER NOT NULL DEFAULT 1,
      current_club_id TEXT,
      current_club_name TEXT,
      last_updated_at TEXT,
      total_fans INTEGER NOT NULL DEFAULT 0,
      monthly_gain INTEGER NOT NULL DEFAULT 0,
      daily_average INTEGER NOT NULL DEFAULT 0,
      today_gain INTEGER NOT NULL DEFAULT 0,
      daily_gains_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planning_boards (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      status TEXT NOT NULL DEFAULT 'draft',
      updated_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS planning_assignments (
      entity_type TEXT NOT NULL CHECK(entity_type IN ('member','applicant')),
      entity_id TEXT NOT NULL,
      destination TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS publication_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      published_at TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      destination TEXT NOT NULL
    );
    INSERT OR IGNORE INTO planning_boards(id, status, updated_at) VALUES(1, 'draft', datetime('now'));
  `)
  migrateMembersPrimaryKey(db)
  ensureClubColumns(db)

  const mapClub = (row: any) => ({
    circleId: row.circle_id, name: row.name, dailyTarget: row.daily_target,
    promotionRatio: row.promotion_ratio, severeRatio: row.severe_ratio,
    inactiveDays: row.inactive_days, promotionEnabled: row.promotion_enabled !== 0,
    sourceUpdatedAt: row.source_updated_at, syncedAt: row.synced_at,
  })
  const mapMember = (row: any) => ({
    umaId: row.viewer_id, circleId: row.circle_id, ign: row.ign, lastUpdatedAt: row.last_updated_at,
    totalFans: row.total_fans, monthlyGain: row.monthly_gain, dailyAverage: row.daily_average,
    todayGain: row.today_gain, dailyGains: JSON.parse(row.daily_gains_json),
    band: row.decision_band, reason: row.decision_reason,
  })
  const mapApplicant = (row: any) => ({
    umaId: row.uma_id, ign: row.ign, targetClubId: row.target_club_id, status: row.status,
    privateNotes: row.private_notes, publishPublicly: Boolean(row.publish_publicly),
    currentClubId: row.current_club_id, currentClubName: row.current_club_name,
    lastUpdatedAt: row.last_updated_at, totalFans: row.total_fans, monthlyGain: row.monthly_gain,
    dailyAverage: row.daily_average, todayGain: row.today_gain,
    dailyGains: JSON.parse(row.daily_gains_json), createdAt: row.created_at, updatedAt: row.updated_at,
  })

  return {
    db,
    close: () => db.close(),
    getClubs: () => db.prepare('SELECT * FROM clubs ORDER BY sort_order, name').all().map(mapClub),
    getClub: (id: string) => {
      const row = db.prepare('SELECT * FROM clubs WHERE circle_id = ?').get(id)
      return row ? mapClub(row) : null
    },
    upsertClub(input: ClubInput) {
      db.prepare(`
        INSERT INTO clubs(circle_id,name,daily_target,promotion_ratio,severe_ratio,inactive_days,promotion_enabled,sort_order)
        VALUES(@circleId,@name,@dailyTarget,@promotionRatio,@severeRatio,@inactiveDays,@promotionEnabled,
          COALESCE((SELECT MAX(sort_order)+1 FROM clubs),0))
        ON CONFLICT(circle_id) DO UPDATE SET name=excluded.name,daily_target=excluded.daily_target,
          promotion_ratio=excluded.promotion_ratio,severe_ratio=excluded.severe_ratio,inactive_days=excluded.inactive_days,
          promotion_enabled=excluded.promotion_enabled
      `).run({ ...input, promotionEnabled: input.promotionEnabled ? 1 : 0 })
      return this.getClub(input.circleId)
    },
    deleteClub(id: string) {
      return db.prepare('DELETE FROM clubs WHERE circle_id = ?').run(id).changes > 0
    },
    getMembers: () => db.prepare('SELECT * FROM members ORDER BY circle_id, daily_average DESC').all().map(mapMember),
    replaceMembers(circleId: string, circle: { name: string; sourceUpdatedAt?: string | null }, members: any[]) {
      const now = new Date().toISOString()
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
      db.transaction(() => {
        db.prepare('UPDATE clubs SET name=?, source_updated_at=?, synced_at=? WHERE circle_id=?')
          .run(circle.name, circle.sourceUpdatedAt ?? null, now, circleId)
        db.prepare('DELETE FROM members WHERE circle_id=?').run(circleId)
        // Active membership is exclusive: Dirt's active roster takes ownership of a transferred trainer.
        const removeElsewhere = db.prepare('DELETE FROM members WHERE viewer_id=? AND circle_id!=?')
        const insert = db.prepare(`INSERT INTO members
          (viewer_id,circle_id,ign,last_updated_at,total_fans,monthly_gain,daily_average,today_gain,daily_gains_json,decision_band,decision_reason,synced_at)
          VALUES(@umaId,@circleId,@ign,@lastUpdatedAt,@totalFans,@monthlyGain,@dailyAverage,@todayGain,@dailyGainsJson,@band,@reason,@syncedAt)`)
        const snapshot = db.prepare(`INSERT INTO daily_snapshots
          (snapshot_date,captured_at,circle_id,viewer_id,ign,total_fans,monthly_gain,daily_average,today_gain,decision_band)
          VALUES(@date,@capturedAt,@circleId,@umaId,@ign,@totalFans,@monthlyGain,@dailyAverage,@todayGain,@band)
          ON CONFLICT(snapshot_date,circle_id,viewer_id) DO UPDATE SET captured_at=excluded.captured_at,
            ign=excluded.ign,total_fans=excluded.total_fans,monthly_gain=excluded.monthly_gain,
            daily_average=excluded.daily_average,today_gain=excluded.today_gain,decision_band=excluded.decision_band`)
        for (const member of members) {
          removeElsewhere.run(member.umaId, circleId)
          insert.run({ ...member, circleId, dailyGainsJson: JSON.stringify(member.dailyGains), syncedAt: now })
          snapshot.run({ ...member, circleId, date, capturedAt: now })
        }
      })()
    },
    getApplicants: () => db.prepare('SELECT * FROM applicants ORDER BY updated_at DESC').all().map(mapApplicant),
    getApplicant: (id: string) => {
      const row = db.prepare('SELECT * FROM applicants WHERE uma_id=?').get(id)
      return row ? mapApplicant(row) : null
    },
    upsertApplicant(input: ApplicantInput) {
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO applicants(uma_id,ign,target_club_id,status,private_notes,publish_publicly,created_at,updated_at)
        VALUES(@umaId,@ign,@targetClubId,@status,@privateNotes,@publishPublicly,@now,@now)
        ON CONFLICT(uma_id) DO UPDATE SET ign=excluded.ign,target_club_id=excluded.target_club_id,
          status=excluded.status,private_notes=excluded.private_notes,publish_publicly=excluded.publish_publicly,updated_at=excluded.updated_at`)
        .run({ ...input, publishPublicly: input.publishPublicly ? 1 : 0, now })
      return this.getApplicant(input.umaId)
    },
    updateApplicantPerformance(id: string, performance: any) {
      db.prepare(`UPDATE applicants SET ign=@ign,current_club_id=@currentClubId,current_club_name=@currentClubName,
        last_updated_at=@lastUpdatedAt,total_fans=@totalFans,monthly_gain=@monthlyGain,daily_average=@dailyAverage,
        today_gain=@todayGain,daily_gains_json=@dailyGainsJson,updated_at=@updatedAt WHERE uma_id=@id`)
        .run({ id, ...performance, dailyGainsJson: JSON.stringify(performance.dailyGains), updatedAt: new Date().toISOString() })
    },
    deleteApplicant: (id: string) => db.prepare('DELETE FROM applicants WHERE uma_id=?').run(id).changes > 0,
    getAssignments: () => db.prepare('SELECT entity_type AS entityType, entity_id AS entityId, destination, position, updated_at AS updatedAt FROM planning_assignments ORDER BY destination, position').all(),
    saveAssignments(assignments: Array<{ entityType: string; entityId: string; destination: string; position: number }>) {
      const now = new Date().toISOString()
      const unique = new Map<string, { entityType: string; entityId: string; destination: string; position: number }>()
      for (const item of assignments) unique.set(`${item.entityType}:${item.entityId}`, item)
      db.transaction(() => {
        db.prepare('DELETE FROM planning_assignments').run()
        const insert = db.prepare('INSERT INTO planning_assignments(entity_type,entity_id,destination,position,updated_at) VALUES(?,?,?,?,?)')
        for (const item of unique.values()) insert.run(item.entityType, item.entityId, item.destination, item.position, now)
        db.prepare("UPDATE planning_boards SET status='draft',updated_at=?,confirmed_at=NULL WHERE id=1").run(now)
      })()
    },
    confirmPlan() {
      const now = new Date().toISOString()
      db.prepare("UPDATE planning_boards SET status='confirmed',updated_at=?,confirmed_at=? WHERE id=1").run(now, now)
      return db.prepare('SELECT * FROM planning_boards WHERE id=1').get()
    },
    getBoard: () => db.prepare('SELECT * FROM planning_boards WHERE id=1').get(),
    addPublication(hash: string, destination: string) {
      db.prepare('INSERT INTO publication_history(published_at,payload_hash,destination) VALUES(?,?,?)')
        .run(new Date().toISOString(), hash, destination)
    },
    getPublications: () => db.prepare('SELECT * FROM publication_history ORDER BY id DESC LIMIT 20').all(),
  }
}

export type Store = ReturnType<typeof createStore>
