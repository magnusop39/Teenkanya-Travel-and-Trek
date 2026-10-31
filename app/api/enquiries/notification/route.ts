import { updateEnquiryNotificationStatus, verifyEnquiryNotificationToken } from '@/lib/enquiries/server'
import { maxEnquiryRequestBodyBytes, readRequestBodyBounded } from '@/lib/enquiries/request-body'

export const runtime = 'nodejs'
export const maxDuration = 10

function respond(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRequestOrigin(request: Request) {
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    ?? request.headers.get('host')?.split(',')[0]?.trim()

  if (protocol && host) {
    try {
      return new URL(`${protocol}://${host}`).origin
    } catch {
      return new URL(request.url).origin
    }
  }

  return new URL(request.url).origin
}

export async function PATCH(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return respond({ error: 'invalid_origin' }, 403)

  try {
    if (new URL(origin).origin !== getRequestOrigin(request)) {
      return respond({ error: 'invalid_origin' }, 403)
    }
  } catch {
    return respond({ error: 'invalid_origin' }, 403)
  }

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return respond({ error: 'unsupported_media_type' }, 415)
  }

  const bodyResult = await readRequestBodyBounded(request, maxEnquiryRequestBodyBytes)
  if (!bodyResult.ok) {
    return respond({ error: bodyResult.reason === 'too_large' ? 'payload_too_large' : 'invalid_body' }, 400)
  }

  let payload: unknown
  try {
    payload = JSON.parse(bodyResult.text)
  } catch {
    return respond({ error: 'invalid_json' }, 400)
  }

  if (!isRecord(payload)) return respond({ error: 'invalid_notification_update' }, 422)

  const { submissionId, reference, status, token } = payload
  if (
    typeof submissionId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(submissionId)
    || typeof reference !== 'string'
    || !/^TTT-\d{6}-[A-F0-9]{16}$/u.test(reference)
    || (status !== 'sent' && status !== 'failed')
    || typeof token !== 'string'
    || token.length > 160
  ) {
    return respond({ error: 'invalid_notification_update' }, 422)
  }

  try {
    if (!verifyEnquiryNotificationToken(token, submissionId, reference)) {
      return respond({ error: 'invalid_notification_token' }, 403)
    }

    await updateEnquiryNotificationStatus(submissionId, reference, status)
    return respond({ status }, 200)
  } catch {
    console.error('[api/enquiries/notification] Unable to update notification status')
    return respond({ error: 'notification_status_unavailable' }, 503)
  }
}
