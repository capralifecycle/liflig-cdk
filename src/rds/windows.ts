const DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
type DayName = (typeof DAY_NAMES)[number]

const MIN_WINDOW_MINUTES = 30

const MAINTENANCE_WINDOW_EXAMPLE = "sun:03:00-sun:04:00"
const BACKUP_WINDOW_EXAMPLE = "01:00-02:00"

// Case-insensitive: AWS accepts "Thu:03:00-Thu:04:00" and "thu:03:00-thu:04:00".
const MAINTENANCE_WINDOW_REGEX =
  /^(mon|tue|wed|thu|fri|sat|sun):(\d{2}):(\d{2})-(mon|tue|wed|thu|fri|sat|sun):(\d{2}):(\d{2})$/i

const BACKUP_WINDOW_REGEX = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/

export interface ParsedMaintenanceWindow {
  readonly raw: string
  readonly startMinuteOfWeek: number
  readonly endMinuteOfWeek: number
}

export interface ParsedBackupWindow {
  readonly raw: string
  readonly startMinuteOfDay: number
  readonly endMinuteOfDay: number
}

export function parseMaintenanceWindow(raw: string): ParsedMaintenanceWindow {
  const match = MAINTENANCE_WINDOW_REGEX.exec(raw)
  if (!match) {
    throw new Error(
      `Invalid preferredMaintenanceWindow "${raw}". ` +
        `Expected format ddd:hh:mm-ddd:hh:mm (UTC), e.g. "${MAINTENANCE_WINDOW_EXAMPLE}". ` +
        `Valid day abbreviations: ${DAY_NAMES.join(", ")}.`,
    )
  }

  const [
    ,
    startDay,
    startHourRaw,
    startMinuteRaw,
    endDay,
    endHourRaw,
    endMinuteRaw,
  ] = match
  const startHour = Number(startHourRaw)
  const startMinute = Number(startMinuteRaw)
  const endHour = Number(endHourRaw)
  const endMinute = Number(endMinuteRaw)

  assertHour(startHour, "preferredMaintenanceWindow", raw)
  assertMinute(startMinute, "preferredMaintenanceWindow", raw)
  assertHour(endHour, "preferredMaintenanceWindow", raw)
  assertMinute(endMinute, "preferredMaintenanceWindow", raw)

  const startMinuteOfWeek =
    dayIndex(startDay.toLowerCase() as DayName) * 24 * 60 +
    startHour * 60 +
    startMinute
  const endMinuteOfWeek =
    dayIndex(endDay.toLowerCase() as DayName) * 24 * 60 +
    endHour * 60 +
    endMinute

  if (startMinuteOfWeek === endMinuteOfWeek) {
    throw new Error(
      `Invalid preferredMaintenanceWindow "${raw}": ` +
        `start and end are equal. Window must be at least ${MIN_WINDOW_MINUTES} minutes. ` +
        `Example: "${MAINTENANCE_WINDOW_EXAMPLE}".`,
    )
  }

  if (
    endMinuteOfWeek > startMinuteOfWeek &&
    endMinuteOfWeek - startMinuteOfWeek < MIN_WINDOW_MINUTES
  ) {
    throw new Error(
      `Invalid preferredMaintenanceWindow "${raw}": ` +
        `window is ${endMinuteOfWeek - startMinuteOfWeek} minutes, minimum is ${MIN_WINDOW_MINUTES}. ` +
        `Example: "${MAINTENANCE_WINDOW_EXAMPLE}".`,
    )
  }

  return { raw, startMinuteOfWeek, endMinuteOfWeek }
}

export function parseBackupWindow(raw: string): ParsedBackupWindow {
  const match = BACKUP_WINDOW_REGEX.exec(raw)
  if (!match) {
    throw new Error(
      `Invalid preferredBackupWindow "${raw}". ` +
        `Expected format hh:mm-hh:mm (UTC), e.g. "${BACKUP_WINDOW_EXAMPLE}".`,
    )
  }

  const [, startHourRaw, startMinuteRaw, endHourRaw, endMinuteRaw] = match
  const startHour = Number(startHourRaw)
  const startMinute = Number(startMinuteRaw)
  const endHour = Number(endHourRaw)
  const endMinute = Number(endMinuteRaw)

  assertHour(startHour, "preferredBackupWindow", raw)
  assertMinute(startMinute, "preferredBackupWindow", raw)
  assertHour(endHour, "preferredBackupWindow", raw)
  assertMinute(endMinute, "preferredBackupWindow", raw)

  const startMinuteOfDay = startHour * 60 + startMinute
  const endMinuteOfDay = endHour * 60 + endMinute

  if (startMinuteOfDay === endMinuteOfDay) {
    throw new Error(
      `Invalid preferredBackupWindow "${raw}": ` +
        `start and end are equal. Window must be at least ${MIN_WINDOW_MINUTES} minutes. ` +
        `Example: "${BACKUP_WINDOW_EXAMPLE}".`,
    )
  }

  if (
    endMinuteOfDay > startMinuteOfDay &&
    endMinuteOfDay - startMinuteOfDay < MIN_WINDOW_MINUTES
  ) {
    throw new Error(
      `Invalid preferredBackupWindow "${raw}": ` +
        `window is ${endMinuteOfDay - startMinuteOfDay} minutes, minimum is ${MIN_WINDOW_MINUTES}. ` +
        `Example: "${BACKUP_WINDOW_EXAMPLE}".`,
    )
  }

  return { raw, startMinuteOfDay, endMinuteOfDay }
}

/**
 * Checks whether the backup and maintenance windows intersect.
 *
 * Only considers forward-ordered windows (where end > start). For ambiguous
 * inputs where end <= start, we defer to AWS's own validation at deploy time
 * rather than guess whether a wraparound was intended.
 */
export function overlaps(
  mw: ParsedMaintenanceWindow,
  bw: ParsedBackupWindow,
): boolean {
  if (mw.endMinuteOfWeek <= mw.startMinuteOfWeek) return false
  if (bw.endMinuteOfDay <= bw.startMinuteOfDay) return false

  const minutesPerDay = 24 * 60
  for (let day = 0; day < 7; day++) {
    const dayBackupStart = day * minutesPerDay + bw.startMinuteOfDay
    const dayBackupEnd = day * minutesPerDay + bw.endMinuteOfDay
    if (
      dayBackupStart < mw.endMinuteOfWeek &&
      dayBackupEnd > mw.startMinuteOfWeek
    ) {
      return true
    }
  }
  return false
}

function dayIndex(day: DayName): number {
  return DAY_NAMES.indexOf(day)
}

function assertHour(hour: number, propName: string, raw: string): void {
  if (hour > 23) {
    throw new Error(
      `Invalid ${propName} "${raw}": hour must be 0-23 (got ${hour}).`,
    )
  }
}

function assertMinute(minute: number, propName: string, raw: string): void {
  if (minute > 59) {
    throw new Error(
      `Invalid ${propName} "${raw}": minute must be 0-59 (got ${minute}).`,
    )
  }
}
