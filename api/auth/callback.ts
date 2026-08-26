import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  createSessionToken,
  findManager,
  redirect,
  safeReturnTo,
  setSessionCookie,
  siteUrl,
  type SessionUser,
} from '../_lib/auth.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' })
    const code = String(request.query.code || '')
    if (!code) throw new Error('Missing Discord OAuth code.')
    const returnTo = safeReturnTo(request.query.state, '/tourney')

    const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim()
    const clientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim()
    if (!clientId || !clientSecret) throw new Error('Discord OAuth is not configured.')

    const redirectUri = `${siteUrl(request)}/api/auth/callback`
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })
    if (!tokenResponse.ok) throw new Error('Discord token exchange failed.')
    const token = await tokenResponse.json() as { access_token: string }

    const meResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    if (!meResponse.ok) throw new Error('Could not load Discord profile.')
    const me = await meResponse.json() as {
      id: string
      username: string
      global_name?: string | null
      avatar?: string | null
    }

    const manager = findManager(me.id)
    const wantsStaff = returnTo.startsWith('/staff')
    if (wantsStaff && !manager) {
      redirect(response, '/staff?error=unauthorized')
      return
    }

    const user: SessionUser = {
      discordId: me.id,
      username: me.username,
      globalName: me.global_name ?? null,
      avatar: me.avatar ?? null,
      clubIds: manager ? manager.clubIds.map(String) : [],
      label: manager?.label || null,
      isManager: Boolean(manager),
    }
    setSessionCookie(response, await createSessionToken(user))
    redirect(response, returnTo)
  } catch (error) {
    console.error(error)
    const returnTo = safeReturnTo(request.query.state, '/tourney')
    const fail = returnTo.startsWith('/staff') ? '/staff?error=login_failed' : '/tourney?error=login_failed'
    redirect(response, fail)
  }
}
