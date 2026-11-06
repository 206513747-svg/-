'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-sync-worktree-'));
const vault = path.join(base, 'isolated-worktree');
const scripts = path.join(vault, 'vault-scripts');
fs.mkdirSync(path.join(vault, '.git'), { recursive: true });
fs.mkdirSync(scripts, { recursive: true });
for (const d of ['vault-data', '00-Inbox · 收件箱', '01-Projects · 项目', '06 · 共享记忆']) {
  fs.mkdirSync(path.join(vault, d), { recursive: true });
}
for (const name of ['memory-sync.js', 'atomic-write.js', 'global-state.js', 'ai-lock.js']) {
  fs.copyFileSync(path.join(__dirname, '..', 'vault-scripts', name), path.join(scripts, name));
}
const outside = path.join(base, 'outside-cwd');
fs.mkdirSync(outside);
const run = spawnSync(process.execPath, [path.join(scripts, 'memory-sync.js')], {
  cwd: outside, encoding: 'utf8'
});
if (run.status !== 0) {
  throw new Error('memory-sync failed in isolated worktree:\n' + run.stdout + '\n' + run.stderr);
}
const handoff = path.join(vault, 'vault-data', '_session-handoff.md');
assert(fs.existsSync(handoff), 'handoff must be created under the script worktree');
assert(fs.statSync(handoff).size > 0, 'handoff must be non-empty');
assert.deepStrictEqual(fs.readdirSync(outside), [], 'current working directory must remain untouched');
console.log('PASS memory-sync writes handoff to its own worktree, not process cwd');
fs.rmSync(base, { recursive: true, force: true });