import { validateEnquiry, type ValidatedEnquiry } from './validation.ts'

export type EnquiryNotificationStatus = 'not_configured' | 'pending' | 'sent' | 'failed'

export interface PersistedEnquiry {
  status: 'saved'
  reference: string
  notificationStatus: EnquiryNotificationStatus
  duplicate: boolean
}

export type EnquiryPersistenceResult =
  | { status: 'rate_limited' }
  | PersistedEnquiry

export type SubmissionOutcome =
  | { status: 'invalid'; fieldErrors: Record<string, string> }
  | { status: 'rate_limited' }
  | { status: 'client_identifier_unavailable' }
  | {
      status: 'saved'
      reference: string
      notificationStatus: EnquiryNotificationStatus
      duplicate: boolean
    }

export interface IdempotentPersistenceDependencies<T> {
  findExisting: () => Promise<T | null>
  consumeRateLimit: () => Promise<boolean>
  create: () => Promise<{ value: T; duplicate?: boolean }>
}

export async function persistIfNew<T>(
  dependencies: IdempotentPersistenceDependencies<T>,
): Promise<{ status: 'rate_limited' } | { status: 'saved'; value: T; duplicate: boolean }> {
  const existing = await dependencies.findExisting()
  if (existing) return { status: 'saved', value: existing, duplicate: true }

  if (!(await dependencies.consumeRateLimit())) return { status: 'rate_limited' }

  const created = await dependencies.create()
  return { status: 'saved', value: created.value, duplicate: created.duplicate ?? false }
}

export interface SubmissionDependencies {
  persist: (
    enquiry: ValidatedEnquiry & { sourcePage: string },
    clientIdentifier: string,
  ) => Promise<EnquiryPersistenceResult>
}

export async function processEnquirySubmission(
  input: unknown,
  clientIdentifier: string | null,
  sourcePage: string,
  dependencies: SubmissionDependencies,
): Promise<SubmissionOutcome> {
  const validation = validateEnquiry(input)
  if (!validation.success) {
    return { status: 'invalid', fieldErrors: validation.fieldErrors }
  }

  if (!clientIdentifier) return { status: 'client_identifier_unavailable' }

  const persisted = await dependencies.persist(
    { ...validation.value, sourcePage },
    clientIdentifier,
  )

  if (persisted.status === 'rate_limited') return persisted

  return {
    status: 'saved',
    reference: persisted.reference,
    notificationStatus: persisted.notificationStatus,
    duplicate: persisted.duplicate,
  }
}
