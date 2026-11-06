/**
 * global-state.js — 「哪些状态必须全仓唯一」的唯一源（判断#1452 · 2026-10-28 治本）
 * ========================================================================
 * 减法三问（判#1392 冻结期）：
 *   ① 能不能用现成？
 *      查过 vault-root.js（只答"根在哪"，不答"哪些要全局唯一"）、ai-lock.js 的
 *      resolveGlobalLockDir（只解决锁一个，且已硬编码在锁里）、scan-scope.js（遍历范围）。
 *      没有一处回答"哪类状态必须在副本外"。→ 现成的盖不住。
 *   ② 改现成？
 *      把这份分类塞进 vault-root.js 会污染它的单一职责（答根）；塞进 ai-lock 会
 *      逼非锁类使用者去依赖锁模块。判据分类本身与锁无关（锁只是一个使用者）。
 *      → 独立成文件，lock 与各写者共同 require。
 *   ③ 靠删解决？
 *      不能删。没有这份分类，每个写者都要自己判断"我该写哪个树"——那正是分家起点。
 *   三问全否 → 新增。覆盖门 = ai-lock + 各共享账本写者共同 require 本文件。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 源头诊断（判#1451 之后立刻发生的第二波同类病）
 * ═══════════════════════════════════════════════════════════════════
 * 判#1451 只修了「锁」这一处。但同一句话适用于所有全局唯一状态：
 *   多副本架构下，凡是"全局唯一"的东西，都必须问：它在副本里，还是副本外？
 * 实测（本判）证明这不是假想——同一时刻：
 *   user-decision-log.md  主树 ≠ 库位   （正在各自演化）
 *   ai-registry.jsonl     主树 ≠ 库位   （正在各自演化）
 * 判#1451 修好锁只解决了 judgment-log 的互斥，**这两份仍在分家**。
 * 逐个修 = 永远慢一步；一次解决 = 先把"谁该唯一"定义在一处，再让写者按它取路径。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 三分类（唯一源·写者按名字查，不自己判断）
 * ═══════════════════════════════════════════════════════════════════
 *  SHARED   AI 可能在任意库位里直接写 → **必须落到 master 主树**，全仓唯一
 *           判据：写者是不是"AI 会话里直接调用的命令"（落判/登记/收入/销账）
 *  LOCAL    机器产出，由主树计划任务生成 → 留在各自的树，**不应全局唯一**
 *           判据：写者是不是"计划任务/运行态生成物"（状态投影、同步游标）
 *  TRACKED  配置类，住版本库、由 git 管其一致性 → **不应全局唯一**
 *           判据：内容需要 review / 随分支演进（门源、板块定义）
 *
 * 判定依据不是"它看起来重要"，而是**谁写它、在哪写**。这是本文件存在的全部理由。
 */

'use strict';

const path = require('path');
const fs = require('fs');

const CLASS = Object.freeze({ SHARED: 'shared', LOCAL: 'local', TRACKED: 'tracked' });

// ── SHARED：必须在 master 主树，全仓唯一 ─────────────────────────────────
// 每项都写明"谁在库位里写它"，这是它被判为 SHARED 的唯一依据。
// **路径列是必须的**（实测踩坑）：judgment-log.md 实际住 vault-scripts/，
//   不在 vault-data/。第一版把目录写死 vault-data/，report 于是报"缺一侧"假警——
//   自己又犯了"检测端定义错"。故本表带 rel（相对 <root> 的路径），不再是纯 basename。
const SHARED_FILES = Object.freeze({
  'judgment-log.md': {
    rel: 'vault-scripts/judgment-log.md',
    why: 'AI 落判：judgment-append.ps1 / jl-isolate.js 都在 AI 当前会话目录里被调用 → 会写进库位',
  },
  'user-decision-log.md': {
    rel: 'vault-data/user-decision-log.md',
    why: '语音/键入收入：user-decision-append.ps1、trade-daily.ps1 -decision 销账时被 AI 直接调 → 会写进库位',
  },
  'ai-registry.jsonl': {
    rel: 'vault-data/ai-registry.jsonl',
    why: 'AI 进门登记：ai-register.ps1 在 AI 当前会话目录里被调用 → 会写进库位（实测两树已不一致）',
  },
  'card-calls.jsonl': {
    rel: 'vault-data/card-calls.jsonl',
    why: '调卡留痕：ai-register.ps1 / judgment-append.ps1 写入 → 同理会写进库位',
  },
  'divergence-log.jsonl': {
    rel: 'vault-data/divergence-log.jsonl',
    why: 'AI 分歧账本：divergence-append.ps1 从当前会话 worktree 调用，必须全仓唯一',
  },
});

// ── LOCAL：机器产出，留在各自树 ───────────────────────────────────────────
const LOCAL_FILES = Object.freeze({
  '_system-status.md': { rel: 'vault-data/_system-status.md', why: '雷达/心跳在 master 计划任务里生成；各树有各自快照是设计如此' },
  'git-sync-state.json': { rel: 'vault-data/git-sync-state.json', why: '同步游标属运行态，跟随各自树的同步进度' },
  'model-capacity.json': { rel: 'vault-data/model-capacity.json', why: '探针每轮在 master 由 proxy-hub 生成；库位副本只作参考' },
});

// ── TRACKED：配置，住版本库 ──────────────────────────────────────────────
const TRACKED_FILES = Object.freeze({
  'entry-gate.json': { rel: 'vault-data/entry-gate.json', why: '门源：需要 review、随分支演进，由 git 保证一致性' },
  'classification.json': { rel: 'vault-data/classification.json', why: '板块定义：同上' },
});

/** 分类查询（只认 basename·调用方可给完整路径） */
function classify(name) {
  const b = String(name).replace(/^.*[\\/]/, '');
  if (b in SHARED_FILES) return { cls: CLASS.SHARED, why: SHARED_FILES[b].why, rel: SHARED_FILES[b].rel };
  if (b in LOCAL_FILES) return { cls: CLASS.LOCAL, why: LOCAL_FILES[b].why, rel: LOCAL_FILES[b].rel };
  if (b in TRACKED_FILES) return { cls: CLASS.TRACKED, why: TRACKED_FILES[b].why, rel: TRACKED_FILES[b].rel };
  // 未登记：默认按 TRACKED（最保守——不擅自把未知文件指向 master）
  return { cls: CLASS.TRACKED, why: '未登记：默认按版本库管理（不擅自指向 master）', rel: 'vault-data/' + b };
}

/**
 * 全仓 master 根（无论当前在哪个 worktree）。
 * 取法与判#1451 的锁目录一致：git-common-dir 的父目录即 master 工作树。
 */
function masterRoot(fromRoot) {
  const VR = (() => { try { return require('./vault-root.js'); } catch { return null; } })();
  const ROOT = fromRoot || (VR && VR.ROOT) || 'D:/Vault';

  const cleanGitEnv = { ...process.env };
  delete cleanGitEnv.GIT_DIR; delete cleanGitEnv.GIT_WORK_TREE; delete cleanGitEnv.GIT_INDEX_FILE;
  try {
    const { execFileSync } = require('child_process');
    const common = String(execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: cleanGitEnv })).trim();
    if (common) {
      const master = path.resolve(common, '..');
      if (!fs.existsSync(path.join(master, 'vault-scripts'))) {
        throw new Error('git common-dir parent is not a Vault root: ' + master);
      }
      return master;
    }
  } catch (e) {
    if (e && /^git common-dir parent/.test(e.message)) throw e;
  }

  // Compatibility path inference is accepted only after independently proving the candidate Git root.
  const m = String(ROOT).replace(/\\/g, '/').match(/^(.*?)\/Vault-wt\/[^/]+$/i);
  if (m) {
    const candidateRaw = path.join(m[1], 'Vault');
    const candidate = fs.existsSync(candidateRaw) ? path.resolve(candidateRaw) : candidateRaw;
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'vault-scripts'))) {
      try {
        const { execFileSync } = require('child_process');
        const top = String(execFileSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'],
          { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: cleanGitEnv })).trim();
        const common = String(execFileSync('git', ['-C', candidate, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
          { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: cleanGitEnv })).trim();
        if (path.resolve(top) === candidate && path.resolve(common, '..') === candidate) return candidate;
      } catch {}
      throw new Error('无法验证候选共享主树的 Git 身份：' + candidate + '；拒绝写入共享状态');
    }
    if (fs.existsSync(ROOT)) {
      throw new Error('无法确认共享主树：当前 worktree 存在，但 Git common-dir 与主树回退均不可验证；拒绝写入共享状态');
    }
    return candidate; // 仅供不存在的路径字符串自测；真实工作树绝不走此回退
  }
  if (fs.existsSync(ROOT)) {
    throw new Error('无法确认共享主树：Git common-dir 不可用；拒绝将当前目录冒充 master');
  }
  return ROOT; // 仅供不存在的路径字符串自测；真实运行目录必须能由 Git 证明
}

/**
 * 共享状态的正确路径**唯一入口**。
 * 写者一律用这个，不要自己 join(ROOT,'vault-data',...)。
 *   resolveStatePath('judgment-log.md')         → <master>/vault-scripts/judgment-log.md
 *   resolveStatePath('_system-status.md')       → <本树>/vault-data/_system-status.md
 *   resolveStatePath('entry-gate.json')         → <本树>/vault-data/entry-gate.json
 */
function resolveStatePath(name, fromRoot) {
  const ROOT = fromRoot || (() => { try { return require('./vault-root.js').ROOT; } catch { return 'D:/Vault'; } })();
  const { cls, rel } = classify(name);
  const base = cls === CLASS.SHARED ? masterRoot(ROOT) : ROOT;
  return path.join(base, rel);
}

/** 诊断用：当前树是不是 master（不是则报告"会分家的文件"） */
function divergenceReport(fromRoot) {
  const ROOT = fromRoot || (() => { try { return require('./vault-root.js').ROOT; } catch { return 'D:/Vault'; } })();
  const master = masterRoot(ROOT);
  const isMaster = path.resolve(ROOT).toLowerCase() === path.resolve(master).toLowerCase();
  const out = [];
  for (const f of Object.keys(SHARED_FILES)) {
    const rel = SHARED_FILES[f].rel;
    const inTree = path.join(ROOT, rel);
    const inMaster = path.join(master, rel);
    const existsTree = fs.existsSync(inTree);
    const existsMaster = fs.existsSync(inMaster);
    let same = null;
    // 判#1452 补：区分「活跃分家」与「过期残留」
    //   修复后写者只写 master，库位那份会**停止更新**、越落越旧——它不是分家，是残留。
    //   第一版一律报"分家"，会让人以为没修好（本判实测踩到）。
    //   判据：库位副本 mtime **早于** master = 已停写（残留）；晚于 master = 仍被写（真分家）。
    let stale = null;
    if (existsTree && existsMaster) {
      same = fs.readFileSync(inTree, 'utf8') === fs.readFileSync(inMaster, 'utf8');
      if (!same) {
        const mTree = fs.statSync(inTree).mtimeMs;
        const mMaster = fs.statSync(inMaster).mtimeMs;
        stale = mTree < mMaster;
      }
    }
    out.push({ file: f, rel, inCurrentTree: existsTree, inMaster: existsMaster, identical: same, stale });
  }
  return { root: ROOT, master, isMaster, files: out };
}

module.exports = {
  CLASS, SHARED_FILES, LOCAL_FILES, TRACKED_FILES,
  classify, masterRoot, resolveStatePath, divergenceReport,
};

// ── CLI：node global-state.js [--json|--report] ─────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--resolve-shared') {
    const name = argv[1];
    if (!name || !Object.prototype.hasOwnProperty.call(SHARED_FILES, path.basename(name))) {
      console.error('拒绝解析：名称未登记为 SHARED；请先审查 SHARED_FILES');
      process.exit(2);
    }
    console.log(resolveStatePath(path.basename(name)).replace(/\\/g, '/'));
    process.exit(0);
  }
  if (argv.includes('--report')) {
    const r = divergenceReport();
    console.log('当前树: ' + r.root);
    console.log('master : ' + r.master + '  (是master=' + r.isMaster + ')');
    console.log('');
    let bad = 0;
    for (const f of r.files) {
      let flag;
      if (f.identical === true) flag = '✓ 一致';
      else if (f.identical === false && f.stale === true) flag = '· 残留（库位已停写，非分家）';
      else if (f.identical === false && f.stale === false) { flag = '⚠ 活跃分家'; bad++; }
      else flag = '— 缺一侧';
      console.log('  ' + f.file.padEnd(24) + flag + '  当前树=' + f.inCurrentTree + ' master=' + f.inMaster);
    }
    console.log('');
    console.log(bad ? ('活跃分家 ' + bad + ' 处 → 需修') : '无活跃分家（库位过期副本不影响一致性）');
    process.exit(bad ? 1 : 0);
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      class: CLASS,
      shared: SHARED_FILES,
      local: LOCAL_FILES,
      tracked: TRACKED_FILES,
      masterRoot: masterRoot(),
    }, null, 2));
    process.exit(0);
  }
  console.error('用法: node global-state.js --report | --json | --resolve-shared <已登记共享文件名>');
  process.exit(2);
}
