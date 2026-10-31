import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTrustedClientIdentifier } from '../lib/enquiries/client-identifier.ts'
import { maxEnquiryRequestBodyBytes, readRequestBodyBounded } from '../lib/enquiries/request-body.ts'

const endpoint = 'https://example.test/api/enquiries'

function createRequest(body, headers = {}) {
  return new Request(endpoint, {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  })
}

function streamRequest(source, headers = {}) {
  return createRequest(new ReadableStream(source, { highWaterMark: 0 }), headers)
}

test('accepts a streamed body exactly at the 16 KB limit', async () => {
  const text = 'a'.repeat(maxEnquiryRequestBodyBytes)
  const request = createRequest(text)

  const result = await readRequestBodyBounded(request)

  assert.deepEqual(result, { ok: true, text })
})

test('rejects an oversized streamed body before reading later chunks', async () => {
  let chunksRead = 0
  let cancelled = false
  const request = streamRequest({
    pull(controller) {
      chunksRead += 1
      if (chunksRead === 1) controller.enqueue(new Uint8Array(12_000))
      else if (chunksRead === 2) controller.enqueue(new Uint8Array(4_001))
      else controller.enqueue(new Uint8Array(1))
    },
    cancel() {
      cancelled = true
    },
  })

  const result = await readRequestBodyBounded(request)

  assert.deepEqual(result, { ok: false, reason: 'too_large' })
  assert.equal(chunksRead, 2)
  assert.equal(cancelled, true)
})

test('rejects an oversized declared length without reading the stream', async () => {
  let chunksRead = 0
  let cancelled = false
  const request = streamRequest({
    pull(controller) {
      chunksRead += 1
      controller.enqueue(new Uint8Array(1))
    },
    cancel() {
      cancelled = true
    },
  }, { 'content-length': String(maxEnquiryRequestBodyBytes + 1) })

  const result = await readRequestBodyBounded(request)

  assert.deepEqual(result, { ok: false, reason: 'too_large' })
  assert.equal(chunksRead, 0)
  assert.equal(cancelled, true)
})

test('uses Vercel x-real-ip and ignores a spoofed forwarded chain', () => {
  const headers = new Headers({
    'x-real-ip': '203.0.113.42',
    'x-forwarded-for': '198.51.100.99, 192.0.2.12',
  })

  assert.equal(getTrustedClientIdentifier(headers), '203.0.113.42')
})

test('missing x-real-ip does not create a shared unknown rate-limit bucket', () => {
  const headers = new Headers({ 'x-forwarded-for': '198.51.100.99' })

  assert.equal(getTrustedClientIdentifier(headers), null)
})

test('malformed x-real-ip does not fall back to a spoofable forwarded chain', () => {
  const headers = new Headers({
    'x-real-ip': 'not-an-ip',
    'x-forwarded-for': '198.51.100.99',
  })

  assert.equal(getTrustedClientIdentifier(headers), null)
})
