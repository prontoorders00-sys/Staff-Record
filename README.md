# Staff Record

Staff Record is a digital staff book for shops, wholesalers, and other employers. It keeps employee records, wages, attendance, advances, responsibilities, and tasks in one simple desktop-and-mobile system.

Official domain: [staffrecords.net](https://staffrecords.net)

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the Staff Record Supabase project URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev`.

The database schema and RLS policies are managed in the linked Supabase project.

## Cloudflare Workers

The application keeps its standard Next.js workflow and includes an additional vinext build for Cloudflare Workers:

- `npm run build:vinext` builds the Worker-compatible production output.
- `npm run start:vinext` runs the built Worker locally.
- `npm run deploy:vinext` deploys the built output through Wrangler.
