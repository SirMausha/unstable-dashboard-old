import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clearSessionCookie, readSession, sendError } from '../_lib/auth.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method === 'GET') {
      const user = await readSession(request)
      if (!user) return response.json({ authenticated: false })
      return response.json({ authenticated: true, user })
    }

    if (request.method === 'POST' || request.method === 'DELETE') {
      clearSessionCookie(response)
      return response.json({ ok: true })
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
