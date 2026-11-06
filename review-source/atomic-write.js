#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// atomic-write.js — 写入宪法物理执行（2026-08-05 v1.42.0）
// root: KC-SYS-001 系统根系 > 宪法第六条（靠证据不靠记录）
//
// 由内而外根治「老是有损坏的文件」：
//   根因1 编码漂移：PS5.1/Python3 在中文 Windows 默认 GBK，Node 默认 UTF-8
//         → 同一中文内容写出 3 种编码 → 混读必坏
//   根因2 无原子性：各写者直接写目标文件，中断/并发/格式错 → 坏数据落盘
//   根因3 无校验：写坏没人拦，直到下次读取崩（content-feedback/_system-score 皆此例）
//
// 写入宪法（所有写文件必须遵守）：
//   ① 显式 UTF-8 编码
//   ② 原子写：临时文件 → 校验 → rename（坏写不落盘）
//   ③ 写后校验：JSON 必须可 parse，脚本必须可解析，失败回滚 + 告警
//
// 用法（供其它脚本调用，替代裸 writeFile/Set-Content/open-w）：
//   node atomic-write.js <file> <content或-stdin> [--json|--jsonl|--append]
//   node atomic-write.js <file> --from-file <路径> [--json|--jsonl]  （2026-08-21 判断#232：PS5.1 原生参数剥引号/管道加BOM，内容走文件可靠）
//
// 同时提供 module 导出：require('./atomic-write.js')
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VAULT = (()=>{try{return require('./vault-root.js').ROOT}catch{return 'D:/Vault'}})();
const GlobalState = require('./global-state.js');
const AiLock = require('./ai-lock.js');

function resolveWriteTarget(filePath) {
  const base = path.basename(filePath);
  if (Object.prototype.hasOwnProperty.call(GlobalState.SHARED_FILES, base)) {
    return GlobalState.resolveStatePath(base, VAULT);
  }
  return path.resolve(filePath);
}

function withSharedWriteLock(filePath, fn) {
  const target = resolveWriteTarget(filePath);
  const base = path.basename(target);
  if (!Object.prototype.hasOwnProperty.call(GlobalState.SHARED_FILES, base)) return fn(target);
  const ai = process.env.AI_NAME || ('atomic-write-' + process.pid);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let lock = null;
  for (let i = 0; i < 40; i++) {
    lock = AiLock.acquire(base, ai, { ttl: 300 });
    if (lock.ok) break;
    Atomics.wait(sleeper, 0, 0, 100);
  }
  if (!lock || !lock.ok) {
    const owner = (lock && lock.busy) || {};
    throw new Error('共享状态写入冲突：' + base + ' 被 ' + (owner.ai || 'unknown') +
      ' / ' + (owner.win || 'unknown-window') + ' 持有超过4秒；本次未写入');
  }
  try { return fn(target); }
  finally {
    const released = AiLock.release(base, ai);
    if (!released.ok) throw new Error('共享状态锁释放失败：' + base);
  }
}

/** 写后校验：JSON 文件必须可 parse */
function validate(pathOrContent, kind) {
  if (kind === 'json') {
    JSON.parse(pathOrContent); // 抛错=校验失败
  } else if (kind === 'jsonl') {
    for (const line of pathOrContent.split('\n')) {
      if (line.trim()) JSON.parse(line);
    }
  }
}

/**
 * 原子写：临时文件 → 校验 → rename
 * @param {string} filePath 目标文件
 * @param {string} content 内容
 * @param {object} opts { encoding:'utf-8', validate:null|'json'|'jsonl', append:bool }
 */
function writeAtomicUnlocked(targetPath, content, opts = {}) {
  const encoding = opts.encoding || 'utf-8';
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, '.' + path.basename(targetPath) + '.tmp-' + process.pid + '-' + Date.now());

  if (opts.append && fs.existsSync(targetPath)) {
    const old = fs.readFileSync(targetPath, encoding);
    content = old.replace(/\n*$/, '\n') + content.replace(/^\n*/, '');
  }
  if (opts.validate === 'jsonl' && !content.endsWith('\n')) content += '\n';

  fs.writeFileSync(tmp, content, { encoding, flag: 'wx' });
  try {
    if (opts.validate) validate(content, opts.validate);
    if (opts.validate === 'jsonl') validate(fs.readFileSync(tmp, encoding), 'jsonl');
    fs.renameSync(tmp, targetPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

/** 原子替换；SHARED 文件的完整读→改→校验→写必须在同一把锁内。 */
function atomicUpdate(filePath, updater, opts = {}) {
  if (typeof updater !== 'function') throw new TypeError('atomicUpdate 需要 updater(currentText) 函数');
  return withSharedWriteLock(filePath, (targetPath) => {
    const encoding = opts.encoding || 'utf-8';
    const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, encoding) : '';
    const next = updater(current);
    if (typeof next !== 'string') throw new TypeError('atomicUpdate updater 必须返回字符串；原文件未改变');
    return writeAtomicUnlocked(targetPath, next, opts);
  });
}

/** 原子写：SHARED 路径解析、锁、临时文件、校验、rename 组成一个事务。 */
function atomicWrite(filePath, content, opts = {}) {
  return withSharedWriteLock(filePath, (targetPath) => writeAtomicUnlocked(targetPath, content, opts));
}

// ── CLI 入口 ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const filePath = args[0];
  let content = args[1];
  let kind = null;
  if (args.includes('--json')) kind = 'json';
  if (args.includes('--jsonl')) kind = 'jsonl';
  const append = args.includes('--append');
  if (args.includes('-stdin')) {
    content = fs.readFileSync(0, 'utf-8');
  }
  // 2026-08-21 判断#232：PS5.1 原生参数会剥掉 JSON 内层引号、管道会给首个字符加 BOM，
  // 内容走 --from-file <路径>（由调用方 .NET 写无BOM临时文件）绕开这两种不可靠通道。
  const fromIdx = args.indexOf('--from-file');
  if (fromIdx !== -1) {
    const fromPath = args[fromIdx + 1];
    if (!fromPath) { console.error('用法: --from-file <路径>'); process.exit(2); }
    content = fs.readFileSync(fromPath, 'utf-8');
  }
  if (!filePath || content === undefined) {
    console.error('用法: node atomic-write.js <file> <content> [--json|--jsonl] [--append] | -stdin | --from-file <路径>');
    process.exit(2);
  }
  try {
    atomicWrite(filePath, content, { validate: kind, append });
    console.log(`[atomic-write] ✓ ${filePath}（${append ? '追加' : '写入'}，UTF-8，校验${kind || '无'}）`);
  } catch (e) {
    console.error(`[atomic-write] ✗ ${filePath} 写入校验失败，已回滚: ${e.message}`);
    process.exit(1);
  }
}

/**
 * readJson — 调用即校验（2026-08-05 v1.43.0 下一环）
 * 读 + UTF-8/BOM + JSON 校验。坏 → 自动 git HEAD 恢复 → 仍坏 → 告警(observations) + 返回 null。
 * 让「系统运行调用的数据」在调用那一刻被检验，不只启动扫描（呼应判断#132）。
 * 用法：const { readJson } = require('./atomic-write'); const data = readJson(fp);
 */
function readJson(filePath, opts = {}) {
  const kind = opts.kind || (filePath.endsWith('.jsonl') ? 'jsonl' : 'json');
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  const obs = path.join(VAULT, 'vault-data', 'observations.jsonl');
  if (kind === 'jsonl') {
    // jsonl：逐行校验，坏行告警+跳过（不整文件回滚，保护未提交新数据）
    const out = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        if (line.includes('�')) throw new Error('编码污染(GBK混入)');
        out.push(JSON.parse(line));
      } catch (e) {
        try {
          fs.appendFileSync(obs, JSON.stringify({ ts: new Date().toISOString(), type: 'readJson-badline', level: 'warn', detail: path.basename(filePath) + ' 坏行跳过: ' + e.message }) + '\n', 'utf-8');
        } catch (e2) {}
      }
    }
    return out;
  }
  try {
    validate(raw, 'json');
    if (raw.includes('�')) throw new Error('编码污染(GBK混入)');
    return JSON.parse(raw);
  } catch (e) {
    // json：自动修复——git HEAD 恢复。判断#682 根治并发覆盖：还原前先把「当前活文件字节」备份成 .corrupt-<ts>，
    // 绝不再静默丢弃并发/未提交的写（旧版直接 HEAD 覆盖 = 别的 AI 刚写没提交的内容被吞=不可恢复，正是多AI覆盖放大器）。
    try {
      const corruptBak = filePath + '.corrupt-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 14);
      try { fs.copyFileSync(filePath, corruptBak); } catch {}
      const rel = filePath.replace(/\\/g, '/');
      const relPath = rel.includes('vault-data/') ? rel : 'vault-data/' + path.basename(filePath);
      const head = execSync(`git -C "${VAULT}" show HEAD:${relPath}`, { stdio: 'pipe' }).toString();
      validate(head.replace(/^\uFEFF/, ''), 'json');
      if (head.includes('\ufffd')) throw new Error('HEAD编码污染');
      atomicWrite(filePath, head, { validate: 'json' });
      fs.appendFileSync(obs, JSON.stringify({ ts: new Date().toISOString(), type: 'readJson-repaired', level: 'warn', detail: path.basename(filePath) + ' 自动git恢复（损坏/并发内容已备份 ' + path.basename(corruptBak) + '·勿静默丢写·判断#682）' }) + '\n', 'utf-8');
      return JSON.parse(head);
    } catch (e2) {
      try {
        fs.appendFileSync(obs, JSON.stringify({ ts: new Date().toISOString(), type: 'readJson-failed', level: 'error', detail: path.basename(filePath) + ' 无法自动修复: ' + e.message }) + '\n', 'utf-8');
      } catch (e3) {}
      return null;
    }
  }
}

module.exports = { atomicWrite, atomicUpdate, validate, readJson };
