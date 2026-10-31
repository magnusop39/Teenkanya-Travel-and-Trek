import assert from 'node:assert/strict'
import test from 'node:test'
import { persistIfNew, processEnquirySubmission } from '../lib/enquiries/submission-workflow.ts'

const validSubmission = {
  submissionId: 'fb84a221-11f8-4bc1-b57e-0e37f45f4458',
  fullName: 'Synthetic Preview QA',
  email: 'preview-qa@example.invalid',
  phone: null,
  countryOfResidence: 'Test Country',
  preferredContactChannel: 'email',
  interest: 'trekking',
  message: 'Synthetic test submission only; not a customer enquiry.',
  travelStartDate: '2027-04-12',
  datesFlexible: true,
  travellerCount: 2,
}

function createDependencies({ savedStatus = 'pending' } = {}) {
  const calls = { persist: 0 }
  const dependencies = {
    async persist(enquiry) {
      calls.persist += 1
      return {
        status: 'saved',
        reference: 'TTT-270101-0123456789ABCDEF',
        notificationStatus: savedStatus,
        duplicate: false,
      }
    },
  }
  return { calls, dependencies }
}

test('a saved enquiry returns its reference and notification state', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await processEnquirySubmission(
    validSubmission,
    'client-ip',
    '/contact',
    dependencies,
  )

  assert.deepEqual(result, {
    status: 'saved',
    reference: 'TTT-270101-0123456789ABCDEF',
    notificationStatus: 'pending',
    duplicate: false,
  })
  assert.equal(calls.persist, 1)
})

test('invalid enquiry data is rejected before persistence', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await processEnquirySubmission(
    { ...validSubmission, email: 'not-an-email' },
    'client-ip',
    '/contact',
    dependencies,
  )

  assert.equal(result.status, 'invalid')
  assert.ok(result.fieldErrors.email)
  assert.equal(calls.persist, 0)
})

test('a missing trusted client identifier fails closed before persistence', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await processEnquirySubmission(validSubmission, null, '/contact', dependencies)

  assert.deepEqual(result, { status: 'client_identifier_unavailable' })
  assert.equal(calls.persist, 0)
})

test('known idempotent retries return the saved row before consuming a rate-limit attempt', async () => {
  const calls = { rateLimit: 0, create: 0 }
  const existing = { reference: 'TTT-270101-0123456789ABCDEF', notificationStatus: 'failed' }

  const result = await persistIfNew({
    async findExisting() { return existing },
    async consumeRateLimit() { calls.rateLimit += 1; return true },
    async create() { calls.create += 1; return { value: {} } },
  })

  assert.deepEqual(result, { status: 'saved', value: existing, duplicate: true })
  assert.deepEqual(calls, { rateLimit: 0, create: 0 })
})

test('new submissions consume rate limits before creation', async () => {
  const calls = { rateLimit: 0, create: 0 }

  const result = await persistIfNew({
    async findExisting() { return null },
    async consumeRateLimit() { calls.rateLimit += 1; return false },
    async create() { calls.create += 1; return { value: {} } },
  })

  assert.deepEqual(result, { status: 'rate_limited' })
  assert.deepEqual(calls, { rateLimit: 1, create: 0 })
})

test('persistence and notification remain independent outcomes', async () => {
  const { dependencies } = createDependencies({ savedStatus: 'failed' })
  const result = await processEnquirySubmission(validSubmission, 'client-ip', '/contact', dependencies)

  assert.equal(result.status, 'saved')
  assert.equal(result.notificationStatus, 'failed')
  assert.equal(result.reference, 'TTT-270101-0123456789ABCDEF')
})
