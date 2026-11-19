# Ja-Nee Management

Ja-Nee Roleplay's shared team dashboard. Members sign in with GitHub; approved accounts share tasks, roadmaps, announcements, resources, tags, and workspace settings through Supabase. Discord is used for optional change notifications, not sign-in.

## Run locally

Requires Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the values from your Supabase project.
3. Run:

   ```sh
   npm install
   npm run dev
   ```

The publishable key is intended for browser use. Never put a Supabase secret/service-role key or a Discord webhook URL in this app or in GitHub Pages variables.

## Set up Supabase and GitHub sign-in

1. Create a Supabase project.
2. Open **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql) once. It creates the tables, access rules, profile trigger, and realtime workspace updates.
3. Run [`supabase/project_features.sql`](supabase/project_features.sql), [`supabase/announcements_storage.sql`](supabase/announcements_storage.sql), and [`supabase/weekly_activity_cleanup.sql`](supabase/weekly_activity_cleanup.sql) in the SQL Editor. `project_features.sql` is an additive migration for LOA requests, member GitHub preferences, and their row-level security policies. The other scripts create private announcement-image storage, a public Discord thumbnail bucket, and schedule activity-feed cleanup for Mondays at 00:00 South African time. Cleanup clears only `workspace_state.data.events`; tasks and other workspace data are untouched. The cleanup uses Supabase Cron (`pg_cron`). If you already ran the storage SQL, run its updated version again to add the Discord image bucket.
4. In **Authentication → URL Configuration**, set the Site URL to the deployed Pages URL:

   `https://ja-nee-roleplay.github.io/ja-nee-management-dashboard/`

   Add that URL and `http://localhost:5173/` to the allowed redirect URLs.
5. In **Authentication → Providers**, enable **GitHub**. Create a GitHub OAuth app and use the callback URL displayed by Supabase (usually `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`) as the OAuth callback URL. Enter the GitHub client ID and secret in Supabase. The dashboard only offers GitHub sign-in.
6. Sign in to the dashboard once. The profile starts unapproved. In **Authentication → Users**, copy your user UUID. In the Supabase SQL Editor, approve yourself as the first owner:

   ```sql
   update public.profiles
   set approved = true, role = 'owner', display_name = 'Klinton_017'
   where id = 'PASTE-YOUR-USER-UUID-HERE';
   ```

7. Have teammates sign in once, then approve each account by UUID and choose a role. For example:

   ```sql
   update public.profiles
   set approved = true, role = 'developer'
   where id = 'PASTE-TEAMMATE-UUID-HERE';
   ```

Roles are `owner`, `administrator`, `management`, `developer`, and `viewer`.

## GitHub Projects

Each member can choose **Dashboard**, **GitHub Projects**, or **Both** in **Settings → GitHub Projects**. Preferences are stored per member. Connect using the same GitHub account used to sign in, load projects, choose one, and use **Sync now** when you want to exchange changes. Sync is manual so members can review and resolve simultaneous edits.

Connecting requests GitHub's `project` scope for Project V2 read/write and `read:org` to list organization projects. These scopes are shown on GitHub's consent screen; `project` covers user and organization projects, and `read:org` can read organization membership and team membership. The app does not request repository code access. See [GitHub's OAuth scope reference](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

Deploy the authenticated sync function after linking the Supabase CLI:

```sh
npx supabase functions deploy github-sync
```

The function verifies the signed-in, approved dashboard member before calling GitHub. It receives the provider token for the requested operation and does not write it to the app's workspace tables. Reconnect after a new session if GitHub access is no longer available.

Sync maps task status, priority, due dates, custom fields with matching names and supported types, and draft issue title/description. Existing GitHub Issues and Pull Requests can import content and sync their Project fields; changing their title or description requires repository write access, which this connection does not request. If both the dashboard task and GitHub item changed since the last sync, the function pauses that item and offers **Use dashboard** or **Use GitHub**. Sync reads up to 500 project items and sends up to 250 dashboard tasks per operation; it stops with an explanation when a project exceeds 500 items so it will not sync from an incomplete item list.

Members who select **GitHub Projects** use the connected project as their task workspace; the dashboard's Task board page becomes a link to that project. **Both** keeps the dashboard editable and enables two-way sync. **Dashboard** leaves GitHub sync off.

## LOA and availability

Members use **Availability** to submit a date range and optional handover message, edit or cancel pending requests, and see active, upcoming, and past requests on the shared team calendar. Owners, administrators, and management can approve or decline requests. Database triggers create in-app notifications for reviewers and requesters. Run `supabase/project_features.sql` before using this page.

## Project views

The Task board supports Board, Table, and Timeline views, saved per-member view presets, filters, sorting and grouping, custom fields, task start and due dates, sub-issues, dependencies, milestones, discussions, activity history, and an optional checklist-completion workflow rule. Existing workspace JSON is normalized with defaults when loaded; no task-data conversion is required.

## Discord task change cards

This dashboard posts a Discord Components V2 card after a task-board change is submitted and saved. The card shows the change summary, assignee names, and who made the change. It does not ping users. The webhook URL stays in Supabase and is never included in the browser build.

1. In your Discord server, open the destination text channel's **Edit Channel → Integrations → Webhooks**, create a webhook, choose the channel, and copy its URL. Keep that URL private.
2. In Supabase, open **Edge Functions → Secrets** and add:

   - Name: `DISCORD_WEBHOOK_URL`
   - Value: the URL you just copied

   You can also set it with the Supabase CLI using `npx supabase secrets set "DISCORD_WEBHOOK_URL=PASTE_WEBHOOK_URL_HERE"`.
3. From this repository folder, sign in and link the Supabase CLI to your project, then deploy the function:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy discord-notify
   ```

   Redeploy this function after dashboard notification changes. Discord Components V2 cards use a container with separators and can include the shared notification thumbnail.

   The project ref is the first part of your Supabase project URL, before `.supabase.co`. Leave the function's JWT verification enabled; only a signed-in, approved dashboard member can send a change notice.
4. In the dashboard **Settings**, upload a Discord notification image if you want a custom thumbnail. The image is resized and stored in the public Supabase bucket so Discord can display it. Approved workspace members can see the image.
5. Push the dashboard changes to GitHub Pages. Create or edit a task and save it. The card should appear in the chosen Discord channel with assignee names shown without pings. Discord incoming webhooks need `with_components=true` to display Components V2; the notification function adds this automatically.

The message uses Discord's explicit allowed-mentions list, so text typed into task titles or descriptions cannot ping `@everyone` or unassigned users. If a teammate has no linked Discord ID, the change is still recorded without a ping to them.

## Publish the Supabase connection on GitHub Pages

In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables** and add these repository variables:

- `VITE_SUPABASE_URL` — your Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — the project's publishable key.

The included Pages workflow reads those variables when it builds. Push a commit to `main`, or rerun the latest Pages workflow from the **Actions** tab. The dashboard will show setup instructions until both variables are present in the build.

## Data and access

- Approved members sign in with GitHub and share one workspace document through Supabase Realtime. Live team status comes from Supabase Realtime Presence and goes offline when their session disconnects. Workspace Settings can upload a small shared logo used in the dashboard sidebar.
- The dashboard refreshes shared workspace data when Realtime reconnects, when a tab becomes active again, and every 20 seconds while it is open. It keeps unsaved local edits when merging an incoming update.
- Workspace Settings can automatically delete completed tasks after 1, 3, 7, 14, 30, 60, or 90 days. Cleanup runs while an approved member has the dashboard open; overdue cards are removed on the next visit if everyone was offline when the timer elapsed. Choose **Never** to disable it.
- New accounts remain blocked until an owner approves them. The first owner must be approved in the trusted Supabase SQL Editor.
- Row-level security protects the database; the browser uses only the publishable key. The Discord webhook and Supabase service credentials remain on the server side.
- The dashboard still saves tasks and project views in one shared workspace JSON row. The sync merges item edits where it can, but concurrent writes to the same workspace can still collide. LOA requests and member preferences use separate row-level-security protected tables.
- Discord receives workspace activity notices. GitHub sign-in uses Supabase Auth; Project V2 synchronization uses the separate protected `github-sync` Edge Function.
