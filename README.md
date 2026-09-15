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
