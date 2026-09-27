# Staff Record

Staff Record is a digital staff book for shops, wholesalers, and other employers. It keeps employee records, wages, attendance, advances, responsibilities, and tasks in one simple desktop-and-mobile system.

The current MVP includes email-code sign-in, business onboarding, employee records, daily attendance, advances, tasks, automatic wage calculations, deductions, advance recovery, payment status, and printable pay records.

Official domain: [staffrecords.net](https://staffrecords.net)

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the Staff Record Supabase project URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev`.

The database schema and RLS policies are managed in the linked Supabase project.

## Cloudflare Workers

The default production workflow targets Cloudflare Workers:

- `npm run build` builds the Worker-compatible production output with vinext.
- `npx wrangler deploy` deploys the built output and attaches `staffrecords.net` and `www.staffrecords.net`.
- `npm run start:vinext` runs the built Worker locally.
- `npm run build:next` is available when a standard Next.js production build is needed for verification.

The committed production environment file contains only Supabase's public browser configuration. Never add a Supabase secret or service-role key to a `NEXT_PUBLIC_*` variable or commit it to this repository.

## Staff workflow verification

- Employees can be edited, marked as former, and reactivated without deleting history. Complete final pay before marking someone as former.
- Attendance supports past dates, lunch/break minutes, overtime minutes within the shift, and separately recorded sick hours. Overnight shifts must be split across dates.
- Hourly gross pay counts clocked time minus breaks, including overtime once. Enter an agreed overtime premium or sick pay as Extra pay; no automatic entitlement or premium is assumed.
- Monthly salaries require monthly payment. Weekly salaries allow weekly or fortnightly payment; fortnightly gross is twice the weekly amount.
- Draft pay records lock the underlying attendance and wage changes. Cancel a draft, correct the inputs, and prepare a replacement. Paid periods remain locked.
- New pay records snapshot business and employee display details so later edits do not rewrite printable history.

Run `npm test`, `npm run typecheck`, and `npm run build` for application checks.
`tests/database/staff-workflows.sql` exercises onboarding, isolation, attendance, draft cancellation, payment, advance recovery, and audit protection with the authenticated role. Run it against a database with all migrations applied; its synthetic data is rolled back.

The real email-code login and browser payment/printing walkthrough still need to pass before launch. Unit/database checks do not replace that walkthrough.

## Timed employee tasks

Managers open **Tasks**, select one employee, enter their own duration in minutes/hours/days, and send. The database calculates the deadline from send time and snapshots the sender's name/role. Employees can acknowledge, start, report a problem, and complete tasks. Completed tasks and deadlines are preserved with audit events; the manager sees overdue and late completion status.

Under **Employee inbox access**, the manager records the worker's email. The worker signs in using the usual verified email code. This grants task-only access, not business membership. No invitation email is automatically sent. Removing the email or deactivating the employee revokes access and excludes their devices from subsequent pushes.

The worker opens **My tasks → Enable phone alerts**. iOS/iPadOS users must install the site on their Home Screen first. The `/task-sw.js` service worker handles background Web Push. Supabase `task-notify` independently verifies the caller with `auth.getUser()`, checks task ownership and age, filters recipients against current access, and deduplicates sends. Gateway JWT verification is disabled because the handler validates current users itself (compatible with asymmetric auth signing keys). Only supported Apple, Google and Mozilla HTTPS push endpoints are contacted.

VAPID keys are stored in `private.task_push_config`, never in source or browser configuration. Generate a P-256 VAPID pair once when setting up a new environment; do not rotate an existing pair without re-enrolling devices. Deploy `supabase/functions/task-notify/index.ts` separately from the web app. The inbox remains the source of truth if an OS blocks an alert or delivery fails; the manager receives delivery feedback after sending. Sign-out removes that user's registered phone-alert subscriptions.

Checks: `tests/database/timed-tasks.sql` covers authenticated manager/employee authorization, durations, responses, audited completion, secret access and revocation, rolling all fixtures back. Device delivery requires a real subscribed browser and notification permission.
