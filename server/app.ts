import express from 'express'
import { z } from 'zod'
import type { Store } from './db.js'
import { UmaClient } from './uma.js'
import {
  buildPublicInput,
  payloadHash,
  previousInput,
  publishToGitHub,
  validateAssignments,
  writeLocalPublicInput,
} from './publication.js'

const clubSchema = z.object({
  circleId: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(100),
  dailyTarget: z.coerce.number().int().min(0),
  promotionRatio: z.coerce.number().min(1).max(10).default(1.25),
  severeRatio: z.coerce.number().min(0).max(1).default(0.5),
  inactiveDays: z.coerce.number().int().min(1).max(60).default(3),
  promotionEnabled: z.boolean().default(true),
})
const applicantSchema = z.object({
  umaId: z.string().trim().regex(/^\d+$/, 'Uma ID must contain only digits.'),
  ign: z.string().trim().min(1).max(100).default('Resolving…'),
  targetClubId: z.string().trim().min(1),
  status: z.enum(['pending', 'approved', 'waitlisted', 'rejected']).default('pending'),
  privateNotes: z.string().max(4000).default(''),
  publishPublicly: z.boolean().default(true),
})
const assignmentsSchema = z.object({
  assignments: z.array(z.object({
    entityType: z.enum(['member', 'applicant']),
    entityId: z.string().min(1),
    destination: z.string().min(1),
    position: z.number().int().min(0),
  })).max(500),
})

export function createApp(store: Store, uma = new UmaClient()) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb' }))

  const state = () => ({
    clubs: store.getClubs(),
    members: store.getMembers(),
    applicants: store.getApplicants(),
    assignments: store.getAssignments(),
    board: store.getBoard(),
    publications: store.getPublications(),
  })

  app.get('/api/health', (_request, response) => response.json({ ok: true, localOnly: true }))
  app.get('/api/state', (_request, response) => response.json(state()))

  app.post('/api/clubs', (request, response) => {
    const input = clubSchema.parse(request.body)
    response.status(201).json(store.upsertClub(input))
  })
  app.put('/api/clubs/:circleId', (request, response) => {
    const input = clubSchema.parse({ ...request.body, circleId: request.params.circleId })
    response.json(store.upsertClub(input))
  })
  app.delete('/api/clubs/:circleId', (request, response) => {
    response.status(store.deleteClub(request.params.circleId) ? 204 : 404).end()
  })

  app.post('/api/applicants', async (request, response) => {
    const input = applicantSchema.parse(request.body)
    if (!store.getClub(input.targetClubId)) return response.status(400).json({ error: 'Target club does not exist.' })
    const resolved = await uma.resolveApplicant(input.umaId)
    store.upsertApplicant({ ...input, ign: resolved.ign })
    store.updateApplicantPerformance(input.umaId, resolved)
    response.status(201).json(store.getApplicant(input.umaId))
  })
  app.put('/api/applicants/:umaId', async (request, response) => {
    const current = store.getApplicant(request.params.umaId)
    if (!current) return response.status(404).json({ error: 'Applicant not found.' })
    const input = applicantSchema.parse({ ...current, ...request.body, umaId: request.params.umaId })
    store.upsertApplicant(input)
    response.json(store.getApplicant(input.umaId))
  })
  app.delete('/api/applicants/:umaId', (request, response) => {
    response.status(store.deleteApplicant(request.params.umaId) ? 204 : 404).end()
  })

  app.post('/api/sync', async (_request, response) => {
    const errors: Array<{ id: string; error: string }> = []
    uma.clearCache()
    for (const club of store.getClubs() as any[]) {
      try {
        const result = await uma.resolveClub(club)
        store.replaceMembers(club.circleId, result.circle, result.members)
      } catch (error) {
        errors.push({ id: club.circleId, error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }
    for (const applicant of store.getApplicants() as any[]) {
      try {
        store.updateApplicantPerformance(applicant.umaId, await uma.resolveApplicant(applicant.umaId))
      } catch (error) {
        errors.push({ id: applicant.umaId, error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }
    response.status(errors.length ? 207 : 200).json({ ...state(), syncErrors: errors })
  })

  app.put('/api/planning', (request, response) => {
    const { assignments } = assignmentsSchema.parse(request.body)
    const errors = validateAssignments(assignments, (store.getClubs() as any[]).map((club) => club.circleId))
    if (errors.length) return response.status(400).json({ error: errors.join(' ') })
    store.saveAssignments(assignments)
    response.json({ assignments: store.getAssignments(), board: store.getBoard() })
  })
  app.post('/api/planning/confirm', (_request, response) => {
    const errors = validateAssignments(store.getAssignments() as any[], (store.getClubs() as any[]).map((club) => club.circleId))
    if (errors.length) return response.status(400).json({ error: errors.join(' ') })
    response.json(store.confirmPlan())
  })

  app.get('/api/publication/preview', async (_request, response) => {
    response.json({ previous: await previousInput(), next: buildPublicInput(store) })
  })
  app.post('/api/publication/publish', async (_request, response) => {
    const payload = buildPublicInput(store)
    const localPath = await writeLocalPublicInput(payload)
    const remote = await publishToGitHub(payload)
    const destination = remote || `local:${localPath}`
    store.addPublication(payloadHash(payload), destination)
    response.json({ ok: true, destination, payload })
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: error.issues.map((issue) => issue.message).join(' ') })
    }
    console.error(error)
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected server error.' })
  })
  return app
}
