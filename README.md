# Ja-Nee Management

Responsive management dashboard for Ja-Nee Roleplay. This first increment is a working local preview; changes persist in browser storage on this device.

## Run

Requires Node.js 20.19+ or 22.12+.

    npm install
    npm run dev

Build using npm run build.

## Included

- Overview metrics, deadlines, activity, presence, roadmap progress, and configurable widgets.
- Kanban task board with create/edit/delete, drag and drop, status, priority, assignees, tags, due dates, checklists, comments, filters, and sorting.
- Roadmaps, announcements and pinning, deadline calendar, activity log, member directory, external links, brand colour, and theme settings.
- Responsive layouts and starter Supabase schema in supabase/schema.sql.

## Current limits

The app uses local browser storage and is not a shared multi-user system. The GitHub Pages workflow is included, but publishing and shared services are not connected yet. Supabase login and data access, realtime presence, backend-enforced permissions, Discord notifications, and uploads remain to be implemented. Do not use this preview for private member data or credentials. The SQL file is a foundation and must be reviewed before production. The frontend does not connect to Supabase yet.

## Next steps

1. Create a Supabase project and apply supabase/schema.sql.
2. Configure Discord and GitHub OAuth and production redirect URLs.
3. Replace browser storage with Supabase data access and approved-member authentication.
4. Send Discord notifications from a Supabase Edge Function; keep the webhook URL in server-side secrets.
5. Add Supabase Storage access policies for attachments.
6. Push to main and enable GitHub Actions as the Pages source in repository Settings → Pages. The included workflow builds and publishes the static frontend. Set matching Supabase site and callback URLs after authentication is connected.
7. After OAuth sign-in, assign the verified first user the owner role through a trusted Supabase SQL session.

Settings can reset the starter workspace in the current browser.
