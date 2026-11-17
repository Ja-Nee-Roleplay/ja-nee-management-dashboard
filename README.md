# Ja-Nee Management

Ja-Nee Roleplay team dashboard. Sign-in is provided by Supabase Auth (Discord and GitHub OAuth), and approved members share one workspace document through Supabase Postgres with realtime updates. New workspaces start empty apart from the standard task-board columns.

## Run locally

Requires Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the values from your Supabase project.
3. Run:

   ```sh
   npm install
   npm run dev
   ```

The publishable key is intended for browser use. Never put a Supabase service-role key in this app or in GitHub Pages variables.

## Set up Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql) once. It creates the tables and row-level security rules, creates a profile for each OAuth account, and enables realtime for the shared workspace row.
3. In **Authentication → URL Configuration**, set **Site URL** to the deployed Pages URL:

   `https://ja-nee-roleplay.github.io/ja-nee-management-dashboard/`

   Add that URL and `http://localhost:5173/` to the allowed redirect URLs.
4. In **Authentication → Providers**, enable Discord and GitHub. For each provider, create an OAuth application in its developer settings and enter its client ID and client secret into Supabase. Use the callback URL shown by Supabase (usually `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`) as the provider's OAuth redirect/callback URL. Use the dashboard URL as the OAuth app homepage/site URL.
5. Sign in to the dashboard once. The profile starts unapproved. In **Authentication → Users**, copy your user UUID. In the Supabase SQL Editor, make yourself the first owner:

   ```sql
   update public.profiles
   set approved = true, role = 'owner', display_name = 'Klinton_017'
   where id = 'PASTE-YOUR-USER-UUID-HERE';
   ```

6. For each teammate, have them sign in once, then approve their profile by UUID and assign a role. For example:

   ```sql
   update public.profiles
   set approved = true, role = 'developer'
   where id = 'PASTE-TEAMMATE-UUID-HERE';
   ```

Roles are `owner`, `administrator`, `management`, `developer`, and `viewer`.

## Publish the Supabase connection on GitHub Pages

In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables** and add these repository variables:

- `VITE_SUPABASE_URL` — your Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — the project's publishable key.

The included Pages workflow reads those variables when it builds. Push a commit to `main`, or rerun the latest Pages workflow from the **Actions** tab. The dashboard will show setup instructions until both variables are present in the build.

## Data and access

- Approved members sign in with Discord or GitHub and share tasks, roadmaps, announcements, resources, activity, and workspace settings through Supabase.
- New accounts remain blocked until an owner approves them. The first owner must be approved once through the trusted Supabase SQL Editor.
- Row-level security protects the database; only approved accounts can read or change shared workspace data. The browser uses only the publishable key.
- The current app syncs a single workspace JSON document and listens for Supabase Realtime changes. If several people edit the same item at the same time, the latest save can replace an earlier one; a later database increment should move the busiest records to separate relational tables.
- Discord and GitHub here are sign-in providers. This setup does not post dashboard activity into Discord channels or synchronize GitHub Issues/Projects.
- GitHub Pages is public. Do not put private member information, credentials, or webhook secrets in the frontend or its database seed content. Discord notifications and file uploads are not connected yet.
