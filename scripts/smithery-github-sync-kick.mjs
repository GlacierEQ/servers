import { spawnSync } from 'node:child_process';

const namespace = process.env.SMITHERY_NAMESPACE || 'GlacierEQ';
const connectionId = process.env.SMITHERY_GITHUB_CONNECTION_ID || 'github';
const owner = process.env.TARGET_OWNER || 'GlacierEQ';
const repo = process.env.TARGET_REPO || 'servers';
const workflow = process.env.TARGET_WORKFLOW || 'upstream-core-sync.yml';
const ref = process.env.TARGET_REF || 'main';

if (!process.env.SMITHERY_API_KEY) {
  console.error('SMITHERY_API_KEY is not configured');
  process.exit(78);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|secret|authorization|api.?key|credential|setupurl/i.test(key)
      ? '[REDACTED]'
      : redact(item),
  ]));
}

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync('smithery', args, {
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  });

  const stdout = result.stdout?.trim() || '';
  const stderr = result.stderr?.trim() || '';

  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`smithery ${args.join(' ')} failed (${result.status}): ${stderr || stdout}`);
  }
  return { status: result.status, stdout, stderr };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function collectTools(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectTools(item, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;

  if (typeof value.name === 'string' && (value.inputSchema || value.input_schema || value.description)) {
    output.push(value);
  }
  for (const item of Object.values(value)) collectTools(item, output);
  return output;
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

run(['namespace', 'use', namespace]);

const listed = run(['--json', 'tool', 'list', connectionId]);
const payload = parseJson(listed.stdout, 'smithery tool list');
const tools = collectTools(payload);
const preferredNames = [
  'actions_run_trigger',
  'create_workflow_dispatch',
  'workflow_dispatch',
  'run_workflow',
];
const tool = preferredNames
  .map((name) => tools.find((candidate) => candidate.name === name))
  .find(Boolean);

if (!tool) {
  const observed = [...new Set(tools.map((candidate) => candidate.name))].sort();
  throw new Error(`No compatible workflow trigger tool found on ${connectionId}; observed: ${observed.join(', ') || 'none'}`);
}

const schema = tool.inputSchema || tool.input_schema || {};
const args = buildArguments(schema);
const called = run([
  '--json',
  'tool',
  'call',
  connectionId,
  tool.name,
  JSON.stringify(args),
]);
const result = parseJson(called.stdout, 'smithery tool call');

if (result?.error || result?.isError || result?.result?.isError) {
  throw new Error(`Smithery GitHub tool returned an error: ${JSON.stringify(redact(result))}`);
}

console.log(JSON.stringify({
  schema_version: '2.0.0',
  status: 'triggered',
  route: 'smithery-cli-managed-github',
  namespace,
  connection_id: connectionId,
  tool: tool.name,
  target: `${owner}/${repo}`,
  workflow,
  ref,
  arguments: args,
  result: redact(result),
}, null, 2));
