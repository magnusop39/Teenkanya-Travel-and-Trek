'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUpRight, Check } from 'lucide-react'
import { submitWeb3Forms } from '@/lib/enquiries/web3forms'
import type { Web3FormsEnquiry } from '@/lib/enquiries/web3forms'

interface EnquiryResponse {
  status?: unknown
  error?: unknown
  message?: unknown
  reference?: unknown
  saved?: unknown
  duplicate?: unknown
  notificationStatus?: unknown
  notificationAccessKey?: unknown
  notificationToken?: unknown
  fieldErrors?: unknown
}

interface PendingNotification {
  enquiry: Web3FormsEnquiry
  accessKey: string
  token: string
}

function isRecord(value: unknown): value is EnquiryResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getFieldErrors(value: unknown) {
  if (!isRecord(value) || typeof value.fieldErrors !== 'object' || value.fieldErrors === null) return {}
  return Object.fromEntries(
    Object.entries(value.fieldErrors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function getFormSnapshot(formData: FormData, submissionId: string): Omit<Web3FormsEnquiry, 'reference'> {
  const travellerCount = String(formData.get('travellerCount') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const countryOfResidence = String(formData.get('countryOfResidence') ?? '').trim()
  const travelStartDate = String(formData.get('travelStartDate') ?? '').trim()

  return {
    submissionId,
    fullName: String(formData.get('fullName') ?? '').trim(),
    email: email || null,
    phone: phone || null,
    countryOfResidence: countryOfResidence || null,
    preferredContactChannel: String(formData.get('preferredContactChannel') ?? 'email') as Web3FormsEnquiry['preferredContactChannel'],
    interest: String(formData.get('interest') ?? 'other') as Web3FormsEnquiry['interest'],
    message: String(formData.get('message') ?? '').trim(),
    travelStartDate: travelStartDate || null,
    datesFlexible: formData.get('datesFlexible') === 'on',
    travellerCount: travellerCount ? Number(travellerCount) : null,
    sourcePage: window.location.pathname,
  }
}

export function ContactForm() {
  const submissionId = useRef<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const successRef = useRef<HTMLDivElement>(null)
  const [submitted, setSubmitted] = useState(false)
  const [statusTrackingFailed, setStatusTrackingFailed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const [error, setError] = useState('')
  const [failureReference, setFailureReference] = useState('')
  const [successReference, setSuccessReference] = useState('')
  const [pendingNotification, setPendingNotification] = useState<PendingNotification | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!submitted || !successRef.current) return
    successRef.current.focus()
    successRef.current.scrollIntoView({ block: 'start' })
  }, [submitted])

  async function recordNotificationStatus(job: PendingNotification, status: 'sent' | 'failed') {
    try {
      const response = await fetch('/api/enquiries/notification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: job.enquiry.submissionId,
          reference: job.enquiry.reference,
          status,
          token: job.token,
        }),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async function deliverNotification(job: PendingNotification) {
    const result = await submitWeb3Forms(job.enquiry, job.accessKey)
    const status = result.success ? 'sent' : 'failed'
    const statusRecorded = await recordNotificationStatus(job, status)

    if (result.success) {
      setStatusTrackingFailed(!statusRecorded)
      setSubmitted(true)
      setSubmissionLocked(false)
      setError('')
      setFailureReference('')
      setSuccessReference(job.enquiry.reference)
      setPendingNotification(null)
      submissionId.current = null
      formRef.current?.reset()
      return
    }

    setSubmissionLocked(true)
    setFailureReference(job.enquiry.reference)
    setPendingNotification(job)
    setError('Your enquiry is saved, but Web3Forms did not confirm acceptance of the email notification. You can retry the notification without creating another enquiry. If the provider accepted the request but its response was interrupted, our team could receive a duplicate email.')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!form.reportValidity() || isSubmitting || submissionLocked) return

    setError('')
    setFieldErrors({})
    setIsSubmitting(true)
    submissionId.current ??= crypto.randomUUID()

    const formData = new FormData(form)
    const snapshot = getFormSnapshot(formData, submissionId.current)
    const payload = {
      ...snapshot,
      website: formData.get('website'),
    }

    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      let result: unknown = null
      try {
        result = await response.json()
      } catch {
        result = null
      }

      if (isRecord(result) && result.saved === true && typeof result.reference === 'string') {
        const job = typeof result.notificationAccessKey === 'string'
          && typeof result.notificationToken === 'string'
          ? {
              enquiry: { ...snapshot, reference: result.reference },
              accessKey: result.notificationAccessKey,
              token: result.notificationToken,
            }
          : null

        setSubmissionLocked(true)
        setFailureReference(result.reference)

        if (result.notificationStatus === 'sent') {
          setStatusTrackingFailed(false)
          setSubmitted(true)
          setSuccessReference(result.reference)
          setFailureReference('')
          submissionId.current = null
          form.reset()
          return
        }

        if (!job) {
          setPendingNotification(null)
          setError('Your enquiry is saved, but email notification is not configured. Please contact our team with the saved reference.')
          return
        }

        if (result.duplicate === true || result.notificationStatus === 'not_configured') {
          setPendingNotification(job)
          setError('Your enquiry is already saved. Use the notification-only retry below if the email was not accepted. This will not create another enquiry.')
          return
        }

        await deliverNotification(job)
        return
      }

      const validationErrors = getFieldErrors(result)
      setFieldErrors(validationErrors)

      if (response.status < 500) {
        setFailureReference('')
        setSubmissionLocked(false)
      }

      if (isRecord(result) && typeof result.message === 'string') {
        setError(result.message)
      } else {
        setError('We could not confirm this enquiry. Please retry with the same details or contact our team directly.')
      }
    } catch {
      setError('We could not confirm whether this enquiry was processed. Retry with the same details; the submission reference prevents duplicates.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retryNotification() {
    if (!pendingNotification || isSubmitting) return
    setError('')
    setIsSubmitting(true)

    try {
      await deliverNotification(pendingNotification)
    } finally {
      setIsSubmitting(false)
    }
  }

  function startSeparateEnquiry() {
    submissionId.current = null
    setSubmissionLocked(false)
    setFailureReference('')
    setPendingNotification(null)
    setError('')
    setFieldErrors({})
  }

  return <div className="contact-form-wrap">
    {submitted ? <div ref={successRef} className="form-success" role="status" tabIndex={-1}>
      <span className="success-icon"><Check aria-hidden="true" /></span>
      <span className="eyebrow">ENQUIRY SAVED</span>
      <h3>Thank you for getting in touch.</h3>
      <p>Your enquiry is saved in our system. Web3Forms accepted the email notification for processing; this does not confirm inbox delivery or a booking.</p>
      {statusTrackingFailed && <p>The email was accepted, but its tracking status could not be updated.</p>}
      {successReference && <p className="success-reference">Reference: <strong>{successReference}</strong></p>}
      <div className="success-actions"><a href="tel:+9779851248173">Call +977 9851248173</a><a href="mailto:3kanya2018@gmail.com">Email our team</a></div>
      <button type="button" className="text-link" onClick={() => { setSubmitted(false); setStatusTrackingFailed(false); startSeparateEnquiry() }}>Send another enquiry</button>
    </div> : <form ref={formRef} className="contact-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label htmlFor="enquiry-full-name">Your name
          <input id="enquiry-full-name" name="fullName" autoComplete="name" required minLength={2} maxLength={120} placeholder="Full name" disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName ? 'enquiry-full-name-error' : undefined} />
          {fieldErrors.fullName && <span className="field-error" id="enquiry-full-name-error">{fieldErrors.fullName}</span>}
        </label>
        <label htmlFor="enquiry-email">Email address (optional if you provide a phone)
          <input id="enquiry-email" type="email" name="email" autoComplete="email" maxLength={254} placeholder="you@example.com" disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'enquiry-email-error' : undefined} />
          {fieldErrors.email && <span className="field-error" id="enquiry-email-error">{fieldErrors.email}</span>}
        </label>
      </div>
      <div className="form-row">
        <label htmlFor="enquiry-phone">Phone (optional if you provide an email)
          <input id="enquiry-phone" type="tel" name="phone" autoComplete="tel" maxLength={30} placeholder="+977" disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'enquiry-phone-error' : undefined} />
          {fieldErrors.phone && <span className="field-error" id="enquiry-phone-error">{fieldErrors.phone}</span>}
        </label>
        <label htmlFor="enquiry-country">Country of residence
          <input id="enquiry-country" name="countryOfResidence" autoComplete="country-name" maxLength={100} placeholder="For example, Nepal" disabled={isSubmitting || submissionLocked} />
        </label>
      </div>
      <div className="form-row">
        <label htmlFor="enquiry-contact-channel">Preferred contact method
          <select id="enquiry-contact-channel" name="preferredContactChannel" defaultValue="email" disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.preferredContactChannel)} aria-describedby={fieldErrors.preferredContactChannel ? 'enquiry-contact-channel-error' : undefined}>
            <option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option>
          </select>
          {fieldErrors.preferredContactChannel && <span className="field-error" id="enquiry-contact-channel-error">{fieldErrors.preferredContactChannel}</span>}
        </label>
        <label htmlFor="enquiry-interest">What are you planning?
          <select id="enquiry-interest" name="interest" defaultValue="" required disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.interest)} aria-describedby={fieldErrors.interest ? 'enquiry-interest-error' : undefined}>
            <option value="" disabled>Select an interest</option><option value="tour">Tour or holiday</option><option value="trekking">Trekking</option><option value="travel_service">Travel service</option><option value="other">Something else</option>
          </select>
          {fieldErrors.interest && <span className="field-error" id="enquiry-interest-error">{fieldErrors.interest}</span>}
        </label>
      </div>
      <div className="form-row">
        <label htmlFor="enquiry-travel-date">Preferred travel date
          <input id="enquiry-travel-date" type="date" name="travelStartDate" disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.travelStartDate)} aria-describedby={fieldErrors.travelStartDate ? 'enquiry-travel-date-error' : undefined} />
          {fieldErrors.travelStartDate && <span className="field-error" id="enquiry-travel-date-error">{fieldErrors.travelStartDate}</span>}
        </label>
        <label htmlFor="enquiry-travellers">Number of travellers
          <input id="enquiry-travellers" type="number" name="travellerCount" min={1} max={50} step={1} placeholder="1" disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.travellerCount)} aria-describedby={fieldErrors.travellerCount ? 'enquiry-travellers-error' : undefined} />
          {fieldErrors.travellerCount && <span className="field-error" id="enquiry-travellers-error">{fieldErrors.travellerCount}</span>}
        </label>
      </div>
      <label className="checkbox-label"><input type="checkbox" name="datesFlexible" disabled={isSubmitting || submissionLocked} /> My travel dates are flexible</label>
      <label htmlFor="enquiry-message">Your message
        <textarea id="enquiry-message" name="message" rows={5} required minLength={10} maxLength={4000} placeholder="Tell us a little about your journey..." disabled={isSubmitting || submissionLocked} aria-invalid={Boolean(fieldErrors.message)} aria-describedby={fieldErrors.message ? 'enquiry-message-error' : undefined} />
        {fieldErrors.message && <span className="field-error" id="enquiry-message-error">{fieldErrors.message}</span>}
      </label>
      <label className="contact-form-honeypot" aria-hidden="true">Leave this field empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
      {fieldErrors.contact && <p className="field-error" role="alert">{fieldErrors.contact}</p>}
      {error && <div className="form-error" role="alert">
        <p>{error}</p>
        {failureReference && <p>Saved enquiry reference: <strong>{failureReference}</strong></p>}
        {pendingNotification && <button type="button" className="text-link" onClick={retryNotification} disabled={isSubmitting}>{isSubmitting ? 'Retrying notification…' : 'Retry email notification only'}</button>}
        {submissionLocked && <button type="button" className="text-link" onClick={startSeparateEnquiry}>Edit details and submit a separate enquiry</button>}
      </div>}
      <div className="form-submit-row"><p>Sending an enquiry does not confirm a booking. Our team will follow up using your preferred contact method.</p><button className="button button-primary" type="submit" disabled={isSubmitting || submissionLocked}>{isSubmitting ? 'Saving…' : 'Send an enquiry'} <ArrowUpRight aria-hidden="true" /></button></div>
      <p className="form-disclaimer">Your enquiry is saved before the browser contacts Web3Forms. The notification uses the recipient bound to the public access key; an accepted notification is not proof of inbox delivery.</p>
    </form>}
  </div>
}
