export type HistoryMonth = {
  year: number
  month: number
  circleId: string
  circleName: string
}

export type ClubStint = {
  circleId: string
  circleName: string
  startYear: number
  startMonth: number
  endYear: number
  endMonth: number
  monthCount: number
}

function monthIndex(year: number, month: number) {
  return year * 12 + (month - 1)
}

function fromIndex(index: number) {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

export function bunnyHistoryStints(
  history: Array<{ year?: number; month?: number; circle_id?: string | number | null; circle_name?: string | null }>,
  bunnyIds: Set<string>,
): { uniqueMonths: number; first: HistoryMonth | null; last: HistoryMonth | null; stints: ClubStint[] } {
  const byMonth = new Map<number, HistoryMonth>()
  for (const row of history) {
    const circleId = row.circle_id == null ? '' : String(row.circle_id)
    if (!circleId || !bunnyIds.has(circleId)) continue
    const year = Number(row.year)
    const month = Number(row.month)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue
    byMonth.set(monthIndex(year, month), {
      year,
      month,
      circleId,
      circleName: String(row.circle_name || ''),
    })
  }
  const months = [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value)
  if (!months.length) {
    return { uniqueMonths: 0, first: null, last: null, stints: [] }
  }

  const stints: ClubStint[] = []
  let current: ClubStint | null = null
  let previousIndex = -2
  for (const item of months) {
    const index = monthIndex(item.year, item.month)
    const contiguous = index === previousIndex + 1
    if (current && contiguous && current.circleId === item.circleId) {
      current.endYear = item.year
      current.endMonth = item.month
      current.monthCount += 1
    } else {
      current = {
        circleId: item.circleId,
        circleName: item.circleName,
        startYear: item.year,
        startMonth: item.month,
        endYear: item.year,
        endMonth: item.month,
        monthCount: 1,
      }
      stints.push(current)
    }
    previousIndex = index
  }

  return {
    uniqueMonths: months.length,
    first: months[0],
    last: months[months.length - 1],
    stints,
  }
}

export function formatMonth(year: number, month: number) {
  return `${fromIndex(monthIndex(year, month)).year}-${String(month).padStart(2, '0')}`
}
