export type Web3FormsInterest = 'tour' | 'trekking' | 'travel_service' | 'other'
export type Web3FormsContactChannel = 'email' | 'phone' | 'whatsapp'

export interface Web3FormsEnquiry {
  submissionId: string
  reference: string
  fullName: string
  email: string | null
  phone: string | null
  countryOfResidence: string | null
  preferredContactChannel: Web3FormsContactChannel
  interest: Web3FormsInterest
  message: string
  travelStartDate: string | null
  datesFlexible: boolean
  travellerCount: number | null
  sourcePage: string
}

export type Web3FormsFailureReason = 'configuration' | 'unavailable' | 'rejected'

export type Web3FormsResult =
  | { success: true }
  | { success: false; reason: Web3FormsFailureReason }

const web3FormsEndpoint = 'https://api.web3forms.com/submit'

function createPayload(enquiry: Web3FormsEnquiry, accessKey: string) {
  const message = [
    `Reference: ${enquiry.reference}`,
    `Name: ${enquiry.fullName}`,
    enquiry.email ? `Email: ${enquiry.email}` : null,
    enquiry.phone ? `Phone: ${enquiry.phone}` : null,
    enquiry.countryOfResidence ? `Country of residence: ${enquiry.countryOfResidence}` : null,
    `Preferred contact: ${enquiry.preferredContactChannel}`,
    `Interest: ${enquiry.interest}`,
    enquiry.travelStartDate ? `Travel date: ${enquiry.travelStartDate}` : null,
    `Dates flexible: ${enquiry.datesFlexible ? 'Yes' : 'No'}`,
    enquiry.travellerCount ? `Travellers: ${enquiry.travellerCount}` : null,
    `Source page: ${enquiry.sourcePage}`,
    '',
    'Message:',
    enquiry.message,
  ].filter((line): line is string => line !== null).join('\n')

  const payload: Record<string, string> = {
    access_key: accessKey,
    subject: `New ${enquiry.interest.replaceAll('_', ' ')} enquiry ${enquiry.reference}`,
    from_name: 'Teenkanya Travel & Trek website',
    name: enquiry.fullName,
    message,
  }

  if (enquiry.email) {
    payload.email = enquiry.email
    payload.replyto = enquiry.email
  }
  if (enquiry.phone) payload.phone = enquiry.phone

  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function submitWeb3Forms(
  enquiry: Web3FormsEnquiry,
  accessKey: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Web3FormsResult> {
  const configuredAccessKey = accessKey?.trim()
  if (!configuredAccessKey) return { success: false, reason: 'configuration' }

  try {
    const response = await fetcher(web3FormsEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createPayload(enquiry, configuredAccessKey)),
      signal: AbortSignal.timeout(5_000),
    })

    let result: unknown
    try {
      result = await response.json()
    } catch {
      return { success: false, reason: 'rejected' }
    }

    if (response.ok && isRecord(result) && result.success === true) {
      return { success: true }
    }

    return { success: false, reason: 'rejected' }
  } catch {
    return { success: false, reason: 'unavailable' }
  }
}
