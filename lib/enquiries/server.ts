import 'server-only'

import { createHmac, randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createNotificationToken, verifyNotificationToken } from './notification-token'
import { persistIfNew, type EnquiryNotificationStatus, type EnquiryPersistenceResult } from './submission-workflow'
import type { ValidatedEnquiry } from './validation'

interface EnquiryForStorage extends ValidatedEnquiry {
  sourcePage: string
}

interface EnquiryRow {
  id: string
  submission_id: string
  reference: string
  full_name: string
  email: string | null
  phone: string | null
  country_of_residence: string | null
  preferred_contact_channel: ValidatedEnquiry['preferredContactChannel']
  interest: ValidatedEnquiry['interest']
  message: string
  travel_start_date: string | null
  dates_flexible: boolean
  traveller_count: number | null
  source_page: string | null
  notification_status: EnquiryNotificationStatus
}

const enquiryColumns = 'id,submission_id,reference,full_name,email,phone,country_of_residence,preferred_contact_channel,interest,message,travel_start_date,dates_flexible,traveller_count,source_page,notification_status'

let cachedClient: SupabaseClient | null = null
let cachedSecret: string | null = null

function getSupabaseConnection() {
  if (cachedClient && cachedSecret) return { client: cachedClient, secret: cachedSecret }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !secret) throw new Error('Supabase server credentials are not configured')

  const timedFetch: typeof fetch = (input, init) => {
    const timeoutSignal = AbortSignal.timeout(2_000)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    return fetch(input, { ...init, signal })
  }

  cachedClient = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { fetch: timedFetch },
  })
  cachedSecret = secret

  return { client: cachedClient, secret }
}

function createReference() {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/gu, '')
  return `TTT-${datePart}-${randomBytes(8).toString('hex').toUpperCase()}`
}

function toPersistedEnquiry(row: EnquiryRow) {
  return {
    status: 'saved' as const,
    reference: row.reference,
    notificationStatus: row.notification_status,
  }
}

async function findExistingEnquiry(client: SupabaseClient, submissionId: string) {
  const { data, error } = await client
    .from('enquiries')
    .select(enquiryColumns)
    .eq('submission_id', submissionId)
    .maybeSingle()

  if (error) throw new Error('Existing enquiry could not be retrieved')
  return data as EnquiryRow | null
}

export async function saveEnquiry(
  enquiry: EnquiryForStorage,
  clientIdentifier: string,
): Promise<EnquiryPersistenceResult> {
  const { client, secret } = getSupabaseConnection()
  const keyHash = createHmac('sha256', secret).update(clientIdentifier).digest('hex')

  const result = await persistIfNew({
    findExisting: async () => {
      const existing = await findExistingEnquiry(client, enquiry.submissionId)
      return existing ? toPersistedEnquiry(existing) : null
    },
    consumeRateLimit: async () => {
      const { data: allowed, error } = await client.rpc('consume_enquiry_rate_limit', {
        p_key_hash: keyHash,
        p_limit: 5,
        p_window_seconds: 900,
      })

      if (error) throw new Error('Enquiry rate limit could not be checked')
      return allowed === true
    },
    create: async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const reference = createReference()
        const { data, error } = await client
          .from('enquiries')
          .insert({
            submission_id: enquiry.submissionId,
            reference,
            full_name: enquiry.fullName,
            email: enquiry.email,
            phone: enquiry.phone,
            country_of_residence: enquiry.countryOfResidence,
            preferred_contact_channel: enquiry.preferredContactChannel,
            interest: enquiry.interest,
            message: enquiry.message,
            travel_start_date: enquiry.travelStartDate,
            dates_flexible: enquiry.datesFlexible,
            traveller_count: enquiry.travellerCount,
            source_page: enquiry.sourcePage,
            notification_status: process.env.WEB3FORMS_ACCESS_KEY?.trim() ? 'pending' : 'not_configured',
          })
          .select(enquiryColumns)
          .single()

        if (!error && data) return { value: toPersistedEnquiry(data as EnquiryRow) }

        if (error?.code === '23505') {
          const existing = await findExistingEnquiry(client, enquiry.submissionId)
          if (existing) return { value: toPersistedEnquiry(existing), duplicate: true }
          continue
        }

        throw new Error('Enquiry could not be saved')
      }

      throw new Error('Enquiry reference could not be generated')
    },
  })

  if (result.status === 'rate_limited') return result
  return { ...result.value, duplicate: result.duplicate }
}

export function createEnquiryNotificationToken(submissionId: string, reference: string) {
  const { secret } = getSupabaseConnection()
  return createNotificationToken(submissionId, reference, secret)
}

export function verifyEnquiryNotificationToken(
  token: string,
  submissionId: string,
  reference: string,
) {
  const { secret } = getSupabaseConnection()
  return verifyNotificationToken(token, submissionId, reference, secret)
}

export async function updateEnquiryNotificationStatus(
  submissionId: string,
  reference: string,
  status: 'sent' | 'failed',
) {
  const { client } = getSupabaseConnection()
  const { data, error } = await client
    .from('enquiries')
    .update({ notification_status: status, updated_at: new Date().toISOString() })
    .eq('submission_id', submissionId)
    .eq('reference', reference)
    .in('notification_status', ['pending', 'failed'])
    .select('id')
    .maybeSingle()

  if (error) throw new Error('Enquiry notification status could not be updated')
  if (data) return

  const { data: existing, error: lookupError } = await client
    .from('enquiries')
    .select('notification_status')
    .eq('submission_id', submissionId)
    .eq('reference', reference)
    .maybeSingle()

  if (lookupError || existing?.notification_status !== status) {
    throw new Error('Enquiry notification status could not be updated')
  }
}
