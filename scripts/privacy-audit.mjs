/**
 * Purpose: catch common secrets and personal metadata before a public push.
 * Inputs: tracked/unignored files, built distribution and all reachable Git blobs/authors.
 * Outputs: locations/rule names only, never matched secret values. Does not rewrite history.
 * Boundary: heuristic defense, not proof of absence; review unknown data before committing.
 */
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString();
const violations = new Set();
const forbidden = /(^|\/)(\.env(?:\..*)?|node_modules|artifacts|test-results|playwright-report|\.DS_Store|\.local)(\/|$)|\.(pem|key|p12|pfx|log|crx|zip)$/i;
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['service-token', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/],
  ['personal-home-path', /(?:\/Users\/|\/home\/)[a-zA-Z0-9._-]+\//],
  ['credential-url', /https?:\/\/[^\s/]+:[^\s/]+@/],
];
function scan(label, file, buffer) {
  if (forbidden.test(file) && !file.endsWith('.env.example')) violations.add(`${label}: forbidden file category`);
  if (buffer.includes(0)) return; // Generated icons/images are reviewed separately, never parsed as text.
  const text = buffer.toString('utf8');
  text.split('\n').forEach((line, index) => {
    for (const [name, pattern] of patterns) if (pattern.test(line)) violations.add(`${label}:${index + 1}: ${name}`);
    for (const match of line.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
      if (!/^(?:users\.noreply\.github\.com|example\.(?:com|org|net))$/i.test(match[1])) violations.add(`${label}:${index + 1}: non-placeholder email`);
    }
    // Fixture credentials are explicitly synthetic; production must not embed literal keys.
    const assignment = line.match(/\b(?:apiKey|api_key|TYPESAFE_API_KEY)\s*[:=]\s*['"]([^'"]+)['"]/);
    if (assignment && !['fixture-key-not-a-credential', 'never transmit'].includes(assignment[1])) violations.add(`${label}:${index + 1}: literal credential assignment`);
  });
}

const files = new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean));
for (const file of files) scan(file, file, await readFile(path.join(root, file)));
async function scanBuild(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanBuild(full);
    else scan(path.relative(root, full), path.relative(root, full), await readFile(full));
  }
}
await scanBuild(path.join(root, 'dist'));

let historyObjects = 0;
const seen = new Set();
const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
for (const commit of commits) {
  for (const record of git(['ls-tree', '-rz', commit]).split('\0').filter(Boolean)) {
    const [metadata, file] = record.split('\t');
    const [, type, hash] = metadata.split(' ');
    if (type !== 'blob' || seen.has(hash)) continue;
    seen.add(hash);
    historyObjects++;
    scan(`history:${hash.slice(0, 8)}:${file}`, file, execFileSync('git', ['cat-file', 'blob', hash], { cwd: root }));
  }
  const emails = git(['show', '-s', '--format=%ae%n%ce', commit]).trim().split('\n');
  if (emails.some(email => !email.endsWith('@users.noreply.github.com'))) violations.add(`commit:${commit.slice(0, 8)}: non-noreply author/committer email`);
}
if (violations.size) {
  console.error('Privacy audit failed (values intentionally redacted):\n' + [...violations].join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Privacy audit passed: ${files.size} current files, distribution, ${commits.length} commits, ${historyObjects} unique historical blobs.`);
}
