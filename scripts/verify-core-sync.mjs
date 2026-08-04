import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const receipts = [];

function run(command, args = []) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function record(name, passed, detail) {
  receipts.push({ name, passed, detail });
  if (!passed) failures.push(`${name}: ${detail}`);
}

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.venv', 'dist', 'build'].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

try {
  const unmerged = run('git', ['diff', '--name-only', '--diff-filter=U']);
  record('no_unmerged_paths', unmerged.length === 0, unmerged || 'none');
} catch (error) {
  record('no_unmerged_paths', false, error.message);
}

try {
  run('git', ['diff', '--check']);
  record('git_diff_check', true, 'clean');
} catch (error) {
  record('git_diff_check', false, error.stderr?.trim?.() || error.message);
}

const files = walk(root);
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.py', '.toml', '.yaml', '.yml', '.sh']);
const conflictPattern = /^(<{7}|={7}|>{7})(?:\s|$)/m;
const conflictFiles = [];
const oversized = [];

for (const file of files) {
  const rel = relative(root, file);
  const size = statSync(file).size;
  if (size > 5 * 1024 * 1024) oversized.push(`${rel}:${size}`);
  const extension = file.slice(file.lastIndexOf('.'));
  if (!textExtensions.has(extension) || size > 2 * 1024 * 1024) continue;
  const content = readFileSync(file, 'utf8');
  if (conflictPattern.test(content)) conflictFiles.push(rel);
}
record('no_conflict_markers', conflictFiles.length === 0, conflictFiles.join(', ') || 'none');
record('oversized_file_inventory', true, oversized.join(', ') || 'none');

const jsonFiles = files.filter((file) => file.endsWith('.json'));
const jsonErrors = [];
for (const file of jsonFiles) {
  try { JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { jsonErrors.push(`${relative(root, file)}:${error.message}`); }
}
record('json_parse', jsonErrors.length === 0, jsonErrors.join(' | ') || `${jsonFiles.length} files parsed`);

try {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const aligned = packageJson.name === lock.name && packageJson.version === lock.version;
  record('package_lock_alignment', aligned, `${packageJson.name}@${packageJson.version} / ${lock.name}@${lock.version}`);
} catch (error) {
  record('package_lock_alignment', false, error.message);
}

try {
  const remotes = run('git', ['remote', '-v']);
  const hasUpstream = remotes.includes('modelcontextprotocol/servers');
  record('upstream_remote_recorded', hasUpstream, hasUpstream ? 'modelcontextprotocol/servers' : remotes);
} catch (error) {
  record('upstream_remote_recorded', false, error.message);
}

const manifestCounts = {
  package_json: files.filter((file) => file.endsWith('package.json')).length,
  pyproject_toml: files.filter((file) => file.endsWith('pyproject.toml')).length,
  uv_lock: files.filter((file) => file.endsWith('uv.lock')).length,
  dockerfile: files.filter((file) => /(^|\/)Dockerfile$/.test(relative(root, file))).length,
};
receipts.push({ name: 'manifest_inventory', passed: true, detail: manifestCounts });

console.log(JSON.stringify({
  schema_version: '1.0.0',
  repository: process.env.GITHUB_REPOSITORY ?? 'GlacierEQ/servers',
  commit: process.env.GITHUB_SHA ?? run('git', ['rev-parse', 'HEAD']),
  verified_at: new Date().toISOString(),
  passed: failures.length === 0,
  checks: receipts,
}, null, 2));

if (failures.length > 0) {
  console.error(`Core synchronization verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
