import { createHmac, timingSafeEqual } from 'node:crypto'

const tokenLifetimeMs = 30 * 60 * 1000

function signatureFor(submissionId: string, reference: string, expiresAt: number, secret: string) {
  return createHmac('sha256', secret)
    .update(`${submissionId}.${reference}.${expiresAt}`)
    .digest('base64url')
}

export function createNotificationToken(
  submissionId: string,
  reference: string,
  secret: string,
  now = Date.now(),
) {
  const expiresAt = now + tokenLifetimeMs
  return `${expiresAt}.${signatureFor(submissionId, reference, expiresAt, secret)}`
}

export function verifyNotificationToken(
  token: string,
  submissionId: string,
  reference: string,
  secret: string,
  now = Date.now(),
) {
  const [expiryText, providedSignature, extra] = token.split('.')
  const expiresAt = Number(expiryText)

  if (
    extra !== undefined
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || expiresAt > now + tokenLifetimeMs
    || !providedSignature
  ) {
    return false
  }

  const expectedSignature = signatureFor(submissionId, reference, expiresAt, secret)
  const expected = Buffer.from(expectedSignature, 'base64url')
  const provided = Buffer.from(providedSignature, 'base64url')

  return expected.length === provided.length && timingSafeEqual(expected, provided)
}
