const apiKey = process.env.SMITHERY_API_KEY;
const namespace = process.env.SMITHERY_NAMESPACE || 'GlacierEQ';
const owner = process.env.TARGET_OWNER || 'GlacierEQ';
const repo = process.env.TARGET_REPO || 'servers';
const workflow = process.env.TARGET_WORKFLOW || 'upstream-core-sync.yml';
const ref = process.env.TARGET_REF || 'main';

if (!apiKey) {
  console.error('SMITHERY_API_KEY is not configured');
  process.exit(78);
}

const headers = {
  authorization: `Bearer ${apiKey}`,
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': 'GlacierEQ-servers-smithery-sync/1.0',
};

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { non_json: true, length: text.length }; }
    if (!response.ok) throw new Error(`Smithery HTTP ${response.status}: ${JSON.stringify(redact(body))}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|secret|authorization|api.?key|credential|setupurl/i.test(key) ? '[REDACTED]' : redact(item),
  ]));
}

function connectionList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['connections', 'data', 'items', 'results']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function connectionId(connection) {
  return connection.connectionId || connection.id || connection.connection_id;
}

function isGitHub(connection) {
  return JSON.stringify(redact(connection)).toLowerCase().includes('github');
}

function toolsFrom(payload) {
  return payload?.result?.tools || payload?.tools || [];
}

function buildArguments(schema = {}) {
  const properties = schema.properties || {};
  const args = {};
  const assign = (names, value) => {
    const found = names.find((name) => Object.hasOwn(properties, name));
    if (found) args[found] = value;
  };
  assign(['owner', 'repo_owner', 'organization'], owner);
  assign(['repo', 'repository', 'repo_name'], repo);
  assign(['workflow_id', 'workflow', 'workflow_file', 'workflow_filename'], workflow);
  assign(['ref', 'branch'], ref);
  assign(['inputs'], { upstream_ref: 'main' });
  return args;
}

const base = `https://api.smithery.ai/connect/${encodeURIComponent(namespace)}`;
const listed = await request(base, { method: 'GET' });
const connection = connectionList(listed).find(isGitHub);
if (!connection) throw new Error(`No GitHub connection found in Smithery namespace ${namespace}`);
const id = connectionId(connection);
if (!id) throw new Error('Smithery GitHub connection has no usable connection ID');

const mcpUrl = `${base}/${encodeURIComponent(id)}/mcp`;
const toolList = await request(mcpUrl, {
  method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
});
const tools = toolsFrom(toolList);
const candidates = ['actions_run_trigger', 'create_workflow_dispatch', 'workflow_dispatch', 'run_workflow'];
const tool = candidates.map((name) => tools.find((item) => item.name === name)).find(Boolean);
if (!tool) throw new Error(`Smithery GitHub connection lacks a workflow trigger tool; observed ${tools.length} tools`);

const result = await request(mcpUrl, {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: tool.name, arguments: buildArguments(tool.inputSchema || {}) },
  }),
});
if (result?.error || result?.result?.isError) throw new Error(`Smithery tool call failed: ${JSON.stringify(redact(result))}`);

console.log(JSON.stringify({
  schema_version: '1.0.0',
  status: 'triggered',
  route: 'smithery-connect-github',
  namespace,
  connection_id: id,
  tool: tool.name,
  target: `${owner}/${repo}`,
  workflow,
  ref,
  result: redact(result?.result || result),
}, null, 2));
