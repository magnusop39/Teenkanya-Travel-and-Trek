import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { submitWeb3Forms } from '../lib/enquiries/web3forms.ts'

const enquiry = {
  submissionId: 'fb84a221-11f8-4bc1-b57e-0e37f45f4458',
  reference: 'TTT-270101-0123456789ABCDEF',
  fullName: 'Synthetic Preview QA',
  email: 'preview-qa@example.invalid',
  phone: '+977 9800000000',
  countryOfResidence: 'Test Country',
  preferredContactChannel: 'email',
  interest: 'trekking',
  message: 'Synthetic test submission only; not a customer enquiry.',
  travelStartDate: '2027-04-12',
  datesFlexible: true,
  travellerCount: 2,
  sourcePage: '/contact',
}

test('browser Standard submission sends JSON to the public endpoint and accepts only success=true', async () => {
  let requestUrl
  let requestInit
  const result = await submitWeb3Forms(enquiry, 'synthetic-access-key', async (url, init) => {
    requestUrl = url
    requestInit = init
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  })
  const payload = JSON.parse(requestInit.body)

  assert.deepEqual(result, { success: true })
  assert.equal(requestUrl, 'https://api.web3forms.com/submit')
  assert.equal(requestInit.method, 'POST')
  assert.equal(requestInit.headers['Content-Type'], 'application/json')
  assert.equal(payload.access_key, 'synthetic-access-key')
  assert.equal(payload.replyto, 'preview-qa@example.invalid')
  assert.equal(payload.to, undefined)
  assert.equal(payload.ccemail, undefined)
  assert.equal(payload.redirect, undefined)
  assert.match(payload.message, /Reference: TTT-270101-0123456789ABCDEF/u)
})

test('provider rejection never reports notification acceptance', async () => {
  const result = await submitWeb3Forms(enquiry, 'synthetic-access-key', async () => (
    new Response(JSON.stringify({ success: false }), { status: 200 })
  ))

  assert.deepEqual(result, { success: false, reason: 'rejected' })
})

test('a 403 is a generic rejection and does not prove the access key is invalid', async () => {
  const result = await submitWeb3Forms(enquiry, 'synthetic-invalid-key-verification', async () => (
    new Response('Forbidden', { status: 403 })
  ))

  assert.deepEqual(result, { success: false, reason: 'rejected' })
})

test('missing public configuration fails without a provider request', async () => {
  let requestCount = 0
  const result = await submitWeb3Forms(enquiry, null, async () => {
    requestCount += 1
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  })

  assert.deepEqual(result, { success: false, reason: 'configuration' })
  assert.equal(requestCount, 0)
})

test('non-success HTTP responses and malformed provider JSON cannot report acceptance', async () => {
  const unavailableStatus = await submitWeb3Forms(enquiry, 'synthetic-key', async () => (
    new Response(JSON.stringify({ success: true }), { status: 503 })
  ))
  const malformedJson = await submitWeb3Forms(enquiry, 'synthetic-key', async () => (
    new Response('not-json', { status: 200 })
  ))

  assert.deepEqual(unavailableStatus, { success: false, reason: 'rejected' })
  assert.deepEqual(malformedJson, { success: false, reason: 'rejected' })
})

test('network errors are reduced to a generic result without exposing transport details', async () => {
  const secret = 'synthetic-network-key'
  const result = await submitWeb3Forms(enquiry, secret, async () => {
    throw new TypeError(`Network failure for ${secret}`)
  })

  assert.deepEqual(result, { success: false, reason: 'unavailable' })
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('the client reads no server credentials and keeps notification retry separate from enquiry persistence', async () => {
  const source = await readFile(new URL('../components/contact-form.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /process\.env|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/u)
  assert.match(source, /submitWeb3Forms\(job\.enquiry, job\.accessKey\)/u)
  assert.match(source, /fetch\('\/api\/enquiries\/notification'/u)
  assert.doesNotMatch(source.match(/async function retryNotification\(\) \{[\s\S]*?\n  \}/u)?.[0] ?? '', /fetch\('\/api\/enquiries'/u)
})
