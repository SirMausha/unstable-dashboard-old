import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redirect, safeReturnTo, sendError, siteUrl } from '../_lib/auth.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' })
    const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim()
    if (!clientId) throw new Error('DISCORD_CLIENT_ID is not configured.')
    const returnTo = safeReturnTo(request.query.returnTo, '/tourney')
    const redirectUri = `${siteUrl(request)}/api/auth/callback`
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify',
      state: returnTo,
    })
    if (request.query.force === '1') params.set('prompt', 'consent')
    redirect(response, `https://discord.com/api/oauth2/authorize?${params}`)
  } catch (error) {
    return sendError(response, error)
  }
}
