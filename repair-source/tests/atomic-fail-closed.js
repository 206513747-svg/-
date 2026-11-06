'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-lock-'));
process.env.AI_LOCK_DIR = lockDir;
const { readJson } = require('../vault-scripts/atomic-write.js');
const target = path.join(os.tmpdir(), 'vault-corrupt-' + process.pid + '.json');
fs.writeFileSync(target, '{broken');
let failedClosed = false;
try { readJson(target); } catch (e) { failedClosed = /fail-closed/.test(e.message); }
assert.strictEqual(failedClosed, true);
assert(fs.readdirSync(path.dirname(target)).some(n => n.startsWith(path.basename(target) + '.corrupt-')));
fs.unlinkSync(target);
for (const n of fs.readdirSync(path.dirname(target)).filter(n => n.startsWith(path.basename(target) + '.corrupt-'))) {
  fs.unlinkSync(path.join(path.dirname(target), n));
}
fs.rmSync(lockDir, { recursive: true, force: true });
console.log('PASS corrupt JSON fails closed and preserves original bytes');