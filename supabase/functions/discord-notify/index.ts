import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mappedKey(variable: string): string | undefined {
  const raw = Deno.env.get(variable);
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return raw;
  }
}

function clean(value: string, maxLength: number): string {
  return Array.from(value, character => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? " " : character; }).join("").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const actionLabels: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Removed",
};
const entityLabels: Record<string, string> = {
  task: "Task",
  roadmap: "Roadmap item",
  announcement: "Announcement",
  resource: "Resource",
  tag: "Tag",
  "board column": "Board column",
  "workspace settings": "Workspace settings",
};
const entityIcons: Record<string, string> = {
  task: "📋",
  roadmap: "🧭",
  announcement: "📣",
  resource: "🔗",
  tag: "🏷️",
  "board column": "🗂️",
  "workspace settings": "⚙️",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")
      ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
      ?? mappedKey("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      ?? Deno.env.get("SUPABASE_SECRET_KEY")
      ?? mappedKey("SUPABASE_SECRET_KEYS");
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      console.error("Supabase function keys are unavailable in this runtime.");
      return json({ error: "Notification service is not configured." }, 500);
    }

    const accessToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Sign in to send workspace notifications." }, 401);

    const caller = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Your session is no longer valid." }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("display_name,approved")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) {
      console.error("Could not verify workspace approval:", profileError.message);
      return json({ error: "Could not verify workspace access." }, 500);
    }
    if (!profile?.approved) return json({ error: "An approved workspace account is required." }, 403);

    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (!webhookUrl) return json({ ok: true, skipped: "Discord webhook is not configured yet." });
    if (!/^https:\/\/discord(?:app)?\.com\/api\/webhooks\//i.test(webhookUrl)) {
      console.error("DISCORD_WEBHOOK_URL is not a Discord webhook URL.");
      return json({ error: "The Discord webhook URL is invalid." }, 500);
    }

    const input = await request.json() as {
      action?: unknown;
      entity?: unknown;
      title?: unknown;
      detail?: unknown;
      workspace?: unknown;
      assigneeIds?: unknown;
    };
    const action = typeof input.action === "string" && Object.hasOwn(actionLabels, input.action) ? input.action : "";
    const entity = typeof input.entity === "string" && Object.hasOwn(entityLabels, input.entity) ? input.entity : "";
    const title = typeof input.title === "string" ? clean(input.title, 180) : "";
    const detail = typeof input.detail === "string" ? clean(input.detail, 700) : "";
    const workspace = typeof input.workspace === "string" ? clean(input.workspace, 80) : "Ja-Nee Management";
    if (!action || !entity || !title) return json({ error: "The change details are incomplete." }, 400);

    const requestedIds = Array.isArray(input.assigneeIds)
      ? [...new Set(input.assigneeIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 25)
      : [];
    let assigneeNames: string[] = [];
    let mentionIds: string[] = [];
    if (requestedIds.length) {
      const { data: assignees, error: assigneeError } = await admin
        .from("profiles")
        .select("display_name,discord_user_id")
        .eq("approved", true)
        .in("id", requestedIds);
      if (assigneeError) {
        console.error("Could not resolve Discord assignees:", assigneeError.message);
        return json({ error: "Could not look up the assigned team members." }, 500);
      }
      assigneeNames = [...new Set((assignees ?? [])
        .map((assignee) => clean(assignee.display_name ?? "Team member", 80)))];
      mentionIds = [...new Set((assignees ?? [])
        .map((assignee) => assignee.discord_user_id)
        .filter((id): id is string => typeof id === "string" && /^\d{17,20}$/.test(id)))];
    }

    const actor = clean(profile.display_name || "A teammate", 80);
    const moved = entity === "task" && action === "updated" && detail.startsWith("Status:");
    const cardTitle = moved ? "🔄 Card moved" : `${entityIcons[entity]} ${entityLabels[entity]} ${actionLabels[action].toLowerCase()}`;
    const fields: { name: string; value: string; inline?: boolean }[] = [];
    if (detail) fields.push({ name: moved ? "Status change" : "Change details", value: detail, inline: false });
    if (assigneeNames.length) fields.push({ name: "Assignees", value: assigneeNames.join(", ").slice(0, 900), inline: true });
    fields.push({ name: "Changed by", value: actor, inline: true });

    const content = mentionIds.map((id) => `<@${id}>`).join(" ");
    const embed = {
      author: { name: "JA-NEE • MANAGEMENT" },
      title: cardTitle,
      description: `**${title}**`,
      color: action === "deleted" ? 0xc95f55 : moved ? 0x5597dc : 0x84ad68,
      fields,
      footer: { text: `Ja-Nee Roleplay • ${workspace}` },
      timestamp: new Date().toISOString(),
    };
    const response = await fetch(`${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(content ? { content } : {}),
        embeds: [embed],
        allowed_mentions: { parse: [], users: mentionIds },
      }),
    });
    if (!response.ok) {
      console.error("Discord webhook returned status:", response.status);
      return json({ error: "Discord could not accept this change notice." }, 502);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Discord notification failed:", error);
    return json({ error: "Could not send the Discord change notice." }, 500);
  }
});
