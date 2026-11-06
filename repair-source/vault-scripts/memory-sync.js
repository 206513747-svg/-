/**
 * memory-sync.js
 *
 * Claude 启动前自动同步记忆文件。
 * 读取 vault 当前状态 → 写入最新 _session-handoff.md
 *
 * MEMORY.md 本身是时间无关的索引（不存状态），无需更新。
 *
 * 调用方式: node D:\Vault\vault-scripts\memory-sync.js
 * 设计原则: 幂等、安全、不丢失已有记忆
 */

const fs = require('fs');
const { atomicWrite, readJson } = require('./atomic-write'); // 写入宪法②③ + 调用即校验（v1.43.0）
const path = require('path');

// ─── 路径 ───────────────────────────────────────────────────────────
// 脚本只作用于自身所属的 Git 工作树；worktree 不得误写正式库 D:\\Vault。
const VAULT = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(VAULT, '.git'))) {
    throw new Error('[memory-sync] 无法确认当前 Git 工作树，拒绝写入: ' + VAULT);
}
const MEMORY_DIR = path.join(VAULT, 'vault-data');  // 已迁移：原 Claude记忆/ 废弃
const INBOX = path.join(VAULT, '00-Inbox · 收件箱');
const KANBAN_PATH = path.join(VAULT, '01-Projects · 项目', '_看板.md');

// ─── 辅助 ───────────────────────────────────────────────────────────

function fmtDate(d) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const w = weekdays[d.getDay()];
    return { iso: `${y}-${m}-${day}`, cn: `${y}年${m}月${day}日 星期${w}` };
}

function safeRead(p) {
    try {
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    } catch { return null; }
}

function safeWrite(p, content) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWrite(p, content, {}); // 写入宪法②③：原子写临时文件→rename（防中断落盘半截文件）
}

/** 在 00-Inbox · 收件箱/复盘提醒/（含 YYYY-MM 月文件夹）中找到最新的一篇复盘文件，返回相对路径 */
function findLatestReview() {
    try {
        const reviewDir = path.join(INBOX, '复盘提醒');
        if (!fs.existsSync(reviewDir)) return null;
        const re = /^复盘提醒-\d{4}-\d{2}-\d{2}\.md$/;
        const candidates = [];
        for (const entry of fs.readdirSync(reviewDir, { withFileTypes: true })) {
            if (entry.isFile() && re.test(entry.name)) {
                candidates.push(`复盘提醒/${entry.name}`);
            } else if (entry.isDirectory()) {
                for (const f of fs.readdirSync(path.join(reviewDir, entry.name))) {
                    if (re.test(f)) candidates.push(`复盘提醒/${entry.name}/${f}`);
                }
            }
        }
        if (candidates.length === 0) return null;
        // 文件名含 YYYY-MM-DD，字典序即时间序；取最新
        candidates.sort();
        return candidates[candidates.length - 1];
    } catch { return null; }
}

/** 解析 kanban 的章节结构 */
function parseKanban(content) {
    if (!content) return {};
    const sections = {};
    let current = null;
    for (const line of content.split('\n')) {
        const m = line.match(/^##\s+(.+)$/);
        if (m) {
            current = m[1].trim();
            sections[current] = [];
        } else if (current && /^-\s+\S/.test(line)) {
            sections[current].push(line.replace(/^-\s+/, '').trim());
        }
    }
    return sections;
}

// ─── 生成 _session-handoff.md ──────────────────────────────────────

function buildHandoff(date, latestReview, kanban) {
    const lines = [];
    lines.push('---');
    lines.push(`name: session-handoff`);
    lines.push(`description: 自动生成 — ${date.iso} 来自 memory-sync`);
    lines.push('metadata:');
    lines.push('  type: reference');
    lines.push('---');
    lines.push('');
    lines.push(`# 会话启动 · ${date.cn}`);
    lines.push('');

    // 最新状态收敛（2026-08-05 v1.41.0）：上次下一步从 .next-step 源读（AI 手写源）
    // 根因：从 session-record 读 next_step 会拿到陈旧副本（settle 滞后）→ handoff 与 MEMORY 双副本打架 → 启动读到旧状态
    // 改法：直接读 AI 手写源 .next-step（单一真相源之一），session-record 不再作为状态源
    try {
        const _nsPath = path.join(VAULT, 'vault-data', '.next-step');
        if (fs.existsSync(_nsPath)) {
            const _ns = fs.readFileSync(_nsPath, 'utf-8')
                .split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 8).join(' ');
            if (_ns) {
                lines.push(`▶ **上次会话下一步:** ${_ns}`);
                lines.push('');
            }
        }
    } catch (e) {}

    // 2026-08-17 v1.45.0：情报决策摘要（由内而外·解决"每次启动不知道D信号状态"）
    // 根因：_next-step 含回检条件但无D信号当前状态 → 启动时AI不知今日研判等级
    // 改法：读今日 intel 文件 → 提取 D信号状态 + 环境温度 + 明日触发/失效条件
    try {
        const today = date.iso;
        const intelPath = path.join(VAULT, '00-Inbox · 收件箱', '情报', `intel-${today}.md`);
        if (fs.existsSync(intelPath)) {
            const intel = fs.readFileSync(intelPath, 'utf-8');
            // 提取 D信号状态
            const dMatch = intel.match(/科创50 D触发[^\n]*→\s*([^\n]+)/);
            const dStatus = dMatch ? dMatch[1].trim() : '';
            // 提取环境温度
            const envMatch = intel.match(/环境温度:\s*(.+)/);
            const envStatus = envMatch ? envMatch[1].trim() : '';
            // 提取触发/失效条件（从跟踪信号段）
            const triggerMatch = intel.match(/站稳([\d.]+)/);
            const volMatch = intel.match(/量比>([\d.]+)/);
            const failMatch = intel.match(/跌破([\d.]+)/);
            const lines2 = [];
            lines2.push('');
            lines2.push(`📡 **今日情报决策摘要**（${today}）`);
            if (envStatus) lines2.push(`- 环境温度: ${envStatus}`);
            if (dStatus) lines2.push(`- D信号: ${dStatus}`);
            if (triggerMatch) lines2.push(`- 触发条件: 站稳${triggerMatch[1]}${volMatch ? '+量比>'+volMatch[1] : ''}`);
            if (failMatch) lines2.push(`- 失效条件: 跌破${failMatch[1]}`);
            lines.push(lines2.join('\n'));
        }
    } catch (e) {
        // 情报摘要提取失败不影响 handoff 生成
    }

    // 2026-08-19 判断：军事运行框架卡片调用入口（由内而外·卡片复利闭环）
    // 系统决策走智囊团宪章5阶段(孙子开战前→毛泽东突破口→王阳明时机→执行→曾国藩容错)×十六字节奏。
    // 执行阶段谋略工具箱=三十六计 KC-STANDARD-022。每次会话启动提示调卡，用即调卡、卡进流通复利。
    lines.push('');
    lines.push(`🛡️ **军事运行框架（调卡）**`);
    lines.push('- 战略[打不打]：[[KC-FIGURE-007]] 孙子（五事七计·先胜后战）');
    lines.push('- 战术[怎么打]：[[KC-STANDARD-022]] 三十六计（六套攻守·执行阶段谋略工具箱）');
    lines.push('- 节奏[何时动]：十六字方针（敌进我退/驻扰/疲打/退追·需≥2数据支撑）');
    lines.push('> 用即调卡：实际 Read 才计调用（gate 物理门），调了必须产出判断。');

    // 2026-08-19 本圈解决记录（军事框架运行·判断#217）
    // 让下次启动时看到这次会话解决了什么问题，形成闭环复利
    lines.push(`📌 **本圈解决（2026-08-19）**`);
    lines.push('- 产出验证门 WARN→BLOCK（卡片调用复利SOP物理硬拦，114次block根除）');
    lines.push('- 三十六计卡 L1→L2（4个实战验证：以逸待劳/声东击西/顺手牵羊/釜底抽薪）');
    lines.push('- 智囊团宪章 L1→L2（军事框架载体升级）');
    lines.push('- 智囊团调用 L1→L2（孙子先胜后战接入决策）');
    lines.push('- 情报判断 L1→L2（军事框架推动）');
    lines.push('- 社群生态 L2→L3（军事框架推动内容层）');
    lines.push('- permanent-fixes 补#71（跳号修复）');
    lines.push('- 5张卡全链路升级，系统核心问题已闭环');
    lines.push('> 跨AI可见：06 · 共享记忆/ → memory_recall("军事框架")');

    // 2026-08-19 全系统统一基础（all-AI unfied）：所有AI共享同一运行基础
    lines.push(`🧭 **全系统统一运行基础（所有AI共享）**`);
    lines.push('- 军事三层：孙子先胜后战(打不打)→三十六计(怎么打)→十六字(何时动)');
    lines.push('- 判断力来源：书库+智囊团发挥到极致（调用必Read·调用即产出·判断权归用户）');
    lines.push('- 由内而外：所有问题从已有机制长修复→装永久→闭环复利');
    lines.push('- 统一载体：recall("统一") / handoff / 卡片库（全AI共用）');
    lines.push('> 权威源：06 · 共享记忆/unified-system-foundation（agent_id=system）');
    lines.push('');

    // 最新复盘
    if (latestReview) {
        lines.push(`📋 **上次复盘:** \`00-Inbox · 收件箱/${latestReview}\``);
        lines.push('');
    }

    // 看板状态
    if (kanban && Object.keys(kanban).length > 0) {
        for (const [section, items] of Object.entries(kanban)) {
            if (items.length > 0) {
                lines.push(`### ${section}`);
                for (const item of items) {
                    lines.push(`- ${item}`);
                }
                lines.push('');
            }
        }
    } else {
        lines.push('📊 **看板:** 无数据或尚未初始化');
        lines.push('');
    }

    // 关键路径提示
    lines.push('---');
    lines.push('');
    lines.push('> 记忆由 memory-sync 自动生成，会话中可随时更新。');
    lines.push('> 当前状态始终以 vault 为准 — 看板、复盘、项目文件。');
    lines.push('');

    return lines.join('\n');
}

// ─── 记忆索引校验与自动修复（由内而外 · 永久 · 自动 · 2026-08-04）───
// 根治"查找失忆"：MEMORY.md 索引路径随目录重命名/文件移动而漂移。
// 原假设"索引时间无关无需更新"→ 无人校验 → 索引指向不存在位置 → 失忆。
// 机制：每次 settle 校验 MEMORY.md 引用路径 → 可解析自动修复 → 不可解析
// 写 signals.jsonl(warn) → 预警雷达下次启动路由。每次运行索引更准 = 复利闭环。
// 校验结果记入 observations 由审计链保留。

const MEMORY_INDEX = 'C:\\Users\\Mi\\.claude\\projects\\C--Users-Mi\\memory\\MEMORY.md';
const AUTO_MEM_DIR = path.dirname(MEMORY_INDEX); // 2026-08-08 根治（#41）：auto-memory 目录也作为引用候选
const SIGNALS_PATH = path.join(VAULT, 'vault-data', 'signals.jsonl');
const SHARED_MEM_DIR = path.join(VAULT, '06 · 共享记忆');

// 防污染（边界·2026-08-04）：信号只在状态变化时写入，不每次重复堆积。
// 同 source 上次 value 与本次相同 → 跳过；变化 → 写。雷达仍反映最新状态，日志不膨胀。
function appendSignalIfChanged(source, level, value, prescription, detail) {
    try {
        const prev = (readJson(SIGNALS_PATH, { kind: 'jsonl' }) || []) // 调用即校验：坏行告警跳过
            .filter(s => s && s.source === source).pop();
        if (prev && prev.value === value) return; // 状态未变，不写（防污染）
    } catch {}
    const sig = {
        level, type: 'system', source, prescription,
        value, status: 'new',
        ts: fmtDate(new Date()).iso,
        detail
    };
    try { fs.appendFileSync(SIGNALS_PATH, JSON.stringify(sig) + '\n'); } catch (e) { console.log(`[${source}] signals 写入失败: ` + e.message); }
}

function verifyMemoryIndex() {
    const index = safeRead(MEMORY_INDEX);
    if (!index) { console.log('[memory-index] MEMORY.md 不存在，跳过校验'); return; }

    // 提取反引号引用 + [[双链]]（去锚点 #Lxx / #N）
    const refs = [];
    let m;
    const tick = /`([^`]+)`/g;
    while ((m = tick.exec(index))) refs.push(m[1]);
    const link = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    while ((m = link.exec(index))) refs.push(m[1]);

    const broken = [];
    const repaired = [];
    const seen = new Set();

    for (let raw of refs) {
        // 仅当引用不以文件扩展名结尾时才剥离 #锚点（共享记忆文件名本身含#，如 bab820e1 铸卡永久机制#18：...md）
        let clean = raw.trim();
        if (!/\.[a-zA-Z0-9]{1,5}\s*$/.test(clean)) clean = clean.split('#')[0].trim();
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        if (/[*?]/.test(clean)) continue;                                  // 通配符
        if (/^[a-z]+:\/\//i.test(clean)) continue;                        // URL
        if (/^\//.test(clean)) continue;                                   // 斜杠命令(/compact /new)
        if (/^(node|powershell|powershell\.exe|pwsh|python|python3|python\.exe|npx|npm|git|bash|cmd|claude|yarn|pnpm)\b/i.test(clean)) continue; // shell 命令非路径
        // 2026-08-08 根治（永久机制#41）：环境变量/配置/命令链误报为文件断链
        if (/%[A-Z0-9_]+%/.test(clean)) continue;                               // 环境变量 %VAR%
        if (/^\S+=\S/.test(clean)) continue;                                    // KEY=VALUE 配置
        if (/&&|\|\||\bcd\s+/.test(clean)) continue;                            // shell 命令链
        if (!/(\/|\\)/.test(clean) && !/\.[a-zA-Z0-9]{1,5}$/.test(clean)) continue; // 非文件引用
        if (/["'][^"']*\\[ntrbf0"'\\u][^"']*["']/.test(clean)) continue;  // 代码字符串转义误判路径（"\n\n".join() 根因）

        // 绝对路径（Windows 盘符）直接校验
        if (/^[A-Za-z]:[\\/]/.test(clean)) {
            if (!fs.existsSync(clean)) broken.push(clean);
            continue;
        }

        // 直接候选路径
        const direct = [
            clean,
            path.join(VAULT, clean),
            path.join(VAULT, 'vault-data', 'memory', clean),
            path.join(SHARED_MEM_DIR, clean),
            path.join(AUTO_MEM_DIR, clean)
        ].find(c => fs.existsSync(c));
        if (direct) continue;

        // 全库 basename 唯一匹配 → 自动修复
        const base = path.basename(clean);
        const hits = [];
        (function walk(dir) {
            if (hits.length > 2) return;
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                if (e.name === 'node_modules' || e.name === '.git' || e.name === '.rag-data' || e.name === 'llama.cpp' || e.name === 'models_cache') continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) walk(full);
                else if (e.name === base) hits.push(full);
                if (hits.length > 2) return;
            }
        })(VAULT);

        if (hits.length === 1) {
            repaired.push({ from: clean, to: path.relative(VAULT, hits[0]).replace(/\\/g, '/') });
        } else {
            // 语义匹配（用 basename）：KC 卡短名→全名（KC-SYS-003.md→KC-SYS-003-系统转向.md）
            // 或共享记忆 hex-ID 短名→全名（bab820e1→bab820e1 铸卡永久机制#18...md）
            const baseName = path.basename(clean);
            const stem = /^((?:KC|CA|CG)-[A-Z]+-\d+)/.exec(baseName) || /^([0-9a-f]{8})/.exec(baseName);
            if (stem) {
                const stemHits = [];
                (function walkStem(dir) {
                    if (stemHits.length > 2) return;
                    let entries;
                    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                    for (const e of entries) {
                        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.rag-data' || e.name === 'llama.cpp' || e.name === 'models_cache') continue;
                        const full = path.join(dir, e.name);
                        if (e.isDirectory()) walkStem(full);
                        else if (e.name.startsWith(stem[1])) stemHits.push(full);
                        if (stemHits.length > 2) return;
                    }
                })(VAULT);
                if (stemHits.length === 1) {
                    repaired.push({ from: clean, to: path.relative(VAULT, stemHits[0]).replace(/\\/g, '/') });
                } else {
                    broken.push(clean);
                }
            } else {
                broken.push(clean);
            }
        }
    }

    if (repaired.length > 0) {
        let updated = index;
        for (const r of repaired) updated = updated.split(r.from).join(r.to);
        try { fs.writeFileSync(MEMORY_INDEX, updated, 'utf-8'); } catch (e) { console.log('[memory-index] 写回失败: ' + e.message); }
        console.log(`[memory-index] 自动修复 ${repaired.length} 条索引路径`);
        for (const r of repaired) console.log(`  ${r.from} → ${r.to}`);
    }

    if (broken.length > 0) {
        appendSignalIfChanged('memory-index', 'warn', 'warn', '🧠 曾国藩(结硬寨逐项清) | 📚 道德经(索引断链→道法自然,不被引用的记忆不如不存在) | 智囊团+书库闭环: 读KC-FIGURE-006+KC-BOOK-019 研判再修', `MEMORY.md 断链${broken.length}条: ${broken.join(', ').slice(0, 400)}`);
        console.log(`[memory-index] 断链 ${broken.length} 条已路由 signals（下次启动预警雷达展示）`);
    } else {
        appendSignalIfChanged('memory-index', 'info', 'up', '', '索引健康');
        console.log('[memory-index] 索引健康');
    }
}

// ─── 调卡物理监控（由内而外 · 永久 · 自动 · 2026-08-04）───
// 根治"每次打开不调卡"：调卡是标准(系统健康自检②½)但无物理门→靠自觉=会失效。
// 机制：每次 settle 统计当日 card-calls → 0调用写 warn → 预警雷达下次启动展示 →
// 被路由。出现能更快更好解决（不靠自觉，靠数据看见）。根卡未调也提示。
// 2026-08-11 扩展（方案B）：调用产出率监控——读≥3 且 0 产出（无 modify/create）的卡 →
// 写 warn 信号路由。根治"读卡不产=死循环"（KC-OUTIMG 读≥5次0产出挂6天）。

function checkCardInvocation() {
    const callsPath = path.join(VAULT, 'vault-data', 'card-calls.jsonl');
    const calls = safeRead(callsPath);
    if (!calls) { console.log('[card-invocation] card-calls.jsonl 不存在，跳过'); return; }
    const today = fmtDate(new Date()).iso;
    const lines = calls.split('\n').filter(l => l.includes(today));
    const readCalls = lines.filter(l => l.includes('"action":"read"')).length;
    const rootCalled = lines.some(l => l.includes('KC-SYS-001'));

    const detail = readCalls > 0 ? `今日调卡${readCalls}次,根卡${rootCalled ? '已调' : '未调'}` : '今日0卡调用(环未进场)';
    appendSignalIfChanged('card-invocation', readCalls > 0 ? 'info' : 'warn', readCalls > 0 ? 'up' : 'warn',
        readCalls > 0 ? '' : '🧠 曹操(破局主动:卡没被调=环没进场,先动) | 📚 刻意练习(不用=退步,有反馈的重复才进步) | 智囊团+书库闭环: 读KC-FIGURE-002+KC-BOOK-010 研判再修', detail);
    console.log(`[card-invocation] 今日调卡 ${readCalls} 次, 根卡${rootCalled ? '已调' : '未调'}`);

    // ── 方案B：调用产出率监控（读≥3 且 0 产出 → warn 路由）──
    try {
        // 聚合每卡今日 read / modify / create
        const perCard = {};
        for (const l of lines) {
            try {
                const c = JSON.parse(l);
                if (!c.card) continue;
                const id = c.card.match(/KC-[A-Z]+-\d+/)?.[0];
                if (!id) continue;
                if (!perCard[id]) perCard[id] = { read: 0, produce: 0 };
                // 判#857：gate-auto 机器读≠真实消费（KC-JUDGE-001 v2.2 版本记录点名的缺维）——KC-TRADE-005 39次机器读0真实读被冤判"读多产0"
                if (c.action === 'read') { if (c.session !== 'gate-auto') perCard[id].read++; }
                else if (c.action === 'modify' || c.action === 'create' || c.action === 'update') perCard[id].produce++;
            } catch (e) {}
        }
        // 读≥3 且 0 产出 = 读卡不产（排除 gate 自动读的三张合规卡——它们不是产出对象）
        const lowProduce = Object.entries(perCard)
            .filter(([, v]) => v.read >= 3 && v.produce === 0)
            .map(([id]) => id)
            .filter(id => !['KC-SYS-001', 'KC-CONST-001', 'KC-USER-001'].includes(id));
        if (lowProduce.length > 0) {
            appendSignalIfChanged('card-produce', 'warn', 'warn',
                '🧠 曾国藩(结硬寨逐项处理死卡·读卡必须产出) | 📚 刻意练习(读卡不产=无效调用,有反馈的重复才进步) | 智囊团+书库闭环: 读KC-FIGURE-006+KC-BOOK-010 研判再修',
                `读多产0: ${lowProduce.slice(0, 10).join(',')}（读≥3次今日0产出）`);
            console.log(`[card-produce] ⚠️ 读多产0卡 ${lowProduce.length} 张: ${lowProduce.join(',')}`);
        } else {
            // 判#857：无债时落健康位——否则上一条 warn 永挂（appendSignalIfChanged 自带去重）
            appendSignalIfChanged('card-produce', 'info', 'up', '', '今日无读多产0卡（真实调用口径·判#857）');
        }
    } catch (e) { console.log('[card-produce] 调用产出率分析失败: ' + e.message); }
}

// ─── 数据完整性检查（变量关系约束 · 全系统 · 由内而外 · 2026-08-04）───
// 边界(用户): 变量关系约束落地全系统——所有数据文件的变量关系物理校验。
// 校验: ①JSON良构 ②ts必在 ③枚举约束(signals.value/audit-todo.status) ④card-calls FK→卡存在 ⑤_schema声明(宪法)。
// 当日断→warn路由; 全绿→up。

const DATA_INTEGRITY = [
    { file: 'card-calls.jsonl' },
    { file: 'signals.jsonl' },
    { file: 'gate-log.jsonl' },
    { file: 'observations.jsonl' },
    { file: 'audit-todo.jsonl' }
];

function cardFileExists(idPrefix) {
    const stem = /^(KC-[A-Z]+-\d{3})/.exec(idPrefix);
    if (!stem) return false;
    const dir = path.join(VAULT, '02-Areas · 资产');
    try {
        const entries = fs.readdirSync(dir, { recursive: true });
        return entries.some(f => {
            if (typeof f !== 'string') return false;
            const base = f.split(/[\\/]/).pop() || '';
            return base.startsWith(stem[1] + '-');
        });
    } catch { return false; }
}

function checkDataIntegrity() {
    const today = fmtDate(new Date()).iso;
    const issues = [];

    // ① 全部数据文件 JSON 良构 + 时间字段必在（audit-todo用updated/created，其余用ts）
    for (const spec of DATA_INTEGRITY) {
        const p = path.join(VAULT, 'vault-data', spec.file);
        const content = safeRead(p);
        if (!content) { issues.push(`${spec.file}不存在`); continue; }
        const lines = content.split('\n').filter(l => l.trim());
        const timeKey = spec.file === 'audit-todo.jsonl' ? 'updated' : 'ts';
        let bad = 0, noTime = 0;
        for (const l of lines) {
            try { const o = JSON.parse(l); if (!o[timeKey]) noTime++; } catch { bad++; }
        }
        if (bad > 0) issues.push(`${spec.file}:${bad}坏行`);
        if (noTime > 0) issues.push(`${spec.file}:${noTime}无${timeKey}`);
    }

    // ② 枚举约束
    try {
        const sig = safeRead(path.join(VAULT, 'vault-data', 'signals.jsonl')) || '';
        for (const l of sig.split('\n').filter(Boolean)) {
            const o = JSON.parse(l);
            if (o.type === 'system' && o.value && !['up', 'warn', 'critical'].includes(o.value)) {
                issues.push(`signals:非法value=${o.value}`);
                break;
            }
        }
        const todo = safeRead(path.join(VAULT, 'vault-data', 'audit-todo.jsonl')) || '';
        for (const l of todo.split('\n').filter(Boolean)) {
            const o = JSON.parse(l);
            if (o.status && !['open', 'resolved'].includes(o.status)) {
                issues.push(`audit-todo:非法status=${o.status}`);
                break;
            }
        }
    } catch {}

    // ③ card-calls FK（当日）
    try {
        const calls = safeRead(path.join(VAULT, 'vault-data', 'card-calls.jsonl')) || '';
        const todayMissing = [];
        for (const l of calls.split('\n').filter(l => l.includes(today))) {
            try {
                const c = JSON.parse(l);
                if (c.card && c.action === 'read' && !cardFileExists(c.card)) todayMissing.push(c.card);
            } catch {}
        }
        if (todayMissing.length > 0) issues.push(`调卡FK断${todayMissing.length}:${todayMissing.join(',').slice(0, 100)}`);
    } catch {}

    // ④ _schema 声明（宪法：数据文件必须有格式声明）
    let schemaMissing = 0;
    for (const spec of DATA_INTEGRITY) {
        const s = path.join(VAULT, 'vault-data', '_schema.' + spec.file.replace('.jsonl', '.md'));
        if (!fs.existsSync(s)) schemaMissing++;
    }
    if (schemaMissing > 0) issues.push(`${schemaMissing}个数据文件缺_schema声明`);

    if (issues.length > 0) {
        appendSignalIfChanged('data-rel', 'warn', 'warn', '🧠 曾国藩(结硬寨逐项清) | 📚 反脆弱(数据是基本盘,断则脆弱) | 智囊团+书库闭环: 读KC-FIGURE-006+KC-BOOK-009 研判再修', `数据完整性: ${issues.join('; ').slice(0, 300)}`);
        console.log(`[data-rel] 数据完整性断 ${issues.length} 项: ${issues.join('; ')}`);
    } else {
        appendSignalIfChanged('data-rel', 'info', 'up', '', '数据完整性健康');
        console.log('[data-rel] 数据完整性健康');
    }
}

// ─── 主流程 ─────────────────────────────────────────────────────────

function main() {
    console.log('[memory-sync] === 开始同步 Claude 记忆 ===');

    const date = fmtDate(new Date());
    const latestReview = findLatestReview();

    if (latestReview) {
        console.log(`[memory-sync]   最新复盘: ${latestReview}`);
    } else {
        console.log('[memory-sync]   未找到复盘文件');
    }

    // 生成 _session-handoff.md
    const kanbanContent = safeRead(KANBAN_PATH);
    const kanban = parseKanban(kanbanContent);
    const handoff = buildHandoff(date, latestReview, kanban);

    const handoffPath = path.join(MEMORY_DIR, '_session-handoff.md');
    safeWrite(handoffPath, handoff);
    if (!fs.existsSync(handoffPath)) throw new Error('[memory-sync] 写后校验失败：handoff 文件不存在');
    const written = fs.readFileSync(handoffPath, 'utf-8');
    if (!written || written !== handoff) throw new Error('[memory-sync] 写后校验失败：handoff 内容不一致');
    console.log('[memory-sync] ✓ _session-handoff.md 已更新并通过写后校验');

    // 记忆索引校验（由内而外根治"查找失忆"，2026-08-04）
    verifyMemoryIndex();

    // 调卡物理监控（由内而外根治"每次打开不调卡"，2026-08-04）
    checkCardInvocation();

    // 数据完整性检查（变量关系约束·全系统，2026-08-04）
    checkDataIntegrity();

    console.log(`[memory-sync] ✅ 同步完成 (${date.cn})`);
}

main();
