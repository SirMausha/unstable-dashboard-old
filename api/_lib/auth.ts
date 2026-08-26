import type { VercelRequest, VercelResponse } from '@vercel/node'
import { parseCookie, stringifySetCookie } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

export type ManagerAccess = {
  discordId: string
  label?: string
  clubIds: string[]
}

export type SessionUser = {
  discordId: string
  username: string
  globalName: string | null
  avatar: string | null
  clubIds: string[]
  label: string | null
  isManager: boolean
}

const SESSION_COOKIE = 'dustbunny_session'

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

export function siteUrl(request: VercelRequest) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/$/, '')
  if (configured) return configured
  const host = request.headers['x-forwarded-host'] || request.headers.host
  const proto = request.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}

export function readAccess(): ManagerAccess[] {
  const file = path.join(process.cwd(), 'config', 'access.json')
  const payload = JSON.parse(readFileSync(file, 'utf8')) as { managers: ManagerAccess[] }
  return payload.managers
}

export function findManager(discordId: string) {
  return readAccess().find((manager) => manager.discordId === String(discordId)) || null
}

async function sessionSecret() {
  return new TextEncoder().encode(requireEnv('SESSION_SECRET'))
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({
    discordId: user.discordId,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    clubIds: user.clubIds,
    label: user.label,
    isManager: user.isManager,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('14d')
    .sign(await sessionSecret())
}

export async function readSession(request: VercelRequest): Promise<SessionUser | null> {
  const cookies = parseCookie(request.headers.cookie || '')
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, await sessionSecret())
    const discordId = String(payload.discordId || '')
    if (!discordId) return null
    const manager = findManager(discordId)
    return {
      discordId,
      username: String(payload.username || ''),
      globalName: payload.globalName == null ? null : String(payload.globalName),
      avatar: payload.avatar == null ? null : String(payload.avatar),
      clubIds: manager ? manager.clubIds.map(String) : [],
      label: manager?.label || null,
      isManager: Boolean(manager),
    }
  } catch {
    return null
  }
}

export function setSessionCookie(response: VercelResponse, token: string) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)
  response.setHeader(
    'Set-Cookie',
    stringifySetCookie({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 14,
    }),
  )
}

export function clearSessionCookie(response: VercelResponse) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)
  response.setHeader(
    'Set-Cookie',
    stringifySetCookie({
      name: SESSION_COOKIE,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 0,
    }),
  )
}

export function safeReturnTo(value: unknown, fallback = '/tourney') {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) return fallback
  if (raw.startsWith('/staff') || raw.startsWith('/tourney')) return raw
  return fallback
}

export function redirect(response: VercelResponse, location: string) {
  response.statusCode = 302
  response.setHeader('Location', location)
  response.end()
}

export async function requireUser(request: VercelRequest, response: VercelResponse) {
  const user = await readSession(request)
  if (!user) {
    response.status(401).json({ error: 'Discord login required.' })
    return null
  }
  return user
}

export async function requireManager(request: VercelRequest, response: VercelResponse) {
  const user = await readSession(request)
  if (!user?.isManager) {
    response.status(401).json({ error: 'Discord manager login required.' })
    return null
  }
  return user
}

export function sendError(response: VercelResponse, error: unknown, fallback = 'Unexpected server error.') {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: error.issues.map((issue) => issue.message).join(' ') })
  }
  const message = error instanceof Error ? error.message : fallback
  console.error(error)
  return response.status(500).json({ error: message || fallback })
}
