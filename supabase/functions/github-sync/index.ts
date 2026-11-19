import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type LocalTask = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  updatedAt: string;
  githubItemId: string;
  githubSyncedAt: string;
  customFields: Record<string, string>;
};

type ProjectField = { id: string; name: string; dataType: string; options?: { id: string; name: string }[] };
type ProjectNode = {
  id: string;
  title: string;
  url: string;
  fields: { nodes: ProjectField[] };
  items: { nodes: ProjectItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};
type RemoteTask = LocalTask & { githubItemId: string; githubSyncedAt: string };
type ProjectItem = {
  id: string;
  updatedAt: string;
  content: { __typename: string; id: string; title: string; body?: string | null; updatedAt?: string; url?: string } | null;
  fieldValues: { nodes: Array<{ __typename: string; name?: string; text?: string; date?: string; number?: number; field?: { name: string } }> };
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? Array.from(value, character => {
    const code = character.charCodeAt(0);
    return code < 32 && character !== "\n" && character !== "\t" ? " " : character;
  }).join("").trim().slice(0, limit) : "";
}

function asLocalTask(value: unknown): LocalTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  const id = cleanText(task.id, 80);
  const title = cleanText(task.title, 200);
  if (!id || !title) return null;
  return {
    id,
    title,
    description: cleanText(task.description, 12000),
    status: cleanText(task.status, 100),
    priority: cleanText(task.priority, 30),
    dueDate: cleanText(task.dueDate, 10),
    updatedAt: cleanText(task.updatedAt, 40),
    githubItemId: cleanText(task.githubItemId, 200),
    githubSyncedAt: cleanText(task.githubSyncedAt, 40),
    customFields: task.customFields && typeof task.customFields === "object"
      ? Object.fromEntries(Object.entries(task.customFields as Record<string, unknown>).slice(0, 40).map(([name, fieldValue]) => [cleanText(name, 80), cleanText(fieldValue, 500)]).filter(([name]) => !!name))
      : {},
  };
}

async function graphQL<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401) throw new Error("GitHub authorization expired. Reconnect GitHub Projects.");
  if (response.status === 403) throw new Error("GitHub denied access. Confirm the project scope and project permissions.");
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(payload.errors.map(error => cleanText(error.message, 240)).join(" ").slice(0, 700));
  if (!payload.data) throw new Error("GitHub returned an empty response.");
  return payload.data;
}

const listProjectsQuery = `query {
  viewer {
    login
    projectsV2(first: 100) { nodes { id title url number } }
    organizations(first: 50) {
      nodes { login projectsV2(first: 100) { nodes { id title url number } } }
    }
  }
}`;

const projectItemsQuery = `query($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      id title url
      fields(first: 100) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name } }
        }
      }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id updatedAt
          content {
            __typename
            ... on DraftIssue { id title body }
            ... on Issue { id title body updatedAt url }
            ... on PullRequest { id title body updatedAt url }
          }
          fieldValues(first: 50) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }
  }
}`;

async function loadProject(token: string, projectId: string) {
  const items: ProjectItem[] = [];
  let fields: ProjectField[] = [];
  let cursor: string | null = null;
  let truncated = false;
  let project: { id: string; title: string; url: string } | null = null;
  for (let page = 0; page < 5; page++) {
    const result: { node: ProjectNode | null } = await graphQL<{ node: ProjectNode | null }>(token, projectItemsQuery, { projectId, after: cursor });
    const node: ProjectNode | null = result.node;
    if (!node) throw new Error("The selected GitHub Project was not found or is not accessible.");
    project = { id: node.id, title: node.title, url: node.url };
    if (page === 0) fields = node.fields.nodes ?? [];
    items.push(...(node.items.nodes ?? []));
    if (node.items.pageInfo.hasNextPage && page === 4) truncated = true;
    if (!node.items.pageInfo.hasNextPage || !node.items.pageInfo.endCursor) break;
    cursor = node.items.pageInfo.endCursor;
  }
  return { project, fields, items, truncated };
}

function remoteSnapshot(item: ProjectItem, fields: ProjectField[], fallback: LocalTask | null, defaultStatus: string, syncedAt: string): RemoteTask | null {
  const content = item.content;
  if (!content || !["DraftIssue", "Issue", "PullRequest"].includes(content.__typename)) return null;
  const values = item.fieldValues.nodes ?? [];
  const valueByName = (name: string) => values.find(value => value.field?.name?.toLowerCase() === name.toLowerCase());
  const statusField = fields.find(field => field.dataType === "SINGLE_SELECT" && field.name.toLowerCase() === "status")
    ?? fields.find(field => field.dataType === "SINGLE_SELECT");
  const priorityField = fields.find(field => field.dataType === "SINGLE_SELECT" && field.name.toLowerCase() === "priority");
  const dueField = fields.find(field => field.dataType === "DATE" && ["due date", "due", "target date"].includes(field.name.toLowerCase()));
  const status = (statusField && valueByName(statusField.name)?.name) || fallback?.status || defaultStatus;
  const priorityValue = priorityField && valueByName(priorityField.name)?.name;
  const validPriority = ["Low", "Medium", "High", "Urgent"].find(priority => priority.toLowerCase() === priorityValue?.toLowerCase());
  const customFields: Record<string, string> = {};
  for (const field of fields) {
    if (!["TEXT", "NUMBER", "DATE", "SINGLE_SELECT"].includes(field.dataType)) continue;
    if (field === statusField || field === priorityField || field === dueField) continue;
    const fieldValue = valueByName(field.name);
    const value = fieldValue?.text ?? fieldValue?.date ?? (typeof fieldValue?.number === "number" ? String(fieldValue.number) : fieldValue?.name);
    customFields[field.name] = typeof value === "string" ? value : "";
  }
  const body = (content.body ?? "").replace(/\n?\n?<!-- ja-nee-task:[\w-]+ -->/g, "").trim();
  return {
    id: fallback?.id ?? crypto.randomUUID().slice(0, 8),
    title: cleanText(content.title, 200),
    description: cleanText(body, 12000),
    status: cleanText(status, 100) || defaultStatus,
    priority: (validPriority ?? fallback?.priority ?? "Medium") as RemoteTask["priority"],
    dueDate: dueField ? (valueByName(dueField.name)?.date ?? "") : fallback?.dueDate ?? "",
    updatedAt: content.updatedAt ?? item.updatedAt,
    githubItemId: item.id,
    githubSyncedAt: syncedAt,
    customFields,
  };
}

function markerTaskId(item: ProjectItem): string {
  const match = item.content?.body?.match(/<!-- ja-nee-task:([\w-]+) -->/);
  return match?.[1] ?? "";
}

function draftBody(task: LocalTask): string {
  const description = cleanText(task.description, 12000);
  return `${description}${description ? "\n\n" : ""}<!-- ja-nee-task:${task.id} -->`;
}

async function updateProjectFields(token: string, projectId: string, itemId: string, fields: ProjectField[], task: LocalTask, item?: ProjectItem) {
  const statusField = fields.find(field => field.dataType === "SINGLE_SELECT" && field.name.toLowerCase() === "status")
    ?? fields.find(field => field.dataType === "SINGLE_SELECT");
  const priorityField = fields.find(field => field.dataType === "SINGLE_SELECT" && field.name.toLowerCase() === "priority");
  const dueField = fields.find(field => field.dataType === "DATE" && ["due date", "due", "target date"].includes(field.name.toLowerCase()));
  const updates: Array<{ fieldId: string; value?: Record<string, string | number>; clear?: boolean }> = [];
  const currentValue = (field: ProjectField) => {
    const value = (item?.fieldValues.nodes ?? []).find(entry => entry.field?.name?.toLowerCase() === field.name.toLowerCase());
    return value?.text ?? value?.date ?? (typeof value?.number === "number" ? String(value.number) : value?.name);
  };
  const hasRemoteValue = (field: ProjectField) => {
    const value = currentValue(field);
    return value !== undefined && value !== "";
  };
  if (statusField && task.status) {
    const option = statusField.options?.find(item => item.name.toLowerCase() === task.status.toLowerCase());
    if (option && currentValue(statusField)?.toLowerCase() !== option.name.toLowerCase()) updates.push({ fieldId: statusField.id, value: { singleSelectOptionId: option.id } });
  }
  if (priorityField && task.priority) {
    const option = priorityField.options?.find(item => item.name.toLowerCase() === task.priority.toLowerCase());
    if (option && currentValue(priorityField)?.toLowerCase() !== option.name.toLowerCase()) updates.push({ fieldId: priorityField.id, value: { singleSelectOptionId: option.id } });
  }
  if (dueField) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) {
      if (currentValue(dueField) !== task.dueDate) updates.push({ fieldId: dueField.id, value: { date: task.dueDate } });
    } else if (hasRemoteValue(dueField)) updates.push({ fieldId: dueField.id, clear: true });
  }
  for (const [name, fieldValue] of Object.entries(task.customFields)) {
    const field = fields.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!field || field === statusField || field === priorityField || field === dueField || field.dataType === "ASSIGNEES" || field.dataType === "MILESTONE" || field.dataType === "ITERATION" || field.dataType === "MULTI_SELECT") continue;
    if (!fieldValue) { if (hasRemoteValue(field)) updates.push({ fieldId: field.id, clear: true }); continue; }
    if (currentValue(field) === fieldValue) continue;
    if (field.dataType === "SINGLE_SELECT") {
      const option = field.options?.find(item => item.name.toLowerCase() === fieldValue.toLowerCase());
      if (option) updates.push({ fieldId: field.id, value: { singleSelectOptionId: option.id } });
    } else if (field.dataType === "TEXT") updates.push({ fieldId: field.id, value: { text: fieldValue } });
    else if (field.dataType === "NUMBER" && Number.isFinite(Number(fieldValue))) updates.push({ fieldId: field.id, value: { number: Number(fieldValue) } });
    else if (field.dataType === "DATE" && /^\d{4}-\d{2}-\d{2}$/.test(fieldValue)) updates.push({ fieldId: field.id, value: { date: fieldValue } });
  }
  const mutation = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value}) { projectV2Item { id } }
  }`;
  const clearMutation = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    clearProjectV2ItemFieldValue(input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId}) { projectV2Item { id } }
  }`;
  for (const update of updates) {
    if (update.clear) await graphQL(token, clearMutation, { projectId, itemId, fieldId: update.fieldId });
    else await graphQL(token, mutation, { projectId, itemId, fieldId: update.fieldId, value: update.value });
  }
}

async function saveDraftIssue(token: string, projectId: string, item: ProjectItem, fields: ProjectField[], task: LocalTask) {
  if (item.content?.__typename === "DraftIssue" && (item.content.title !== task.title || item.content.body !== draftBody(task))) {
    await graphQL(token, `mutation($draftIssueId: ID!, $title: String!, $body: String!) {
      updateProjectV2DraftIssue(input: {draftIssueId: $draftIssueId, title: $title, body: $body}) { draftIssue { id } }
    }`, { draftIssueId: item.content.id, title: task.title, body: draftBody(task) });
  }
  await updateProjectFields(token, projectId, item.id, fields, task, item);
}

async function createDraftIssue(token: string, projectId: string, fields: ProjectField[], task: LocalTask): Promise<ProjectItem> {
  const result = await graphQL<{ addProjectV2DraftIssue: { projectItem: ProjectItem } }>(token, `mutation($projectId: ID!, $title: String!, $body: String!) {
    addProjectV2DraftIssue(input: {projectId: $projectId, title: $title, body: $body}) { projectItem { id updatedAt content { __typename ... on DraftIssue { id title body } } fieldValues(first: 50) { nodes { __typename } } } }
  }`, { projectId, title: task.title, body: draftBody(task) });
  const item = result.addProjectV2DraftIssue.projectItem;
  await updateProjectFields(token, projectId, item.id, fields, task, item);
  return item;
}

async function syncProject(token: string, input: Record<string, unknown>) {
  const projectId = cleanText(input.projectId, 200);
  const source = input.source === "github" ? "github" : input.source === "both" ? "both" : "dashboard";
  const defaultStatus = cleanText(input.defaultStatus, 100) || "Backlog";
  const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (rawTasks.length > 250) throw new Error("Sync up to 250 dashboard tasks at a time.");
  const tasks = rawTasks.map(asLocalTask).filter((task): task is LocalTask => !!task);
  const { fields, items, truncated } = await loadProject(token, projectId);
  if (truncated) throw new Error("This project has more than 500 items. Sync stopped to avoid duplicate imports; reduce the project size before syncing.");
  const handled = new Set<string>();
  const updates: RemoteTask[] = [];
  const conflicts: Array<{ id: string; title: string; local: LocalTask; remote: RemoteTask }> = [];
  let created = 0;
  let pulled = 0;
  let pushed = 0;
  let contentSkipped = 0;
  for (const task of tasks) {
    let item = items.find(candidate => candidate.id === task.githubItemId);
    if (!item) item = items.find(candidate => markerTaskId(candidate) === task.id);
    if (!item) {
      const titleMatches = items.filter(candidate => !handled.has(candidate.id) && candidate.content?.title?.toLowerCase() === task.title.toLowerCase());
      if (titleMatches.length === 1) item = titleMatches[0];
    }
    if (!item) {
      if (source === "github") continue;
      item = await createDraftIssue(token, projectId, fields, task);
      const now = new Date().toISOString();
      updates.push({ ...task, githubItemId: item.id, githubSyncedAt: now });
      handled.add(item.id);
      created++;
      continue;
    }
    handled.add(item.id);
    const remote = remoteSnapshot(item, fields, task, defaultStatus, new Date().toISOString());
    if (!remote) continue;
    const syncedAt = task.githubSyncedAt;
    const localChanged = !!syncedAt && task.updatedAt > syncedAt;
    const remoteChanged = !!syncedAt && item.updatedAt > syncedAt;
    const initialCustomDiffers = Object.entries(task.customFields).some(([name, value]) => (remote.customFields[name] ?? "") !== value);
    const initialContentDiffers = !syncedAt && (task.title !== remote.title || task.description !== remote.description || task.status.toLowerCase() !== remote.status.toLowerCase() || task.priority.toLowerCase() !== remote.priority.toLowerCase() || task.dueDate !== remote.dueDate || initialCustomDiffers);
    if (source === "both" && ((localChanged && remoteChanged) || initialContentDiffers)) {
      conflicts.push({ id: task.id, title: task.title, local: task, remote });
      continue;
    }
    if (source === "both" && localChanged) {
      await saveDraftIssue(token, projectId, item, fields, task);
      updates.push({ ...task, githubItemId: item.id, githubSyncedAt: new Date().toISOString() });
      pushed++;
      if (item.content?.__typename !== "DraftIssue" && (task.title !== remote.title || task.description !== remote.description)) contentSkipped++;
    } else if (source === "github" || remoteChanged || !syncedAt) {
      updates.push({ ...remote, id: task.id, githubSyncedAt: new Date().toISOString() });
      pulled++;
    } else {
      updates.push({ ...task, githubItemId: item.id, githubSyncedAt: syncedAt });
    }
  }
  if (source !== "dashboard") {
    for (const item of items) {
      if (handled.has(item.id)) continue;
      const remote = remoteSnapshot(item, fields, null, defaultStatus, new Date().toISOString());
      if (remote) { updates.push(remote); pulled++; }
    }
  }
  const limitation = contentSkipped ? ` ${contentSkipped} linked issue/pull-request title or description change${contentSkipped === 1 ? " was" : "s were"} not written because this connection has project-only access.` : "";
  return { updates, conflicts, message: `Created ${created}, imported ${pulled}, pushed ${pushed}, and found ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}.${limitation}` };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? mappedKey("SUPABASE_PUBLISHABLE_KEYS");
    if (!supabaseUrl || !publishableKey) return json({ error: "The sync service is not configured." }, 500);
    const accessToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Sign in before connecting GitHub Projects." }, 401);
    const caller = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: authData, error: authError } = await caller.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Your workspace session is no longer valid." }, 401);
    const { data: profile, error: profileError } = await caller.from("profiles").select("approved,github_username").eq("id", authData.user.id).maybeSingle();
    if (profileError || !profile?.approved) return json({ error: "Only approved workspace members can sync projects." }, 403);
    if (authData.user.app_metadata?.provider !== "github") return json({ error: "Connect the GitHub account used to sign in." }, 403);
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return json({ error: "The sync request is too large." }, 413);
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const providerToken = cleanText(body.providerToken, 4096);
    if (!providerToken) return json({ error: "Reconnect GitHub Projects to provide project access." }, 401);
    const identity = await graphQL<{ viewer: { login: string } }>(providerToken, "query { viewer { login } }");
    const expectedLogin = typeof profile.github_username === "string" ? profile.github_username.trim().replace(/^@/, "") : "";
    if (expectedLogin && identity.viewer.login.toLowerCase() !== expectedLogin.toLowerCase()) {
      return json({ error: "The connected GitHub account does not match this workspace profile." }, 403);
    }
    if (body.action === "list_projects") {
      const result = await graphQL<{ viewer: { login: string; projectsV2: { nodes: Array<{ id: string; title: string; url: string; number: number }> }; organizations: { nodes: Array<{ login: string; projectsV2: { nodes: Array<{ id: string; title: string; url: string; number: number }> } }> } } }>(providerToken, listProjectsQuery);
      const projects = [
        ...result.viewer.projectsV2.nodes.map(project => ({ ...project, owner: result.viewer.login })),
        ...result.viewer.organizations.nodes.flatMap(org => org.projectsV2.nodes.map(project => ({ ...project, owner: org.login }))),
      ];
      return json({ projects });
    }
    if (body.action === "sync_project") return json(await syncProject(providerToken, body));
    if (body.action === "resolve_conflict") {
      const projectId = cleanText(body.projectId, 200);
      const itemId = cleanText(body.remoteItemId, 200);
      const direction = body.direction === "dashboard" ? "dashboard" : "github";
      const task = asLocalTask(body.localTask);
      if (!projectId || !itemId || !task) return json({ error: "Conflict details are incomplete." }, 400);
      const { fields, items, truncated } = await loadProject(providerToken, projectId);
      if (truncated) return json({ error: "This project has more than 500 items. Sync stopped to avoid resolving against an incomplete item list." }, 409);
      const item = items.find(candidate => candidate.id === itemId);
      if (!item) return json({ error: "The GitHub item was removed. Refresh the project and sync again." }, 409);
      if (direction === "dashboard") {
        await saveDraftIssue(providerToken, projectId, item, fields, task);
        const message = item.content?.__typename === "DraftIssue" ? "Dashboard version applied to GitHub." : "Project fields were updated. GitHub issue and pull request titles or descriptions need repository write permission, so those values remain unchanged there.";
        return json({ updates: [{ ...task, githubItemId: item.id, githubSyncedAt: new Date().toISOString() }], message });
      }
      const remote = remoteSnapshot(item, fields, task, task.status || "Backlog", new Date().toISOString());
      return json({ updates: remote ? [{ ...remote, id: task.id }] : [] });
    }
    return json({ error: "Choose a supported GitHub sync action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? cleanText(error.message, 700) : "The GitHub sync failed.";
    return json({ error: message || "The GitHub sync failed." }, 400);
  }
});
