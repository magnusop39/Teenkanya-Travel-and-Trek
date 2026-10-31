import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotificationToken, verifyNotificationToken } from '../lib/enquiries/notification-token.ts'

const submissionId = 'fb84a221-11f8-4bc1-b57e-0e37f45f4458'
const reference = 'TTT-270101-0123456789ABCDEF'
const secret = 'synthetic-server-secret'
const now = 1_800_000_000_000

test('notification update token is bound to one submission and reference', () => {
  const token = createNotificationToken(submissionId, reference, secret, now)

  assert.equal(verifyNotificationToken(token, submissionId, reference, secret, now), true)
  assert.equal(verifyNotificationToken(token, submissionId, 'TTT-270101-0000000000000000', secret, now), false)
  assert.equal(verifyNotificationToken(token, '00000000-0000-4000-8000-000000000000', reference, secret, now), false)
  assert.equal(verifyNotificationToken(token, submissionId, reference, 'different-secret', now), false)
})

test('expired and malformed notification tokens are rejected', () => {
  const token = createNotificationToken(submissionId, reference, secret, now)

  assert.equal(verifyNotificationToken(token, submissionId, reference, secret, now + 30 * 60 * 1000), false)
  assert.equal(verifyNotificationToken('not-a-token', submissionId, reference, secret, now), false)
})
