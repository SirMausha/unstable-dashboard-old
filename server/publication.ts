import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Store } from './db.js'

const forbiddenField = /discord|token|secret|password|private|notes?|database|localPath/i

export function assertPublicPayload(value: unknown, location = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertPublicPayload(child, `${location}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenField.test(key)) throw new Error(`Forbidden public field: ${location}.${key}`)
    assertPublicPayload(child, `${location}.${key}`)
  }
}

export function buildPublicInput(store: Store) {
  const payload = {
    schemaVersion: 1 as const,
    clubs: store.getClubs().map((club: any) => ({
      circleId: club.circleId,
      name: club.name,
      dailyTarget: club.dailyTarget,
      promotionRatio: club.promotionRatio,
      severeRatio: club.severeRatio,
      inactiveDays: club.inactiveDays,
      promotionEnabled: club.promotionEnabled !== false,
    })),
    applicants: store.getApplicants()
      .filter((applicant: any) => applicant.publishPublicly)
      .map((applicant: any) => ({
        umaId: applicant.umaId,
        ign: applicant.ign,
        targetClubId: applicant.targetClubId,
        status: applicant.status,
        publishPublicly: true as const,
      })),
  }
  assertPublicPayload(payload)
  return payload
}

export function validateAssignments(
  assignments: Array<{ entityType: string; entityId: string; destination: string; position: number }>,
  clubIds: string[],
) {
  const errors: string[] = []
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const item of assignments) {
    const key = `${item.entityType}:${item.entityId}`
    if (seen.has(key)) errors.push(`Duplicate assignment for ${key}.`)
    seen.add(key)
    if (clubIds.includes(item.destination)) {
      counts.set(item.destination, (counts.get(item.destination) || 0) + 1)
    } else if (!['waitlist', 'kick', 'unassigned', 'applicants'].includes(item.destination)) {
      errors.push(`Unknown destination ${item.destination}.`)
    }
  }
  for (const [clubId, count] of counts) {
    if (count > 30) errors.push(`Club ${clubId} has ${count} assignments; capacity is 30.`)
  }
  return errors
}

export async function writeLocalPublicInput(payload: unknown) {
  assertPublicPayload(payload)
  const destination = path.resolve(process.env.PUBLIC_INPUT_PATH || 'public-data/input.json')
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return destination
}

export async function publishToGitHub(payload: unknown) {
  assertPublicPayload(payload)
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  const filePath = process.env.GITHUB_PUBLIC_INPUT_PATH || 'public-data/input.json'
  if (!token || !owner || !repo) return null

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'uma-club-dashboard',
  }
  const current = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers })
  let sha: string | undefined
  if (current.ok) sha = (await current.json() as { sha?: string }).sha
  else if (current.status !== 404) throw new Error(`GitHub read failed with ${current.status}.`)

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update sanitized dashboard data',
      content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`).toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!response.ok) throw new Error(`GitHub publication failed with ${response.status}.`)
  return `github:${owner}/${repo}@${branch}`
}

export async function previousInput() {
  try {
    return JSON.parse(await readFile(path.resolve(process.env.PUBLIC_INPUT_PATH || 'public-data/input.json'), 'utf8'))
  } catch {
    return null
  }
}

export function payloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
