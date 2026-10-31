# Teenkanya Travel & Trek — V1 Architecture

## Product direction

Teenkanya serves both domestic Nepali travellers and international visitors. The public website uses English as its initial language. This is one shared product, not two separate websites.

The experience should collect enough context to respond appropriately to either audience:

- Traveller residence/country and preferred contact channel.
- Travel dates or date flexibility.
- Party size and travel interests.
- Destination, tour or trekking interest.
- Budget range only when useful and voluntarily supplied.
- Accessibility, dietary or other trip notes where relevant.

Do not infer nationality from a phone number. Do not make English-only content imply that the service is limited to international customers.

## Commercial rules

- Treat enquiries as the initial conversion path; do not imply a confirmed booking.
- Do not publish invented prices, availability, company history, awards, licences, partnerships, testimonials or team credentials.
- Use NPR for approved domestic quotes. Support USD for approved international quotes when the company supplies verified prices and exchange-rate policy.
- Until pricing is verified, show an enquiry/quote flow rather than fabricated amounts.
- Keep supplier-backed flight, bus, hotel and vehicle availability out of the product until real providers and operational workflows are selected.

## Application architecture

Start with a modular monolith in the existing Next.js App Router application.

### Presentation
- Existing public routes and visual components remain the customer-facing layer.
- Keep reusable UI and accessible interactions in components/.
- Keep route-specific composition in app/.

### Application and business modules
Introduce modules behind server-side boundaries as each capability is implemented:
- Enquiries and customer contact preferences.
- Travel catalogue: destinations, packages, treks, services and editorial content.
- Staff identity, roles and permissions.
- Quotes and booking lifecycle (later phase).
- Supplier integrations and payments (later phase).

### Data access
- Preserve lib/travel-service.ts as the catalogue abstraction.
- Add repository/service interfaces for new database-backed modules.
- Supabase Postgres is the V1 system of record.
- Use the Supabase JavaScript client from server-only repository modules; do not add an ORM for this integration.
- Keep SQL migrations under supabase/migrations and apply schema changes through the connected Supabase integration.
- Keep credentials in server-only environment variables. Never expose secrets to client components.

### Security
- Validate all untrusted input on the server.
- Add rate limiting and spam controls to public submission endpoints.
- Keep public enquiry tables inaccessible to anon/authenticated roles; only server routes may use a server-only Supabase secret.
- Restrict staff data and admin routes with server-verified authorization.
- Record important administrative changes in an audit trail.
- Collect only customer information needed to respond to the enquiry.

### Enquiry implementation status
- `POST /api/enquiries` validates and saves submissions to Supabase before any notification attempt. Web3Forms failure cannot undo or lose the saved enquiry.
- The Standard Web3Forms `POST /submit` endpoint is not supported for this app's server-side request pattern. Its documented usage is browser-side; server-side requests require a paid plan and server-IP safelisting. The browser submits directly to Web3Forms only after the API confirms persistence.
- The Standard access key is necessarily public in this browser flow. It is returned only after a save and is tied to the configured recipient. It must not be treated as a secret or used to authorize other operations. The app sends neither `to` nor Pro-only `ccemail` overrides.
- The UI distinguishes “enquiry saved” from “notification accepted.” A successful Web3Forms response means the provider accepted the notification request; it does not prove inbox delivery or confirm a booking. `notification_status = sent` records provider acceptance, not delivery.
- Notification retries use the saved form snapshot, submission ID, reference, and a short-lived signed status token. They call Web3Forms only and never resubmit the enquiry. The UI keeps a saved enquiry locked after notification failure, shows its reference, and warns that an interrupted provider response can make an email-only retry create a duplicate notification.
- Known idempotent replays are checked before the database rate-limit function, so ordinary retries do not consume another attempt. The unique submission ID still prevents duplicate rows. Concurrent first requests with the same ID can race before the separate rate-limit RPC and may consume an extra attempt; an atomic database function would be needed to eliminate that narrow quota race.
- Only a valid Vercel `x-real-ip` is used for rate limiting. Missing or malformed values fail closed with a retryable service error; they never share an `unknown` bucket or fall back to `x-forwarded-for`.
- The staff enquiry console remains a later milestone.

### Local setup and checks
- Use pnpm 12.3.4 and run `pnpm install`.
- Configure `SUPABASE_URL` and one server-only key (`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`) as shown in `.env.example`.
- Configure `WEB3FORMS_ACCESS_KEY` in the server environment and set the intended recipient on that key in the Web3Forms dashboard. In the free Standard browser integration the key is public by design, recipient-bound, and sent only after Supabase saves the enquiry. Keep Supabase server credentials server-only.
- Apply `supabase/migrations/20261031000000_create_enquiries.sql` to the intended Supabase project before accepting submissions.
- Run `pnpm dev` for local development, `pnpm check` for TypeScript and unit tests, and `pnpm build` for a production build.

## Delivery phases

1. **Foundation:** quality checks, architecture documentation, content governance and deployment hygiene.
2. **Enquiries:** server validation, persistence, delivery notifications and customer acknowledgement.
3. **Admin:** staff authentication, roles and enquiry management.
4. **Catalogue CMS:** manage destinations, packages, treks, services and publication status.
5. **Quotes and bookings:** quote versions, customer acceptance, booking statuses and operational records.
6. **Integrations:** selected flight/bus/hotel suppliers, payments and customer accounts only after business requirements are confirmed.

## Release policy

- main is the production baseline.
- Work happens on v1/* feature branches.
- Each coherent module is delivered through a pull request into main.
- A pull request must pass the repository quality workflow and receive review before merge.
- Do not merge or deploy to production without explicit approval.
- Do not add production credentials to source control or issue descriptions.
