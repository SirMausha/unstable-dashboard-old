import Database from 'better-sqlite3'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const source = path.resolve(process.env.DATABASE_PATH || 'data/dashboard.sqlite')
const backupDirectory = path.resolve(process.env.BACKUP_DIRECTORY || 'backups')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const destination = path.join(backupDirectory, `dashboard-${stamp}.sqlite`)

await mkdir(backupDirectory, { recursive: true })
const database = new Database(source, { readonly: true, fileMustExist: true })

try {
  await database.backup(destination)
} finally {
  database.close()
}

const restored = new Database(destination, { readonly: true, fileMustExist: true })
try {
  const integrity = restored.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${String(integrity)}`)
  restored.prepare('SELECT 1 FROM clubs LIMIT 1').get()
  console.log(`Backup written and verified at ${destination}`)
} finally {
  restored.close()
}
