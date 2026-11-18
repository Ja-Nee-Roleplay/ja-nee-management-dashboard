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
3. Run [`supabase/announcements_storage.sql`](supabase/announcements_storage.sql) and [`supabase/weekly_activity_cleanup.sql`](supabase/weekly_activity_cleanup.sql) in the SQL Editor. These create private image storage for announcements, a public image bucket for the optional Discord notification thumbnail, and schedule activity-feed cleanup for Mondays at 00:00 South African time. Cleanup clears only `workspace_state.data.events`; tasks and other workspace data are untouched. The cleanup uses Supabase Cron (`pg_cron`). If you already ran the storage SQL, run its updated version again to add the Discord image bucket.
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
- The current app saves one shared workspace JSON document. If several people edit the same item at once, a later database save can replace an earlier one; a later database increment should move the busiest records to separate relational tables.
- Discord receives workspace activity notices. GitHub OAuth provides sign-in; the dashboard does not sync GitHub Issues or Projects.
