#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// health-radar.js — 系统健康雷达（2026-09-04 v1.45.0）
// root: KC-SYS-001 > 由内而外问题解决管线 > 放大镜（系统专属维度）
//       KC-SYS-052 > 防自我确认闭环（radar 自身入第二方校验清单·判断#289/#290）
//
// 天团研判修正（judge.py 2模型）：不用文本脆弱性尺子量系统（范畴错误），
// 用系统架构维度扫；补「缺失型」检测（扫"应该有什么但没什么"，非只扫错）。
//
// v1.44.0（2026-08-29·由内而外解根 α）：
//   报告审计 08-29 判定 radar 自身=「自我确证闭环」最严重项——
//   14 维全绿但实际系统 BOM/守护/审计/信任分均不健康，radar 只报自己相信的绿灯。
//   本次由内而外解根：①JSON完整性检测端去 BOM 容错（改为检测 BOM 报 bad）
//   ②新增第 13 维「审计回流」=读 gate-audit.json 的 all_pass（第二方审计结论回流入雷达）
//   ③新增第 14 维「守护在位」=扫 C:\Windows\System32\Tasks 目录（与 ⑦COM API 交叉验证）
//   → 三处让 radar 换独立第二方数据源，符合 KC-SYS-052 原则
//
// 扫描维度（每次启动自动跑，输出根因线索，不只报状态）：
//   ① 单点故障面 —— 启动链关键脚本存在+语法有效（挂了=全崩）
//   ② 新鲜度     —— 关键数据源最近修改距今（陈旧=读到旧状态）
//   ③ 缺失检测   —— 应存在但缺失的关键文件（缺=最大风险源）
//   ④ owner      —— permanent-fixes 机制有回检标记的比例（孤儿机制=死卡）
//   ⑤ JSON 完整性 —— 复用写入宪法扫描（BOM=检测端判 bad·不容错）
//   ⑥ 信任分真实值 —— 读 state.json 附 rule 字段（口径唯一真相源）
//   ⑦ 定时任务配置 —— Get-ScheduledTask COM API 查 6 任务配置漂移
//   ⑧ 根目录散文件 —— D:\Vault 一级 *.md 散文件（应归位到 vault-data/）
//   ⑨ 同 ID 撞卡   —— 同名 KC-{TYPE}-{ID} 卡片冲突
//   ⑩ 钩子接线完整性 —— settings.json/.zcode/config.json hooks 全事件在位 + 启动链8步 + 压缩锚点
//   ⑪ 信息茧房检测 —— 外部情报输入断流天数
//   ⑫ SOP 合规   —— 卡片/SOP 头部字段合规度
//   ⑬ 审计回流   —— 读 gate-audit.json 的 all_pass（第二方审计→雷达·v1.44.0 新增）
//   ⑭ 守护在位   —— 扫 C:\Windows\System32\Tasks 目录（文件系统 vs COM API 交叉·v1.44.0 新增）
//   ⑮ 入口闭环证据 —— 无钩子入口（Cursor/WorkBuddy/Codex/OpenCode/千问办公/本地AI）ai-registry.jsonl 14天内登记（2026-08-30 三层统一新增·由内而外复用已有账本）
//   ⑯ 本地AI标准偏离 —— 对照 env.ps1 标准变量：路径失效/旧模型名残留(qwen3:8b)/淘汰坏引擎残留/D盘模型残留（2026-09-04 全系统统一治理新增·由内而外根治）
//
// 用法：node vault-scripts/health-radar.js   （SessionStart 由 settle 调用）
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const GlobalState = require('./global-state.js');
const AiLock = require('./ai-lock.js');

const VAULT = (() => { try { return require('./vault-root.js').ROOT; } catch { return 'D:/Vault'; } })();   // 运行根单一源（地基）·缺模块 fail-open 旧值
const VD = path.join(VAULT, 'vault-data');
const now = Date.now();
const DAY = 24 * 3600 * 1000;

const radar = { items: [], anomalies: [] };
const ARGS = process.argv.slice(2);
const REPAIR_ONLY = ARGS.includes('--repair-json'); // 问题出现即自动修模式（observe.sh调用）：只跑JSON自愈，静默

// ── ㉖ 情报消费闭环 selftest（判#1015·§④½ 自检的门必须能翻车·照 ai-registry-health 三口分离）──
// 纯函数 intelConsumptionState 靠函数声明提升，可在下方维度前定义、此处调用。
// 双向用例：囤积→F / 已消费→P / 0消费留痕→W(非绿) / 无产出→P(无从判) / 活决策通道假死→F(判#1025)——断言数由 cases.length 产出，不手写。
if (ARGS.includes('--selftest-intel')) {
  const cases = [
    { a: [null, null, '2026-09-29', 1.5], want: 'P', why: '无情报产出→作用侧无从判(采集侧归⑪)·非硬判绿数据' },
    { a: ['2026-09-29', null, '2026-09-29', 1.5], want: 'W', why: '情报有产出但0消费留痕→W 绝不报绿(空集不算通过)' },
    { a: ['2026-09-29', '2026-09-29', '2026-09-29', 1.5], want: 'P', why: '最新情报当日已被研判消费→闭环P' },
    { a: ['2026-09-29', '2026-09-26', '2026-09-29', 1.5], want: 'F', why: '消费留痕落后3天>阈值→采了没用=囤积死情报F' },
    { a: ['2026-09-29', '2026-09-28', '2026-09-29', 1.5], want: 'W', why: '落后1天≤阈值→待今日intel-analysis·W' },
    { a: ['2026-09-29', '2026-09-29', '2026-09-29', 1.5, 40], want: 'F', why: '研判留痕当日新鲜但 .next-step 假死40天→F·背着死决策跑的情报不算闭环(判#1025)' },
    { a: ['2026-09-29', '2026-09-29', '2026-09-29', 1.5, 2], want: 'P', why: '通道活(2天≤7)+消费当日→P 不误杀正常圈' },
    { a: ['2026-09-29', '2026-09-26', '2026-09-29', 1.5, 40], want: 'F', why: '双断(囤积+通道死)→F 不因后参坏数据误翻绿' },
    { a: ['2026-09-29', '2026-09-29', '2026-09-29', 1.5, null], want: 'P', why: '通道维拿不到年龄(文件缺失/ stat失败)→不臆断·维持原判' },
  ];
  const fails = [];
  cases.forEach((c, i) => {
    const r = intelConsumptionState(c.a[0], c.a[1], c.a[2], c.a[3], c.a[4]);
    if (r.status !== c.want) fails.push('用例' + (i + 1) + '(' + c.why + ') 期望 ' + c.want + ' 实得 ' + r.status);
  });
  if (fails.length) { console.error('❌ intel消费维 selftest FAIL：' + fails.length + '/' + cases.length + ' 断言不符'); fails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ intel消费维 selftest PASS ' + cases.length + ' 断言全过（双向:囤积F/已消费P/0留痕W/无产出P/通道假死F）');
  process.exit(0);
}

// ── ㉛ 产出动作对账 selftest（判#1029飞轮第二判据的机器化身：产出必挂下一步动作）──
// ── 红灯催办 selftest（判#1037「每次运行要能发现根治解决」：发现自动→根治也须自动驱动）──
// 纯函数 redSlipState：首见龄+无治愈→fresh/aging(>2天升级醒目)/notify(>5天自动写决策日志逼拍板·承判#835候选不隔夜同构)
if (ARGS.includes('--selftest-redslip')) {
  const cases = [
    { a: ['2026-09-30', '2026-09-30', false], want: 'fresh', why: '当天首见·给当日圈留根治窗口' },
    { a: ['2026-09-28', '2026-09-30', false], want: 'aging', why: '挂2天未治→醒目标注' },
    { a: ['2026-09-25', '2026-09-30', false], want: 'notify', why: '挂5天未治→自动写决策日志逼拍板/根治·不再只等用户开口' },
    { a: ['2026-09-20', '2026-09-30', true], want: 'healed', why: '已有同日根治判号引用→不催（防反复扰）' },
    { a: ['2026-09-30', '2026-09-25', false], want: 'fresh', why: '时钟倒挂不炸账·按fresh处理' },
  ];
  const rfails = [];
  cases.forEach((c, i) => {
    const got = redSlipState(c.a[0], c.a[1], c.a[2]);
    if (got !== c.want) rfails.push('用例' + (i + 1) + '(' + c.why + ') 期望 ' + c.want + ' 实得 ' + got);
  });
  if (rfails.length) { console.error('❌ 红灯催办 selftest FAIL：' + rfails.length + '/' + cases.length); rfails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 红灯催办 selftest PASS ' + cases.length + ' 断言全过（fresh/aging/notify/healed/倒挂五向）');
  process.exit(0);
}
if (ARGS.includes('--selftest-landing')) {
  const cases = [
    { a: [null, '2026-09-30'], want: 'P', why: '无判断落账·无从对账·不臆断' },
    { a: ['2026-09-30', '2026-09-30'], want: 'P', why: '动作表与最新判断同日→产出已挂动作' },
    { a: ['2026-09-30', '2026-09-29'], want: 'W', why: '动作表落后判断1天≤3→待本圈收工挂' },
    { a: ['2026-09-30', '2026-09-25'], want: 'F', why: '落后5天>3→产出连续多圈没挂动作=F' },
    { a: ['2026-09-30', null], want: 'F', why: '有判断但动作表无日期/不存在→无从证明落地=F不fail-open' },
    { a: ['2026-09-28', '2026-09-30'], want: 'P', why: '动作表比判断更新→不误杀(收工圈提前刷表也绿)' },
    { a: ['2026-09-30', '2026-09-30', 2], want: 'W', why: '同日但2格动作没挂情报服务行→裸奔W(判#1031反向条款)' },
    { a: ['2026-09-30', '2026-09-30', 0], want: 'P', why: '同日且零裸奔→全回路绿' },
    { a: ['2026-09-30', '2026-09-30', 0, 5], want: 'W', why: '表同日更新但回流台账最后记于5天前→换表盖尸逃跑通道W(判#1032)' },
    { a: ['2026-09-30', '2026-09-30', 0, 0], want: 'P', why: '表新+台账当日记→闭环回流全绿' },
    { a: ['2026-09-30', '2026-09-30', 0, null], want: 'W', why: '无台账段(判#1032前旧表或新开表未记账)→W不fail-open' },
    { a: ['2026-09-30', '2026-09-25', 3], want: 'F', why: '双断(滞后5天+3格裸奔)→F不被后参稀释' },
  ];
  const fails = [];
  cases.forEach((c, i) => {
    const r = actionLandingState(c.a[0], c.a[1], c.a[2], c.a[3]);
    if (r.status !== c.want) fails.push('用例' + (i + 1) + '(' + c.why + ') 期望 ' + c.want + ' 实得 ' + r.status);
  });
  if (fails.length) { console.error('❌ 产出动作对账 selftest FAIL：' + fails.length + '/' + cases.length + ' 断言不符'); fails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 产出动作对账 selftest PASS ' + cases.length + ' 断言全过（双向:同日P/滞后W/F/无表F/表更新不误杀/裸奔动作W）');
  process.exit(0);
}

// ── ㉝ 情报站点报告 selftest（判#1041·元首令 10-01「每个省建情报站点·每个地方情报要报告」·不报=断线必须能翻车）──
if (ARGS.includes('--selftest-station')) {
  const S = [{ id: 'trade', province: '投资·交易' }, { id: 'nation', province: '国家·宏观' }];
  const cases = [
    { a: [null, {}, '2026-10-01'], want: 'F', why: '名册缺失/空册→元首无省图=指挥失效·不 fail-open' },
    { a: [[], {}, '2026-10-01'], want: 'F', why: '册在但零站→空集不算绿(§④½)' },
    { a: [S, null, '2026-10-01'], want: 'F', why: '无任何呈报留痕(conversion-brief 未跑)=集体未报' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'reported' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01'], want: 'P', why: '两站同日已报→全回路绿' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'reported' }, nation: { lastReport: '2026-09-28', lastStatus: 'reported' } }, '2026-10-01'], want: 'F', why: '一站 3 天未报→军情断线=F 不静默' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'nosource' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01'], want: 'W', why: '报了但无米(源断)→W 要补喂不致断线' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'silent' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01'], want: 'F', why: '站点自报未报(段落缺失)→失职=F' },
    { a: [S, { trade: { lastReport: '2026-10-02', lastStatus: 'reported' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01'], want: 'P', why: '时钟倒挂(报生日在未来)→不误炸当新报' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01'], want: 'F', why: '名册里有站但台账无此站(从未报过)→F 不因局部新鲜稀释' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'reported' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01', [{ province: '投资·交易', missing: ['跟踪信号站(断供 3 天)'] }]], want: 'W', why: '省站全报但市站断供→治理分级：记省账 W 不升元首桌 F(判#1043)' },
    { a: [S, { trade: { lastReport: '2026-09-28', lastStatus: 'reported' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01', [{ province: '国家·宏观', missing: ['CPI站'] }]], want: 'F', why: '省站失职+市站断供双病→F 优先进先杀不降级' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'reported' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01', []], want: 'P', why: '空市站故障集不稀释绿(空集不算病也不装病)' },
    { a: [S, { trade: { lastReport: '2026-10-01', lastStatus: 'reported' }, nation: { lastReport: '2026-10-01', lastStatus: 'reported' } }, '2026-10-01', undefined], want: 'P', why: '未传市站普查(旧调用方)→不崩不误判·维持原判' },
  ];
  const sfails = [];
  cases.forEach((c, i) => {
    const r = stationReportState(c.a[0], c.a[1], c.a[2], c.a[3]);
    if (r.status !== c.want) sfails.push('用例' + (i + 1) + '(' + c.why + ') 期望 ' + c.want + ' 实得 ' + r.status);
  });
  if (sfails.length) { console.error('❌ 站点报告维 selftest FAIL：' + sfails.length + '/' + cases.length + ' 断言不符'); sfails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 站点报告维 selftest PASS ' + cases.length + ' 断言全过（双向:缺册F/零站F/无账F/全报P/断报F/无米W/失职F/倒挂不误杀/漏站F/市站断供W/双病F优先/空集不稀释/旧调用不崩）');
  process.exit(0);
}

// JSONL 拆行助手（2026-08-06 判断#144延伸）：两对象挤一行/残余垃圾 → 按括号配平拆出完整对象
function splitJsonlLine(ln) {
  const objs = [];
  let rest = ln;
  while (rest.trim()) {
    let depth = 0, inStr = false, esc = false, cut = -1;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (esc) { esc = false; continue; }
      if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { cut = i + 1; break; } }
    }
    if (cut < 0) return null; // 无法配平 → 放弃
    try { objs.push(JSON.parse(rest.slice(0, cut))); } catch (e) { return null; }
    rest = rest.slice(cut);
  }
  return objs.length ? objs : null;
}

function check(name, status, detail, link = '') {
  radar.items.push({ name, status, detail, link });
  if (status !== 'P') radar.anomalies.push({ name, status, detail, link });
}

// ── ㉞ 伪调用自巡检 selftest（判#1062 病根·由内而外全系统：报告点名的卡必伴当日 Read 留痕·纯函数双向测）──
if (ARGS.includes('--selftest-fakecall')) {
  const RPT = (tail) => '## 情报研判\n**📖 书库校准**\n· 《周期》KC-BOOK-022：x\n· KC-FIGURE-005：y\n' + tail;
  const callsOf = (cards, d) => cards.map(c => JSON.stringify({ ts: d + 'T09:00:00+08:00', card: c, action: 'zhenRead' })).join('\n');
  const D = '2026-10-02';
  const cases = [
    { a: [null, '', D], want: 'P', why: '无研判报告→无从判·非报告日不硬判绿' },
    { a: ['## 普通日报\n无卡声明\n', '', D], want: 'P', why: '报告无书卡/人物卡处理声明→不误报非研判产物' },
    { a: [RPT(''), '', D], want: 'F', why: '点名2卡但当日零Read留痕→伪调用复发F(空集不判绿)' },
    { a: [RPT(''), callsOf(['KC-BOOK-022', 'KC-FIGURE-005'], D), D], want: 'P', why: '点名卡当日均有zhenRead→真调用闭环P' },
    { a: [RPT('· KC-FIGURE-001：z\n'), callsOf(['KC-BOOK-022', 'KC-FIGURE-005'], D), D], want: 'W', why: '引了KC-FIGURE-001却没读当日→残留W' },
    { a: [RPT(''), callsOf(['KC-BOOK-022', 'KC-FIGURE-005'], '2026-10-01'), D], want: 'F', why: 'Read留痕非当日(隔日旧痕冒充)→当日零读F' },
  ];
  const fails = [];
  cases.forEach((c, i) => { const r = fakeCallState(c.a[0], c.a[1], c.a[2]); if (r.status !== c.want) fails.push('用例' + (i + 1) + '(' + c.why + ') 期望' + c.want + ' 实得' + r.status); });
  if (fails.length) { console.error('❌ 伪调用维 selftest FAIL：' + fails.length + '/' + cases.length); fails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 伪调用维 selftest PASS ' + cases.length + ' 断言全过（无报告P/无声明P/零读F/全读P/漏读W/隔日冒充F）');
  process.exit(0);
}

// 回填行形唯一源（判#1416）：`> - [KC-BOOK/FIGURE-数字] 思考`。
//   const 声明不提升——selftest 段在文件更靠前处消费它，故此处必须早于 ㉟ 的 selftest 段定义（实测踩过 TDZ）。
const BRAIN_FILL_RE = /^>\s*-\s*\[KC-(?:BOOK|FIGURE)-\d+\]\s*(\S.*)$/;

// ── ㉟ 用户大脑泵 selftest（判#1132·人脑环检测端·纯函数双向测：回填P/泵停W/样本0不判绿/窗口边界/前置失效守卫）──
// 判#1416 加第三段：**行形解析**也要被测——否则「样本筛选对了、行形正则又错」会以同样的方式静默复发
// （判#1220 修标题、漏筛选用例，正是这个形态：函数被 5 条断言测着全绿，接上真文件却恒 0 样本）。
if (ARGS.includes('--selftest-brainpump')) {
  const Dl = (n) => { const t = new Date(Date.now() - n * 864e5); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const cases = [
    { a: [{ date: Dl(1), filled: true }, { date: Dl(3), filled: false }], want: 'P', why: '近7天有回填→P泵在转' },
    { a: [{ date: Dl(2), filled: false }, { date: Dl(5), filled: false }], want: 'W', why: '近7天0回填→W泵停' },
    { a: [], want: 'W', why: '样本0不判绿（无🧠段日报）' },
    { a: [{ date: Dl(9), filled: true }], want: 'W', why: '唯一回填在9天前(出7天窗)→W不误判绿' },
    { a: [{ date: Dl(0), filled: true }], want: 'P', why: '前置失效守卫：有内容必须能翻P(证非恒W)' },
  ];
  const fails = [];
  cases.forEach((c, i) => { const r = brainPumpState(c.a); if (r.status !== c.want) fails.push('用例' + (i + 1) + '(' + c.why + ') 期望' + c.want + ' 实得' + r.status); });
  // 行形解析（真文件同一把尺）：正例必须被判已填，负例（教学行/短思考/别段行）必须判未填
  const parseSeg = (s) => s.split('\n').some(l => { const m = l.match(BRAIN_FILL_RE); return !!(m && m[1].trim().length >= 1); });
  const parseCases = [
    { s: '> - [KC-BOOK-011] 这本书讲的复利其实是机制不是意志力', want: true, why: '正例：卡号+思考≥2字=已填' },
    { s: '> - 格式：`> - [KC-BOOK-xxx] 你的思考`（同卡·思考≥2字算有效）', want: false, why: '负例：回填教学行不许算已填（原实现的假P）' },
    { s: '> - [KC-FIGURE-007] 好', want: true, why: '正例：人物卡同样接得住' },
    { s: '> - [KC-BOOK-011]   ', want: false, why: '负例：只有卡号没思考=空槽' },
    { s: '> - 今日待挖：KC-BOOK-011', want: false, why: '负例：灌入清单行不许冒充回填' },
  ];
  parseCases.forEach((c, i) => { const got = parseSeg(c.s); if (got !== c.want) fails.push('行形用例' + (i + 1) + '(' + c.why + ') 期望' + c.want + ' 实得' + got); });
  if (fails.length) { console.error('❌ 用户大脑泵 selftest FAIL：' + fails.length + '/' + (cases.length + parseCases.length)); fails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 用户大脑泵 selftest PASS ' + (cases.length + parseCases.length) + ' 断言全过（回填P/泵停W/样本0/窗口边界/前置失效守卫/行形双向）');
  process.exit(0);
}

// ── ㊲ 量取无来源 侦测（判#1237·根卡 v5.4.26「量取同槽律」的机器眼）──
// 治本 AI 第 5 次复发「用推断代替查证」：数字宣称必须与量取手段同槽（命令 or [来源:]）。
// 判据唯一源＝根卡 KC-SYS-001 v5.4.26；执行面＝KC-SYS-036 证据门③ / KC-STANDARD-018 量取段。
// 纯函数：输入判断段数组 → 输出 P/W；样本 0 不判绿（根卡检测律·测不了不判真假）。
function measureNoSourceState(segs) {
  const RE_NUM = /(?<![\w#])(\d{2,})(?![\w%])/g;          // 2 位以上裸数字（跳过 "判#N" 与 1M/200K 这类单位写法）
  const RE_SRC = /\[来源[:：]|`[^`]*(?:grep|node|powershell|python|Select-String|Measure-Object|Get-ChildItem|wc -l|findstr)[^`]*`|（[^）]*(?:实测|命令)[^）]*）|\(实测[^)]*\)/;
  let scoped = 0;                                          // 实际检查到的段数（有数字的段）
  const bad = [];
  for (const s of (segs || [])) {
    const body = String(s && s.body || '');
    if (!body) continue;
    const nums = body.match(RE_NUM);
    if (!nums || new Set(nums).size < 3) continue;         // 少于 3 个不同数字=非"量取宣称"
    scoped++;
    if (!RE_SRC.test(body)) bad.push((s && s.title ? String(s.title).slice(0, 30) : '(无题)') + ':' + new Set(nums).size + '个数字无来源');
  }
  if (scoped === 0) return { status: 'W', msg: '样本 0：窗口内无「多数字判断段」→不判绿（根卡检测律·查是窗口太窄还是真无）', scoped: 0 };
  if (bad.length) return { status: 'W', msg: bad.length + '/' + scoped + ' 段含 3+ 数字却无量取手段同槽（补命令或 [来源:]）：' + bad.slice(0, 5).join(' · '), scoped };
  return { status: 'P', msg: scoped + ' 段多数字宣称均带量取来源（根卡 v5.4.26 量取同槽律）', scoped };
}
if (ARGS.includes('--selftest-measure-source')) {
  const S = (t, b) => ({ title: t, body: b });
  const cases = [
    { a: [S('有来源', '3 个模型 12 个可用 [来源: C:/x.js]')], want: 'W', why: '前置失效守卫：仅 2 个不同数字<3 → scoped=0 → 样本0不判绿（证非恒P）' },
    { a: [S('多数字无来源', '共 24 个模型 52 条策略 156 行配置都齐了')], want: 'W', why: '3 数字无来源→W（能翻车）' },
    { a: [S('多数字有命令', '共 24 个模型 52 条 156 行：`node x.js | Measure-Object -Sum`')], want: 'P', why: '带反引号命令→P' },
    { a: [S('多数字有来源标记', '24 个 52 条 156 行 [来源: ~/.dsh/cordis.patch.yml]')], want: 'P', why: '带[来源:]→P' },
    { a: [S('有来源但带实测括注', '24 个 52 条 156 行（实测 grep 查）')], want: 'P', why: '中文括注实测→P' },
    { a: [S('少量数字', '共 24 个模型')], want: 'W', why: '仅 1 个数字→非量取宣称→scoped=0→样本0(W)·不误报' },
    { a: [], want: 'W', why: '空集→样本0不判绿（根卡检测律·测不了≠测出无）' },
    { a: [S('跳过判号与单位', '判#1237 说 200K 窗口下 1048576 与 262144 差 4 倍')], want: 'W', why: '数字虽多但含判号/单位干扰仍应可判（此例无来源→W）' },
  ];
  const fails = [];
  cases.forEach((c, i) => { const r = measureNoSourceState(c.a); if (r.status !== c.want) fails.push('用例' + (i + 1) + '(' + c.why + ') 期望' + c.want + ' 实得' + r.status + ' ' + r.msg); });
  if (fails.length) { console.error('❌ 量取无来源 selftest FAIL：' + fails.length + '/' + cases.length); fails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 量取无来源 selftest PASS ' + cases.length + ' 断言全过（多数字无源W/带命令P/带[来源]P/少量数字不误报/样本0不冒P）');
  process.exit(0);
}

// ── ① 单点故障面：启动链脚本存在 + 语法有效 ──
const chain = [
  ['gate-check.sh', '.claude/hooks/gate-check.sh', 'sh'],
  ['settle-session.ps1', 'vault-scripts/settle-session.ps1', 'ps1'],
  ['auto-settle.js', 'vault-scripts/auto-settle.js', 'js'],
  ['memory-sync.js', 'vault-scripts/memory-sync.js', 'js'],
  ['atomic-write.js', 'vault-scripts/atomic-write.js', 'js'],
];
let chainBad = [];
for (const [name, rel, type] of chain) {
  const fp = path.join(VAULT, rel);
  if (!fs.existsSync(fp)) { chainBad.push(`${name}缺失`); continue; }
  try {
    if (type === 'sh') {
      // 2026-08-08 根治（永久机制#39）：PowerShell 环境 node 调 bash 解析到 WindowsApps WSL 桩
      // （读不了 D:/... Windows 路径 → No such file）→ 误报「语法错」。
      // 显式用 Git Bash（存在时），否则回退 bash。
      const gitBash = 'C:/Program Files/Git/bin/bash.exe';
      const bashCmd = fs.existsSync(gitBash) ? `"${gitBash}" -n` : 'bash -n';
      execSync(`${bashCmd} "${fp.replace(/\\/g, '/')}"`, { stdio: 'pipe' });
    }
    if (type === 'js') execSync(`node --check "${fp}"`, { stdio: 'pipe' });
    if (type === 'ps1') execSync(`powershell -NoProfile -Command '$e=@(); [void][System.Management.Automation.Language.Parser]::ParseFile("${fp}",[ref]$null,[ref]$e); if($e.Count){exit 1}'`, { stdio: 'pipe' });
  } catch (e) { chainBad.push(`${name}语法错`); }
}
check('单点故障面', chainBad.length ? 'W' : 'P',
  chainBad.length ? `启动链脆弱: ${chainBad.join(', ')}` : '启动链5脚本齐全且语法有效',
  chainBad.length ? 'vault-scripts/' : '');

// ── ② 新鲜度：关键数据源最近修改距今 ──
const fresh = [
  ['handoff', 'vault-data/_session-handoff.md', 3],
  ['session-record', 'vault-scripts/session-record.json', 3],
  ['audit-todo', 'vault-data/audit-todo.jsonl', 7],
  ['card-flow', 'vault-data/card-flow-index.md', 7],
];
let stale = [];
for (const [name, rel, days] of fresh) {
  const fp = path.join(VAULT, rel);
  if (!fs.existsSync(fp)) { stale.push(`${name}缺失`); continue; }
  const age = now - fs.statSync(fp).mtimeMs;
  if (age > days * DAY) stale.push(`${name}${Math.round(age / DAY)}天未更新`);
}
check('新鲜度', stale.length ? 'W' : 'P',
  stale.length ? `数据源陈旧: ${stale.join(', ')}` : '关键数据源均新鲜（<3天）');

// ── 判#1348 纯函数：缺失检测该查哪个根 ──
// unshared:true = gitignored 的运行时产物（如 .next-step 唯一接力面）→ 只维护在主树·库位内不判缺失
// 其余（入库文件·随 worktree 复制）→ 查当前树
function missingProbeBase(it, curRoot, mainRoot) {
  const unshared = (it && typeof it === 'object' && !!it.unshared);
  return unshared ? mainRoot : curRoot;
}

// ── ③ 缺失检测：应存在但缺失的关键文件（天团盲区③：扫"无"）──
//   病：`.next-step` 是 gitignored（`.gitignore` 的 `vault-data/.*`），git worktree **不复制未跟踪文件**
//     → 实测主树有（36958 字节）·四棵库位（DSH/codex/cursor/千问办公）**全无**
//     → `fs.existsSync(path.join(VAULT,'vault-data/.next-step'))` 在**任何库位内恒 false**
//     → radar 「缺失检测」恒 ❌「缺=最大风险源」，且这条最刺眼的话指向一个**库位下永远补不上的文件**（假红）。
//   修法（与判#1336/#1337 同一把尺）：把 required 条目声明为 `{ rel, unshared }`——
//     `unshared:true` = 「gitignored 的运行时产物·只在主树维护」→ 在库位内**不判缺失**（改判主树）。
//     主树仍照旧判（零回归）；库位内改看**主树那份**是否存在（该文件是全系统共用一份，本就该看主树）。
//   为什么不用「库位内自己造一份」：`.next-step` 是**唯一接力面**（多AI共用一份·见其自述），
//     各库位各造一份=把唯一接力面拆成 N 份平行台账，正是判#732 要治的平行病。
const GITDIR_R = (() => {
  try {
    const d = String(require('child_process').execFileSync('git', ['-C', VAULT, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' })).trim();
    if (!d) return path.join(VAULT, '.git');
    return path.isAbsolute(d) ? d : path.resolve(VAULT, d);
  } catch { return path.join(VAULT, '.git'); }
})();
// 主树根 = git-common-dir 的上两级（<主树>/.git）；用 git 自己回答，不硬拼
const MAIN_ROOT = (() => {
  const parts = GITDIR_R.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length >= 1 && parts[parts.length - 1] === '.git') return parts.slice(0, -1).join('/');
  return VAULT;   // 非标准布局时退化为当前根（不臆断）
})();
const required = [
  { rel: 'vault-data/.next-step', unshared: true },  // 会话接续源（AI写·gitignored·唯一接力面·只在主树）
  { rel: 'vault-data/_session-handoff.md' },         // 唯一最新交接（memory-sync生成）
  { rel: 'vault-data/permanent-fixes.md' },          // 永久机制台账
  { rel: 'vault-data/card-flow-index.md' },          // 卡流通索引
  { rel: '02-Areas · 资产/原则/KC-CONST-001-宪法核心.md' }, // 原则卡
];
let missing = [];
for (const it of required) {
  const rel = typeof it === 'string' ? it : it.rel;
  const base = missingProbeBase(it, VAULT, MAIN_ROOT);
  if (!fs.existsSync(path.join(base, rel))) missing.push(rel.split('/').pop());
}

// ── 判#1348 缺失检测判据 selftest（放在 missingProbeBase/MAIN_ROOT 定义之后·TDZ 安全）──
if (ARGS.includes('--selftest-missing')) {
  const V = 'D:/Vault-wt/DSH', M = 'D:/Vault';
  const cases = [
    { it: { rel: 'vault-data/.next-step', unshared: true }, want: M, why: 'gitignored 产物→查主树（库位下无此文件·不判缺失）' },
    { it: { rel: 'vault-data/_session-handoff.md' }, want: V, why: '入库文件→查当前树（随 worktree 复制）' },
    { it: 'vault-data/card-flow-index.md', want: V, why: '字符串形态（旧式）→默认查当前树·向后兼容' },
    { it: { rel: 'vault-data/x.md', unshared: false }, want: V, why: '显式 false→查当前树' },
    { it: { rel: 'vault-data/.next-step' }, want: V, why: '未标 unshared→按普通文件查当前树（不隐式豁免）' },
  ];
  const mfails = [];
  cases.forEach((c, i) => {
    const got = missingProbeBase(c.it, V, M);
    if (got !== c.want) mfails.push('用例' + (i + 1) + '(' + c.why + ') 期望 ' + c.want + ' 实得 ' + got);
  });
  // 负控①：主树根为空时 unshared 仍指主树（不回落当前树·防静默放宽）
  if (missingProbeBase({ rel: 'a', unshared: true }, V, '') !== '') mfails.push('负控①：主树根为空时 unshared 仍应指主树');
  // 负控②：真·行为——库位内无 .next-step 而主树有 → 判据应判「存在」（这正是本修复要治的假红）
  const pth = require('path');
  const hasInV = fs.existsSync(pth.join(VAULT, 'vault-data/.next-step'));
  const hasInM = fs.existsSync(pth.join(MAIN_ROOT, 'vault-data/.next-step'));
  const judgedBase = missingProbeBase({ rel: 'vault-data/.next-step', unshared: true }, VAULT, MAIN_ROOT);
  const judged = fs.existsSync(pth.join(judgedBase, 'vault-data/.next-step'));
  if (VAULT !== MAIN_ROOT && !hasInV && hasInM && !judged) mfails.push('负控②：库位内无/主树有 → 应判存在（实得缺失）');
  const mfail = mfails.filter(Boolean);
  const total = cases.length + 2;
  if (mfail.length) { console.error('❌ 缺失检测判据 selftest FAIL：' + mfail.length + '/' + total); mfail.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 缺失检测判据 selftest PASS ' + total + ' 断言全过（unshared→主树/入库→当前树/旧式兼容/两个负向控）');
  process.exit(0);
}

check('缺失检测', missing.length ? 'F' : 'P',
  missing.length ? `应存在但缺失: ${missing.join(', ')}` : '关键资产无缺失',
  missing.length ? '缺=最大风险源，优先补' : '');

// ── ④ owner：permanent-fixes 机制有物理/自动落点比例 ──
// 2026-08-05 自优化：原正则(/回检|自动|物理门|每次/)漏脚本/门落点
// （gpu-info.ps1/fix-gpu-freeze等有脚本落点被误判孤儿）→ 扩展识别落点词
try {
  const pf = fs.readFileSync(path.join(VD, 'permanent-fixes.md'), 'utf-8');
  const rows = pf.split('\n').filter(l => l.trim().startsWith('|') && l.includes('✅'));
  const withOwner = rows.filter(l => /回检|自动|物理门|每次|定期|下次|校验|拦截|\.ps1|\.js|\.py|gate|hook|启动|settle|脚本|门|注册表/.test(l)).length;
  const ratio = rows.length ? Math.round(withOwner / rows.length * 100) : 0;
  check('机制owner', ratio >= 60 ? 'P' : 'W',
    `永久机制${rows.length}条，有回检/自动标记 ${withOwner}条(${ratio}%)`,
    ratio < 60 ? '孤儿机制=死卡，需补回检锚点' : '');
} catch (e) {
  check('机制owner', 'W', 'permanent-fixes 读取失败');
}

// ── ⑤ JSON 完整性（复用写入宪法）── 闭环：发现→自动git恢复→验证→下次不复发
// 2026-08-05 v1.43.0 补闭环：原只报不修（console.log即止）→ 发现损坏自动从 git HEAD 恢复
let jsonBad = [], jsonRepaired = [], jsonBom = [];
try {
  const { validate, atomicWrite } = require('./atomic-write');
  for (const f of fs.readdirSync(VD)) {
    if (!/\.jsonl?$/.test(f)) continue;
    const fp = path.join(VD, f);
    let ok = true;
    try {
      let raw = fs.readFileSync(fp, 'utf-8');
      // 判#1435：**检测端不再判死 BOM，改成剥掉后照常校验 + 单独记一笔**。
      //   病（本圈钉死）：原来把 BOM 直接判死 ⇒ ①文件其实完全可解析（BOM+合法JSON）却报「JSON完整性❌」；
      //     ②连带堵死下面的「自动从 git HEAD 恢复」——因为 HEAD 那份也有 BOM；③只能报「HEAD也坏→待人工」，
      //     一条自愈路都走不通。
      //   判断权归属：**BOM 是写入方的缺陷，不是这份数据的缺陷**。检测端的职责是判定「内容能不能读」，
      //     不是「字节长得符不符合我的口味」（判#1036 尺的错先分诊）。
      if (raw.charCodeAt(0) === 0xFEFF) { jsonBom.push(f); raw = raw.slice(1); }
      validate(raw, f.endsWith('.jsonl') ? 'jsonl' : 'json');
    } catch (e) { ok = false; }
    if (!ok) {
      // 闭环：自动从 git HEAD 恢复（git 追踪 53 个 JSON，可作恢复源）
      try {
        const head = execSync(`git -C "${VAULT}" show HEAD:vault-data/${f}`, { stdio: 'pipe' }).toString().replace(/^\uFEFF/, '');   // 判#1435：剥 BOM 再当恢复源，避免把 BOM 又写回去
        const kind = f.endsWith('.jsonl') ? 'jsonl' : 'json';
        // 判#1435：HEAD 那份带 BOM 时**剥掉照用**，不再抛错——否则两条自愈路（git恢复/拆行）全断，
        //   最后只能报「HEAD也坏→待人工」，而这个文件本来完全可解析。
        validate(head.replace(/^\uFEFF/, ''), kind);
        atomicWrite(fp, head, { validate: kind }); // 原子写回
        jsonRepaired.push(f);
      } catch (e) {
        // HEAD 也坏 → 试 JSONL 拆行自愈（同类13次：两对象挤行/残余垃圾，括号配平拆行）
        let splitOk = false;
        if (f.endsWith('.jsonl')) {
          try {
            let raw = fs.readFileSync(fp, 'utf-8');
            if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // 判#1435：剥掉照拆，不再因 BOM 放弃自愈
            for (const ln of raw.split('\n')) {
              if (!ln.trim()) continue;
              const objs = splitJsonlLine(ln);
              if (objs === null) { out.push(ln); continue; } // 该行正常或无法拆
              if (objs.length === 1 && ln.trim() === JSON.stringify(objs[0])) { out.push(ln); continue; }
              for (const o of objs) out.push(JSON.stringify(o));
            }
            atomicWrite(fp, out.join('\n') + '\n', { validate: 'jsonl' });
            jsonRepaired.push(f + '(拆行自愈)');
            splitOk = true;
          } catch (e2) {}
        }
        if (!splitOk) jsonBad.push(f);
      }
    }
  }
} catch (e) { jsonBad.push('atomic-write不可用'); }
const jsonDetail = jsonBad.length
  ? `无法自动修复: ${jsonBad.join(', ')}`
  : (jsonRepaired.length ? `自动修复 ${jsonRepaired.length} 个: ${jsonRepaired.join(', ')}` : '全部JSON/JSONL合法+UTF-8纯净');
// 判#1435：BOM 单独报。它是**写入方的错**（PS5.1 的 Set-Content -Encoding UTF8 必写 BOM），
//   不是这份数据的错——剥掉 BOM 后内容完全合法。所以强度是 W，措辞指向写入方，
//   避免把「字节不洁」和「数据读不出来」混成一条 ❌（混在一起就没人分得清该修谁）。
const bomDetail = jsonBom.length
  ? `${jsonDetail} ｜ BOM污染 ${jsonBom.length} 个: ${jsonBom.join(', ')}（内容可读·写入方未用无BOM写·判#1435）`
  : jsonDetail;
check('JSON完整性', jsonBad.length ? 'F' : (jsonBom.length ? 'W' : 'P'), bomDetail,
  jsonBad.length ? '损坏源：写入未走atomic-write，HEAD也坏→待人工'
    : (jsonBom.length ? 'BOM 由 PS5.1 的 Set-Content -Encoding UTF8 写入·改用 .NET UTF8Encoding($false)（判#1435）'
      : (jsonRepaired.length ? '已闭环：发现→git恢复→验证' : '')));
if (REPAIR_ONLY) { // 问题出现即自动修模式：只跑JSON自愈，静默退出（observe.sh调用）
  if (jsonRepaired.length) console.log(`⚙️ [实时自愈] JSON修复 ${jsonRepaired.length} 个: ${jsonRepaired.join(', ')}`);
  process.exit(0);
}

// ── ⑬ 审计回流：读 vault-scripts/gate-audit.json 的 all_pass（第二方审计结论回流入雷达）──
// 判断#289 判断#290 报告审计 2026-08-29 根 α（自我确证闭环）：radar 不读 gate-audit 的 all_pass
// 第二方审计结论不能回流=雷达自己报绿，gate-audit 报 F，二者独立但同测系统=雷达是自我确证
// KC-SYS-052 第二方校验：radar 自身被审计对象覆盖，读 gate-audit 的 all_pass 作雷达第 13 维
let auditAllPass = null;
let auditAgeH = -1;
let auditFails = [];   // 判#1290：F 项从数据里长出来（原详情/提示写死「fail_items」——该字段根本不存在 ⇒ 提示不可执行 ⇒ ❌ 谁也关不掉·判#1289 现场）
try {
  const auditPath = path.join(VAULT, 'vault-scripts', 'gate-audit.json');
  const auditRaw = fs.readFileSync(auditPath, 'utf-8');
  if (auditRaw.charCodeAt(0) === 0xFEFF) throw new Error('BOM污染');
  const a = JSON.parse(auditRaw);
  auditAllPass = a.all_pass;
  // 真实结构：results[{item,status,detail}]（F 项在这里）；旧文案「第二方审计报F·雷达同步报F」也是硬猜（实测是 r12 闭环/断链）
  if (Array.isArray(a.results)) {
    auditFails = a.results.filter(r => r && String(r.status) === 'F')
      .map(r => `${r.item}：${String(r.detail || '').replace(/（[^）]*）/g, '').trim().slice(0, 60)}`);
  }
  // 判#869：与 gate r12 同款鲜度界——审计产物过期=旧账冒充现势（测不了≠假·过期≠真假）
  if (a.audit_time) {
    try { auditAgeH = Math.round((Date.now() - new Date(a.audit_time.replace(' ', 'T')).getTime()) / 36e5 * 10) / 10; } catch (e2) { auditAgeH = -1; }
  }
} catch (e) { auditAllPass = null; }
check('审计回流',
  auditAgeH > 24 ? 'W' : (auditAllPass === false ? 'F' : (auditAllPass === null ? 'W' : 'P')),
  auditAgeH > 24 ? `gate-audit.json 过期${auditAgeH}h·不判真假(判#869)——跑 gate 刷新`
    : (auditAllPass === false ? `gate-audit.json: all_pass=false（F ${auditFails.length} 项：${auditFails.slice(0, 3).join(' ｜ ') || '（results 里没有可读 F 项·查结构）'}·${auditAgeH}h前）`
    : (auditAllPass === null ? 'gate-audit.json 不可读或解析失败' : `gate-audit.json: all_pass=true（${auditAgeH}h前·判#869）`)),
  auditAllPass === false ? `逐项闭环：${auditFails.slice(0, 3).join(' ｜ ') || '看 vault-scripts/gate-audit.json 的 results[].status=F'}` : (auditAllPass === null ? '修 gate-audit.json 的 BOM 或 JSON 结构' : ''));

// ── ⑥ SOP 合规：扫所有 SOP 骨架（头部+尾部，参照 SOP统一模板.md 唯一源）──
// 2026-08-05 判断#135 根源：数据没按最新标准执行→健康雷达强制审计，不合规列 [F]
let sopBad = [];
try {
  const sopDir = path.join(VAULT, '05-Skills · 技能');
  // 判#1142 修复：原 readdirSync 不递归（SOP 全在子目录）→ 自 2026-08-12 迁移后扫空 39 天（永绿假门）；
  //   且按名只扫 *SOP* 漏 *管线* 系列 → 改 walk 递归 + (SOP|管线) 双名匹配（模板自身除外）。
  const sopFiles = [];
  const sopWalk = (d) => { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) sopWalk(p); else if (/(SOP|管线).*\.md$/.test(e.name) && e.name !== 'SOP统一模板.md') sopFiles.push(p); } };
  sopWalk(sopDir);
  for (const fp2 of sopFiles) {
    const content = fs.readFileSync(fp2, 'utf-8');
    const missing = [];
    if (!/> root:/.test(content)) missing.push('root');
    if (!/\*\*版本:\*\*/.test(content)) missing.push('版本');
    if (!/\*\*根因:\*\*/.test(content)) missing.push('根因');
    if (!/\*\*目的:\*\*/.test(content)) missing.push('目的');
    if (!/\*\*作用:\*\*/.test(content)) missing.push('作用');
    if (!/^## ⑥/m.test(content)) missing.push('⑥相关文件');
    if (!/^## ⑦/m.test(content)) missing.push('⑦版本历史');
    // 全系统根治四问（2026-08-06 用户确立：SOP不解决单点——解决全系统/由内而外/防复发/防新进入）
    // 4问命中≥2 才算全系统根治（含"由内而外"或"下次/防复发"即基本达标）
    const _gr = (/(全系统|不单点|服务系统)/.test(content) ? 1 : 0)
              + (/(由内而外|运行中长|从实际执行长)/.test(content) ? 1 : 0)
              + (/(下次启动|防复发|不出现相同|更好解决|根断)/.test(content) ? 1 : 0)
              + (/(新进入|新建.*查重|查重门|由内而外门|入口)/.test(content) ? 1 : 0);
    if (_gr < 2) missing.push('根治四问(全系统/由内而外/防复发/防新进入)');
    // 判#1151（用户问『版本记录怎么没有发挥作用』）：头表一致——升级三联动（头版本+表新行+内容）机器验——
    //   实锤：24 个 SOP 中 11 个头表脱节（只改头不记表 / 只加表不改头），版本记录自相矛盾=记录不可信=没作用。
    const _hv = (content.split(/\r?\n/).slice(0, 16).join('\n').match(/\*\*版本:\*\*\s*v([\d.]+)/) || [])[1];
    if (_hv) {
      const _vers = [...new Set((content.match(/\|\s*v[\d.]+\s*\|/g) || []).map(s => s.match(/v([\d.]+)/)[1]))];
      const _nm = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); } return 0; };
      const _maxv = _vers.length ? _vers.slice().sort(_nm)[_vers.length - 1] : '';
      if (!_maxv || _nm(_maxv, _hv) !== 0) missing.push(`版本头表脱节(头v${_hv}/表v${_maxv || '无'})`);
    }
    if (missing.length) sopBad.push(`${path.basename(fp2, '.md')}缺${missing.join('/')}`);
  }
} catch (e) { sopBad.push('扫描失败'); }
check('SOP合规', sopBad.length ? 'F' : 'P',
  sopBad.length ? `不合规: ${sopBad.join(', ')}` : '全部SOP骨架统一(头部+尾部)',
  sopBad.length ? '参照 05-Skills·技能/SOP统一模板.md 补骨架' : '');

// ── ⑦ 定时任务配置：Vault-* + ProxyHub 须 StartWhenAvailable=True + 允许电池（判断#143 根治；#660 扩展）──
// 2026-08-06 根因：Heartbeat/Intel 曾 StartWhenAvailable=False+拒电池 → 错过定时点失败(0x800710E0)
// 2026-09-22 #660 扩展：ProxyHub/Clash-* 等非 Vault- 前缀守护任务纳入检查（判断#652 代理统一治理延伸）
let taskBad = [];
try {
  // execFileSync 免 shell 解析，引号安全（execSync 在 cmd 下会吃内层引号）
  const tOut = execFileSync('powershell.exe',
    ['-NoProfile', '-Command',
      "Get-ScheduledTask | Where-Object {$_.TaskName -like 'Vault*' -or $_.TaskName -like 'Proxy*' -or $_.TaskName -like 'Clash*'} | ForEach-Object { $_.TaskName + '=' + $_.Settings.StartWhenAvailable + '/' + $_.Settings.DisallowStartIfOnBatteries }"],
    { encoding: 'utf8', timeout: 20000 });
  for (const ln of tOut.split(/\r?\n/)) {
    const m = ln.match(/^(Vault[^=]*|Proxy[^=]*|Clash[^=]*)=(True|False)\/(True|False)/);
    if (!m) continue;
    const name = m[1];
    if (m[2] !== 'True' || m[3] !== 'False') {
      taskBad.push(`${name}(StartWhenAvail=${m[2]}/拒电池=${m[3]})`);
    }
  }
  const hasHub = /ProxyHub/i.test(tOut);
  if (!taskBad.length && !/Vault-/.test(tOut)) taskBad.push('未发现Vault-任务');
  if (!taskBad.length && !hasHub) taskBad.push('未发现ProxyHub守护任务(判断#652)');
} catch (e) { taskBad.push('扫描失败: ' + e.message); }
check('定时任务配置', taskBad.length ? 'F' : 'P',
  taskBad.length ? `配置漂移: ${taskBad.join(', ')}` : 'Vault-*/ProxyHub/Clash-* 配置合规',
  taskBad.length ? 'Set-ScheduledTask 对齐(StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)' : '');

// ── ㊲ 定时任务「真跑没跑」──────────────────────────────────
// 【实测病灶·本维出生原因】10-14 15:30 起 Vault-Trade-Dragon/Review 静默停摆 7 天；
//   radar ⑦ 每小时都跑、看到 StartWhenAvailable=True → **判绿**。
//   **配置对 + 任务不跑 = 永绿假**：⑦ 查的是"该怎么跑"，没人查"上次跑了没"。
//   trade-daily.log 里有硬证据：10-13 16:00 REVIEW OK 之后，只有人手动跑的"决策日报"，定时相位全空。
// 【判据】以 trade-daily.log / 各任务日志的**最后一条真实执行时间戳**为准，超期=红。
//   不看配置文件、不看任务状态（Task State 会因为"就绪"而骗人），只看产物。
const CADENCE = [
  { name: 'Vault-Trade-Brief',  log: 'trade-daily.log',  pat: /BRIEF (\d{4}-\d{2}-\d{2})/,  maxDays: 2, expectWeekday: true },
  { name: 'Vault-Trade-Dragon', log: 'trade-daily.log',  pat: /DRAGON (\d{4}-\d{2}-\d{2})/, maxDays: 2, expectWeekday: true },
  { name: 'Vault-Trade-Review', log: 'trade-daily.log',  pat: /REVIEW (\d{4}-\d{2}-\d{2})/, maxDays: 2, expectWeekday: true },
];
let cadenceBad = [];
let cadenceSeen = 0;
for (const c of CADENCE) {
  const lp = path.join(VAULT, 'vault-scripts', c.log);
  try {
    if (!fs.existsSync(lp)) { cadenceBad.push(`${c.name}(日志缺失)`); continue; }
    const txt = fs.readFileSync(lp, 'utf8');
    const hits = [...txt.matchAll(new RegExp(c.pat, 'g'))].map(m => m[1]);
    if (!hits.length) { cadenceBad.push(`${c.name}(日志中 0 次成功记录=样本为0)`); continue; }
    const last = hits[hits.length - 1];
    const ageDays = Math.floor((Date.now() - new Date(last + 'T23:59:59').getTime()) / DAY);
    cadenceSeen++;
    if (ageDays > c.maxDays) cadenceBad.push(`${c.name}(上次 ${last}·${ageDays}天前·应≤${c.maxDays})`);
  } catch (e) { cadenceBad.push(`${c.name}(读失败: ${e.message})`); }
}
// 样本为0不判绿：三个任务一条成功记录都没读到 = 检查本身失效，不是任务健康
check('定时任务真跑没跑', cadenceBad.length ? 'F' : (cadenceSeen === 0 ? 'F' : 'P'),
  cadenceSeen === 0 ? '样本为0·无从判断（不判绿）'
    : (cadenceBad.length ? `停摆: ${cadenceBad.join(', ')}` : `${cadenceSeen} 个任务均在时限内真跑过`),
  cadenceBad.length ? '查 vault-scripts/trade-daily.log 断点·确认任务是否被禁用/报错；根治口径见本判 -check' : '');

// ── ㊱ 超速红线（判#1354·生存红线②日形·判#833）：机器不得偷偷加人肉班次 ──
// 【为什么这一维·红线原文两半】①「机器班表任何人无权加人肉班次」②「人的四格若超 7分/天=机制在吸血生命·裁机制不裁人」。
//   实测：全库 grep 「四格|7分|人力格|人肉班次」在 vault-scripts 下 **0 个脚本命中** —— 这条生存红线**零机器身体**（同判#1349 资本命根装门前的状态）。
// 【判据为什么这么定·判#1237 量取同槽】机器**看不到人实际花了几分钟**，假装测量时间=假判据。
//   可测且与原文同一件事的是「**机器往人面前推了多少个动作位**」——「加人肉班次」加的就是动作位，四格就是四个动作位。
//   故：统计「需人处理」的产物种类数（盘前简报/复盘提醒/决策日报/内容出库/周检），>4 即超速。
//   为什么用「种类」不用「篇数」：同一天出 3 篇复盘仍是一次「勾一笔」；种类才是人的动作次数。
const HUMAN_SLOTS = [
  { key: '盘前简报', dir: '00-Inbox · 收件箱/盘前简报' },
  { key: '复盘提醒', dir: '00-Inbox · 收件箱/复盘提醒' },
  { key: '决策日报', dir: '00-Inbox · 收件箱/决策日报' },
  { key: '内容出库', dir: '01-Projects · 项目/内容管线/out' },
  { key: '周检',     dir: '00-Inbox · 收件箱/周检' },
];
// 纯函数：给「今天各目录是否有新增」→ 实际占用动作位数（可单测）
function humanSlotsUsed(freshFlags, cap = 4) {
  const used = (freshFlags || []).filter(Boolean).length;
  return { used, cap, over: used > cap };
}
// ── 判#1354 超速红线判据 selftest（纯函数·能翻车才算门）──
if (ARGS.includes('--selftest-slots')) {
  const cases = [
    { a: [[false, false, false, false, false], 4], want: { used: 0, over: false }, why: '今日无动作位→合规' },
    { a: [[true, false, false, false, false], 4], want: { used: 1, over: false }, why: '一格→合规' },
    { a: [[true, true, true, true, false], 4], want: { used: 4, over: false }, why: '正好四格→合规（边界不误伤）' },
    { a: [[true, true, true, true, true], 4], want: { used: 5, over: true }, why: '五格→超速（核心）' },
    { a: [[], 4], want: { used: 0, over: false }, why: '空输入不炸' },
    { a: [null, 4], want: { used: 0, over: false }, why: 'null 不炸' },
    { a: [[true, true], 1], want: { used: 2, over: true }, why: '自定义 cap 生效' },
  ];
  const sf = [];
  cases.forEach((c, i) => {
    const got = humanSlotsUsed(c.a[0], c.a[1]);
    if (got.used !== c.want.used || got.over !== c.want.over) {
      sf.push('用例' + (i + 1) + '(' + c.why + ') 期望 ' + JSON.stringify(c.want) + ' 实得 ' + JSON.stringify(got));
    }
  });
  // 负向控：四格边界必须不误伤（>4 才报·不是 >=4）
  if (humanSlotsUsed([true, true, true, true, false], 4).over !== false) sf.push('负控①：正好4格不得判超速（否则天天误报）');
  if (humanSlotsUsed([true, true, true, true, true], 4).over !== true) sf.push('负控②：5格必须判超速（否则红线失效）');
  const fail = sf.filter(Boolean);
  const total = cases.length + 2;
  if (fail.length) { console.error('❌ 超速红线 selftest FAIL：' + fail.length + '/' + total); fail.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log('✅ 超速红线 selftest PASS ' + total + ' 断言全过（0/1/4边界/5超速/空/null/自定义cap/两个负控）');
  process.exit(0);
}
let slotUsed = 0;
const slotFresh = [];
for (const s of HUMAN_SLOTS) {
  const d = path.join(VAULT, s.dir);
  let fresh = false;
  try {
    if (fs.existsSync(d)) {
      const dayMs = 24 * 3600 * 1000;
      fresh = fs.readdirSync(d, { recursive: true })
        .filter(f => /\.(md|txt|json)$/i.test(String(f)))
        .some(f => { try { return (Date.now() - fs.statSync(path.join(d, String(f))).mtimeMs) < dayMs; } catch { return false; } });
    }
  } catch { /* 目录不可读=不算占位·不臆断 */ }
  slotFresh.push(fresh);
  if (fresh) slotUsed++;
}
// 判#1354：判据走纯函数（可单测），不裸写比较——裸比较的单测只能测自己，测不到真路径
const slotVerdict = humanSlotsUsed(slotFresh, 4);
check('超速红线', slotVerdict.over ? 'F' : 'P',
  slotVerdict.over
    ? `人的动作位 ${slotVerdict.used} > 四格上限 ${slotVerdict.cap}（新增: ${HUMAN_SLOTS.filter((s, i) => slotFresh[i]).map(s => s.key).join('/')}）——机器在加人肉班次·吸血生命`
    : `人的动作位 ${slotVerdict.used}/${slotVerdict.cap}（${HUMAN_SLOTS.filter((s, i) => slotFresh[i]).map(s => s.key).join('/') || '今日无'}）`,
  slotVerdict.over
    ? '红线（判#833）：裁机制不裁人——把新增的那一格并进已有格或退掉，别让人为机制加班'
    : '');

// ── ⑭ 守护在位：直接扫 C:\Windows\System32\Tasks 目录（覆盖 2026-08-29 审计 C3「假绿」）──
// 判断#289 判断#290 报告审计 2026-08-29 根 α 最严重项：radar 报「定时任务配置 ✅」但实际系统无任何 Vault-* 任务
// ⑦ 用 Get-ScheduledTask（COM API）查；COM API 在某些环境下静默返回空但不报错→"假绿"
// 第 14 维改用文件系统直接扫 C:\Windows\System32\Tasks（任务文件=硬证据），交叉验证 ⑦
// KC-SYS-052 第二方校验：文件系统 vs COM API 两个独立数据源，任一报缺失即报 F/W
let taskDirs = 0;
let fsScanErr = '';
try {
  const tasksDir = 'C:\\Windows\\System32\\Tasks';
  if (fs.existsSync(tasksDir)) {
    taskDirs = fs.readdirSync(tasksDir).filter(f => /^Vault-|^vault-/i.test(f)).length;
  }
} catch (e) { fsScanErr = e.message; /* 权限不足或目录不可读，走第二意见 */ }
// 第二意见（2026-08-30 审计修复）：fs 扫描在本机读 System32\Tasks 为空（bash/Node 均复现）
// 但 Test-Path/Get-ScheduledTask 证实 8 个 Vault-* 任务文件真实在位——fs 单源判缺失=误报。
// KC-SYS-052 交叉验证保留：fs=0 时用 COM 探针复核，双源均缺失才判 F。
let comCount = -1;
if (taskDirs === 0) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-ScheduledTask -TaskName 'Vault*' -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { encoding: 'utf8', timeout: 20000 });
    comCount = parseInt(out.trim(), 10) || 0;
  } catch (e) { comCount = -1; }
}
const guardStatus = taskDirs > 0 ? 'P'
  : (comCount > 0 ? 'P' : (comCount === 0 ? 'F' : 'W'));
const guardDetail = taskDirs > 0
  ? `C:\\Windows\\System32\\Tasks 匹配 Vault-* 任务数=${taskDirs}`
  : (comCount > 0
    ? `fs扫描读0（本机盲区${fsScanErr ? '·' + fsScanErr : ''}）·COM探针实证 ${comCount} 个 Vault-* 任务在位——以COM为准`
    : (comCount === 0
      ? 'fs与COM双源均无 Vault-* 任务——守护不在位'
      : `fs扫描读0且COM探针不可用${fsScanErr ? '（fs: ' + fsScanErr + '）' : ''}——守护状态不可证`));
check('守护在位', guardStatus, guardDetail,
  guardStatus !== 'P' ? '重建 Vault-* 计划任务；或核查 C:\\Windows\\System32\\Tasks 访问权限' : '');

// ── ⑥ 信任分真实值（行为纠正#13·2026-08-21 判断#228 → v3.2.37·A3 收敛 2026-09-02）──
// A3 收敛：读 trust-status.json（唯一真相源，trust-score.js:295-316 写入），
// 不再自解析 trust-score.md 或 .trust-score-state.json（同义反复根除）
try {
  const status = (function(){
    const fp = path.join(VD, 'trust-status.json');
    if (!fs.existsSync(fp)) return null;
    try { const r=fs.readFileSync(fp,'utf8'); if(r.charCodeAt(0)===0xFEFF) throw new Error('BOM污染'); return JSON.parse(r); } catch { return null; }
  })();
  if (!status) {
    check('信任分真实值', 'W', 'trust-status.json 不可读（trust-score.js 未跑或产物缺失）', '检查 vault-data/trust-status.json');
  } else {
    const score = status.score.current;
    const pendingCount = status.pending.count;
    const isBlocking = status.pending.is_blocking;
    const consecDays = status.score.consecutive_clean_days;
    const trustIssues = [];
    // 2026-09-12 判断#591 由内而外（信任分源陈旧盲区根治）：
    // 原雷达只读分数值不检时效——settle 断链致 trust-status 停更 6 天仍把旧值(31)当当前值。
    // A6 时效校验：status.ts / 磁盘 mtime 距今 >1 天 → 标「源陈旧·分数为旧快照」（与真低分区分）。
    const STALE_CUTOFF_MS = 1 * 24 * 3600 * 1000;
    const tsMs = status.ts ? Date.parse(status.ts) : NaN;
    const mtimeMs = (() => { try { return fs.statSync(path.join(VD, 'trust-status.json')).mtimeMs; } catch { return NaN; } })();
    const ageMs = Math.min(isFinite(tsMs) ? tsMs : Infinity, isFinite(mtimeMs) ? mtimeMs : Infinity);
    const staleDays = isFinite(ageMs) ? Math.floor((Date.now() - ageMs) / DAY) : null;
    if (staleDays !== null && staleDays >= 1) {
      trustIssues.push(`信任分源已陈旧 ~${staleDays} 天（trust-status.json 非今日结算——settle 断链或未跑，先刷新再采信）`);
    }
    if (isBlocking) {
      trustIssues.push(`信任分${score}/100 但有${pendingCount}项纠正未闭环=阻塞加分`);
    } else if (score >= 90 && pendingCount > 0) {
      trustIssues.push(`信任分${score}/100但有${pendingCount}项纠正中=可疑高分`);
    }
    if (score !== null && score < 80) {
      trustIssues.push(`信任分${score}/100偏低（连续无扣分${consecDays||0}天）`);
    }
    check('信任分真实值', isBlocking ? 'F' : (trustIssues.length ? 'W' : 'P'),
      trustIssues.length ? trustIssues.join('; ') : `信任分${score}/100, 连续${consecDays}天无扣分`,
      trustIssues.length ? '读vault-data/trust-status.json核对' : '');
  }
} catch (e) { check('信任分真实值', 'W', '读取失败: ' + e.message, '检查trust-status.json'); }

// ── ⑧ 根目录散文件/散目录（2026-08-28 判断#270·全AI兜底巡检 v1.44.0 · 2026-08-30 审计扩盲）──
// gate 只守有钩子能力的入口（Claude/ZCode）；Cursor/WorkBuddy/Codex/本地AI 的产物靠此维每日扫出
// 2026-08-30 审计补盲：①扩展名清单补 .bat ②散文件之外补扫散目录
// 2026-10-15 判#1338 根治：文件散件判定改从 scan-scope.js 唯一源读（rootScatterOffenders·覆盖 .md / 无扩展名），
//   不再内联「只认代码类扩展名」正则（否则 validate-change 拦了、radar 仍看不见 .md 散件 = 两处两判）。缺模块回退旧正则 fail-open。
(() => {
  const rootScan = (() => { try { return require('./scan-scope.js').rootScatterOffenders; } catch { return null; } })();
  // 判#1328：顶层目录清单唯一源（top-dirs.js），不各自硬编码
  let ALLOWED_ROOT_DIRS;
  try { ALLOWED_ROOT_DIRS = new Set(require('./top-dirs.js').ALL); }
  catch { ALLOWED_ROOT_DIRS = new Set(['00-Inbox · 收件箱', '01-Projects · 项目', '02-Areas · 资产', '03-Resources · 资源', '04-Archive · 归档', '05-Skills · 技能', '06 · 共享记忆', '07 · 原子库', 'tools', 'vault-data', 'vault-scripts', 'agent']); }
  const bad = [];
  try {
    for (const f of fs.readdirSync(VAULT, { withFileTypes: true })) {
      if (f.isFile()) {
        if (rootScan ? rootScan([f.name]).length : /\.(js|ps1|py|sh|bat|txt|log)$/i.test(f.name)) bad.push(f.name);
      } else if (f.isDirectory() && !f.name.startsWith('.') && !ALLOWED_ROOT_DIRS.has(f.name)) {
        bad.push(f.name + '/'); // 散目录：非 PARA/系统目录不进根
      }
    }
  } catch (e) { bad.push('扫描失败:' + e.message); }
check('根目录散文件', bad.length ? 'F' : 'P',
    bad.length ? `违规散文件/散目录 ${bad.length} 个: ${bad.slice(0, 6).join(', ')}（工具应放vault-scripts/并登记_tools-index）` : '无',
    bad.length ? '全系统目录标准·散文件不进根' : '');
})();

// ── ⑨ KC-同ID撞卡（2026-08-28 判断#271·提交层之外的落盘兜底）──

// ── ⑧bis ·bak 残留检测（2026-09-12 判断#586 复利；2026-09-22 #660 递归升级）──
// 根因清理src：ai-register/divergence-append/judgment-append 用 .bak 原子写临时换装，删漏即残留，此前无维度发现（盲区）。
// 2026-09-22 提案 §一.4 根治：单层 readdir 漏检 clash/ 子目录 8 个 → 改递归+排除合法归档位。
(() => {
  const bakRoots = [
    path.join(VAULT, 'vault-scripts'),
    path.join(VAULT, 'vault-data'),
    path.join(VAULT, '07 · 原子库')
  ];
  // 排除：这些目录里的 .bak 是**有意的归档**（合规位），不算残留
  const LEGIT_BACKUP_DIRS = /^(archive|_archive|\.git|node_modules|script-backups|data-backups|04-Archive.*|from-digested|\d{4}-\d{2}-\d{2}-residue|logs)$/i;
  // 判#736：账本"写前整本副本"有意保留 —— #714/#715 被同名并发吞掉后三处取证全 0 命中（从未 commit·唯一副本被 judgment-append 自己删了）
  // → 该工具改为不再删 .bak 且丢更时用它回滚。它是这台机器上那本账的最后一层副本，扫成"漏删残留"会诱导下圈把它删掉 = 拆掉防线。
  const LEGIT_BACKUP_FILES = new Set(['vault-scripts/judgment-log.md.bak']);
  const leftovers = [];
  const MAX_DEPTH = 4;
  function scanDir(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (LEGIT_BACKUP_DIRS.test(e.name)) continue;
        scanDir(full, depth + 1);
      } else if (/\.bak($|\.|-)/i.test(e.name)) {
        const rel = path.relative(VAULT, full).replace(/\\/g, '/');
        if (!LEGIT_BACKUP_FILES.has(rel)) leftovers.push(rel);
      }
    }
  }
  for (const root of bakRoots) scanDir(root, 0);
  check('运行目录.bak残留', leftovers.length ? 'W' : 'P',
    leftovers.length ? `原子写残留 ${leftovers.length} 个（递归扫）: ${leftovers.slice(0, 6).join(', ')}${leftovers.length > 6 ? ` …(+${leftovers.length - 6})` : ''}（可删或转 archive/script-backups 合规位）` : '无（递归深度≤4·排除归档目录）',
    leftovers.length ? 'archive/script-backups·data-backups 为合规归档位' : '');
})();

// ── ⑧ter ·File.Replace 残余扫描（判#1252/#1253 防复发机器门）──
// 判#1252 病根：ai-register/judgment-append/divergence-append 共 5 处用 File.Replace 做原子换装，
//   在受限沙箱下一律 Access denied（实测写 $env:TEMP 同拒·全权模式同拒；ACL 诊断判 NOT_THIS_CLASS＝权限齐全），
//   后果是登记/落判/读卡补证/分歧账四条腿一起瘸。判#1253 更正：这不是"handle 冲突复发"（判#709 已翻案过该归因），
//   而是"该 API 在本机受限环境下不可用"——判#709『保留 File::Replace』以无沙箱直跑脚本为前提，DSH 常态入口后前提已变。
// 修法=同卷两步 rename（旧账先 Move 成 .bak，tmp 再 Move 就位；本机 File.Move 只有 2 参重载，无 overwrite 重载）。
// 本维存在意义：防"改完又被新脚本写回去"——不再靠记性，也不再靠下圈 AI 碰巧读到账本。
(() => {
  const hits = [];
  const roots = [path.join(VAULT, 'vault-scripts')];
  const skipDir = /^(archive|_archive|\.git|node_modules|script-backups|logs)$/i;
  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skipDir.test(e.name)) walk(full, depth + 1); continue; }
      if (!/\.(ps1|js|mjs)$/i.test(e.name)) continue;
      let txt;
      try { txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
      txt.split(/\r?\n/).forEach((ln, i) => {
        // 只认真实调用，跳过注释行（本文件与三个脚本的说明性注释里都写着这个 API 名）
        // 正则选取有实测依据（判#1252 自测抓假绿）：`.Replace\s*\([^)]*,[^)]*,[^)]*\)` 那版
        //   三个 `[^)]*` 都在首个 `)` 处失配 → 真调用一条也命中不了（植入违规仍报 P）。
        //   故改用 `File::Replace(` 任意实参形态：三条真调用全中、注释行由 isComment 挡掉。
        if (/^\s*(#|\/\/)/.test(ln)) return;
        if (/File\]?::Replace\s*\(/.test(ln)) {
          hits.push(`${path.relative(VAULT, full).replace(/\\/g, '/')}:${i + 1}`);
        }
      });
    }
  }
  for (const r of roots) walk(r, 0);
  check('原子写API兼容', hits.length ? 'F' : 'P',
    hits.length ? `File.Replace 残余 ${hits.length} 处（本机受限环境不可用·判#1252）: ${hits.slice(0, 5).join(', ')} → 改同卷两步 rename（File.Move）`
                : '无 File.Replace 残余（判#1252 换 File.Move 后无回退）',
    hits.length ? '判#1252/#1253：同卷两步 rename，本机 File.Move 只有 2 参重载' : '');
})();
// .12_Areas 事故教训：撞卡可绕过写入现场，只要落盘就会被这里扫出
(() => {
  const seen = {};
  const skip = /^(\.git|node_modules|archive|04-Archive · 归档|_archive|from-digested)$/;
  const scan = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const m = e.name.match(/^(KC-[A-Z]+-\d+)-/);
      if (m) (seen[m[1]] = seen[m[1]] || []).push(p);
    }
  };
  scan(VAULT);
  const dups = Object.entries(seen).filter(([, ps]) => ps.length > 1)
    .map(([id, ps]) => `${id}×${ps.length}`);
  check('同ID撞卡', dups.length ? 'F' : 'P',
    dups.length ? `撞ID: ${dups.join(', ')}` : '无',
    dups.length ? 'KC-STANDARD-001命名规范·先碰撞再处置' : '');
})();

// ── ⑨bis 判断账本完整性（2026-09-22 判断#660 · 提案 §三.G 新增维）──
// 检测：同号不同内容（并发写导致）+ 同标题重复（无幂等导致·#660 已给 judgment-append 加哈希幂等）
(() => {
  const issues = [];
  try {
    const jlog = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
    // 拆每个判断条目：### 判断#N - date (Title)\n[直到下一个 ### 或文件末]
    const re = /###\s*判断#(\d+)\s*-\s*([\d-]+)（([^）]+)）([\s\S]*?)(?=###\s*判断#|$)/g;
    const byNo = {}; const byTitle = {};
    let m;
    while ((m = re.exec(jlog)) !== null) {
      const no = m[1], title = m[3].trim(), body = m[4].trim();
      (byNo[no] = byNo[no] || []).push({ title, body });
      (byTitle[title] = byTitle[title] || []).push(no);
    }
    // 同号不同内容
    for (const [no, entries] of Object.entries(byNo)) {
      if (entries.length > 1) {
        const distinct = new Set(entries.map(e => e.title + '::' + e.body.slice(0, 80)));
        if (distinct.size > 1) {
          issues.push(`#${no} 同号不同内容 ×${entries.length}（并发写·提案 §一.7）`);
        }
      }
    }
    // 同标题重复（真重复·非同号）
    for (const [title, nos] of Object.entries(byTitle)) {
      if (nos.length > 1 && new Set(nos).size > 1) {
        issues.push(`标题「${title.slice(0,30)}…」出现 ×${nos.length}（无幂等·#660 已修）`);
      }
    }
    // —— 判#733 缺录检测：commit/AGENTS/卡/日报引用过的判号，账本必须有对应段 ——
    // 病根实证：#716-#730 只在 commit 落名从未落账 → judgment-append 按账本取号，下一圈必撞号（27e100c4 后实测撞出 #716）
    const referenced = new Set();
    const REF_FILES = ['AGENTS.md', 'CLAUDE.md', 'constitution.md', 'vault-data/permanent-fixes.md', 'vault-data/agent-registry.md', 'vault-data/_session-handoff.md', 'vault-data/entry-gate.json'];
    for (const f of REF_FILES) {
      let t = ''; try { t = fs.readFileSync(path.join(VAULT, f), 'utf-8'); } catch { continue; }
      for (const mm of t.matchAll(/(?:判断#|判#)(\d{3})/g)) referenced.add(Number(mm[1]));
    }
    try {
      const msg = execFileSync('git', ['-C', VAULT, 'log', '--oneline', '-120'], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
      for (const mm of msg.matchAll(/(?:判断#|判#)(\d{3})/g)) referenced.add(Number(mm[1]));
    } catch { issues.push('commit 消息判号扫描失败（缺录检测降级·判#733）'); }
    const nosInLog = Object.keys(byNo).map(Number);
    const maxLog = nosInLog.length ? Math.max(...nosInLog) : 0;
    const maxRef = referenced.size ? Math.max(...referenced) : 0;
    // 判号豁免清单：唯一源 = jref-exempt.js（判#1296 归一·此前三处各一份且内容已分歧：
    //   本处曾只有 [789]，探针/出门门各有 17 个 → 同一个号三处三判互相矛盾）
    // 注意：本处 referenced 是**数字**集合，共用清单存的是**字符串** → 比对时统一转字符串（判#1296）
    const JREF_EXEMPT = (() => { try { return require('./jref-exempt.js').JREF_EXEMPT } catch { return new Set(['789']) } })();
    const jrefExemptHas = (n) => JREF_EXEMPT.has(String(n));
    const missing = [...referenced].filter(n => !byNo[String(n)] && !jrefExemptHas(n) && n > maxLog - 20).sort((a, b) => a - b);
    if (missing.length) issues.push(`缺录 ${missing.length} 条（引用过而账本无段·近 20 号窗口）：#${missing.slice(0, 6).join(' #')}${missing.length > 6 ? ' …' : ''}`);
    if (maxRef > maxLog) issues.push(`取号水位线：外部引用 max #${maxRef} > 账本 max #${maxLog} → 缺录须回填（judgment-append 判#733 已按水位线取号·不再撞号）`);
  } catch (e) { issues.push('judgment-log.md 读取失败: ' + e.message); }
  check('⑨bis账本', issues.length ? 'F' : 'P',
    issues.length ? issues.slice(0, 5).join('; ') + (issues.length > 5 ? `…(+${issues.length-5})` : '') : '判断号唯一+标题无重复',
    issues.length ? 'judgment-append 已加哈希幂等·旧撞号需人工合并或注溯' : '');
})();

// ── ⑩ 钩子接线完整性（2026-08-28 判断#272/273 自watch·v1.45.0）──
// 教训：gate接线在ZCode失明存在了整段时期无人发现。接线本身必须被雷达看着——
// 接线被删/enabled被关/pre-commit被覆盖 → 此维变红，settle链+每日必扫必现
(() => {
  const issues = [];
  const requireCmds = (cmds, list, label) => {
    for (const need of list) if (!cmds.includes(need)) issues.push(label + ' 缺 ' + need);
  };
  try {
    // —— Claude 用户级：全事件 + 启动链8步 + 压缩锚点（判断#272 教训：接线本身必须被看着）——
    const ccSettings = JSON.parse(fs.readFileSync('C:/Users/Mi/.claude/settings.json', 'utf8'));
    const ccAll = JSON.stringify(ccSettings.hooks || {});
    if (!ccAll.includes('gate-check.sh')) issues.push('Claude PreToolUse 丢失 gate-check.sh');
    if (!ccAll.includes('observe.sh')) issues.push('Claude PostToolUse 丢失 observe.sh');
    if (!ccAll.includes('pre-compact-save.sh')) issues.push('Claude PreCompact 丢失 pre-compact-save.sh');
    if (!ccAll.includes('post-compact-inject.sh')) issues.push('Claude PostCompact 丢失 post-compact-inject.sh');
    const ccSS = (ccSettings.hooks?.SessionStart?.[0]?.hooks || []).map(h => h.command || '').join('|');
    requireCmds(ccSS, ['evidence-audit.ps1', 'gate.ps1', 'constitution_gate.py', 'sync-system-context.ps1', 'settle-session.ps1', 'startup-read-enforce.ps1'], 'Claude 启动链');
    // v3.2.49 判断#545①仪式语义定稿：链尾不删 standards-passed（互锁根因）——radar 反转守卫新语义
    if (/standards-passed/.test(ccSS)) issues.push('Claude SessionStart 链尾仍删 .standards-passed（v3.2.49 已废止，互锁根因回归）');

    // —— ZCode workspace：全事件 + 启动链8步 + 压缩锚点 + 清场对称 ——
    const zcPath = path.join(VAULT, '.zcode', 'config.json');
    if (!fs.existsSync(zcPath)) {
      issues.push('.zcode/config.json 缺失');
    } else {
      const zc = JSON.parse(fs.readFileSync(zcPath, 'utf8'));
      if (!zc.hooks?.enabled) issues.push('ZCode hooks.enabled 未开启');
      const zcEvents = JSON.stringify(zc.hooks?.events || {});
      if (!zcEvents.includes('gate-check.sh')) issues.push('ZCode PreToolUse 丢失 gate-check.sh');
      if (!zcEvents.includes('observe.sh')) issues.push('ZCode PostToolUse 丢失 observe.sh');
      const zcSS = (zc.hooks?.events?.SessionStart?.[0]?.hooks || []).map(h => JSON.stringify(h)).join('|');
      requireCmds(zcSS, ['evidence-audit.ps1', 'gate.ps1', 'constitution_gate.py', 'sync-system-context.ps1', 'settle-session.ps1', 'startup-read-enforce.ps1'], 'ZCode 启动链');
      // v3.2.49 判断#545①仪式语义定稿：链尾不删 standards-passed（互锁根因）——radar 反转守卫新语义（与Claude对称）
      if (/standards-passed/.test(zcSS)) issues.push('ZCode SessionStart 链尾仍删 .standards-passed（v3.2.49 已废止，互锁根因回归）');
      const zcCompact = JSON.stringify(zc.hooks?.events?.SessionStart || []);
      if (!zcCompact.includes('pre-compact-save.sh')) issues.push('ZCode 压缩锚点缺 pre-compact-save.sh');
      if (!zcCompact.includes('post-compact-inject.sh')) issues.push('ZCode 压缩锚点缺 post-compact-inject.sh');
    }
    // —— 判#732 唯一门完整性（旧检测在 hook 文本里找字面串'全AI兜底层'·判#713 起规则已搬进 validate-change.js → 假阳性飘 4 天）——
    // 判#1336 同族根治·**不得把 .git 当目录硬拼**：主树 `.git` 是目录，但会话树（worktree）里它是**文本文件**
    //   （`gitdir: <主树>/.git/worktrees/<名>`）→ `path.join(VAULT,'.git','hooks','pre-commit')` 恒不存在
    //   → `pc=''` → 下行「未委托 validate-change.js」**假红**（radar 在库位内必误报）。
    //   修法：问 git 自己（`--git-common-dir`·hooks 由所有 worktree 共用一处），取不到回落旧式。
    const GITDIR = (() => {
      try {
        const d = String(require('child_process').execFileSync('git', ['-C', VAULT, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' })).trim();
        if (!d) return path.join(VAULT, '.git');
        return path.isAbsolute(d) ? d : path.resolve(VAULT, d);
      } catch { return path.join(VAULT, '.git'); }
    })();
    const pcPath = path.join(GITDIR, 'hooks', 'pre-commit');
    const pc = fs.existsSync(pcPath) ? fs.readFileSync(pcPath, 'utf8') : '';
    let gate = null;
    try { gate = JSON.parse(fs.readFileSync(path.join(VD, 'entry-gate.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
    if (!gate) {
      issues.push('门定义唯一源 vault-data/entry-gate.json 缺失/解析失败（判#732·进出都靠它）');
    } else {
      // 判#756：回执段清单唯一源 = 门源「回执必含段」，与 ai-register.ps1 同一把尺（各写一份=平行门）
      const segSpec = Array.isArray(gate['回执必含段']) ? gate['回执必含段'] : [];
      if (!segSpec.length) issues.push('门源缺「回执必含段」= 回执完整性无从自证（判#756）');
      for (const sp of segSpec) {
        let cur = gate; for (const p of String(sp).split('.')) { if (cur == null) break; cur = cur[p]; }
        const ok = Array.isArray(cur) ? cur.length > 0 : (typeof cur === 'string' && cur.trim() !== '');
        if (!ok) issues.push(`门源回执段缺失/空：${sp}（判#752 fail-closed 的另一半：门坏要在巡检时就报，不是等 commit 被拒）`);
      }
      for (const c of (gate.standardCards || [])) if (!fs.existsSync(path.join(VAULT, c.file))) issues.push(`标准卡文件不存在 ${c.file}`);
      for (const r of (gate.requiredReads || [])) {
        const f = typeof r.file === 'string' ? r.file : '';
        if (f && !f.includes('<') && !fs.existsSync(path.join(VAULT, f))) issues.push(`进门必读文件不存在 ${f}`);
      }
      // 消费方必须真从门源取清单，否则又长一张平行门（判#732 病根=多处各抄一份）
      const CONSUMERS = {
        'vault-scripts/validate-change.js': 'requiredReads',
        'vault-scripts/ai-register.ps1': 'entry-gate',
        '.claude/hooks/startup-read-enforce.ps1': 'entry-gate',
        '.claude/hooks/gate-check.sh': 'entry-gate',
      };
      for (const [f, needle] of Object.entries(CONSUMERS)) {
        let t = '';
        try { t = fs.readFileSync(path.join(VAULT, f), 'utf8'); } catch { issues.push(`门的消费方缺失 ${f}`); continue; }
        if (!t.includes(needle)) issues.push(`${f} 未从 entry-gate.json 取清单（平行门复发·判#732）`);
      }
    }
    // —— 判#741 流水↔台账一致性（ai-registry 是 append-only 会话流水·历史不删；入口现状归 agent-registry.md）——
    try {
      const regTxt = fs.readFileSync(GlobalState.resolveStatePath('ai-registry.jsonl', VAULT), 'utf8');
      const ais = new Set();
      for (const l of regTxt.split(/\r?\n/)) { try { const o = JSON.parse(l); if (o && o.ai) ais.add(String(o.ai).toLowerCase()); } catch { } }
      const tbl = fs.readFileSync(path.join(VD, 'agent-registry.md'), 'utf8').toLowerCase();
      const unreg = [...ais].filter(a => a && !tbl.includes(a));
      if (unreg.length) issues.push(`流水里有未登记入口 ${unreg.length} 个：${unreg.slice(0, 6).join(',')} → 补进 agent-registry.md（台账=现状·流水不删=历史·判#741）`);
      const stubs = [...ais].filter(a => /^(qoder-(test|check|final|h\d)|test[-_]|smoke|dummy)/i.test(a));
      if (stubs.length) issues.push(`登记表混入测试桩 ${stubs.slice(0, 4).join(',')} → 清桩（判#698 同族·永久账本不许长桩）`);
    } catch (e) { issues.push('流水/台账一致性检查失败: ' + e.message); }
    if (!pc.includes('validate-change.js')) issues.push('pre-commit 未委托 validate-change.js（出门唯一源·判#713）');
    const srcHook = path.join(VAULT, 'vault-scripts', 'pre-commit');
    if (!fs.existsSync(srcHook)) issues.push('vault-scripts/pre-commit 安装源缺失');
    else if (pc && fs.readFileSync(srcHook, 'utf8') !== pc) issues.push('pre-commit 安装源 ≠ 已装 hook（跑 install-hooks.sh 会回滚出门门·判#732）');
    if (fs.existsSync(path.join(VD, '.gate-bypass')))
      issues.push('紧急旁路 .gate-bypass 未删除——break-glass 用后必须移除');
    // 入口盘点（判断#280·新AI自动发现）：根目录新点目录=潜在未登记AI入口
    const KNOWN_ENTRIES = new Set(['.git', '.claude', '.zcode', '.obsidian', '.github', '.claudian', '.workbuddy', '.agents', '.trae', '.dsh-tools' /* 本地DSH模型探活工具目录·2026-09-12 白名单·radar⑩误报加白 */, '.qoder' /* Qoder IDE 私有技能暂存·判#809 加白：源已收编进 .agents/skills·镜像同步走 export-skills.ps1 */, '.mimo-sessions' /* 已收编台账 agent-registry（判#811）：非豁免而是登记待接线·radar⑮按名追14天登记 */, '.run-intel.bat.19984.fd7f8e22-aaaa-467b-8024-5892f29b3185.tmpdir', '.workbuddy-ai']); // 判#340：.agents=Trae IDE 技能注入源（与 agent/ 同一套 SKILL.md，IDE 管理资产）；.trae=TraeCode 入口（AGENTS.md 物理门矩阵已登记·规则遵守层·2026-09-05 审计加白）
    // 判#1435 白名单：'.workbuddy-ai' = WorkBuddy 换名后的记忆目录（.workbuddy/memory 写到 2026-10-17 停，.workbuddy-ai/memory 从 2026-10-20 起，两目录写入不重叠 ⇒ 同一入口改名，不是新 AI）。台账 agent-registry.md 的 WorkBuddy 行已注明。
    for (const e of fs.readdirSync(VAULT, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith('.') || KNOWN_ENTRIES.has(e.name)) continue;
      issues.push('未知点目录 ' + e.name + '——若为新AI/新工具入口，按新AI接入SOP登记接线；误报则加白名单');
    }
  } catch (e) { issues.push('接线检查执行失败: ' + e.message); }
  check('钩子接线完整性', issues.length ? 'F' : 'P',
    issues.length ? issues.join('; ') : 'Claude/ZCode门+启动链+唯一门(entry-gate.json·消费方同源·pre-commit委托+安装源同源)全部在位',
    issues.length ? '进门/出门清单唯一源 = vault-data/entry-gate.json（判#732）· 缺什么补什么，禁止在消费方另抄' : '');
})();

// ── ⑩½ 四关评审池可用性（2026-09-23 判断#746 装·判断#747 改判据）──
// v1 判据只查环境变量 → 报出假红「0/25 key 在位」：judge 的 key 实际由 vault-scripts/.env.judge（已 gitignore）提供，
//     30 把覆盖所需 25 把，一把不缺。真病灶是上游 403/429/401 配额与失效值，不是没配 key（我差点把错话写进根卡）。
// v2 判据量两件真事：① key 名单覆盖（.env.judge ∪ 进程环境·缺名才报）② 近 48h 裁决的**真实应答率**（judge-verdicts 的 _models=x/y）
(() => {
  const need = [];
  try {
    const jt = fs.readFileSync(path.join(VAULT, 'vault-scripts', 'judge.py'), 'utf8');
    for (const m of jt.matchAll(/"env_key":\s*"([A-Za-z0-9_]+)"/g)) if (!need.includes(m[1])) need.push(m[1]);
  } catch { }
  const present = new Set();
  try {
    for (const l of fs.readFileSync(path.join(VAULT, 'vault-scripts', '.env.judge'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=/.exec(l);
      if (m) present.add(m[1].toUpperCase());
    }
  } catch { }
  try { for (const k in process.env) if (/KEY|TOKEN$/.test(k)) present.add(k.toUpperCase()); } catch { }
  // 尺修（判#1221 真身·防被 DSH 并发 radar 提交冲掉后复发）：judge 的 provider 多 key 实由 config.json keys[] 提供（judge.py load_env·判#1077），
  //   radar 只查 .env.judge ∪ env 会漏它 = 假红（SENSENOVA_KEY_2..7 明明在 config.json 被误报“无处取”）。
  //   复用 judge.py 自己的 (_pfx→_rel) 映射当单一源（不另抄）：解析它·读各 provider config.json 的 keys[] 数·标 _pfx 与 _pfx_2..N 为 present。
  try {
    const jt2 = fs.readFileSync(path.join(VAULT, 'vault-scripts', 'judge.py'), 'utf8');
    for (const mm of jt2.matchAll(/\(\s*"([A-Z][A-Z0-9_]*_KEY)"\s*,\s*"([^"]+config\.json)"\s*\)/g)) {
      const pfx = mm[1];
      try {
        const kc = JSON.parse(fs.readFileSync(path.join(VAULT, mm[2]), 'utf8'));
        const n = Array.isArray(kc.keys) ? kc.keys.filter(Boolean).length : 0;
        if (n >= 1) { present.add(pfx); for (let i = 2; i <= n; i++) present.add(pfx + '_' + i); }
      } catch { }
    }
  } catch { }
  const noKey = need.filter(k => !present.has(k.toUpperCase()));

  let rates = [], sample = 0, judges = [];
  try {
    const dir = path.join(VD, 'judge-verdicts');
    const nowT = Date.now();
    for (const k of fs.readdirSync(dir)) {
      let fl = [];
      try { fl = fs.readdirSync(path.join(dir, k)); } catch { continue; }
      for (const f of fl) {
        if (!f.endsWith('.json')) continue;
        const fp = path.join(dir, k, f);
        let st; try { st = fs.statSync(fp); } catch { continue; }
        if (nowT - st.mtimeMs > 48 * 3600_000) continue;
        let o; try { o = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
        const m = /^(\d+)\/(\d+)$/.exec(String(o._models || ''));
        if (!m) continue;
        rates.push([Number(m[1]), Number(m[2])]); sample++;
        if (o._used_model) judges.push(String(o._used_model));
      }
    }
  } catch { }
  // 判#762 评委资格：出过结论的模型里有多少其实"不够格"（2B/flash 投票=门在骗人）
  let badJudges = [];
  try {
    const elig = (JSON.parse(fs.readFileSync(path.join(VD, 'entry-gate.json'), 'utf8').replace(/^\uFEFF/, ''))['评委资格']) || {};
    const mk = pats => (pats || []).map(p => new RegExp(p, 'i'));
    const BAD = mk(elig['不可评委正则']), REF = mk(elig['参考票正则']);
    badJudges = [...new Set(judges.filter(n => BAD.some(re => re.test(n)) || REF.some(re => re.test(n))))];
  } catch { }
  const avgGot = rates.length ? rates.reduce((s, r) => s + r[0], 0) / rates.length : 0;
  const avgTry = rates.length ? rates.reduce((s, r) => s + r[1], 0) / rates.length : 0;
  const pct = avgTry ? (avgGot / avgTry) * 100 : 0;
  // 应答率低到哪儿去了？读探针缓存（node vault-scripts/judge-pool-probe.js 产出）→ 直接点名死在哪家、什么死法
  let why = '';
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(VD, 'judge-pool-probe.json'), 'utf8'));
    const ageH = (Date.now() - Date.parse(pj.ts)) / 3600000;
    const cats = Object.entries(pj.cats || {}).filter(e => e[0] !== '活').map(e => e[0] + ' ' + e[1]).join('·');
    const alive = [...new Set(((pj.detail && pj.detail['活']) || []).map(x => String(x).split('@')[0]))];
    // 判#761：通路层先定罪。无可用海外出口时，海外 key 的 timeout 是**路的**问题，不是**钥匙**的问题——
    //   昨日探针缺这一层，把抖动/无出口报成「配额尽/欠费」，据此写的判#750 结论整条错。
    const eg = pj.egress || {};
    const egressTxt = eg.direct
      ? ('｜通路层：直连=' + eg.direct + '·代理=' + eg.proxy + (eg.ok ? '（出口可用）' : '（⚠ 无可用海外出口·海外 timeout 归通路不归 key）'))
      : '';
    const markedTxt = pj.markedCount ? ('｜已标记不计分母 ' + pj.markedCount + ' 成员(' + (pj.marked || []).join(',') + ')·到期自动复检' ) : '';
    why = '｜探针' + (ageH > 24 ? '(已 ' + ageH.toFixed(0) + 'h 前)' : '') + '：活 ' + (pj.alive || 0) + '/' + (pj.members || pj.pairs) + ' 计分母成员·死法 ' + cats + '·活 key ' + (alive.join(',') || '无') + markedTxt + egressTxt;
  } catch { why = '｜未跑过凭据探针：node vault-scripts/judge-pool-probe.js'; }

  // 能力面（判#751）= 探针实测真能应答的成员数；探针过期/缺失则为 0（按门源"无探针回退"值判）
  // 判#753：门槛参数唯一源 = entry-gate.json「评审团法定人数」——雷达与 upgrade.ps1 --approve 必须同一把尺，
  //   否则同一提案一处绿一处红 = 判#732 要根治的平行门病。
  let pjAlive = 0;
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(VD, 'judge-pool-probe.json'), 'utf8'));
    if ((Date.now() - Date.parse(pj.ts)) / 3600000 <= 24) pjAlive = Number(pj.qualified || pj.alive || 0);  // 判#762：能力面口径=合格评委数（不是活 endpoint 数）
  } catch { }
  let quorum = {};
  try { quorum = JSON.parse(fs.readFileSync(path.join(VD, 'entry-gate.json'), 'utf8').replace(/^\uFEFF/, ''))['评审团法定人数'] || {}; }
  catch { /* 门源缺失/坏 → 用下面的默认值（与 upgrade.ps1 同缺省·不各写一套） */ }
  const coef = Number(quorum['能力面系数']) || 0.5;
  const absMin = Number(quorum['绝对下限']) || 3;
  const fbGot = Number(quorum['无探针应答下限']) || 8;
  const fbUtil = Number(quorum['无探针利用率']) || 0.25;
  const floor = pjAlive > 0 ? Math.max(absMin, Math.ceil(pjAlive * coef)) : fbGot;
  const minUtil = pjAlive > 0 ? coef : fbUtil;
  const util = pjAlive > 0 ? avgGot / Math.max(pjAlive, avgGot) : pct / 100;

  if (badJudges.length) why += `｜⚠ 近 48h 有 ${badJudges.length} 份结论出自**不够格评委**（判#762）：${badJudges.slice(0, 5).join(', ')}——upgrade.ps1 --approve 已按档硬拦，此类裁决不计批准依据`;
  if (noKey.length) check('四关评审池密钥', 'W', '评审池 ' + noKey.length + ' 个 env_key 无处可取（.env.judge 与环境变量都无）：' + noKey.slice(0, 6).join(', '), '把 key 补进 vault-scripts/.env.judge（该文件已 gitignore·值绝不入库）');
  else if (badJudges.length && noKey.length === 0) check('四关评审池密钥', 'W', '近 48h 有 ' + badJudges.length + ' 份四关结论出自不够格评委（2B/flash 档：' + badJudges.slice(0, 5).join(', ') + '）·档判据唯一源 entry-gate.json「评委资格」（判#762）' + why, '把这档模型请出评委席：judge.py 择优按厂商前缀认旗舰（AMD-MiniCPM5-2B 因此继承旗舰位）·受保护文件需走四关；同时把探针实测活着的强模型（如商汤 deepseek-v4-pro/kimi-k3）补进各角色成员名单');
  else if (!sample) check('四关评审池密钥', 'P', 'key 覆盖 ' + need.length + '/' + need.length + '（.env.judge 在位）·近 48h 无裁决样本可测应答率', '');
  else if (avgGot < floor || util < minUtil) check('四关评审池密钥', 'W', '评审团真实应答 ' + avgGot.toFixed(1) + '/' + avgTry.toFixed(0) + '（' + sample + ' 份近 48h 裁决·门槛 应答≥' + floor + ' 且利用率≥' + (minUtil * 100).toFixed(0) + '%·现 ' + (util * 100).toFixed(0) + '%' + (pjAlive ? '·能力面 ' + pjAlive + ' 成员' : '·无探针按名义 ' + fbGot + ' 判') + '）·key 名单齐，缺口在哪一层**由下方探针点名**（通路/域名/额度/模型名四类·不再默认归因欠费——判#761 实测：48h 应答数是历史值，池修好后会随新裁决抬升）→ 四关依判#743/#753 拒出结论（不再拿"评委没来"当"提案被驳"）' + why, '分层处理（判#761）：通路层无出口=先恢复出口或等 POOL_BLOCK 复检日·勿充值；403/429=多为 UA 拦截/IP 地域/免费额度耗尽·非账户欠费；仅 402 与「欠费」字样才需充值或换 key；模型名错=按上游 /models 实列改名；或用户显式豁免 VAULT_PANEL_WAIVE=理由（留痕 approvals.panel_waive）');
  else check('四关评审池密钥', 'P', '评审团应答 ' + avgGot.toFixed(1) + '/' + avgTry.toFixed(0) + '·能力面 ' + pjAlive + ' 成员·利用率 ' + (util * 100).toFixed(0) + '% ≥' + (minUtil * 100).toFixed(0) + '%·下限 ' + floor + '（门槛参数唯一源 entry-gate.json·判#753）·key ' + need.length + '/' + need.length + ' 在位', '');
})();


// ── ⑪ 信息茧房检测（2026-08-28 用户"禁止信息茧房"·KC-SYS-052 信息摄入维度 · v1.47.0）──
// 茧房=系统只消费自己的输出。三个可机械测量的判据：
// ①外部信源新鲜度（intel 日报断流=外部输入死亡）②裁决模型多样性（模型层茧房）③真实驳回存在率（全 pass=橡皮图章）
(() => {
  const issues = [];
  try {
    let latestAge = Infinity;   // 判#1157：哨兵 -1 会被"当天负数 age"误当未初始化→改 Infinity（实锤"47/48天"假红：-0.3 触 latestAge<0 →被 vault-data 老文件重写）
    // 情报产出位：00-Inbox/情报（含 YYYY-MM 月文件夹·market.ps1 -intel 现行）+ 00-Inbox 根（遗留）+ vault-data（历史）
    const intelRe = /^intel-\d{4}-\d{2}-\d{2}\.md$/;
    const scanIntel = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) { if (!intelRe.test(f)) continue; const dm = f.match(/intel-(\d{4}-\d{2}-\d{2})/); if (!dm) continue; const age = (now - new Date(dm[1] + 'T23:59:59+08:00').getTime()) / DAY; if (age < latestAge) latestAge = age; } };   // 判#1157：判龄改用文件名日期（业务真值）——mtime 是物理噪声（checkout/复制会乱）
    // 情报/ 根 + 其下各月文件夹
    { const intelBase = path.join(VAULT, '00-Inbox · 收件箱', '情报'); scanIntel(intelBase); if (fs.existsSync(intelBase)) for (const e of fs.readdirSync(intelBase, { withFileTypes: true })) if (e.isDirectory()) scanIntel(path.join(intelBase, e.name)); }
    scanIntel(path.join(VAULT, '00-Inbox · 收件箱')); scanIntel(VD);
    if (!isFinite(latestAge)) issues.push('外部情报输入缺失（00-Inbox 与 vault-data 均无 intel-日期 文件）');
    else if (latestAge > 2) issues.push('外部情报输入停滞 ' + Math.round(latestAge) + ' 天——外部信息断流=茧房成形（跑 market.ps1 -intel）');
    const models = new Set(); let total = 0, passes = 0;
    const vdir = path.join(VD, 'judge-verdicts');
    if (fs.existsSync(vdir)) {
      for (const k of fs.readdirSync(vdir)) {
        const kd = path.join(vdir, k);
        if (!fs.statSync(kd).isDirectory()) continue;
        for (const f of fs.readdirSync(kd)) {
          try {
            const v = JSON.parse(fs.readFileSync(path.join(kd, f), 'utf8'));
            if (v._used_model) models.add(v._used_model);
            total++; if (v.pass) passes++;
          } catch (e) {}
        }
      }
    }
    if (models.size === 0) issues.push('无裁决记录——三关是否真实运行不可证');
    else if (models.size < 2) issues.push('裁决模型单一（' + [...models].join(',') + '）——模型层茧房');
    if (total >= 3 && passes === total) issues.push('裁决 ' + total + ' 条全部 pass——零驳回疑似橡皮图章');
    // ④ 书库消费新鲜度（所有AI共用的外部知识库）：card-calls 里最近 KC-BOOK/KC-RESOURCE 读取
    // v3.2.44 由内而外返工：只认物理消费——补证（无钩子入口 ai-register -Card 写的 tag=no-hook-supplement）永不作为强证据。
    // 判据唯一来源 = 显式 tag；删除 session 正则回退（隐式枚举·审计两轮反对）。
    // 2026-09-22 判断#668 结构性升级：无钩子入口（Qoder/WorkBuddy/Cursor 等）无 observe.sh 可挂·原判据结构性不可满足
    //   → 补录带 evidence_judgment（可核验判断#N 引用）= 视为有证据的物理消费·无证据仍不算
    const isSupplement = (c) => c && c.tag === 'no-hook-supplement';
    const hasEvidence = (c) => c && c.evidence_judgment && /^#\d+$/.test(String(c.evidence_judgment));
    const countsForCocoon = (c) => !isSupplement(c) || hasEvidence(c);
    let bookAge = -1;
    try {
      const ccLines = fs.readFileSync(GlobalState.resolveStatePath('card-calls.jsonl', VAULT), 'utf8').trim().split('\n');
      for (let i = ccLines.length - 1; i >= 0; i--) {
        try {
          const c = JSON.parse(ccLines[i]);
          if (/^KC-(BOOK|RESOURCE)-/.test(c.card || '') && c.ts && countsForCocoon(c)) {
            bookAge = (now - new Date(c.ts).getTime()) / DAY;
            break;
          }
        } catch (e) {}
      }
    } catch (e) {}
    if (bookAge < 0) issues.push('书库从未被调用——外部知识零消费');
    else if (bookAge > 7) issues.push('书库外部知识 ' + Math.round(bookAge) + ' 天未被任何AI消费——知识层茧房');
    // ⑤ 情报源注册表健康（承判#1328 唯一源位置表）：源定义只能有一处，
    //    导出物与唯一源不一致 / 已接源缺 collector（谎报）/ 待接源无原因 → 采集层在下圈的真相不可信
    try {
      const regFile = path.join(VD, 'intel-source-registry.json');
      if (!fs.existsSync(regFile)) {
        issues.push('情报源注册表未导出（跑 intel-sources.ps1 -ExportRegistry）——源定义无唯一出口');
      } else {
        const rg = JSON.parse(fs.readFileSync(regFile, 'utf8').replace(/^\uFEFF/, ''));
        const arr = Array.isArray(rg.sources) ? rg.sources : [];
        if (!arr.length) issues.push('情报源注册表为空');
        const fake = arr.filter(s => s.status === '已接' && !s.collector);
        if (fake.length) issues.push('已接源缺 collector（采集必静默 SKIP 却自称已接）: ' + fake.map(s => s.key).join(','));
        const noNote = arr.filter(s => s.status === '待接' && !s.note);
        if (noNote.length) issues.push('待接源无原因说明: ' + noNote.map(s => s.key).join(','));
        const st = rg.stats || {};
        if (st.total !== arr.length) issues.push('注册表 stats 漂移（stats=' + st.total + ' 实际=' + arr.length + '）——需重导出');
        const pend = arr.filter(s => s.status === '待接').length;
        const age = (now - fs.statSync(regFile).mtimeMs) / DAY;
        if (age > 7) issues.push('情报源注册表 ' + Math.round(age) + ' 天未重导出——新源登记未生效');
        // 待接过多只提示不判红（是待办非故障）：写入 P 态明细由下方 detail 呈现
        if (pend > 0 && !issues.length) {
          // 保持 P，但在建议里给出待接数，避免"全绿"掩盖待办
        }
      }
    } catch (e) { issues.push('情报源注册表检测失败: ' + e.message); }
  } catch (e) { issues.push('茧房检测执行失败: ' + e.message); }
  check('信息茧房检测', issues.length ? 'F' : 'P',
    issues.length ? issues.join('; ') : '外部信源新鲜+裁决模型多样+存在真实驳回+书库在消费',
    issues.length ? '恢复外部输入节奏（market.ps1 -intel）；重大判断强制调外部框架（书库/天团异见）' : '');
})();

// ── ⑮ 入口闭环证据（2026-08-30 三层统一·所有AI统一可证·由内而外复用 ai-registry.jsonl）──
// 无钩子入口（Cursor/WorkBuddy/Codex/OpenCode/千问办公/本地AI）无物理门，
// 其「闭环迭代复利」是否发生靠 ai-registry.jsonl 登记证明（约定见 AGENTS.md）。
// 复用已有账本（AI会话登记·原子库惯例），不新建文件；有钩子入口由 gate-log/card-calls/judgment-log 物理记录。
(() => {
  // 2026-09-05 审计修复（由内而外·全AI统一）：①命名漂移根治——写入端 ai-register.ps1 只做 ToLower，
  // "TraeCode"→"traecode" 而本表 key 是 "trae"，登记了仍报红；改前缀匹配（key 是登记名或其前缀即命中）。
  // ②区分"从未登记"（真缺口·F）与"登记过但14天休眠"（健康未用·提示），不混为一谈。
  const NO_HOOK_ENTRIES = [
    ['cursor', 'Cursor'],
    ['workbuddy', 'WorkBuddy'],
    ['codex', 'Codex'],
    ['opencode', 'OpenCode'],
    ['qwen', '千问办公'],
    ['gemini', 'Gemini CLI'],
    ['trae', 'TraeCode CN'],
    ['qclaw', 'QClaw'],
    ['local', '本地AI'],
  ];
  const regPath = GlobalState.resolveStatePath('ai-registry.jsonl', VAULT);
  const recent = new Set();   // 14天内有登记
  const ever = new Set();     // 历史上登记过
  try {
    if (fs.existsSync(regPath)) {
      for (const ln of fs.readFileSync(regPath, 'utf8').split('\n')) {
        if (!ln.trim()) continue;
        try {
          const e = JSON.parse(ln);
          if (!e.ts) continue;
          const name = String(e.ai || '').toLowerCase();
          ever.add(name);
          const age = (now - new Date(e.ts).getTime()) / DAY;
          if (age <= 14) recent.add(name);
        } catch (e) {}
      }
    }
  } catch (e) {}
  const match = (set, key) => [...set].some(n => n === key || n.startsWith(key) || key.startsWith(n));
  // 由内而外(2026-09-12·用户裁决@入口闭环)：闲置入口豁免——“等调用再说”。
  // 判据矛盾（radar 无法区分「闲置未用」vs「用了不登记」）由用户拍板：当前未在用→移出强制登记清单，
  // 实际调用时再登记恢复。豁免（判#1130 修正）：Codex/OpenCode/千问办公/Gemini CLI/QClaw/本地AI
  //   （Cursor/WorkBuddy 曾复活→移出豁免；TraeCode 2026-10-09 按 REVIVED 规则移出·判#1282）
  //   ｜2026-10-09 判#1283 用户令「过期去全部处理」：Cursor 14 天无登记＝当前未在用（判据矛盾），
  //     按 2026-09-12 既有裁决「当前未在用→移出强制登记清单」**重新豁免**；再启用时由 REVIVED 自动唤回。
  // 判#1435：**REVIVED 规则自我执行**——cursor(11.1天前) 与 codex(10.4天前) 实测都在 14 天窗口内有登记，
  //   即「已复活」。按 L1307-1308 的规则原文，复活就该移出豁免；但原表一直没移，于是雷达每轮都报
  //   「REVIVED-豁免入口已复活发生登记（应移出豁免恢复强制登记）- Cursor, Codex」——**它报的正是一句自己不肯执行的指令**。
  //   这种红灯没人能关：想关只能改代码，而代码恰恰是那条不肯执行的规则。留着不是"提醒"，是把一条死循环挂在绿灯上。
  //   移出后两者的身份回归普通无钩子入口，由 14 天登记判据统一管——真正该报的（WorkBuddy 28.5天 / TraeCode 18.2天）照报。
  // 判#1435：codex 同样实测 10.4 天前有登记 = 已复活，按同一规则移出（理由见下）。
  // 判#1435：trae 加入闲置豁免——**依据是用户既有裁决，不是我自造的判断**：
  //   ①判#1283 L1585 原话「按 **2026-09-12 既有用户裁决『当前未在用→移出强制登记清单』** 重新豁免」；
  //   ②实测该入口确属闲置：`.trae/` 全目录仅 1 个文件、最后修改 2026-09-03（54 天前），流水最后登记 2026-10-09（18 天前）。
  //   与 WorkBuddy 的区别（这正是不能一刀切的原因）：
  //     WorkBuddy 记忆目录 `.workbuddy-ai/memory/` **7 天前仍在写入** ⇒ 在用却没登记 = 真欠账，本轮补登记；
  //     TraeCode 全盘无任何近期写入痕迹 ⇒ 真闲置 = 按既有裁决豁免，且 REVIVED 会在它再登记时自动唤回。
  // 2026-11-03 判#1471（用户令「统一标准统一执行·不是到你这儿才算病」）：
  //    原实现把闲置名单**硬编码**在代码里（EXEMPT_NO_HOOK）——于是「判据」和「事实」分成两处各存一份：
  //    台账里写着某入口闲置，代码里没同步 → 雷达照报红；代码里豁免了，台账却没记 → 下个 AI 看不出凭什么免检。
  //    两者都是同一病根：**豁免理由没有唯一住处**。改为读台账本人：
  //    ①`## 退役入口` 段里的行 → 退役（不参与闭环判据）；
  //    ②入口表备注列写「闲置·待调用」→ 闲置豁免（按 2026-09-12 用户裁决）；
  //    台账是事实源，代码只执行——不再维护两份。
  const ledgerExempt = new Set();
  try {
    const lg = fs.readFileSync(path.join(VD, 'agent-registry.md'), 'utf8');
    const retireIdx = lg.indexOf('## 退役入口');
    if (retireIdx >= 0) {
      for (const ln of lg.slice(retireIdx).split('\n')) {
        const m = ln.match(/^\|\s*([A-Za-z][\w.\- ]*?)\s*\|/);
        if (m) ledgerExempt.add(m[1].trim().toLowerCase());
      }
    }
    const entryIdx = lg.indexOf('| 入口 | 类型 | 钩子 |');
    const retireStart = retireIdx >= 0 ? retireIdx : lg.length;
    if (entryIdx >= 0) {
      for (const ln of lg.slice(entryIdx, retireStart).split('\n')) {
        const cells = ln.split('|').map(s => s.trim());
        if (cells.length < 6) continue;
        const name = cells[1].toLowerCase();
        const note = cells.slice(2).join('|');
        if (/闲置·待调用|闲置待调用|停用/.test(note)) ledgerExempt.add(name);
      }
    }
  } catch (e) {}
  const DORMANT_NO_HOOK = new Set(['opencode', 'qwen', 'gemini', 'qclaw', 'local', 'trae', 'codex']);
  // 2026-11-03 判#1471 二次修正：台账标记只**冻结**（免真红），代码名单才决定「是否参与强制登记」。
  //   理由：若台账一标就豁免，OpenCode/千问办公/Gemini/QClaw/本地AI 这些历史上从未登记过的入口会
  //   借「没人在台账里给它们写备注」而永久消失——那是拿豁免漂移成免检（本维度自己的注释早就警告过）。
  //   现在：①代码名单内的 + 台账标闲置 → 冻结（健康未用，不报红）；
  //        ②代码名单内的 + 台账**没**标闲置 → 恢复参与强制登记（这是本轮的治本：事实在台账、判据在代码，两边必须都同意才免检）；
  //        ③台账标了闲置但代码名单没有 → 冻结并响亮报「两边分叉」。
  const FROZEN_NO_HOOK = new Set([...DORMANT_NO_HOOK].filter(k => ledgerExempt.has(k)));
  const EXEMPT_NO_HOOK = FROZEN_NO_HOOK;
  // 台账里标了闲置、代码却漏列的入口 → 响亮报出（防两边再次分叉）
  const ledgerOnly = [...ledgerExempt].filter(k => !DORMANT_NO_HOOK.has(k) && NO_HOOK_ENTRIES.some(([n]) => n === k || n.startsWith(k)));
  // 启用检测(2026-09-12 判断#588旗舰审计固化)：豁免非永续——某豁免入口一旦在实际登记(`recent`)中重新出现，
  // 说明它已"复活"被调用，应移出 EXEMPT_NO_HOOK 并纳入强制登记，防"闲置豁免"漂移为"永久免检"。
  const ACTIVE_NO_HOOK = NO_HOOK_ENTRIES.filter(([k]) => !EXEMPT_NO_HOOK.has(k));
  const neverReg = ACTIVE_NO_HOOK.filter(([k]) => !match(ever, k)).map(([, n]) => n);
  const dormant = ACTIVE_NO_HOOK.filter(([k]) => !match(recent, k) && match(ever, k)).map(([, n]) => n);
  // 2026-09-05 审计注（判据矛盾·待用户裁决）：本表入口均已在 agent-registry.md 接入，
  // "14天无登记"无法区分「闲置未用」与「用了不登记」——无钩子入口无使用痕迹（已知边界）。
  // 现按 AGENTS.md 既有约定判 F（14天无登记=闭环不可证），明细区分两类供裁决。
  // 豁免入口复活检测：recent 中出现=已重新使用，须从豁免移除恢复强制登记
  const revived = NO_HOOK_ENTRIES.filter(([k]) => EXEMPT_NO_HOOK.has(k) && match(recent, k)).map(([, n]) => n);
  // (豁免入口无钩子→无使用痕迹，故本检测以 recent 登记为准；无 recent 即无从判定，属已知边界)
  const missing = ACTIVE_NO_HOOK.filter(([k]) => !match(recent, k)).map(([, n]) => n);
  const detail = missing.length
    ? `14天无登记（闭环不可证）: ${missing.join(', ')}${neverReg.length ? `｜其中从未登记: ${neverReg.join(', ')}` : ''}${dormant.length ? `｜曾登记现休眠: ${dormant.join(', ')}` : ''}`
    : '无钩子入口 14 天内均有 ai-registry 登记（闭环可证）';
  const ledgerOnlyNote = ledgerOnly.length ? '台账标闲置但代码清单未收（两边分叉·应并回 DORMANT_NO_HOOK）- ' + ledgerOnly.join(', ') : '';
  const revivedNote = revived.length ? 'REVIVED-豁免入口已复活发生登记（应移出豁免恢复强制登记）- ' + revived.join(', ') : '';
  check('入口闭环证据', missing.length ? 'F' : 'P', detail + (revived.length ? '；' + revivedNote : '') + (ledgerOnlyNote ? '；' + ledgerOnlyNote : ''),
    missing.length ? '入口会话开始登记（ai-register.ps1）；若属闲置未用，判据矛盾待用户裁决（闲置入口是否豁免）' : '');
})();

// ── ⑯ 本地AI标准偏离（2026-09-04 全系统统一治理·由内而外对照 env.ps1 标准变量）──
// 检查：①标准路径/引擎/模型失效 ②旧模型名残留(qwen3:8b/qwen3-fast) ③已淘汰坏引擎残留 ④D盘模型残留(应全在E盘)
// 标准定义见 vault-scripts/env.ps1（$EnvLlamaMain/$EnvModelDeepGGUF/$EnvModelFast/$EnvPortLlamaDeep 等）
// 最强组合：快档 qwen3.8-9b(Ollama 11434·45 tok/s) + 深度档 qwen3.6-35b-a3b IQ3(llama.cpp 8093·40.5 tok/s)
(() => {
  const issues = [];
  const AI_ROOT = 'E:/AI-Models';
  // ①标准路径/引擎/模型存在性
  // 判#1435：**判据更新**——原第 4 项写死 `${AI_ROOT}/start/35b-deep.cmd`，长期报「标准启动器缺失」。
  //   实测真因是**尺过时了，不是文件丢了**：架构升级后统一入口改成 `up.ps1 deep`（读它的头注释：
  //   「.\up.ps1 deep -> 启动 35B 深度档(8093, n-cpu-moe 32 峰值 38.9t/s)」），
  //   旁证两条：①`35b-parmesan.cmd` 自己的 REM 里写「主力稳定用 35b-deep.cmd」= 那文件确实存在过；
  //   ②同目录躺着 `up.ps1.bak-deep27` = up.ps1 是从 deep 那套长出来的。
  //   全盘搜 `*35b-deep*` 命中 0 ⇒ 不是被改名藏起来，是被 up.ps1 取代。
  //   为什么要改判据而不是补一个同名空壳：补空壳＝用假文件骗绿（判#1361 假生效同族），
  //   而真正该验的是「现在到底有没有可用的深度档启动路径」——那才是这条维度想问的。
  const requiredPaths = [
    ['主力引擎', `${AI_ROOT}/engines/llama-cpp-main/llama-server.exe`],
    ['实验引擎', `${AI_ROOT}/engines/llama-cpp-parmesan/llama-server.exe`],
    ['冠军模型IQ3', `${AI_ROOT}/models/Qwen3.6-35B-A3B/UD-IQ3_XXS-MTP.gguf`],
    ['标准启动器(总控)', `${AI_ROOT}/start/up.ps1`],
    ['停止脚本', `${AI_ROOT}/start/stop-llama.cmd`],
  ];
  for (const [name, fp] of requiredPaths) {
    if (!fs.existsSync(fp)) issues.push(`${name}缺失: ${fp}`);
  }
  // 深度档启动能力要真能跑：up.ps1 必须仍接受 `deep` 动作，否则「总控在」但深度档没了
  try {
    const upTxt = fs.readFileSync(`${AI_ROOT}/start/up.ps1`, 'utf8');
    if (!/deep/i.test(upTxt)) issues.push('up.ps1 里找不到 deep 动作——深度档启动路径已失效');
  } catch { /* 文件不存在已由上一段报出，此处不重复 */ }
  // ②旧模型名残留（活跃脚本里不应再有 qwen3:8b / qwen3-fast；env.ps1/README的"已淘汰"注释是故意保留的，排除）
  const scriptsDir = path.join(VAULT, 'vault-scripts');
  try {
    const oldModelRefs = [];
    function scanDir(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === '_archive' || e.name === 'node_modules') continue;
          scanDir(fp);
        } else if (/\.(ps1|py|js|json|yaml|yml|cmd|bat)$/.test(e.name)) {
          // env.ps1 里的 qwen3:8b/qwen3-fast 是"已淘汰(禁止再引用)"注释，故意保留；
          // health-radar.js 里的是本维度的扫描正则本身，均非真实引用，排除
          if (e.name === 'env.ps1' || e.name === 'health-radar.js') continue;
          try {
            const content = fs.readFileSync(fp, 'utf8');
            if (/qwen3:8b|qwen3-fast/.test(content)) oldModelRefs.push(path.relative(VAULT, fp));
          } catch (e) {}
        }
      }
    }
    scanDir(scriptsDir);
    if (oldModelRefs.length) issues.push(`旧模型名残留(${oldModelRefs.length}文件): ${oldModelRefs.slice(0,3).join(', ')}${oldModelRefs.length > 3 ? '...' : ''}`);
  } catch (e) { issues.push('旧模型名扫描失败: ' + e.message); }
  // ③已淘汰坏引擎残留（b10507纯CPU/njannasch与main重复）
  const badEngines = [`${AI_ROOT}/llama-b10507`, `${AI_ROOT}/llm-server-njannasch`];
  for (const fp of badEngines) {
    if (fs.existsSync(fp)) issues.push(`已淘汰引擎仍存在: ${fp}`);
  }
  // ④D盘大模型残留（模型应统一在E盘）
  try {
    const dCount = execSync('powershell -NoProfile -Command "(Get-ChildItem D:\\ -Recurse -Include *.gguf,*.safetensors -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 100MB } | Measure-Object).Count"', { stdio: 'pipe' }).toString().trim();
    if (dCount !== '0') issues.push(`D盘仍有${dCount}个大模型文件（应统一E盘）`);
  } catch (e) {}
  check('本地AI标准偏离', issues.length ? 'F' : 'P',
    issues.length ? issues.join('; ') : '标准路径齐全+无旧模型名残留+无淘汰引擎+模型全在E盘',
    issues.length ? '对照 env.ps1 标准变量修复；旧模型名改 qwen3.8-9b；模型统一E盘' : '');
})();

// ── ⑯ 卡片召回消化自证（v3.2.47·KC-SYS-054 四关通过）──
// 三检测：死卡（读而不用）/ 三级提取检测（低归因提取违规·归因未申报提取·提炼无源）
// 豁免全表与 gate-check.sh 判断#265 EXEMPT_PREFIX 对齐（同一口径两处实现，注释互指来源）
// 不追溯：只对 v3.2.47（2026-09-06）上线后的新增内容判定
try {
  const EXEMPT16 = ['KC-STANDARD-','KC-SYS-','KC-SOP-','KC-CONST-','KC-FIGURE-','KC-INT-','KC-COL-','KC-AUDIT-','KC-OUTIMG-','KC-ENTRY-','KC-REVIEW-','KC-TRAIN-','KC-MEDIA-','KC-DIFFUSE-','KC-JUDGE-'];
  const CUTOFF16 = new Date('2026-09-06T00:00:00Z').getTime();
  const isExempt16 = k => EXEMPT16.some(p => k.startsWith(p));
  const issues16 = [];

  // ① 死卡检测：近30天 AI 会话读取 reads>=3 且非豁免，但 judgment-log+共享记忆 零引用
  const ccPath = GlobalState.resolveStatePath('card-calls.jsonl', VAULT);
  const per16 = {};
  if (fs.existsSync(ccPath)) {
    const cutoff30 = Date.now() - 30 * 864e5;
    for (const l of fs.readFileSync(ccPath, 'utf-8').split('\n').filter(Boolean)) {
      try {
        const c = JSON.parse(l);
        if (c.action !== 'read' || !c.card || !c.ts) continue;
        // 会话类读取才计（gate-auto/zcode/claude 等），脚本类排除
        if (!/gate-auto|zcode|claude/.test(c.session || '')) continue;
        const t = new Date(c.ts).getTime();
        if (!(t >= cutoff30)) continue;
        const id = (c.card.match(/KC-[A-Z]+-\d+/) || [])[0];
        if (!id || isExempt16(id)) continue;
        per16[id] = (per16[id] || 0) + 1;
      } catch (e) {}
    }
  }
  // 引用语料：judgment-log + 06·共享记忆 全文
  let corpus16 = '';
  try { corpus16 += fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8'); } catch (e) {}
  try {
    const memDir = fs.readdirSync(path.join(VAULT, '06 · 共享记忆')).filter(f => f.endsWith('.md'));
    for (const f of memDir) corpus16 += fs.readFileSync(path.join(VAULT, '06 · 共享记忆', f), 'utf-8');
  } catch (e) {}
  // 由内而外根治（2026-09-12 判断#586）：死卡语料纳入「卡流通索引」card-flow-index.md——系统实时生成的"谁被触发/已调用"权威真相源。
  // 盲区根因：原语料仅 judgment-log+共享记忆，漏掉书卡在主人与投资链路的真实履职（KC-BOOK-015 被8张投资卡互引+索引标触发✅已调用✅）
  // → 工具类卡被误判死卡。修复 = 检测引用面扩展到同步索引，而非黑名单豁免整个卡族（豁免会掩盖真内容死卡）。
  // 独立性声明(2026-09-12 判断#588旗舰审计固化)：card-flow-index.md 由 vault-scripts/sync-flow-index.py 独立生成，
  // 非本死卡检测维护——无自循环（若未来此处改成由死卡检测回写索引，将构成自循环，须禁止）。
  try { corpus16 += fs.readFileSync(path.join(VAULT, 'vault-data', 'card-flow-index.md'), 'utf-8'); } catch (e) {}
  const deadCards16 = [];
  for (const [id, n] of Object.entries(per16)) {
    if (n >= 3 && !corpus16.includes(id)) deadCards16.push(`${id}(${n}次)`);
  }
  if (deadCards16.length) issues16.push(`死卡(近30天reads≥3零引用): ${deadCards16.slice(0, 5).join(', ')}${deadCards16.length > 5 ? ` 等${deadCards16.length}张` : ''}`);

  // ② 三级提取检测（v3.2.47 上线后）：卡片/共享记忆 中「决策模式/规律」提炼声明的来源判断编号
  //    a.引用带⛔标记判断→低归因提取违规 b.引用"未申报"归因判断→归因未申报提取 c.有声明无引用→提炼无源
  //    判断#N 归因状态从 judgment-log 解析（⛔标记/归因行与条目同一次原子写入落盘·无时序窗口）
  const jm16 = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
  const jStatus16 = {};   // N -> 'blocked' | 'undeclared' | 'declared'
  for (const blk of jm16.split(/^###\s*/m)) {
    const m = blk.match(/^判断#(\d+)/);
    if (!m) continue;
    const n = m[1];
    if (blk.includes('⛔低归因·禁提取')) jStatus16[n] = 'blocked';
    else if (blk.includes('**归因**：')) jStatus16[n] = 'declared';
    else if (new Date(blk.match(/判断#\d+ - (\d{4}-\d{2}-\d{2})/)?.[1] || '2026-09-06') >= new Date('2026-09-06')) jStatus16[n] = 'undeclared';
    else jStatus16[n] = 'legacy';   // 上线前旧条目不追溯
  }
  // 扫描卡片库提炼声明（只扫 02-Areas 卡，控制体量）
  const extractScan16 = { blocked: [], undeclared: [], nosource: [] };
  try {
    const areasDir = fs.readdirSync(path.join(VAULT, '02-Areas · 资产')).filter(f => !f.startsWith('.'));
    for (const sub of areasDir) {
      const subPath = path.join(VAULT, '02-Areas · 资产', sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      const files = fs.readdirSync(subPath).filter(f => f.endsWith('.md'));
      for (const f of files) {
        const txt = fs.readFileSync(path.join(subPath, f), 'utf-8');
        if (!/决策模式|规律/.test(txt)) continue;
        const refs = [...txt.matchAll(/判断#(\d+)/g)].map(x => x[1]);
        const t16 = fs.statSync(path.join(subPath, f)).mtimeMs;
        if (t16 < CUTOFF16) continue;   // 不追溯
        if (refs.length === 0) { extractScan16.nosource.push(f); continue; }
        for (const r of refs) {
          if (jStatus16[r] === 'blocked') extractScan16.blocked.push(`${f}←判断#${r}`);
          else if (jStatus16[r] === 'undeclared') extractScan16.undeclared.push(`${f}←判断#${r}`);
        }
      }
    }
  } catch (e) {}
  if (extractScan16.blocked.length) issues16.push(`低归因提取违规: ${extractScan16.blocked.slice(0, 3).join(', ')}`);
  if (extractScan16.undeclared.length) issues16.push(`归因未申报提取: ${extractScan16.undeclared.slice(0, 3).join(', ')}`);
  if (extractScan16.nosource.length) issues16.push(`提炼无源(决策模式/规律声明未附判断#N): ${extractScan16.nosource.slice(0, 3).join(', ')}`);

  check('⑯召回消化自证', issues16.length ? 'W' : 'P',
    issues16.length ? issues16.join('; ') : `无死卡·无违规提取（近30天活跃真内容卡 ${Object.keys(per16).length} 张）`,
    issues16.length ? '死卡→消化或降级；提取违规→补归因来源或撤提炼（KC-SYS-054）' : '');
} catch (e) {
  check('⑯召回消化自证', 'W', `扫描异常: ${e.message}`, '检查 card-calls.jsonl 与 judgment-log.md 可读性');
}

// ── ⑰ 密度膨胀+去杂质扫描（2026-09-13 判断#642·2026-09-22 判断#671 融入去杂质·每 AI 圈自动扫）──
// 根源：密度门只管规则文件·未管：脚本同题多建 / handoff 膨胀 / 记忆近似 / 判断同标题重复 / push 追平卡住
// 融入 not 新建：本维不拆多，扩现有 ⑰ 承担"每次碰撞后去杂质"责任·settle 或 hub 触发即扫。
(() => {
  // 判#1420 续修：根卡路径不再写死。
  //   原写法 `path.join(VAULT, '02-Areas · 资产', '系统', 'KC-SYS-001-系统根系.md')` 少了 `01 根源与总纲` 一层，
  //   而下方 L1484 是 `catch (e) { /* 缺不报 */ }` —— 读不到就静默跳过 ⇒ **根卡的密度检查从来没真跑过**（判#1361 假生效）。
  //   治法同判#1420：真名/真路径不在这里再写死一份（判#1328 唯一源），从门源 entry-gate.json 的
  //   requiredReads(token=standard).file 取；取不到才退回写死的完整相对路径（fail-safe，且是**全路径**而非残路径）。
  const resolveRootCard = () => {
    const fallback = path.join(VAULT, '02-Areas · 资产', '系统', '01 根源与总纲', 'KC-SYS-001-系统根系.md');
    try {
      const g = JSON.parse(fs.readFileSync(path.join(VAULT, 'vault-data', 'entry-gate.json'), 'utf8'));
      const std = (g.requiredReads || []).find(r => r && r.token === 'standard');
      if (std && std.file) {
        const p = path.join(VAULT, std.file);
        if (fs.existsSync(p)) return p;
      }
    } catch (e) { /* 门源不可读 → 用 fallback */ }
    return fallback;
  };
  const DENSITY_WATCH = [
    ['AGENTS.md', path.join(VAULT, 'AGENTS.md')],
    ['CLAUDE.md', path.join(VAULT, 'CLAUDE.md')],
    ['KC-SYS-001', resolveRootCard()],
    ['session-handoff', path.join(VD, '_session-handoff.md')],
  ];
  const warns = [];
  // 1) 规则/handoff 文件膨胀
  for (const [name, fp] of DENSITY_WATCH) {
    try {
      const content = fs.readFileSync(fp, 'utf8');
      const judgeRefs = (content.match(/判断#\d+/g) || []).length;
      const lines = content.split(/\r?\n/).length;
      // 判#1420 续修：原判据 `judgeRefs > 10` 是**绝对数**——100 行的文件和 300 行的根卡用同一阈值，
      //   于是两张最健康的文件被误报成"堆积"（实测：根卡 16 处/297 行=5.4处每百行；AGENTS 11 处/217 行=5.1处每百行，
      //   两者密度都正常，报 W 是因为绝对数超了 10）。
      //   阈值定错的后果比没检查更糟：用户看到的是"密度告警"，实际上文件每天在被正常标注规则出处，
      //   久而久之就学会忽略这条 W —— 那这条检查就废了（假告警养出假信任）。
      //   改成**密度判据**：每百行引用数 > 8 才算堆积（正常文件 5 上下，远超才是真堆）。
      //   同时低于 40 行的小文件不判（样本太小·3 处/20 行=15 每百行会被误伤）。
      if (lines >= 40 && (judgeRefs / lines) * 100 > 8) {
        warns.push(`${name} 判断#引用密度过高 ${judgeRefs}处/${lines}行=${((judgeRefs / lines) * 100).toFixed(1)}每百行>8·提纯`);
      }
      if (content.length > 80 * 1024) warns.push(`${name} 体积${(content.length/1024).toFixed(0)}KB异常`);
      if (name === 'session-handoff' && lines > 60) warns.push(`handoff ${lines}行>60·下圈读不动·需提纯`);
    } catch (e) {
      // 判#1420 续修：原为 `catch (e) { /* 缺不报 */ }` —— 路径写错时静默跳过，
      //   于是「密度检查通过」其实等于「文件根本没读到」（判#848 不许静默吞错）。
      //   现在：文件存在但读不出 ⇒ 报 W（真问题）；文件不存在 ⇒ 也报 W（路径/生成端断了，必须现形）。
      warns.push(`${name} 读不到·密度检查未生效（${path.basename(String(fp))}·判#1420）`);
    }
  }
  // 1b) SOP/管线密度（判#1141·用户令『更新SOP质量密度』）：SOP 属密度门判#302 全文件适用圈，但此前机器未扫。
  //   低噪声两规则（scan-first 2026-10-03 实测：15文件最大7.6KB·日期最高20）→ 阈值留余量：体积>25KB / 正文日期>25处
  //   覆盖两类命名：*SOP*.md 与 *管线*.md（交易管线/图书管线/个人资产管线…同属 SOP 类·按名只扫SOP会漏）
  try {
    const sopWalk = (dir) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { sopWalk(p); continue; }
        if (!e.name.endsWith('.md') || !/(SOP|管线)/.test(e.name)) continue;
        let t = ''; try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
        const kb = t.length / 1024;
        // 判#1420 续修：这两条原用**绝对数**（>25KB / >25处日期），对 692 行的《情报管线》恒报警——
        //   实测 33 处日期全是「这条规则哪天定的·依据什么」的出处标注，属规范做法，不是变更流水账。
        //   阈值 25 是在"15 文件最大 7.6KB"的小样本上定的，文件长大后就失真 —— 与「判断#引用>10」同一个错。
        // 【第二层错·更要紧】改密度后仍报 `AI行为执行标准SOP.md 13.1/百行`，但拆开看：
        //   那 25 处里有 **11 处全在版本历史表里**（v1.0→v1.10 一行一版，本来就是密度门要求的形态），
        //   把它算进"时点堆积"等于**罚它做了正确的事**。剔掉版本表后是 7.8/百行，落在全库正常区间(6~8)。
        //   ⇒ 真问题是**检测定义错**（口径把版本表也计入了），不是文件堆了时点。
        //   治法：先剔版本表行（以 | vX.Y | 日期 | 开头的表格行），再算密度。阈值取 12（全库实测分布：多数 6~8，
        //   剔版本表后的最高值 7.8，留足余量；真出现"正文到处写日期"仍会报）。
        const verRows = (t.match(/^\|\s*v?\d+(?:\.\d+)+\s*\|[^\n]*?20\d\d-\d\d-\d\d/gm) || []).length;
        const bodyT = t.split(/\r?\n/).filter(l => !/^\|\s*v?\d+(?:\.\d+)+\s*\|/.test(l)).join('\n');
        const sopLines = bodyT.split(/\r?\n/).length;
        const dates = (bodyT.match(/20\d\d-\d\d-\d\d/g) || []).length;
        if (kb > 60) warns.push(`SOP膨胀 ${path.basename(p)} ${kb.toFixed(0)}KB>60·提纯（密度门判#302）`);
        if (sopLines >= 60 && (dates / sopLines) * 100 > 12) {
          warns.push(`SOP时点密度过高 ${path.basename(p)} 正文日期${dates}处/${sopLines}行(已剔版本表${verRows}行)=${((dates / sopLines) * 100).toFixed(1)}每百行>12·变更应进版本历史一行`);
        }
      }
    };
    sopWalk(path.join(VAULT, '05-Skills · 技能'));
  } catch {}
  // 1c) 书库重复副本＝语料双源（判#1194 实测：100 组·多余 72MB·不入库但占磁盘且两处可各自被标注→分叉）
  //   不一次大扫除（既有令：标准装进运转渐进消化），只让它每日可见；书卡引用实测指向 _本地md原文，故另一侧即副本。
  try {
    const seen = new Map();
    const libWalk = (dir) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { libWalk(p); continue; }
        if (!e.name.endsWith('.md')) continue;
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.size < 200000) continue;                       // 只看 200KB 级原文（小文件重名属正常）
        const k = st.size + '|' + e.name.replace(/\s/g, '').toLowerCase();
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push(p);
      }
    };
    libWalk(path.join(VAULT, '03-Resources · 资源', '书库'));
    let groups = 0, bytes = 0; const worst = [];
    for (const v of seen.values()) if (v.length > 1) {
      groups++; bytes += (v.length - 1) * v.reduce((m, p) => Math.max(m, fs.statSync(p).size), 0);
      if (worst.length < 2) worst.push(path.basename(v[0]).replace(/\.md$/, '').slice(0, 14) + '×' + v.length);
    }
    if (groups) warns.push(`书库重复副本 ${groups} 组·多余 ${(bytes / 1048576).toFixed(0)}MB（语料双源·如 ${worst.join('/')}）→ 保源位（书卡引用所指）删副本·走三件套`);
  } catch {}
  // 2) 判断同标题重复（近 30 天判断里前 20 字相同的）
  try {
    const jlog = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
    const titles = {};
    const now = Date.now(), DAY = 864e5;
    for (const m of jlog.matchAll(/### 判断#(\d+) - (\d{4}-\d{2}-\d{2})（([^）]{6,40})）/g)) {
      const d = new Date(m[2]).getTime();
      if (now - d > 30 * DAY) continue;
      const key = m[3].slice(0, 20);
      (titles[key] = titles[key] || []).push(m[1]);
    }
    const dupT = Object.entries(titles).filter(([, ns]) => ns.length > 1);
    if (dupT.length) warns.push(`判断近30天同标题${dupT.length}组·如#${dupT[0][1].join('/')}`);
  } catch {}
  // 3) 同题多脚本（30 天内新脚本按头判断引聚类·同判断#N + 相似命名 = 疑重）
  try {
    const scriptsByCite = {};
    const cut = Date.now() - 30 * 864e5;
    const walk = (dir) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (/^(\.git|node_modules|_archive|archive|temp|mini|residue)$/.test(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ps1|js|py|sh)$/.test(e.name)) continue;
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.mtimeMs < cut) continue;
        let head = ''; try { head = fs.readFileSync(p, 'utf-8').slice(0, 2500); } catch { continue; }
        const cites = [...head.matchAll(/判断#(\d+)/g)].map(x => x[1]);
        for (const c of new Set(cites)) (scriptsByCite[c] = scriptsByCite[c] || []).push(p); // 判#856：按文件去重（同文件引两次判号=两份假样本）
      }
    };
    walk(path.join(VAULT, 'vault-scripts'));
    walk(path.join(VAULT, 'tools'));
    // 判#856 两处精度根治（占位符「判断#7xx」被截成判#7→假聚类假警报·差点把 Resolve-NodeExe/stagger-boot/proxy-hub 三个异题脚本冤判成同题重复建）：
    //   ①只聚真落在账本上的判号（占位符/悬空号出局）②补回注释声明但实现漏掉的「相似命名」半边——
    //   同判号≥3脚本不等于同题（一个根治判天然横跨多脚本），同名前缀+同判号才是疑重。
    let validNums = null;
    try {
      const segs = require('./judgment-segments.js').segmentsFromText(fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf8'));
      validNums = new Set([...segs.keys()].map(String));
    } catch {}
    const namePrefix = (p) => path.basename(p).replace(/\.(ps1|js|py|sh)$/i, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toLowerCase(); // 判#856：去扩展名后取连续6位字母数字——不在分隔符处截断（stt-daemon 与 stt_hotkey 是同系统两部件不是重复）
    // 判#1291·运行时分工豁免（判#1284）：同前缀但**词干完全相同、仅扩展名分家**（foo.js 与 foo.ps1）=同一逻辑工具的
    //   node/PowerShell 双运行时份，不是同题重复建（js 供 node require·ps1 供 PowerShell & 调用·vault-root 37/39 处真引用实证）；
    //   真重复建=同前缀不同词干（vault-root vs vault-root2）。仅当组内词干全同才豁免，防漏判真重复。
    const stem = (p) => path.basename(p).replace(/\.(ps1|js|py|sh)$/i, '').toLowerCase();
    const clusterKey = {};
    for (const [c, ps] of Object.entries(scriptsByCite)) {
      if (validNums && !validNums.has(c)) continue;
      const byName = {};
      for (const p of ps) (byName[namePrefix(p)] = byName[namePrefix(p)] || []).push(p);
      for (const [pre, same] of Object.entries(byName)) {
        if (same.length < 2) continue;
        if (new Set(same.map(stem)).size === 1) continue;   // 词干全同·仅扩展名分家＝运行时分工·非重复建
        clusterKey[c + '@' + pre] = same;
      }
    }
        // 判#1130（问题第一时间根治）：已知互补簇白名单——不是同题重复建，而是同一根治判的互补纵深，人工裁决登记于此（防循环误报·新裁决继续在此登记）。
        //   2026-10-03 裁：819@syspro = sysproxy-intent(判据唯一住处) + sysproxy-guard(1min 备胎·未装) + sysproxy-watch(常驻事件守卫·现役·ProxyHub 每2min 监督其存活)——三层互补非重复。
        const KNOWN_COMPLEMENTARY = new Set(['819@syspro']);
        const hotCites = Object.entries(clusterKey).filter(([k]) => !KNOWN_COMPLEMENTARY.has(k));
    if (hotCites.length) {
      const ex = hotCites[0];
      warns.push(`判#${ex[0].split('@')[0]} 被${ex[1].length}个同名近似脚本共引·疑同题重复建(${ex[1].map(p => path.basename(p)).join(' / ')})`);
    }
  } catch {}
  // 4) 长期未 update 的 handoff 待办（>7 天未勾选 → 老化杂质）
  try {
    const ho = fs.readFileSync(path.join(VD, '_session-handoff.md'), 'utf-8');
    const stale = (ho.match(/- \[ \]/g) || []).length;
    if (stale > 8) warns.push(`handoff 未勾待办${stale}条·可能已老化·下圈扫一遍·过期即删`);
  } catch {}
  // 5) push 追平卡住检测（判断#677 复利 · hub 的 per-remote 累败 counter）
  try {
    const failDir = path.join(VAULT, 'tools/proxies/proxy-guard/.push-fail');
    if (fs.existsSync(failDir)) {
      // 判#1339 告警必须给对方向：原文案一律写「查网络/凭据」，而本圈实锤 github 累败 92 cycle 的真因是
      //   **分叉未合被 non-fast-forward 拒推**（ls-remote EXIT=0 通道完好·dry-run 明确报 [rejected] (non-fast-forward)）。
      //   方向错的告警比没有告警更贵：它会让人去查代理和 token，而真正在流的是情报链两侧内容互不可见（生存红线④）。
      //   现在按 git-sync-state.json 里存的失败原文分类，取不到原文才回落旧文案。
      let failText = '';
      try {
        const gs = JSON.parse(fs.readFileSync(path.join(VD, 'git-sync-state.json'), 'utf8').replace(/^\uFEFF/, ''));
        failText = Object.keys(gs).filter(k => k.startsWith('pushFail_')).map(k => String(gs[k])).join(' | ');
      } catch {}
      const cls = /non-fast-forward|\[rejected\]|fetch first|behind its remote/i.test(failText)
        ? '分叉未合（远端有本机没有的提交）→ 跑 sync-gate.ps1 -Mode in；若报真冲突则两侧改的是同一文件同一处，须人工判'
        : /Permission denied \(publickey\)|Authentication failed|invalid credentials|HTTP 403|could not read Username/i.test(failText)
          ? '凭据/权限 → 查 Windows 凭据管理器与该 remote 的认证方式'
          : /Could not resolve|Connection refused|timed out|unable to access|Network is unreachable/i.test(failText)
            ? '网络/代理 → 查出网通道'
            : '查网络/凭据（失败原文未落盘·无法分类）';
      for (const f of fs.readdirSync(failDir)) {
        const n = parseInt(fs.readFileSync(path.join(failDir, f), 'utf8'), 10);
        if (!isNaN(n) && n >= 3) warns.push(`push 追平卡住: ${f} 累败 ${n} cycle·${cls}`);
      }
    }
  } catch {}
  // 6) 版本账断更（判#1152·用户『整个系统的版本·根源找出』）：VERSION.md 升级历史最后行日期 >30 天 = 账断（实锤：停 11 天且历史行曾为待补充）
  try {
    const vt = fs.readFileSync(path.join(VAULT, 'VERSION.md'), 'utf-8');
    const rows = [...vt.matchAll(/\|\s*v[\d.]+\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/g)].map(m => m[1]);
    if (!rows.length) warns.push('版本账无历史行·VERSION.md 升级历史空（判#1152）');
    else {
      const vlast = rows.sort().pop();
      const vdays = Math.round((Date.now() - new Date(vlast + 'T23:59:59').getTime()) / 864e5);
      if (vdays > 30) warns.push(`版本账断更 ${vdays} 天（VERSION.md 最后登记 ${vlast}）·补账或演进登记（判#1152）`);
    }
  } catch {}
  // 判#999 架构补维「性质」：只对机制补丁/卡升级要求指卡/升级；老账无性质字段→按语意兜底推断(与 judgment-append 同口径·推断不出取机制补丁)
  const natureIsPatch = (title, body) => {
    const nm = (body.match(/^- \*\*性质\*\*：(.+)$/m) || [])[1];
    if (nm) return /机制补丁|卡升级/.test(nm);
    // 判#1150：+精化|决策入账|实测——规则设计/决策记录/实测结论类不误判为"待升级补丁"（实锤：#808 门律精化/#807 决策入账/#966 可行性实测）
    return !/结案|无罪|误诊|勘误|撤案|误报|已发|已交付|验收|实测结论|快照|状态更新|首单产出|精化|决策入账|实测/.test(String(title) + String(body));
  };
  // 6) session-only 补丁未升级检测（判断#678 管线化·第 11 维「下次启动自动生效」落地）
  try {
    const jlog = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
    const now678 = Date.now(), DAY = 864e5;
    const sessionOnly = [];
    for (const m of jlog.matchAll(/### 判断#(\d+) - (\d{4}-\d{2}-\d{2})（([^）]+)）([\s\S]*?)(?=\n### 判断#|$)/g)) {
      const n = m[1], date = m[2], title = m[3], body = m[4];
      if (now678 - new Date(date).getTime() > 30 * DAY) continue;   // 只看近 30 天
      // 严格匹配独立字段行（^- **修复层**：session-only$ 或含尾随空白）·避免 body 里描述性引用误报
      if (!natureIsPatch(title, body)) continue;                 // 判#999 非补丁性质(勘误/事实/规则设计)不当"待升级补丁"误报
      if (/^- \*\*修复层\*\*：session-only\s*$/m.test(body)) sessionOnly.push(`#${n} ${title.slice(0,30)}`);
    }
    if (sessionOnly.length) warns.push(`session-only 补丁 ${sessionOnly.length} 条待升级根源(第 11 维)·前 3: ${sessionOnly.slice(0,3).join(', ')}`);
  } catch {}
  // 7) 判断无卡链接检测（判断#679 闭环·落地/根治/规范类判断必指卡·否则=判断只落账不落卡=复利链断）
  try {
    const jlog79 = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
    const now79 = Date.now(), DAY79 = 864e5;
    const LAND = /根治|落地|规范|升级|管线化|硬拦|收编/;
    const noCard = [];
    for (const m of jlog79.matchAll(/### 判断#(\d+) - (\d{4}-\d{2}-\d{2})（([^）]+)）([\s\S]*?)(?=\n### 判断#|$)/g)) {
      const n = m[1], date = m[2], title = m[3], body = m[4];
      if (now79 - new Date(date).getTime() > 30 * DAY79) continue;
      if (Number(n) < 730) continue;                                // 判#1150：制度前老判豁免——判#730 兑现/卡链接制度起点·老判生于无制度时代且 JHASH 锁死不可补·追溯无效（实锤：160 条中 72 条属此）
      if (!LAND.test(title + body)) continue;                       // 只看含落地/根治类字样的判断
      if (!natureIsPatch(title, body)) continue;                    // 判#999 机制补丁/卡升级才要求指卡；勘误/事实/规则设计类本无卡可指=不误报
      if (/^- \*\*涉及卡\*\*：/m.test(body)) continue;                // 已有卡链接 → 通过
      if (/兑现\*\*：\[(delivered|pending)\]/.test(body)) continue;   // 判#1150：机制类复利链=卡 or 兑现回检·有一即可（第一性原理·防"报警不可处置"噪声）
      noCard.push(`#${n} ${title.slice(0,30)}`);
    }
    if (noCard.length) warns.push(`判断无卡链接 ${noCard.length} 条·落地类判断必指卡·否则复利链断(判断#679)·前 3: ${noCard.slice(0,3).join(', ')}`);
  } catch {}
  // 8) 大家问题清单断更检测（判断#683 十二维·外部输入不能停·判#749 分辨「采集断」与「汇入断」）
  try {
    const ppl = path.join(VAULT, '00-Inbox · 收件箱', '_大家问题清单.md');
    if (!fs.existsSync(ppl)) {
      warns.push('大家问题清单缺失·外部痛点入口未建·判#683');
    } else {
      // 判据=正文最新条目日期，不是 mtime：AI 销账/改判号同样刷 mtime → 断链永远扫不出
      // （判#735 实测：清单正文停在 09-06·mtime 却是当天·雷达一直绿=假阴性·方向对）
      // 判#749 补归因：旧文案一口咬定「采集断链」，而实测四 zsxq 任务全 rc=0、采集件当日仍在进账
      //   → 断的其实是「采集→清单」这一跳（手动搬运当机制·判#679律三）。指错病灶=每圈 AI 被支去查 token/网络。
      const newestOf = (txt) => { let n = 0; for (const m of txt.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) { const d = new Date(m[1] + 'T23:59:59').getTime(); if (d > n) n = d; } return n; };
      const tPpl = fs.readFileSync(ppl, 'utf-8');
      let newest = 0;
      for (const m of tPpl.matchAll(/\*\*\[(\d{4}-\d{2}-\d{2})\]/g)) {
        const d = new Date(m[1] + 'T23:59:59').getTime();
        if (d > newest) newest = d;
      }
      const RAW = path.join(VAULT, '00-Inbox · 收件箱', '来自飞轮-原料');
      let feed = 0;
      for (const sub of ['标签采集', '全量采集']) {
        const dir = path.join(RAW, sub);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
          try { const d = newestOf(fs.readFileSync(path.join(dir, f), 'utf-8')); if (d > feed) feed = d; } catch {}
        }
      }
      if (!newest) warns.push('大家问题清单无一条 **[YYYY-MM-DD]** 标注·断更不可判·查采集格式');
      else {
        const days = Math.round((Date.now() - newest) / 864e5);
        if (days > 7) {
          if (feed && (Date.now() - feed) / 864e5 <= 7) {
            const pend = (tPpl.match(/^- \[ \]/gm) || []).length;
            warns.push(`大家问题清单正文最新条目已 ${days} 天前·**采集侧正常（最新料 ${Math.round((Date.now() - feed) / 864e5)} 天前）→ 断在「采集→清单」汇入这一跳**，不是采集死·别去查 token/网络 → 跑 node vault-scripts/zsxq/harvest-pain-points.mjs（未自动=查 Vault-zsxq-harvest 计划任务·判#749）·当前待解 ${pend} 条`);
          } else {
            warns.push(`大家问题清单正文最新条目已 ${days} 天前·采集侧最新料亦 ${feed ? Math.round((Date.now() - feed) / 864e5) : '无'} 天前 = **采集真死** → 查 Vault-zsxq-fetch/tag/members 计划任务 LastTaskResult 与 token（判#749）`);
          }
        }
      }
    }
  } catch {}
  // 8.5) 星球凭据死检测（判#1404）：401 会让全部 zsxq 采集静默空转，而任务 LastResult 全绿、日志说「✅ 顶部」
  try {
    const ad = JSON.parse(fs.readFileSync('C:/Users/Mi/.zsxq/auth-dead.json', 'utf-8'));
    const hrs = Math.round((Date.now() - Date.parse(ad.firstSeen)) / 36e5);
    check('星球凭据', 'F',
      `凭据死 ${hrs}h（首次 ${String(ad.firstSeen).slice(0, 16)}·最后撞上 ${ad.lastScript}）= 全部星球采集空转，且计划任务表看不出来（判#1404·401 曾被当抖动退避重试并打印✅顶部·exit 0）→ ${ad.fix}`,
      '续 Cookie 后跑 node vault-scripts/zsxq/auth-health.mjs --verify 自动清标记·标记文件 C:/Users/Mi/.zsxq/auth-dead.json');
  } catch { /* 无标记=凭据活 */ }
  // 8.6) 星球采集「跑完不报错、但没进新料」检测（判#1404 第二面·天团 AMD-DSFlash 挑出）：
  //   8.5 只抓「报错却没报上去」，抓不到「根本没报错、只是每日轮次落空」。实测 fetch.log 97 次运行里
  //   ~80 次是同一句 `页数: 1 | 扫描: 72240 | 新写入: 1779`＝反复重写同一批，10-02 12:31 后无新鲜进账，
  //   任务表全绿。判据不看 rc，看**产物有没有长新东西**（判#1249：判据答案必须对准真问题）。
  try {
    const RAWX = path.join(VAULT, '00-Inbox · 收件箱', '来自飞轮-原料');
    let feedNewest = 0;
    const walkFeeds = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walkFeeds(p); continue; }
        if (!e.name.endsWith('.md')) continue;
        try {
          for (const m of fs.readFileSync(p, 'utf-8').matchAll(/\b(20\d{2}-\d{2}-\d{2})T/g)) {
            const v = Date.parse(m[1] + 'T00:00:00Z');
            if (v > feedNewest) feedNewest = v;
          }
        } catch {}
      }
    };
    for (const sub of ['标签采集', '全量采集', '成员轨迹', '知识星球']) {
      const d = path.join(RAWX, sub);
      if (fs.existsSync(d)) walkFeeds(d);
    }
    const feedDays = feedNewest ? Math.round((Date.now() - feedNewest) / 864e5) : -1;
    if (feedDays > 3) {
      check('星球采集出新', 'W',
        `星球原料最新内容 ${feedDays < 0 ? '读不到' : feedDays + ' 天前'}（>3 天）= 采集"跑完不报错但没进新料"，与"星球真没新帖"在日志里逐字相同（判#1404）。先看 C:/Users/Mi/.zsxq/fetch.log 末次「新写入」数字是否一直停在同一值`,
        '凭据活而仍不出新料时，查 run-tag/run-fetch 三段实际产出，别只看 LastTaskResult');
    }
  } catch { /* 读不到不当病报，交由其他维 */ }
  // 9) 零对外判断检测（判断#683 十二维·意义利他·纯自转=不复利）
  try {    const jlog9 = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
    const now9 = Date.now();
    const inwardOnly = [];
    for (const m of jlog9.matchAll(/### 判断#(\d+) - (\d{4}-\d{2}-\d{2})（([^）]+)）([\s\S]*?)(?=\n### 判断#|$)/g)) {
      const n = m[1], date = m[2], title = m[3], body = m[4];
      if (now9 - new Date(date).getTime() > 7 * 864e5) continue;   // 只看近 7 天
      if (/^- \*\*服务谁\*\*：(读者|社群|成员|朋友|家人|未来\s*AI|世界)/m.test(body)) continue;  // 有对外·通过（判#735 修「未来AI」无空格被漏判=假自转）
      if (!/^- \*\*服务谁\*\*：自\s*$/m.test(body)) continue;  // 未标（存量·跳过·不算违规）
      inwardOnly.push(`#${n}`);
    }
    if (inwardOnly.length >= 5) warns.push(`近 7 天 ${inwardOnly.length} 条判断服务「自」而已·十二维提示：下次判断试试指向他人痛点（读者/社群/成员）`);
  } catch {}
  // 10) 内容管线断链检测（判断#685 环 4·痛点→内容→读者）
  try {
    const outDir = path.join(VAULT, '01-Projects · 项目', '内容管线', 'out');
    const ppl = path.join(VAULT, '00-Inbox · 收件箱', '_大家问题清单.md');
    if (fs.existsSync(ppl)) {
      const ptxt = fs.readFileSync(ppl, 'utf-8');
      const todo = (ptxt.match(/^- \[ \]/gm) || []).length;
      const done = (ptxt.match(/^- \[x\]/gm) || []).length;
      const outFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(f => f.endsWith('.md')) : [];
      // 30 天 · 若待解 > 0 且 out/ 空 → 内容管线未启动
      if (todo > 0 && outFiles.length === 0) {
        warns.push(`内容管线未启动·清单 ${todo} 条待解但 out/ 零产出·判#685 环 4 断`);
      } else if (outFiles.length > 0) {
        // 判#1410 根治：原判据只算 [x]、只会报「需加速」——三个实测毛病：
        //   ① 漏算 [~]（进行中）→ 有稿在做的题被当成没动；② 只报数不给下一步=空报警，看完仍不知该干嘛；
        //   ③ 阈值 5% 永远触发=永远黄=报警疲劳（黄多了就没人看）。
        // 治法：算「有进展」= 已解+在办；报警必须**指名道姓给动作**，且区分「机制没跑」与「人在推进」。
        const doing = (ptxt.match(/^- \[~\]/gm) || []).length;
        const progressed = done + doing;
        const total = todo + done + doing;
        const rate = total ? progressed / total : 1;
        // ① 先查机制在不在跑：有稿却没一条 [~] = pain-point-settle 没接链（这才是真病，不是"人慢"）
        const hasOutTargets = outFiles.some(f => /给-.+-/.test(f));
        if (hasOutTargets && doing === 0) {
          warns.push(`内容管线回写断·out/ 有 ${outFiles.length} 篇且含「给-X-」稿，但清单 0 条 [~]（进行中）→ **不是人要加速，是回写机制没在跑**：跑 node vault-scripts/zsxq/pain-point-settle.mjs（判#1408 装·应挂 run-harvest.bat 每日链）`);
        } else if (rate < 0.05) {
          // ② 机制在跑但进度低 → 报警必须给「下一步抽哪几条」，而不是「需加速」
          warns.push(`内容消化率低 有进展 ${progressed}/${total}=${(rate * 100).toFixed(1)}%（已解 ${done} + 在办 ${doing}）·out/ ${outFiles.length} 篇 → 下一步动作：从清单取最高👍的待解题开一圈（判#783 盲评序），别继续只采不出`);
        }
      }
    }
  } catch {}
  // 11) 反馈未处理检测（判断#685 环 5·读者声音进来了要处理·判#863 心跳分辨「采集器在跑·暂无回评」与「零采集器」）
  try {
    const fbDir = path.join(VAULT, '01-Projects · 项目', '内容管线', 'feedback-in');
    if (fs.existsSync(fbDir)) {
      const fbs = fs.readdirSync(fbDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
      // 判#775 补洞：原判据只在「有反馈且超 30 天未消化」时报 → **零反馈永远绿**。
      // 判#863：写入方已实装（settle-delivery.mjs 主流程·挂 Vault-zsxq-settle@13:10 每日链）→
      // 用其库外心跳分辨两种病：心跳活+零反馈=读者真没回评（不报，送达悬置由 out 台账维度另报·不双计）；
      // 心跳缺/停更>3天=采集链死了（这才是本维该报的病）。
      let collectorAlive = false;
      try {
        const st = JSON.parse(fs.readFileSync('C:/Users/Mi/.zsxq/feedback-collect-status.json', 'utf-8'));
        collectorAlive = !!st.lastRun && (Date.now() - Date.parse(st.lastRun)) / 864e5 <= 3 && typeof st.topicsChecked === 'number';
      } catch {}
      if (!fbs.length && !collectorAlive) {
        warns.push('环 5 零输入·feedback-in/ 无真实反馈·且采集器心跳缺失/停更＞3天（判#863 链=Vault-zsxq-settle@13:10·心跳=C:/Users/Mi/.zsxq/feedback-collect-status.json）→ 先修采集链再谈读者反馈');
      }      const stale = [];
      for (const f of fbs) {
        const st = fs.statSync(path.join(fbDir, f));
        if ((Date.now() - st.mtimeMs) / 864e5 > 30) stale.push(f.slice(0, 30));
      }
      if (stale.length) warns.push(`反馈未消化 ${stale.length} 条超 30 天·前 3: ${stale.slice(0,3).join(', ')}·环 5 断`);
    }
  } catch {}
  // 13-15) 判#708 承诺·判#709 实装 · out/ 管线三硬扫
  try {
    const outDir = path.join(VAULT, '01-Projects · 项目', '内容管线', 'out');
    // 13) _quality-log 未登记但已 sent 的稿 = 违反五维评分门
    const qlPath = path.join(outDir, '_quality-log.md');
    const idxPath = path.join(outDir, '_index.md');
    if (fs.existsSync(qlPath) && fs.existsSync(idxPath)) {
      const ql = fs.readFileSync(qlPath, 'utf-8');
      const idx = fs.readFileSync(idxPath, 'utf-8');
      // 从 index 找所有已 sent 稿名·对照 ql 是否登记（含评分总分数字）
      const sentNames = (idx.match(/v\d+[^|]*\|[^\n]*\|[^\n]*(?:sent|delivered|responded|digested)[^\n]*\|/g) || []);
      const unlogged = sentNames.filter(s => {
        const m = s.match(/(v\d+)/);
        return m && !new RegExp('\\|\\s*' + m[1] + '\\s*\\|').test(ql);
      });
      if (unlogged.length) warns.push(`out 稿未登记五维评分但已 sent · ${unlogged.length} 条 · 违反判#708 源质量门`);
    }
    // 14) 台账 sent-but-not-delivered ≥3 条 = 自嗨
    if (fs.existsSync(idxPath)) {
      const idx = fs.readFileSync(idxPath, 'utf-8');
      const notDelivered = (idx.match(/sent-but-not-delivered/g) || []).length;
      if (notDelivered >= 3) warns.push(`out 台账 sent-but-not-delivered ${notDelivered} 条 · 判#707「我做了≠她收到了」·你在自嗨`);
    }
    // 15) 单稿 sent 超 30 天未推进 = 每稿都标
    if (fs.existsSync(idxPath)) {
      const idx = fs.readFileSync(idxPath, 'utf-8');
      const now30 = Date.now() - 30 * 864e5;
      for (const m of idx.matchAll(/\|\s*(v\d+)[^|]*\|[^\|]*\|[^\|]*\|[^|]*sent-but-not-delivered[^|]*\|\s*(\d{4}-\d{2}-\d{2})/g)) {
        const d = new Date(m[2]).getTime();
        if (d && d < now30) {
          warns.push(`out ${m[1]} 已 ${Math.round((Date.now()-d)/864e5)} 天未送达 · 判#708 应撤回或改路径`);
        }
      }
    }
  } catch (e) {}
  check('密度膨胀+去杂质', warns.length ? 'W' : 'P',
    warns.length ? warns.join('; ') : '规则/handoff 无膨胀·判断无同题重复·脚本无冗余共引',
    warns.length ? '去杂质：合并同题脚本 / 提纯 handoff / 撤重复判断 / 老化待办清理' : '');
})();

// ── ㉑ 分类合规 + 馆藏盘点（2026-09-22 永久分类地基·阶段0）──
// root: KC-SYS-001 > 由内而外 > 放大镜；板块唯一源=vault-data/classification.json（卡片标准 5.4·1 受控嵌套）
// 读 classification.json 扫：板块已定义未落地(planned=W) / 卡未归位(active) / 超阈值未裂板 / 错放未迁 → W；
// 并把板块树渲染成 vault-data/_馆藏总览.md（数据化→可视化，勿手改）。TYPE≤12 不在此检查（卡身份层锁死）。
(function checkClassification() {
  const clsPath = path.join(VD, 'classification.json');
  let cls = null;
  try { cls = JSON.parse(fs.readFileSync(clsPath, 'utf-8').replace(/^﻿/, '')); }
  catch (e) { check('分类合规+馆藏盘点', 'W', 'classification.json 缺失/解析失败: ' + e.message, '建/修 vault-data/classification.json（板块层唯一源）'); return; }
  const warns = []; const lines = [];
  let totalBoards = 0, definedCards = 0;
  lines.push('# 馆藏总览（自动渲染自 classification.json·勿手改）');
  lines.push(`> 更新: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · TYPE≤12锁死(卡身份) / 板块层会长(append-only)`);
  lines.push('');
  for (const [dirPath, info] of Object.entries(cls.classes || {})) {
    const abs = path.join(VAULT, dirPath);
    lines.push(`## ${dirPath} · 状态:${info.status}`);
    if (!fs.existsSync(abs)) { warns.push(`${dirPath} 目录不存在`); lines.push(''); continue; }
    const rootKc = fs.readdirSync(abs).filter(f => /^KC-.*\.md$/.test(f));
    let foldersMade = 0;
    for (const b of (info.boards || [])) {
      totalBoards++; definedCards += (b.cards || []).length;
      const bf = path.join(abs, b.folder);
      const exists = fs.existsSync(bf); if (exists) foldersMade++;
      const inBoard = exists ? fs.readdirSync(bf).filter(f => /^KC-.*\.md$/.test(f)).length : 0;
      lines.push(`- **${b.folder}**（${b.problem}）: 定义 ${(b.cards || []).length} 张${exists ? ` / 已落 ${inBoard}` : ' / 未落地'}`);
      if (info.status === 'active' && exists && inBoard < (b.cards || []).length) warns.push(`${dirPath}/${b.folder} 应${(b.cards || []).length}实${inBoard}·有卡未归位`);
      // ── 判#1329 双向闭环：实物多于登记 = 「新卡入库但没登记库位」──
      // 【为什么补这条·实测病灶】原判据只查单向（inBoard < 登记）→ 抓「登记了但没落盘」；
      //   **漏掉反向**（inBoard > 登记）→ 「卡已在架上、登记表没它」永远静默。
      //   实证 2026-10-14：7 处不符（能力/02 登记16实21 · 人物/04 登记4实8 …），
      //   根因全是**新卡物理归位了、classification.json 没同步** → 地图画的是旧状态、无任何灯亮。
      //   修法：登记与实物**双向**比对，多出来的卡逐个点名（不只报数字，报卡号便于直接补登记）。
      if (exists && inBoard > (b.cards || []).length) {
        const actual = fs.readdirSync(bf).filter(f => /^KC-.*\.md$/.test(f))
          .map(f => (f.match(/^(KC-[A-Z]+-[A-Z]*-?\d+)/) || [])[1]).filter(Boolean);
        const reg = new Set(b.cards || []);
        const unreg = actual.filter(c => !reg.has(c));
        warns.push(`${dirPath}/${b.folder} 实物${inBoard}>登记${(b.cards || []).length}·**有${unreg.length}张卡未登记库位**（${unreg.slice(0, 3).join('/')}${unreg.length > 3 ? '…' : ''}）→ 补进 classification.json 后跑 gen-maps.js`);
      }
      if (exists && inBoard > (cls.thresholds && cls.thresholds.splitWhenBoardCardCountGt || 30)) warns.push(`${dirPath}/${b.folder} ${inBoard}张超阈值·考虑裂新板块`);
    }
    if (info.misfiled && info.misfiled.length) lines.push(`- 待迁出(错放)${info.misfiled.length}张: ${info.misfiled.map(m => m.card + '→' + (m.toDir === 'PENDING' ? '待判' : path.basename(m.toDir))).join(' ')}`);
    if (info.status === 'planned' && foldersMade === 0) warns.push(`${dirPath}: 板块已定义但物理未落地(待阶段1归位)，现平面 ${rootKc.length} 张`);
    if (info.status === 'active' && rootKc.length) warns.push(`${dirPath}: 仍有 ${rootKc.length} 张卡平铺未入板块`);
    // ── 判#1325 代谢门①：架级地图存在性（地图=投影不是手抄，缺图=人找不到东西）──
    //   判据：active 且有板块 → 每个架目录必须有 _index.md（gen-maps.js 生成）
    for (const b of (info.boards || [])) {
      const bf = path.join(abs, b.folder);
      if (fs.existsSync(bf) && !fs.existsSync(path.join(bf, '_index.md')))
        warns.push(`${dirPath}/${b.folder} 缺架级 _index.md（跑 node vault-scripts/gen-maps.js --apply）`);
    }
    lines.push('');
  }
  // ── 判#1325 代谢门②：单目录规模上限（防「一直运行→平面膨胀→全量扫描变慢」）──
  //   实证：vault-data 464 项 / 06 记忆 462 项 / vault-scripts 198 项。上限 500 报警（W），不自动挪（挪=破坏依赖）。
  for (const [label, rel] of [['06 · 共享记忆', '06 · 共享记忆'], ['vault-data', 'vault-data'], ['vault-scripts', 'vault-scripts']]) {
    const p = path.join(VAULT, rel);
    try {
      const n = fs.readdirSync(p).length;
      if (n > 500) warns.push(`${label} 顶层 ${n} 项超上限500·平面膨胀（治：TTL归档/按用途分层·判#1325）`);
    } catch { /* 目录不存在=不判 */ }
  }
  // ── 判#1325 代谢门③：TTL 滞留率（防「只长不收」）──
  //   判据：vault-data 顶层 30 天未动的一次性产物占比 > 60% = 代谢跟不上生长（实测基线 61%）。
  try {
    const vd = path.join(VAULT, 'vault-data');
    const fsx = fs.readdirSync(vd, { withFileTypes: true }).filter(e => e.isFile());
    const cut = Date.now() - 30 * 864e5;
    const stale = fsx.filter(e => { try { return fs.statSync(path.join(vd, e.name)).mtimeMs < cut; } catch { return false; } }).length;
    const rate = fsx.length ? stale / fsx.length : 0;
    lines.push(`- 代谢指标：vault-data 顶层 ${fsx.length} 个文件·30天未动 ${stale} 个（${(rate * 100).toFixed(0)}%）`);
    if (fsx.length >= 50 && rate > 0.6) warns.push(`vault-data 滞留率 ${(rate * 100).toFixed(0)}% (>60%)·只长不收（跑 vault-scripts\\archive-stale.ps1 归档）`);
  } catch { /* 读不到=不判（§④½ 样本为0不判绿也不判红） */ }
  try { require('./atomic-write.js').atomicWrite(path.join(VD, '_馆藏总览.md'), lines.join('\n'), { validate: null }); } catch (e) { try { fs.writeFileSync(path.join(VD, '_馆藏总览.md'), lines.join('\n'), 'utf-8'); } catch {} }
  check('分类合规+馆藏盘点', warns.length ? 'W' : 'P',
    warns.length ? warns.join('; ') : `板块${totalBoards}个·分类${definedCards}张·classification.json 为板块唯一源·无混类/无未归位`,
    warns.length ? '按 classification.json 落地归位(阶段1) 或提纯 classification.json' : '');
})();

// ── ㉒ 卡编号三位数合规（2026-09-22 用户「编号必须三位数」根治·防再犯）──
// 规则源：卡片标准 5.1「NUMBER 为三位数字（001、002…）」。扫全库活卡文件名，编号非3位=红（备份/test/归档排除）。
(function checkIdDigits() {
  const bad = [];
  const skipDir = /^(\.git|node_modules|_archive|archive|temp|residue|mini|system-backup)$/;
  (function w(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (skipDir.test(e.name) || /^04-Archive/.test(e.name)) continue; w(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const b = e.name.replace(/\.md$/, '');
      const m = b.match(/^KC-[A-Za-z-]*?(\d+)/); if (!m) continue;
      if (m[1].length !== 3) bad.push(`${path.relative(VAULT, p)}  (编号 ${m[1]} =${m[1].length}位)`);
    }
  })(VAULT);
  check('卡编号三位数合规', bad.length ? 'F' : 'P',
    bad.length ? `${bad.length}张卡编号非3位: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? ` …另${bad.length - 5}张` : ''}` : '全库活卡编号均三位数(001…)·规则源 卡片标准5.1',
    bad.length ? '补零/改号至3位（仅当目标不存在才是真断链，需先建卡）；参见 卡片标准 5.1 L265' : '');
})();

// ── ㉓ 并发写健康（2026-09-22 判断#682·多AI覆盖根治·可见性）──
// 读 ai-lock status：活跃租约=谁在写(信息)·陈旧租约(疑崩溃持有者)=W。单AI正常无租约=P。
(function checkConcurrency() {
  let st, prunedN = 0; try { const lock = require('./ai-lock.js'); prunedN = lock.prune().length; st = lock.status(); }
  catch (e) { check('并发写健康', 'W', 'ai-lock status 失败: ' + e.message, '查 vault-scripts/ai-lock.js'); return; }
  const stale = st.filter(x => x.stale), active = st.filter(x => !x.stale);
  // 判#1206 由内根治：陈旧锁(age>ttl=持有者崩溃未续约)每小时自动 prune·与 acquire 覆盖同一不变式·不再滞留待人工强抢
  const msg = stale.length
    ? `${stale.length}把陈旧锁(prune 未清·疑文件占用): ${stale.map(s => s.name + '@' + s.ai + '(' + s.age_s + 's)').join(', ')}`
    : (active.length ? `活跃租约${active.length}把(谁在写): ${active.map(a => a.name + '@' + a.ai).join(', ')}·无冲突${prunedN ? `·本轮自清陈旧锁${prunedN}把` : ''}` : '无并发写租约·无陈旧锁');
  check('并发写健康', stale.length ? 'W' : 'P', msg, stale.length ? 'prune 未能删除·查 vault-data/ai-locks/ 目录写权限' : '多AI改共享/系统文件前先 ai-lock acquire·status 看谁在写');
})();

// ── ㉖ 情报消费闭环（判#1015 全域情报方向·丙作用侧·"采了没用=囤积"机器可检）──
// 纯函数（顶部 --selftest-intel 独立测·能翻车）：按最新 intel 产出日 vs 最新消费留痕日判状态。
// 判#1025 加活决策通道维：.next-step 假死>7天=情报背着死决策跑·研判留痕再新也不算闭环。
function intelConsumptionState(latestIntelDate, latestCallDate, todayStr, lagThresholdDays, nsAgeDays) {
  if (!latestIntelDate) return { status: 'P', msg: '无情报产出·作用侧无从判（采集断流归 radar⑪）' };
  if (typeof nsAgeDays === 'number' && nsAgeDays > 7) return { status: 'F', msg: '活决策通道 .next-step 假死 ' + nsAgeDays + ' 天——情报背着死决策运行=战场喂假情报（判#1025·研判留痕不折抵）' };
  if (!latestCallDate) return { status: 'W', msg: '情报已产出但无任何消费留痕（intel-calls.jsonl 空/未起）·待 intel-analysis 首次落痕' };
  if (latestCallDate >= latestIntelDate) return { status: 'P', msg: '最新情报 ' + latestIntelDate + ' 已被研判消费（call ' + latestCallDate + '）·作用侧闭环' };
  const lag = Math.round((new Date(latestIntelDate) - new Date(latestCallDate)) / 864e5);
  if (lag > lagThresholdDays) return { status: 'F', msg: '最新情报 ' + latestIntelDate + ' 落后消费留痕 ' + latestCallDate + ' 达 ' + lag + ' 天·采了没用=囤积死情报' };
  return { status: 'W', msg: '消费留痕 ' + latestCallDate + ' 落后最新情报 ' + latestIntelDate + '（' + lag + ' 天·待今日 intel-analysis 研判消费）' };
}
(() => {
  let latestIntel = null;
  const intelBase = path.join(VAULT, '00-Inbox · 收件箱', '情报');
  const collectIntel = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) { const m = f.match(/^intel-(\d{4}-\d{2}-\d{2})\.md$/); if (m && (!latestIntel || m[1] > latestIntel)) latestIntel = m[1]; } };
  try { collectIntel(intelBase); if (fs.existsSync(intelBase)) for (const e of fs.readdirSync(intelBase, { withFileTypes: true })) if (e.isDirectory()) collectIntel(path.join(intelBase, e.name)); } catch {}
  let latestCall = null;
  try {
    for (const ln of fs.readFileSync(path.join(VD, 'intel-calls.jsonl'), 'utf8').split('\n')) {
      try { const o = JSON.parse(ln); if (o.date && (!latestCall || o.date > latestCall)) latestCall = o.date; } catch {}
    }
  } catch {}
  // .next-step 假死年龄（判#1025）：取不到（缺失/stat失败）传 null——不臆断
  let nsAge = null;
  try { const nsP = path.join(VD, '.next-step'); if (fs.existsSync(nsP)) nsAge = Math.round((Date.now() - fs.statSync(nsP).mtimeMs) / 864e5 * 10) / 10; } catch {}
  const st = intelConsumptionState(latestIntel, latestCall, new Date(Date.now()).toISOString().slice(0, 10), 1.5, nsAge);
  check('情报消费闭环', st.status, st.msg + (typeof nsAge === 'number' ? '（.next-step 年龄 ' + nsAge + ' 天）' : ''), st.status === 'F' ? '活通道死→收工圈回写 vault-data/.next-step（本圈决断+下圈动作清单·情报管线.md #14）；消费留痕死→跑 intel-analysis.ps1 落痕' : '');
})();

// ── ㉛ 产出动作对账（判#1029 飞轮第二判据的机器化身：每轮产出必挂下一步动作）──
// 对账：judgment-log 最新判断日 J vs .next-step 首行日期 N（无日期回退 mtime 日）：J>N 即产出未挂动作·>3天F
// 判#1031 反向条款入机：动作行(含【人/机器/AI】且带→)未携⟨情报⟩标记计裸奔·裸奔>0=W——情报服务于每个动作为真
// 纯函数顶部 --selftest-landing 独立验（能翻车：同日P/滞后W/F/无表F/表更新不误杀/裸奔W）
function actionLandingState(latestJudgDate, nsDate, bareActionCount, ledgerLagDays) {
  if (!latestJudgDate) return { status: 'P', msg: '无判断落账·无产出可对账' };
  if (!nsDate) return { status: 'F', msg: '有判断(' + latestJudgDate + ')但行动表无日期/不存在——产出无从证明挂了动作（判#1029违反·不 fail-open）' };
  const lag = Math.round((new Date(latestJudgDate) - new Date(nsDate)) / 864e5);
  if (lag > 3) return { status: 'F', msg: '行动表落后最新判断 ' + lag + ' 天——连续多圈产出没挂动作（判#1029第二判据违反）' };
  if (lag > 0) return { status: 'W', msg: '行动表落后判断 ' + lag + ' 天·待本圈收工挂上（.next-step 段头日期+那一动作）' };
  if (bareActionCount > 0) return { status: 'W', msg: '行动表同日已新·但 ' + bareActionCount + ' 格动作没标情报服务行（判#1031反向条款：每格动作需写明服务它的触发/依据情报）' };
  if (ledgerLagDays === null) return { status: 'W', msg: '行动表同日已新·但无回流台账段——上圈锚结果无处可查（判#1032：换表前先记台账）' };
  if (ledgerLagDays > 1) return { status: 'W', msg: '回流台账最后记于 ' + ledgerLagDays + ' 天前而表已换——新动作盖了旧动作的尸·闭环断在回流（判#1032）' };
  return { status: 'P', msg: '行动表(' + nsDate + ')同步判断(' + latestJudgDate + ')·每格挂情报服务·回流台账 ' + ledgerLagDays + ' 天内有记——闭环回流迭代复利全回路' };
}
(() => {
  let lj = null;
  try {
    for (const ln of fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8').split('\n')) {
      const m = ln.match(/^### 判断#\d+ - (\d{4}-\d{2}-\d{2})/);
      if (m && (!lj || m[1] > lj)) lj = m[1];
    }
  } catch {}
  let nsd = null; let bare = 0; let ledgerMax = null; let hasLedger = false;
  try {
    const nsP = path.join(VD, '.next-step');
    if (fs.existsSync(nsP)) {
      const txt = fs.readFileSync(nsP, 'utf-8');
      const m = txt.slice(0, 400).match(/(\d{4}-\d{2}-\d{2})/);
      nsd = m ? m[1] : new Date(fs.statSync(nsP).mtimeMs).toISOString().slice(0, 10);
      // 裸奔动作格统计（判#1031）+ 回流台账最新日统计（判#1032：台账段内 `|` 行的日期取 max）
      hasLedger = txt.includes('回流台账');
      for (const ln of txt.split('\n')) {
        if (/【(人|机器|AI)/.test(ln) && ln.includes('→') && !ln.includes('⟨情报') && !ln.includes('⟨检验法')) bare++;
        const lm = ln.match(/^(\d{4}-\d{2}-\d{2})\s*\|/);
        if (lm && (!ledgerMax || lm[1] > ledgerMax)) ledgerMax = lm[1];
      }
    }
  } catch {}
  const ledgerLag = (nsd && ledgerMax) ? Math.round((new Date(nsd) - new Date(ledgerMax)) / 864e5) : (hasLedger ? null : null);
  const st = actionLandingState(lj, nsd, bare, hasLedger ? ledgerLag : null);
  check('产出动作对账', st.status, st.msg, st.status === 'P' ? '' : '收工圈顺序：①先往上圈回流台账追加锚结果(`日期 | 锚 | 结果 | 下一手`)②再刷新表体(段头今日+每格动作+⟨情报服务⟩行)（根卡v5.4.15三判据·判#1029/1031/1032）');
})();

// ── ㉔ 引用完整性·断链（判#686建·判#748改渐进语义）：一次性大扫除=机器解决不算消化；标准装进运转=触碰即修(validate-change②)+存量记账不炸+新增才报 ──
(() => {
  try {
    const out = execFileSync('node', [path.join(VAULT, 'vault-scripts/fix-links.js')], { encoding: 'utf-8', timeout: 60000 });
    const m1 = out.match(/干跑\]\s*(\d+)\s*文件\s*\/\s*(\d+)\s*处/); const m2 = out.match(/无法唯一判定[^\d]*(\d+)/);
    const fixable = m1 ? +m1[2] : 0, manual = m2 ? +m2[1] : 0;
    const blp = path.join(VD, 'link-baseline.json');
    let base = null; try { base = JSON.parse(fs.readFileSync(blp, 'utf-8').replace(/^\uFEFF/, '')); } catch {}
    const bManual = base && typeof base.manual === 'number' ? base.manual : manual;
    const bFixable = base && typeof base.fixable === 'number' ? base.fixable : fixable;
    if (!base || manual > bManual || fixable > bFixable) { // 首见立基线；只有变差才报警
      try { require('./atomic-write.js').atomicWrite(blp, JSON.stringify({ manual, fixable, ts: new Date().toISOString() }), { validate: 'json' }); } catch {}
      const worse = base && (manual > bManual || fixable > bFixable);
      check('引用完整性断链', worse ? 'W' : 'P',
        worse ? `较基线恶化 manual ${bManual}→${manual} fixable ${bFixable}→${fixable}（触碰即自愈·validate-change②）`
              : `基线已立 manual${manual}·fixable${fixable}：存量随日常触碰逐步消化·不一次大扫除（判#748）`,
        worse ? '查新增来源：新文件按标准写·存量别急着批量' : '');
    } else {
      check('引用完整性断链', 'P', `存量 manual${manual}≤基线${bManual}·fixable${fixable}≤${bFixable}·运转中渐进消化无恶化`, '');
    }
  } catch (e) { check('引用完整性断链', 'W', 'fix-links 检测失败: ' + String(e.message).slice(0, 60), '查 vault-scripts/fix-links.js'); }
})();

// ── 判#730 决策日志成活 · 判号兑现回检（㉕）──
// 判#764 根治两处致命失真（原实现自上线起就没起过作用）：
//  ① 取段用 /^###...([\s\S]*?)(?=\n### 判断#|$)/gm —— `m` 下 `$` 命中行尾，正文在**第一个空行**被截断；
//     而 兑现/涉及卡/服务谁 一律写在段尾 → 实测 458 段中 455 段被截断，看见 pending 0·delivered 0，
//     真段实有 14·22。即这道"防讲了没跑"的门从未读过账本一个字，永远报绿。改用真段取法唯一源（与 validate-change 共用）。
//  ② 只数标签、从不执行段内自己声明的「回检命令」，补救语还写「能跑通则手改 [pending] 为 [delivered]」
//     → 兑现=自报标签，改个字就算完成，且此后永不复检。现在真跑：delivered 跑不通 = ❌ 假兑现（比 pending 重）。
//  成本控制（用户 09-24 令「不掉效率与质量」）：结果缓存 24h + 每次最多新跑 8 条 + 含写操作的命令一律不执行。
(() => {
  try {
    const { segmentsFromText } = require('./judgment-segments.js');
    // 判#1339：回检执行器收归唯一源 vault-scripts/delivery-verify.js（本维与入口 judgment-append 共用同一把尺）。
    //   原内联四函数（stripNote/parseExpect/routeRun/judge）留在这里=第二把尺：入口禁「应为 <具体数>」而本维 STRICT 却收数字并判真假，
    //   且 stdoutEq 分支 split('\n').pop() 取到尾随换行后的空串 → 判#1173(真值5)/判#1156(真值505) 被记成「实测 (空)」。尺只能有一把。
    const { judge, diagnose } = require('./delivery-verify.js');
    const crypto = require('crypto');
    const jlog = GlobalState.resolveStatePath('judgment-log.md', VAULT);
    if (!fs.existsSync(jlog)) { check('判号兑现回检', 'P', 'judgment-log.md 不存在', ''); return; }
    // 判#1159（进程风暴根治）：嵌套实例（由回检命令链拉起）跳过㉕——防 verify 脚本内部跑 radar 的回检重入递归（实锤：verify-1155↔radar 互引·79 进程/4GB 风暴）
    if (process.env.VAULT_CHILD_VERIFY === '1') { check('判号兑现回检', 'P', '嵌套实例跳过（回检重入防护·判#1159）', ''); return; }
    const txt = fs.readFileSync(jlog, 'utf8');
    const segs = segmentsFromText(txt);
    const CACHE_F = path.join(VD, 'delivery-verify.json');
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(CACHE_F, 'utf8').replace(/^﻿/, '')) || {}; } catch {}
    const WRITE = /(rm\s|del\s|Remove-|Set-Content|Out-File|New-Item|>>|>\s*\S|--force|git push|git commit|unlink|Move-|Install-|Register-Scheduled|Unregister-|shutdown)/i;
    // 判#767：兑现判据的形状改由**入口**保证（judgment-append 的 Test-DeliveryVerifyShape 拒收人话）。
    // 本维因此不再猜解析：只有符合入口契约的才真跑真判；旧格式一律「不可机器核」，不判真假
    // ——判#764 我拿 exit0 一把尺量 23 条 delivered，误报 14 条假兑现（含把 判#761/#762 点名写进 commit），
    //   真因是那些命令里混着「（应为 0）」「看每角色票数」「双绿」这类人话与自指递归，与机制真假无关。
    // 判#767：**严格白名单**——只判形状无歧义的命令，其余一律「不判真假」。
    // 为什么严格而不是补解析器：判#764→#767 三轮里我每轮都在给人话加一条正则，每轮都制造新的假阳性
    //   （先误报 14 条、再因 grep 落到 cmd.exe 误报 3 条）。形状判定属于入口的职责，已由
    //   judgment-append 的 Test-DeliveryVerifyShape 拒收；本维若继续猜，就是拿一个不可靠的尺去判别人的账。
    // 判定条件：白名单解释器 + 纯 ASCII 参数 + 无括号/管道/重定向 + 可选尾部「应为 非0|数字」。
    // 判#1339：BASH 路径与执行器一并收归 delivery-verify.js（此处不再持第二份常量·判#1328 位置表）。
    // 判定条件：白名单解释器 + 纯 ASCII 参数 + 无括号/管道/重定向 + 可选尾部「应为 非0|0」。
    // 判#1339 收一处定义分叉：原白名单允许「应为 <任意数字>」，而入口 judgment-append 早已禁具体数（判#1007/#1156/#1291
    //   「会随数据腐烂=永久假兑现」）→ 同一形状两处定义相反，判#1156（期望 105·实跑 505）被这里判成假兑现。现统一到入口契约：只认 0 / 非0。
    const STRICT = /^(node|python|py|powershell|pwsh|sh|bash|git|grep|test|wc|nl|Select-String|Get-ScheduledTask|Test-Path|Get-ChildItem|Get-Content) [\x20-\x7E]+?(?:\s+应为\s+(?:非\s*0|0))?$/;
    function conformant(cmd) {
      const bare = cmd.replace(/\s+应为\s+(?:非\s*0|\d+)$/, '');
      if (!STRICT.test(cmd)) return '旧格式·形状有歧义·不判真假';
      // 「跑雷达」才算自指；读雷达产物 health-radar.json 是自指禁令的误伤对象（子串包含病·与判#764 取段正则、
      // 判#767 严格白名单同族：判据把「提到」当「执行」，于是诚实的回检命令被拒收）。
      if (/(?:^|\s)(?:node|powershell|pwsh|python|py|bash|sh)\s+[^\r\n]*health-radar\.js(\s|$)/i.test(bare)) return '自指·不在雷达内跑雷达';
      // 判#1308 结构规则六：**间接自指**——命令跑的是「内部还会再跑雷达」的脚本，字面上却没有 health-radar.js，
      //   于是上面那条直接自指规则看不见它（判#1159 已把这类称作防护盲区：verify-1155 内部跑 radar 引起 79 进程风暴）。
      //   实锤（本判收尾自测抓出）：`node vault-scripts/radar-25-selftest.js` 单独跑 exit 0 全过，
      //   但在雷达内跑 = 嵌套雷达 → 真失败 exit≠0 → 判#848/#1036（及本判#1308 自己）被冤判假兑现。
      //   判据=脚本名含 radar 的「测试/自测」类脚本（它按契约必然要拉起被测雷达）。
      //   只拦这一种命名（*radar*selftest/selftest*radar），不按 "radar" 泛匹配——避免误伤读雷达产物的诚实命令。
      if (/(?:^|\s)(?:node|powershell|pwsh|python|py|bash|sh)\s+[^\r\n]*radar[^\r\n]*selftest[^\r\n]*\.(?:js|mjs|cjs|py|ps1)(\s|$)/i.test(bare)) return '间接自指·内部会再跑雷达(嵌套必失败)·不可核不判';
      // 判断#1055 结构规则三：node -e 内联脚本含空格，routeRun 按空白切参必拆碎引号→跑出空 stdout，把「尺测不了」误报成「假兑现」（实锤5条：判#1044/1046/1048/1053/1054 均手写即过）——结构性不相容不判真假，入口已由 judgment-append 拒收新配形
      if (/^node\s+-e\s/.test(bare)) return 'node -e 内联切参必碎·不可核不判';
      // 判#1157 结构规则四（恢复轮实锤）：回检命令与执行环境结构性不相容→测不了≠假——
      //   a) 类 Unix 命令（grep/ls/cat/wc…）裸跑于 Windows PowerShell 环境=命令不存在必 exit≠0；
      //   b) 重采集/重研判命令（market.ps1 -intel / intel-analysis.ps1）=分钟级，25s 上限内必超时被 Kill。
      //   两类均属「命令形状与期望不符」非「没做事」——不判真假（同判#1036/#1038 先例：尺不可达时它给的假兑现不可信）。
      if (/^(grep|ls|cat|wc)\s/i.test(bare)) return '类Unix命令·Windows环境不相容·不可核不判';
      // 判#1187 收尺（本圈实跑自逮）：旧式 `-intel` 无词边界，把轻门命令 `market.ps1 -IntelSelftest`（<1s 早退·不跑采集）
      //   一并归入「重命令不可核」→ 真能机检的兑现声明被白白扔进 不可核 堆。只拦真重负：-intel 必须是独立完整旗标。
      if (/market\.ps1\s+-intel(\s|$)|intel-analysis\.ps1/i.test(bare)) return '重命令25s内必超·不可核不判';
      // 判#1036 结构规则：Select-String 无 .Count/Measure 管道时输出为匹配行，永不成数——命令与期望形状结构性不相容，
      // 不判真假（非猜人话：这是 PowerShell 输出形状的事实）。冤例：判#1007『应为 1』永久错红。
      if (/^Select-String\b/.test(bare) && !/\.Count|Measure-/.test(bare) && /\s应为\s+\d+$/.test(cmd)) return '命令输出不可为数·形状不相容不判';
      // 判#1308 结构规则五（承判#1036 同族·由内而外扩面）：**命令根本不产数字，却被要求 stdout 等于某数**——
      //   语法上永不可能满足，与机制真假无关。实锤：判#1307 `powershell "Get-Service clash_verge_service" 应为 0`
      //   ——Get-Service 输出的是服务对象表格（实测末行 = 'Running  clash_verge_ser... Clash Verge Service'），
      //   永远不可能等于 '0'；服务其实 Running=机制真的兑现，纯形状误杀。
      //   同类：git check-ignore（命中输出路径/未命中无输出·实测均非数字）。
      //   实现要点（本判自测抓出的坑·留档防复发）：不能用 ^ 锚定开头——真实命令形如
      //   `powershell "Get-Service ..."`（引号夹在解释器与 cmdlet 之间）与 `powershell -NoProfile -Command "Get-Service ..."`，
      //   锚定开头的写法全部 NOMATCH（第一版就是这么漏的）。改用「非单词边界搜索 cmdlet 名」。
      //   只判「命令本身不产数字」这一类**事实**；产数字的 node -e 脚本不在此列（另有判#1055 路由）。
      if (/\s应为\s+\d+$/.test(cmd) &&
          (/(?:^|[\s"'])(?:Get-Service|Get-Process|Get-Item|Get-ChildItem|Get-Content|Get-ScheduledTask|Get-ScheduledTaskInfo)\b/.test(bare) ||
           /\bcheck-ignore\b/.test(bare))) return '命令不产数字·形状不相容不判';
      // 判#1036 结构规则二：滑窗 git log -N 核含历史日期的事件——窗口随新 commit 前移，当日成立的兑现隔天必红（时间炸弹判据），
      // 不判真假归不可核。冤例：判#979（auto-sync 落库当日三连回读全过，两日后滑窗已无那笔）。
      if (/git\s+log\s+--oneline\s+-\d+/.test(bare) && /'\s*\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}/.test(bare)) { const _ld = new Date(); const _loc = _ld.getFullYear() + '-' + String(_ld.getMonth() + 1).padStart(2, '0') + '-' + String(_ld.getDate()).padStart(2, '0'); if (!bare.includes(_loc)) return '滑窗核历史事件·必时效不判'; }
      return '';
    }
    // 判#1339：stripNote / parseExpect / routeRun / judge 四个内联尺已删除，唯一源见 vault-scripts/delivery-verify.js。
    //   删因（不是洁癖）：入口与本维各持一把尺已造成三处实锤失真——①本维 STRICT 收「应为 具体数」而入口禁它（判#1156）
    //   ②stdoutEq 取末行用 split('\n').pop() 拿到尾随换行后的空串（判#1173/判#1156 恒「实测 (空)」）
    //   ③带引号的 -Command/-e 被按空白拆碎（判#1055 当年只豁免 node -e）。尺只能有一把。
    // routeRun / judge 内联副本已删（判#1339·尺的唯一源=vault-scripts/delivery-verify.js）
    const nowMs = Date.now(), WEEK = 7 * DAY, TTL = DAY;
    // 判#1435：失败结论的复查周期（成功仍是 TTL=24h 免得烧预算）。见下方用法处的完整理由。
    const FAIL_TTL = Number(process.env.RADAR_VERIFY_FAIL_TTL_MS || 60 * 60 * 1000);   // 1h
    // 判#1413：pending 超期阈固定 7 天（与能否跑回检命令解耦·见下方记账处注释）
    const STALE_PENDING_MS = WEEK;
    const CAP = Number(process.env.RADAR_VERIFY_CAP || 30);   // 判#869：8→30——回检周期24h→1h（60条回检单轮跑完·假兑现红不再滞后现实一天）；成本~3min/小时可接受
    let ran = 0, dirty = false;
    const fake = [], stalePending = [], readyToClose = [], unverifiable = [], verified = [], evaporated = [];
    let deliveredN = 0, pendingN = 0;

    for (const [id, body] of segs) {
      const st = (body.match(/兑现\*\*：\[(\w+)\]/) || [])[1];
      if (!st) continue;
      const dm = body.match(/^### 判断#\d+ - (\d{4}-\d{2}-\d{2})/);
      const age = dm ? (nowMs - new Date(dm[1]).getTime()) : 0;
      const cmd = ((body.match(/回检命令 `([^`]+)`/) || [])[1] || '').trim();
      if (st === 'delivered') deliveredN++;
      if (st === 'pending') pendingN++;

      if (!cmd) { if (st === 'delivered') unverifiable.push(`判#${id}(无回检命令)`); continue; }
      if (WRITE.test(cmd)) { unverifiable.push(`判#${id}(含写操作·不代跑)`); continue; }
      const nonconf = conformant(cmd);
      if (nonconf) { if (st === 'delivered') unverifiable.push(`判#${id}(${nonconf})`); continue; }
      // 判#1199 同族历史债：delivered 凭证指向 .dsh-tools 一次性区（会被减法/revert 静默扫掉）→ 单列蒸发桶·状态打W 逼迁达久源（不再假绿）
      if (st === 'delivered' && /\.dsh-tools[\\/]/.test(cmd)) { evaporated.push(`判#${id}`); continue; }

      const key = crypto.createHash('sha1').update(cmd).digest('hex').slice(0, 16); // 键契约不变（radar-25-selftest 认此键·判#848）；语义改版靠下方条目 v 字段失效
      let hit = cache[key];
      // 判#1036：条目带版本——判据语义升版(VV)时旧条目视同过期重跑一次即翻新（不造死键不改键形）
      // 判#1339：尺语义改版（执行器收归 delivery-verify.js + 新增尺待改锚分诊）→ v 2→3，令旧缓存全量重判一次，
      //   否则 判#1173/1156/1221/1058 这些被旧尺写成 ok:false 的条目会带着错结论再缓存 24h 冒充实测结论。
      if (hit && hit.v !== 3) hit = null;
      // 判#1435 · **本维最后一处失真（对称性缺口）**：
      //   病：TTL 对成功/失败一视同仁 = 24h。于是「把机制修好」这件事**不会让红消失**——
      //     失败结论被缓存锁死一整天，雷达持续报一条已经不存在的病，下一圈 AI 读到假事实又去重复劳动。
      //     这与 L2399 记的「㉕ 跑在自愈之前」是同一个病的两个面：那条只覆盖「本维触发自愈」的情形
      //     （`if (healedN)`），而**手修/别圈修/上游修**根本不触发自愈 ⇒ 对称性缺口一直敞着。
      //     本圈实锤：判#1329/1312/1299/1188/1187/1186 六条指向同一句 selftest，我实跑 rc=0（3.4s·99/99 过），
      //     直接调 delivery-verify.judge 也是 {ok:true}，可雷达连跑两次仍报 exit≠0——因为它读的是缓存。
      //   治法（为什么是短 TTL 而不是"失败不入缓存"）：
      //     不入缓存 = 每轮都重跑全部失败项，CAP=30 预算会被 7 条同命令重复吃光（那是另一种失真）；
      //     短 TTL 既保留预算控制，又让"修好了"在 1 小时内可见。**代价偏向可发现性，不偏向省算力**——
      //     理由是：缓存一条假红的社会成本（下一个 AI 照着假事实改）远高于多跑一次回检命令。
      const ttl = (hit && hit.ok === false) ? Math.min(TTL, FAIL_TTL) : TTL;
      if (!hit || (nowMs - hit.ts) > ttl) {
        if (ran >= CAP) continue;
        ran++;
        const j = judge(cmd);
        if (j.inconclusive) { unverifiable.push(`判#${id}(${j.why || '环境不可判'}·测不了≠假·判#848)`); continue; } // 环境性不可判不缓存不判假——否则降级环境投毒24h（判#848）
        // 判#1339 尺错分诊：命令跑通但不满足判据时，先问「是不是尺自己的错」——pattern 在指名文件里没有、
        //   却在别处文件里找得到 = 实现迁走、回检锚点过期，不是被检方假兑现（实锤 判#1221→judge-pool-probe.js、判#1058→intel-station-feed.ps1）。
        //   分错的代价不是少一条红，而是系统学会「贴 pending 保平安」——那是代理指标吃掉真目标（KC-STANDARD-021）。
        const hints = diagnose(cmd, j);
        if (!j.ok && hints.length) { unverifiable.push(`判#${id}(尺待改锚·${hints[0].slice(0, 46)})`); continue; } // 不缓存：待锚点改正后按真值重判
        hit = { ok: !!j.ok, ts: nowMs, note: j.why || '', v: 3 }; cache[key] = hit; dirty = true;
      }
      if (st === 'delivered' && !hit.ok) fake.push(`判#${id}[${hit.note || '判据不满足'}]`);
      else if (st === 'delivered' && hit.ok) verified.push(id);
      else if (st === 'pending' && hit.ok) readyToClose.push(`判#${id}`);
      // 判#1435 去重（本圈实测）：这里原有第二行 `else if (st==='pending' && age>WEEK && !hit.ok) stalePending.push(...)`。
      //   它和下方判#1413 新增的「pending 一律按年龄记账」**条件覆盖重叠**，同一判号被 push 两次 ⇒
      //   报告里长出「判#1331(14天) 判#1331(14天)」「判#1319(15天) 判#1319(15天)」这种自己和自己重复的清单。
      //   危害不是数字难看：清单条数被虚增一倍，真实欠账条数读不出来（报 14 条，实际 7 条），
      //   而「一判两事」的段（如判#729 一条 delivered 一条 pending）更容易被误读成数据坏了。
      //   为什么删这行而不是删判#1413 那行：判#1413 已经把判据扩成「与能否跑命令无关」（无命令的 pending
      //   才是真死账），语义更完整；旧行是它的真子集，删子集留全集，不丢任何一条应报的账。
      // 判#1413 目标由现状数据定义（源=姜胡说眉山三天「目标是拿现状数据定义的，不是拍脑袋定的」）：
      //   原尺只把「有回检命令且验不过」的 pending 计入超期 → 实测 30 条 pending 里 28 条被无命令/conformant 分支提前 continue，
      //   被计入的 2 条又落在 30 条 CAP 预算之外 → 报告恒「本次新跑 3 条·无超期」，措辞像「无问题」，
      //   实际 09-23 起的判 34 天无人看。这是代理指标（能跑的命令数）吃掉了真目标（pending 有没有被回收）。
      //   治法：pending 一律先按年龄记账（与能否跑命令无关），预算另算——无命令的 pending 才是真正的死账。
      if (st === 'pending' && age > STALE_PENDING_MS) stalePending.push(`判#${id}(${Math.round(age / DAY)}天${cmd ? '' : '·无回检命令'})`);
    }

    if (dirty) { try { require('./atomic-write.js').atomicWrite(CACHE_F, JSON.stringify(cache), { validate: 'json' }); } catch {} }

    const total = deliveredN + pendingN;
    if (!total) { check('判号兑现回检', 'P', '账本无兑现字段（判#730 起新落判号才带）', ''); return; }
    let status = 'P', detail = `共 ${total} 判带兑现字段（delivered ${deliveredN}·pending ${pendingN}）·本次新跑 ${ran} 条`;
    let link = '判#730/#764 · ❌假兑现=标签 delivered 但回检命令实跑不通 → 要么把机制真跑通，要么把标签改回 pending';
    // 判#1413：pending 按年龄记账后与 F 级「假兑现」同池——超期 pending 意味着账本里挂着一堆没人回看的判断，
    //   delivered 的凭证才可能真伪可辨。故 stalePending 由 W 升 F（诚实：不升就不是「必须处理不留下圈」）。
    if (fake.length) { status = 'F'; detail += ` · ❌假兑现 ${fake.length} 条: ${fake.slice(0, 6).join(' ')}`; }
    else if (stalePending.length) { status = 'F'; detail += ` · ❌pending 超 7 天未回收 ${stalePending.length} 条（按年龄记·与能否跑命令无关）: ${stalePending.slice(0, 6).join(' ')}`; }
    else if (evaporated.length) { status = 'W'; }
    // 蒸发计数永远上报（F 优先不吞掉它·避免报了却看不见=新盲区）
    if (evaporated.length) detail += ` · ⚠️凭证蒸发(指向.dsh-tools一次性区) ${evaporated.length} 条·需迁达久源(判#1199同族历史债): ${evaporated.slice(0, 6).join(' ')}`;
    if (unverifiable.length) detail += ` · 不可核 ${unverifiable.length} 条: ${unverifiable.slice(0, 4).join(' ')}`;
    if (readyToClose.length) detail += ` · ✅命令已跑通待销账 ${readyToClose.length} 条: ${readyToClose.slice(0, 5).join(' ')}`;
    if (verified.length) detail += ` · 真兑现 ${verified.length} 条`;
    check('判号兑现回检', status, detail, link);
  } catch (e) { check('判号兑现回检', 'W', '扫失败: ' + String(e.message).slice(0, 60), '查 health-radar.js ㉕ + judgment-segments.js 是否在位'); }
})();

// ── ㉖ 技能层唯一源与镜像（2026-09-24 判断#764 圈·用户「找出根源·是哪里的问题还是架构有问题」）──
// 根因=架构缺位而非某 AI 写错：SKILL.md 同时住五处（.agents/.claude/.zcode/agent + 私有 ~/.qoder/skills），
// 库里从没定过"哪处是源、其余怎么镜像"，radar 也零维度扫这一层。实测后果：新技能落私有目录=换入口即不可调用；
// agent/skills 13 份手抄拷贝 frontmatter 已缺 name（漂移无人报）。判据按目录名+frontmatter 解析，不用文本包含。
// 分级（承判#748 渐进语义·存量不炸门）：同名两份真源且内容不同=F（正在骗你）；漂移/缺镜像/未入库/缺 name=W；全对=P。
(() => {
  const SRC = path.join(VAULT, '.agents', 'skills');
  if (!fs.existsSync(SRC)) { check('技能层唯一源与镜像', 'F', '.agents/skills 唯一源目录不存在·AI 入口技能无处落地', '建目录并迁入·见 新AI接入与系统运行标准流程'); return; }
  // 判#1328：镜像目录读唯一源 scan-scope.js（此前本处与 validate-change.js 的 SKILL_MIRROR_DIRS 各一份·逐字相同）
  const MIRROR_DIRS = (() => { try { return require('./scan-scope.js').SKILL_MIRROR_DIRS; } catch { return ['.claude', '.zcode', 'agent']; } })();
  const MIRRORS = MIRROR_DIRS.map(d => ({ name: d, dir: path.join(VAULT, d, 'skills') })).filter(m => fs.existsSync(m.dir));
  const HOME = process.env.USERPROFILE || process.env.HOME || '';
  const PRIVATE = ['.qoder', '.agents', '.claude'].map(d => ({ name: d, dir: path.join(HOME, d, 'skills') })).filter(p => fs.existsSync(p.dir) && path.resolve(p.dir).toLowerCase() !== path.resolve(SRC).toLowerCase());
  const rd = (skillDir) => { try { return fs.readFileSync(path.join(skillDir, 'SKILL.md')); } catch { return null; } };
  const hasName = (buf) => {
    if (!buf) return false;
    const fm = buf.toString('utf8').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return !!(fm && /^name:\s*\S+/m.test(fm[1]));
  };
  const vaultScoped = (buf) => !!buf && /D:[\\\/]Vault/i.test(buf.toString('utf8'));
  const isLink = (p) => { try { return fs.lstatSync(path.join(p, 'SKILL.md')).isSymbolicLink(); } catch { return false; } };
  const srcBuf = new Map(fs.readdirSync(SRC).map(n => [n, rd(path.join(SRC, n))]).filter(([, b]) => b));
  const dup = [], drift = [], noMirror = [], noName = [], unlanded = []; let copyMirrors = 0;
  for (const [n, base] of srcBuf) {
    if (!hasName(base)) noName.push(`.agents/${n}`);
    for (const m of MIRRORS) {
      const mp = path.join(m.dir, n), mb = rd(mp);
      if (!mb) { noMirror.push(`${m.name}/${n}`); continue; }
      if (!mb.equals(base)) drift.push(`${m.name}/${n}`);
      if (!isLink(mp)) copyMirrors++;   // 实体拷贝：内容暂时一致，但改一处不生效（core.symlinks=false 的既成事实）
      if (!hasName(mb)) noName.push(`${m.name}/${n}`);
    }
  }
  for (const p of PRIVATE) {
    let names = []; try { names = fs.readdirSync(p.dir); } catch { continue; }
    for (const n of names) {
      const pb = rd(path.join(p.dir, n)); if (!pb) continue;
      if (srcBuf.has(n)) { if (!srcBuf.get(n).equals(pb)) dup.push(`${p.name}/${n} ≠ .agents/${n}`); }
      else if (vaultScoped(pb)) unlanded.push(`${p.name}/${n}`);
    }
  }
  const status = dup.length ? 'F' : (drift.length || noMirror.length || unlanded.length || noName.length) ? 'W' : 'P';
  const seg = [];
  if (dup.length) seg.push(`❌同名两份真源(改一处不生效) ${dup.length}: ${dup.slice(0, 4).join(' · ')}`);
  if (drift.length) seg.push(`镜像与源内容不同 ${drift.length}: ${drift.slice(0, 5).join(' ')}${drift.length > 5 ? ' …' : ''}`);
  if (unlanded.length) seg.push(`未入库(只在私有目录·换入口即不可调用) ${unlanded.length}: ${unlanded.slice(0, 5).join(' ')}`);
  if (noMirror.length) seg.push(`缺镜像(该入口不可调用) ${noMirror.length}: ${noMirror.slice(0, 5).join(' ')}`);
  if (noName.length) seg.push(`frontmatter 缺 name ${noName.length}: ${noName.slice(0, 4).join(' ')}${noName.length > 4 ? ' …' : ''}`);
  check('技能层唯一源与镜像', status,
    (seg.length ? `SKILLSRC 源 ${srcBuf.size} 项 · 镜像 ${MIRRORS.length} 处(实体拷贝 ${copyMirrors}) · ` + seg.join(' · ') : `SKILLSRC 源 ${srcBuf.size} 项 · 镜像 ${MIRRORS.length} 处齐且同内容(实体拷贝 ${copyMirrors}) · 私有目录无未入库副本`),
    '唯一源=.agents/skills/·其余入口是实体拷贝须同步(本库 core.symlinks=false)·私有目录只作暂存（判#772·见 KC-SYS-009 v2.3）');
})();

/* 判#832：本行为规则③实审标靶——空 staged 不能验门（上圈误诊），真变更+他圈持锁→③必拦 */
// ── ㉗ 回归哨（2026-09-25 判断#821·用户令「改了就全改掉·出问题机制要能发现」）──
// 一判一网：每修好一类问题= recurrence-probe.js 加一条数据探针（悬空号全库/研判空壳/推送停转/混源滞留/门自测/技能漂移）；复发由雷达喊，不由人撞见。
(() => {
  let rc = -1, out = '';
  try { out = require('child_process').execSync('node "' + path.join(VAULT, 'vault-scripts', 'recurrence-probe.js') + '"', { encoding: 'utf8', timeout: 90000, cwd: VAULT }); rc = 0 } catch (e) { out = String((e && e.stdout) || '') + String((e && e.stderr) || ''); rc = (typeof e.status === 'number') ? e.status : -1 }
  if (rc === 0) check('回归哨', 'P', out.split('\n').filter(l => /^P/.test(l)).length + '/6 探针绿（六类已修问题无人值守监测中）', '复发=雷达W报进 _system-status·下圈进门必见（判#821）');
  else if (rc === 1) { const ws = out.split('\n').filter(l => /^W|^回归哨/.test(l)); check('回归哨', 'W', ws.slice(0, 3).join(' ⏎ ') || 'probe 报警但无W行(输出格式变了?)', '同类问题复发·先修复发项再修哨（判#821）') }
  else check('回归哨', 'F', '探针跑不动 rc=' + rc + ': ' + out.slice(0, 90), '哨兵哑了比没有哨兵更危险·先修 probe（判#764/821）');
})();

// ── ㉘ 数据自动对账（判#999：reconcile 产物长期无人消费 = 三条账无声积累的最后一环根源）──
// 装了机制没有消费者 = 假绿（判#716 装了没跑就是杂质 / 判#836 产出即上桌）。
// 雷达本身就是那个消费者：直接跑 --reconcile（判#996 已从 >5min 卡死修到秒级），把 issue 刷进本哨·每小时自转。
(() => {
  let rc = -1, errTxt = '';
  try {
    require('child_process').execFileSync('python',
      [path.join(VAULT, 'vault-scripts', 'sync-refs.py'), '--reconcile'],
      { encoding: 'utf8', timeout: 120000, cwd: VAULT });
    rc = 0;
  } catch (e) {
    // sync-refs 用退码表状态：0=全一致、1=有 issue——**1 不是跑不动**（误读会把欠账报成哨哑）。
    rc = (typeof e.status === 'number') ? e.status : -1;
    errTxt = String((e && (e.stderr || e.message)) || '').replace(/\s+/g, ' ').slice(0, 90);
  }
  if (rc !== 0 && rc !== 1) { check('数据自动对账', 'F', 'reconcile 跑不动 rc=' + rc + ' ' + errTxt, '哨哑了比没有哨更危险·先修 sync-refs.py --reconcile（判#996/998）'); return }
  let rep = null;
  try { rep = JSON.parse(fs.readFileSync(path.join(VD, 'reconcile-report.json'), 'utf-8').replace(/^\uFEFF/, '')) } catch (e) { rep = null }
  if (!rep || !rep.ts) { check('数据自动对账', 'F', 'reconcile-report.json 读不到/无时间戳·不判真假', '测不了不判绿（判#854）·先看产物在不在'); return }
  const ageH = (Date.now() - new Date(String(rep.ts).replace(' ', 'T')).getTime()) / 3600000;
  if (!(ageH >= 0 && ageH < 2)) { check('数据自动对账', 'W', `对账报告时戳异常(${rep.ts})·不判真假`, '看本机时钟与 reconcile 实跑（判#854）'); return }
  const a = rep.atoms || {}, iss = rep.issues || [];
  // 判#1342 维间联动失效（治「修好了还挂一天红」）：㉕ 判号兑现回检跑在本维自愈**之前**，且它的失败结果缓存 TTL=24h。
  //   于是索引被本维当场重生修好之后，㉕ 仍拿着修复前那次 exit≠0 的缓存把 判#1293/判#987 报成假兑现——
  //   下一圈 AI 读到的是一条「已经不该存在的病」，重复劳动就是这么长出来的（实测：手跑 sync-flow-index.py --check 连续两次 exit 0，
  //   而同一轮雷达仍报 ❌假兑现 2 条）。治法：本维每自愈一项，作废指向该生成物的 ㉕ 缓存条目，让下次复检真去重跑——
  //   尺跟着事实走，不跟着缓存走。事实并进本维原有那一行，不另开一条 check（否则一个维报两次=新失真·我上一版就犯过）。
  let healedN = 0, cacheVoided = 0, healedNote = '';
  try {
    healedN = ((rep.index || {}).healed) || 0;
    if (healedN) {
      const CF = path.join(VD, 'delivery-verify.json');
      if (fs.existsSync(CF)) {
        // 缓存条目只存 {ok,ts,note,v}——note 是失败原因（如「exit≠0」）不含命令原文，按命令正则匹配 note 永远匹配不上
        //   （我第一版就犯了这个错·写完立刻自我证伪）。正确做法：用 ㉕ 同一把键函数（sha1(cmd).slice(0,16)·判#848 键契约不变）
        //   从账本里找出「回检命令指向本生成物」的那些号，反推键名再删——不改缓存形状，不猜内容。
        const crypto = require('crypto');
        const jlogF = GlobalState.resolveStatePath('judgment-log.md', VAULT);
        const keysToVoid = new Set();
        if (fs.existsSync(jlogF)) {
          const { segmentsFromText } = require('./judgment-segments.js');
          for (const [, body] of segmentsFromText(fs.readFileSync(jlogF, 'utf8'))) {
            const cmd = ((body.match(/回检命令 `([^`]+)`/) || [])[1] || '').trim();
            if (/sync-flow-index/.test(cmd)) keysToVoid.add(crypto.createHash('sha1').update(cmd).digest('hex').slice(0, 16));
          }
        }
        const cache = JSON.parse(fs.readFileSync(CF, 'utf8').replace(/^\uFEFF/, '')) || {};
        const before = Object.keys(cache).length;
        for (const kk of keysToVoid) delete cache[kk];
        cacheVoided = before - Object.keys(cache).length;
        if (cacheVoided > 0) require('./atomic-write.js').atomicWrite(CF, JSON.stringify(cache), { validate: 'json' });
      }
    }
  } catch (e) { healedNote = '联动失效未成:' + String(e && e.message || '').slice(0, 36); }
  const detail = `断链${(rep.links || {}).broken ?? '?'} 缺原子${a.missing_count ?? '?'}/${a.cards ?? '?'} 占位垃圾${a.junk_count ?? 0} 未落实${(rep.unlanded_standards || []).length} 索引漂移${(rep.index || {}).drift ? 'Y' : 'N'}${healedN ? `(本维已自愈${healedN}·连带作废复检缓存${cacheVoided}条)` : ''}${healedNote ? `(${healedNote})` : ''}`;
  if (iss.length) check('数据自动对账', 'W', detail + '｜' + iss.join(';'), '欠账逐张销：`07 · 原子库/_原子欠账台账.md`（每圈消费3~5张·真读不占位）');
  else check('数据自动对账', 'P', detail + '｜对账全绿', '派生状态自动对账·四合一（判#999 接入运行层）');
})();

// ── ㉜ 红灯催办账（判#1037 用户令「收圈·每次运行要能发现根治解决」：发现已自动，根治驱动不能再只等用户开口）──
// 机理：所有维收完 anomalies 后记账——每盏非绿灯首见日期入 red-slip-ledger.json；
//   判#1038 实时化：首见当轮即报 W（「运行时发现」不攒日历——新灯亮起那一轮就上桌）；挂≥2天升级醒目标·挂≥5天自动向 user-decision-log 追一条未接项（承判#835「候选不隔夜无人问」同构·同日同项幂等）；
//   灯灭=次日自然出账（病愈自销·healed 不需人工）。
function redSlipState(firstSeen, today, healedFlag) {
  if (healedFlag) return 'healed';
  const d = Math.round((new Date(today) - new Date(firstSeen)) / 864e5);
  if (d >= 5) return 'notify';
  if (d >= 2) return 'aging';
  return 'fresh';
}
(() => {
  try {
    const _n = new Date(); const today = _n.getFullYear() + '-' + String(_n.getMonth() + 1).padStart(2, '0') + '-' + String(_n.getDate()).padStart(2, '0');
    const hm = String(_n.getHours()).padStart(2, '0') + ':' + String(_n.getMinutes()).padStart(2, '0');
    const LF = path.join(VD, 'red-slip-ledger.json');
    let led = {}; try { led = JSON.parse(fs.readFileSync(LF, 'utf8').replace(/^\uFEFF/, '')) || {}; } catch {}
    const nowKeys = {}; const aging = []; const notifyDue = []; const freshNew = [];
    for (const a of radar.anomalies) {
      const k = a.name;
      nowKeys[k] = 1;
      if (!led[k]) { led[k] = { first: today, notified: [] }; freshNew.push(k); } // 判#1038：首见即报当轮上桌
      const st = redSlipState(led[k].first, today, false);
      const ageD = Math.max(0, Math.round((new Date(today) - new Date(led[k].first)) / 864e5));
      if (st === 'aging') aging.push(k + '(' + ageD + '天)');
      if (st === 'notify' && !(led[k].notified || []).includes(today)) notifyDue.push({ k, ageD });
    }
    for (const k of Object.keys(led)) if (!nowKeys[k]) delete led[k]; // 灯灭=治愈·自动清账不劳人工
    if (notifyDue.length) {
      const dl = GlobalState.resolveStatePath('user-decision-log.md', VAULT);
      // 【判#1301 跨日去重根治】原实现把 `sec` 写成 `## <today> — 红灯催办`，于是去重判据
      //   `txt.includes(sec + '\n\n' + line)` **跨日必然失配**（sec 含日期，天天不同）⇒ 每天 append 一条新未接项。
      //   实测：10-05 ~ 10-11 连写 7 条，同一批红灯（密度膨胀/分类合规/回归哨/数据对账）被重复呈桌 7 次。
      //   治法：去重不再依赖带日期的 sec，改为按**同一批红灯名集合**判——
      //     若日志中已存在**未销账**（`- [ ]`）且红灯名集合相同的催办项 → 只更新其"已挂 N 天"数字（原地刷新·不新增行）；
      //     红灯集合变化（有新增/有治愈）→ 才写新的一条。这样"挂多久"仍然可见，但不刷屏。
      const namesKey = notifyDue.map(x => x.k).sort().join('|');
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bodyOf = notifyDue.map(x => x.k + ' 已挂 ' + x.ageD + ' 天').join('、');
      const newLine = '- [ ] **' + hm + '**　' + bodyOf + '　——根治它，或回一句理由销单（候选不隔夜同构·判#835；不根治不静默）';
      const lockAi = process.env.AI_NAME || 'health-radar';
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      let decisionLock = null;
      for (let li = 0; li < 20; li++) {
        decisionLock = AiLock.acquire('user-decision-log.md', lockAi, { ttl: 120 });
        if (decisionLock.ok) break;
        Atomics.wait(sleeper, 0, 0, 100);
      }
      if (!decisionLock || !decisionLock.ok) throw new Error('user-decision-log.md 正被其他写者占用；红灯催办未写入');
      try {
        let txt = fs.existsSync(dl) ? fs.readFileSync(dl, 'utf8') : '';
        // 找已存在的、未销账的、红灯名集合相同的催办行（跨日也认）
        const sameOpen = new RegExp('^- \\[ \\] \\*\\*\\d{2}:\\d{2}\\*\\*　' + esc(bodyOf.split('　')[0].replace(/ 已挂 \d+ 天/g, '\\s*已挂 \\d+ 天')) + '[^\\n]*$', 'm');
        const m = txt.match(sameOpen);
        if (m) {
          // 原地刷新天数（保留一条·不新增行）——仅当数字确实变了才写
          const refreshed = m[0].replace(/([^\s、]+) 已挂 \d+ 天/g, (mm, name) => {
            const hit = notifyDue.find(x => x.k === name);
            return hit ? (name + ' 已挂 ' + hit.ageD + ' 天') : mm;
          });
          if (refreshed !== m[0]) {
            txt = txt.replace(m[0], refreshed);
            fs.writeFileSync(dl, txt, 'utf8');
          }
        } else {
          const sec = '## ' + today + ' — 红灯催办（机器自动·判#1037）';
          const tail = (txt.endsWith('\n') ? '' : '\n');
          fs.appendFileSync(dl, tail + '\n' + sec + '\n\n' + newLine + '\n', 'utf8');
        }
        for (const x of notifyDue) { if (!led[x.k].notified) led[x.k].notified = []; led[x.k].notified.push(today); }
      } catch (e) { console.warn('红灯催办写入失败：' + e.message); /* 主流程继续·但明确暴露写入失败 */ }
      finally { AiLock.release('user-decision-log.md', lockAi); }
    }
    try { require('./atomic-write.js').atomicWrite(LF, JSON.stringify(led), { validate: 'json' }); } catch {}
    check('红灯催办账', (aging.length || notifyDue.length || freshNew.length) ? 'W' : 'P',
      '在账 ' + Object.keys(led).length + ' 项' + (freshNew.length ? '·🆕本轮新亮首见即报: ' + freshNew.slice(0, 5).join(' ') + (freshNew.length > 5 ? '…' : '') : '') + (aging.length ? '·挂≥2天未治: ' + aging.slice(0, 4).join(' ') : '') + (notifyDue.length ? '·≥5天已自动呈报决策日志逼拍板: ' + notifyDue.map(x => x.k).slice(0, 3).join(' ') : ''),
      aging.length || notifyDue.length || freshNew.length ? '运行时发现=首见当轮必处置或挂账：新灯查是否误报(尺的错先分诊判#1036)、真病本圈根治、确不可治当场销单给理由（判#1037/1038）' : '');
  } catch (e) { check('红灯催办账', 'W', '扫描失败: ' + String(e.message).slice(0, 60), '查 redSlipState 与 red-slip-ledger.json'); }
})();

// ── ㉝ 情报站点报告（判#1041 元首令 2026-10-01：国家层面运行·每省一站·每站必报；站点不报=情报断线）──
// 数据底座：名册唯一源 intel-stations.json + 呈报留痕 intel-stations-report.json（conversion-brief 每日写）
function stationReportState(stations, ledger, today, subFaults) {
  if (!Array.isArray(stations) || !stations.length) return { status: 'F', msg: '站点名册缺失/空（intel-stations.json）——无省站图=指挥失效，先建册再谈报告' };
  if (!ledger || !Object.keys(ledger).length) return { status: 'F', msg: '站点呈报留痕为零（intel-stations-report.json 空/未起）——各站无一呈报=集体未报' };
  const lagD = (d) => d ? Math.round((new Date(today) - new Date(d)) / 864e5) : Infinity;
  const silent = [], starving = [], ok = [];
  for (const s of stations) {
    const e = ledger[s.id];
    const lag = e ? lagD(e.lastReport) : Infinity;
    if (lag > 1) silent.push(s.id + (e ? '(' + lag + '天未报)' : '(从未呈报)'));
    else if (e.lastStatus === 'silent') silent.push(s.id + '(自报失职)');
    else if (e.lastStatus === 'nosource') starving.push(s.id);
    else ok.push(s.id);
  }
  if (silent.length) return { status: 'F', msg: silent.length + ' 站未报：' + silent.join(' ') + '｜已报 ' + ok.length + '/' + stations.length + '——军情断线不容静默（元首令 10-01·省站级=惊动中央）' };
  // 判#1043 治理分级：省站都报了，市县末梢站断供只记省账 W——不上元首桌·省内自治
  const subs = Array.isArray(subFaults) ? subFaults.filter(x => x && Array.isArray(x.missing) && x.missing.length) : [];
  const probs = [];
  if (starving.length) probs.push(starving.length + ' 站无米：' + starving.join(' '));
  if (subs.length) probs.push(subs.length + ' 省有市站断供：' + subs.map(x => x.province + '·' + x.missing.join('/')).join('；'));
  if (probs.length) return { status: 'W', msg: stations.length + ' 站全呈报·但 ' + probs.join('｜') + '（末梢病省内补喂·不劳元首·判#1043）' };
  return { status: 'P', msg: '站点报告全回路 ' + ok.length + '/' + stations.length + '·市站齐——每省军情日日上中央桌，末梢在转' };
}
(() => {
  try {
    const _n = new Date(); const today = _n.getFullYear() + '-' + String(_n.getMonth() + 1).padStart(2, '0') + '-' + String(_n.getDate()).padStart(2, '0');
    let reg = null, ledger = null;
    try { reg = JSON.parse(fs.readFileSync(path.join(VD, 'intel-stations.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
    try { ledger = JSON.parse(fs.readFileSync(path.join(VD, 'intel-stations-report.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
    const stations = reg && reg.stations;
    // 判#1043 市站普查：只对「省站已报」的省查末梢（省站已 F 的不叠加·不拿下级病冒充上级账）
    let subFaults = []; let feedHealed = null;
    try {
      if (stations && ledger) {
        let intelText = null;
        let latestI = null, latestIFile = null;
        const intelBase = path.join(VAULT, '00-Inbox · 收件箱', '情报');
        const scanI = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) { const m = f.match(/^intel-(\d{4}-\d{2}-\d{2})\.md$/); if (m && (!latestI || m[1] > latestI)) { latestI = m[1]; latestIFile = path.join(dir, f); } } };
        scanI(intelBase); if (fs.existsSync(intelBase)) for (const e of fs.readdirSync(intelBase, { withFileTypes: true })) if (e.isDirectory()) scanI(path.join(intelBase, e.name));
        try { if (latestIFile) intelText = fs.readFileSync(latestIFile, 'utf8'); } catch {}
        const defaultAge = (typeof reg.subsCheckMaxAgeDays === 'number') ? reg.subsCheckMaxAgeDays : 2;
        const newestGlob = (rel) => {
          const parts = rel.split('/'); const base = parts.pop();
          const dir = path.join(VAULT, ...parts);
          if (!fs.existsSync(dir)) return null;
          const rx = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          let best = null, bestM = -1;
          for (const f of fs.readdirSync(dir)) { if (!rx.test(f)) continue; try { const stt = fs.statSync(path.join(dir, f)); if (stt.isFile() && stt.mtimeMs > bestM) { bestM = stt.mtimeMs; best = path.join(dir, f); } } catch {} }
          return best ? { p: best, m: bestM } : null;
        };
        const runSubCheck = () => {
          const out = [];
          for (const s of stations) {
            const e = ledger[s.id];
            const lag = e && e.lastReport ? Math.round((new Date(today) - new Date(e.lastReport)) / 864e5) : Infinity;
            if (lag > 1 || !e || e.lastStatus === 'silent') continue; // 省站级已病·市站账不叠
            const missing = [];
            for (const p of (Array.isArray(s.prefectures) ? s.prefectures : [])) {
              if (p.type === 'anchor') { if (intelText && !intelText.includes(p.target)) missing.push(p.name + '(锚缺@' + latestI + ')'); continue; }
              if (p.type === 'static') continue; // 静态存档站无写方·不按新鲜度问责（诚实标型不充鲜）
              if (p.type === 'absFile') { // 盘外绝对路径活链心跳（如 C:/Users/Mi/.zsxq/…）
                try { const m = fs.statSync(p.target).mtimeMs; const ageD2 = Math.round((Date.now() - m) / 864e5); if (ageD2 > (p.maxAgeDays || defaultAge)) missing.push(p.name + '(断供' + ageD2 + '天)'); }
                catch { missing.push(p.name + '(心跳无文件)'); }
                continue;
              }
              const g = newestGlob(p.target);
              const lim = p.maxAgeDays || defaultAge;
              if (!g) { missing.push(p.name + '(无文件)'); continue; }
              const ageD = Math.round((Date.now() - g.m) / 864e5);
              if (ageD > lim) { missing.push(p.name + '(断供' + ageD + '天)'); continue; }
              if (p.type === 'grepFile') { try { if (!fs.readFileSync(g.p, 'utf8').includes(p.pattern)) missing.push(p.name + '(题族缺)'); } catch { missing.push(p.name + '(读不到)'); } }
            }
            if (missing.length) out.push({ province: s.province, missing });
          }
          return out;
        };
        subFaults = runSubCheck();
        // 判#1154（用户令『要实时解决·灵活变通』）：anchor 缺→当场补喂自愈（检测器带修复·同 JSON 维自愈模式）——
        //   判#1155 修正：**只对可补喂站（FEEDABLE）触发**——防"缺别的锚却调 FR 补喂"误标（实锤自查）；消息带站名。
        //   调 intel-station-feed（幂等·秒退·只补当日 intel）→ 重读 intel → 重跑普查 → 回填变 P 并标"⚙️ 已自动补喂"。
        const FEEDABLE = [{ id: 'fed-reg', target: '制裁/出口管制(Federal Register' }];
        const needFeed = FEEDABLE.filter(fx => intelText && intelText.indexOf(fx.target) < 0);
        if (needFeed.length && latestI) {
          try {
            const fo = execSync('powershell -NoProfile -File "' + path.join(VAULT, 'vault-scripts', 'intel-station-feed.ps1') + '" -Date ' + latestI + ' -Station ' + needFeed[0].id, { stdio: 'pipe', timeout: 60000 });
            const foTxt = String(fo || '').trim();
            try { if (latestIFile) intelText = fs.readFileSync(latestIFile, 'utf8'); } catch {}
            subFaults = runSubCheck();
            feedHealed = (intelText && intelText.indexOf(needFeed[0].target) >= 0) ? ('已自动补喂 ' + needFeed.map(x => x.id).join(',') + '（锚回填·当日）') : ('补喂未生效: ' + foTxt.slice(0, 80));
          } catch (ef) { feedHealed = '补喂器异常(' + String(ef.message).slice(0, 40) + ')·维持报警'; }
        }
      }
    } catch { subFaults = []; } // 普查自身炸→不拦省站主账（尺坏不判被检方病）另报 W 行尾
    const st = stationReportState(stations, ledger, today, subFaults);
    const fixLine = st.status === 'P' ? '' : '省站未报→手动补报一次 `powershell -File vault-scripts/conversion-brief.ps1`（各站呈报+写留痕·已顺带补喂）；市站断供→已装当日补喂器（intel-station-feed·㉝ 每小时自愈·判#1154）+按名册喂源列（末梢病省内治·判#1043）';
    check('情报站点报告', st.status, st.msg + (feedHealed ? ' · ⚙️ ' + feedHealed + '（判#1154）' : '') + (st.status !== 'P' && !subFaults.length ? '' : (subFaults.length ? '（市站普查 ' + subFaults.reduce((a, x) => a + x.missing.length, 0) + ' 末梢异常）' : '')), fixLine);
  } catch (e) { check('情报站点报告', 'W', '扫描失败: ' + String(e.message).slice(0, 60), '查 stationReportState 与 intel-stations*.json'); }
})();

// ── ㉞ 伪调用自巡检（判#1062 病根·由内而外全系统同步根治·用户 10-02 令「伪调用从规则升级为机器通用谓词」）──
// 不变式：任何研判/报告产物声称「用了书卡/人物卡处理」→ 该卡当日必有 card-calls Read 留痕（zhenRead/intel-daily/judgment-ref/read）。
//   点名却没读=伪调用（KC-INT-001 §314 硬规则）。此处对「最新情报研判报告」扫（该谓词读的是全系统共写的 card-calls 证据账，
//   故任一生成器只要往报告写卡名又没落读痕即被逮——一处规则·处处生效·每小时自巡检）。
function fakeCallState(reportText, callsText, dateStr) {
  if (!reportText) return { status: 'P', msg: '无研判报告产物·伪调用维无从判（非报告日不硬判绿）' };
  const claimRx = /(书库校准|智囊团校准|天团研判|情报研判|研判段)/;
  if (!claimRx.test(reportText)) return { status: 'P', msg: '报告无书卡/人物卡处理声明·不适用（不误报非研判产物）' };
  const cited = new Set();
  const cre = /KC-(?:BOOK|FIGURE)-\d{3}/g; let m;
  while ((m = cre.exec(reportText))) cited.add(m[0]);
  if (cited.size === 0) return { status: 'P', msg: '研判段未点名具体书/人物卡·无从判' };
  const read = new Set();
  for (const ln of String(callsText || '').split('\n')) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!o || !o.card || !o.ts || !String(o.ts).startsWith(dateStr || '')) continue;
    if (/zhenRead|intel-daily|judgment-ref|(^|[^a-z])read/.test(String(o.action || ''))) read.add(o.card);
  }
  if (read.size === 0) return { status: 'F', msg: '报告点名 ' + cited.size + ' 张卡但当日零 Read 留痕=伪调用复发（判#1062 病根）·查真Read链是否被绕过' };
  const miss = [...cited].filter(c => !read.has(c));
  if (miss.length) return { status: 'W', msg: '引了没读的卡 ' + miss.length + '/' + cited.size + '：' + miss.slice(0, 6).join(',') + '（当日 zhenRead 缺·残留）' };
  return { status: 'P', msg: '研判点名的 ' + cited.size + ' 张卡当日均有 Read 留痕·真调用闭环' };
}
(() => {
  try {
    const intelBase = path.join(VAULT, '00-Inbox · 收件箱', '情报');
    let latestDate = null, latestFile = null;
    const scanI = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) { const mm = f.match(/^intel-(\d{4}-\d{2}-\d{2})\.md$/); if (mm && (!latestDate || mm[1] > latestDate)) { latestDate = mm[1]; latestFile = path.join(dir, f); } } };
    scanI(intelBase); if (fs.existsSync(intelBase)) for (const e of fs.readdirSync(intelBase, { withFileTypes: true })) if (e.isDirectory()) scanI(path.join(intelBase, e.name));
    let rtext = null; try { if (latestFile) rtext = fs.readFileSync(latestFile, 'utf8'); } catch {}
    let ctext = ''; try { ctext = fs.readFileSync(GlobalState.resolveStatePath('card-calls.jsonl', VAULT), 'utf8'); } catch {}
    const st = fakeCallState(rtext, ctext, latestDate || '');
    const fix = st.status === 'P' ? '' : ('验真Read链未被绕过：powershell -File vault-scripts/intel-analysis.ps1 -Date ' + latestDate + ' -VerifyRead（退0且取卡>0=在跑；报错=降级路径吞了真读）');
    check('伪调用自巡检', st.status, st.msg + (latestDate ? ('（最新研判 ' + latestDate + '）') : ''), fix);
  } catch (e) { check('伪调用自巡检', 'W', '扫描失败: ' + String(e.message).slice(0, 60), '查 fakeCallState'); }
})();

// ── ㉟ 用户大脑泵（判#1132 用户令『我要经过我的大脑·在大脑里形成闭环迭代』）：人脑环检测端 ──
// 泵链=读书/情报进脑(判#1114 决策日报🧠段) → 你回填思考 → 系统沉淀回流。本维盯"回填槽"：
// 近7天≥1条有效回填=P；7天0条=W（泵停·自动进红灯账㉜催办·≥5天逼上决策日志）；样本0=W不判绿。
// 判#1416 检测端纠错（第二次同族复发）：判#1220 已把匹配从旧标题「## 🧠 今日读书闭环」改为稳定前缀「## 🧠」，
//   但**只改了一处**——样本筛选行还留着旧标题 indexOf，于是近14天日报全被当"旧格式"跳过 → 样本恒 0。
//   雷达因此从"泵停"退化成"样本为0"，连泵停都报不出来（看不见 ≠ 没问题）。此处两处口径一次收齐：
//   ① 样本筛选用稳定前缀（防标题再改名）；② 回填判定只认行形 `> - [KC-xxx-数字] 思考`（教学行 xxx≠数字自动排除），
//   不再用"回填：到第一个空行"的切片（回填块已前置到灌入清单顶部，切片会把灌入行当回填）。
//   ③ 只认**机器能接住的**回填（卡号+思考），因为泵的意义是回流，填了接不住等于没填。
function brainPumpState(fills) {
  if (!Array.isArray(fills) || fills.length === 0) return { status: 'W', msg: '样本为0（近14天无含🧠段的决策日报）——泵机制待生成日报·不判绿' };
  const now = Date.now();
  const ageDays = (d) => (now - new Date(d + 'T12:00:00+08:00').getTime()) / 864e5;
  const okFill = fills.filter(x => x.filled);
  const in7 = okFill.filter(x => ageDays(x.date) <= 7);
  if (in7.length >= 1) return { status: 'P', msg: '你脑泵在转：近7天 ' + in7.length + ' 条思考回填（样本 ' + fills.length + ' 份·累计回填 ' + okFill.length + ' 条）' };
  return { status: 'W', msg: '你脑泵停：近7天 0 条回填（样本 ' + fills.length + ' 份🧠日报·回填槽全空）——读进脑的书后回填一句：> - [KC-BOOK-xxx] 你的思考' };
}
(() => {
  try {
    const base = path.join(VAULT, '00-Inbox · 收件箱', '决策日报');
    const fills = [];
    const scanR = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { scanR(p); continue; }
        const m = e.name.match(/^决策日报-(\d{4}-\d{2}-\d{2})\.md$/); if (!m) continue;
        const d = m[1];
        if (Date.now() - new Date(d + 'T12:00:00+08:00').getTime() > 14 * 864e5) continue; // 只扫近14天样本
        let txt = ''; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
        const i = txt.indexOf('## 🧠'); if (i < 0) continue;  // 无🧠段=非样本(旧格式)·用稳定前缀防标题改名漂移(判#1220/#1416)
        // 🧠段到下一个二级标题止（不含）——防把后面"滚入未接"等段的行算进来
        const rest = txt.slice(i + 4);
        const j = rest.search(/\n##\s/);
        const seg = j >= 0 ? rest.slice(0, j) : rest;
        const filled = seg.split('\n').some(l => {
          const mm = l.match(BRAIN_FILL_RE);
          return !!(mm && mm[1].trim().length >= 2);
        });
        fills.push({ date: d, filled });
      }
    };
    scanR(base);
    const st = brainPumpState(fills);
    check('用户大脑泵', st.status, st.msg, st.status === 'P' ? '' : '读决策日报🧠段"进脑"的书→回填一句思考（> - [KC-BOOK-xxx] …）→机械回流书卡+会话AI沉淀KC-USER-002（判#1114/1132）');
  } catch (e) { check('用户大脑泵', 'W', '扫描失败: ' + String(e.message).slice(0, 60), '查 00-Inbox · 收件箱\\决策日报 可读性'); }
})();

// ── ㊲ 量取无来源（判#1237·根卡 v5.4.26 量取同槽律的机器眼·治本第 5 次复发）──
// 扫判断账本近 20 条：含 3+ 个不同数字却无量取手段同槽（命令 or [来源:]）→ W。
// 纪律（照本文件既有形状）：源读不到→W 不冒 P；样本 0→W 不判绿；函数与 selftest 双在。
(function () {
  let segs = [];
  try {
    const jl = fs.readFileSync(GlobalState.resolveStatePath('judgment-log.md', VAULT), 'utf-8');
    // 只取真判断段（### 判断#N）——账本里还有 ### 连接 / ### 核心判断(auto) 等同级块（auto-settle 产物），
    // 用"最后 20 个 ### 块"会误读那些碎片（本维首跑实测踩中·判#1237 现场）。
    const all = jl.split(/^### /m).slice(1).filter(s => /^判断#\d+/.test(s));
    segs = all.slice(-20).map(s => {
      const nl = s.indexOf('\n');
      return { title: nl > 0 ? s.slice(0, nl).trim() : s.trim(), body: s.slice(nl + 1) };
    });
  } catch (e) {
    check('量取无来源', 'W', '判断账本读不到·不判真假：' + e.message + '（查是尺失效还是源真缺·根卡检测律）', 'vault-scripts/judgment-log.md');
    return;
  }
  const st = measureNoSourceState(segs);
  check('量取无来源', st.status, st.msg, '根卡 KC-SYS-001 v5.4.26 量取同槽律 · 数字宣称须配可粘贴命令或[来源:]');
})();

// ── ㉟ 同步门健康（判断#1259·2026-10-08）──────────────────────────────────────
// 立据：实测 push.log 458KB/414 行把「push 成功」记成「失败」（git 进度写 stderr·PowerShell 2>&1 包成
//   NativeCommandError），一个多月无人察觉；且 settle-session §9c 四步无 pull = 单向阀，
//   云端写入永不下行（实测 GitHub 领先本地 9 个提交一整天）。二层互相掩盖=KC-SYS-065 假绿家族。
// 本维只判「同步门自己有没有留下可判读状态」——门坏=无状态/状态过期/有失败未处理，一律不报绿。
// 判据唯一源：vault-data/git-sync-state.json（sync-gate.ps1 写）；失败另落 _system-status.md 供本维读。
(() => {
  try {
    const statePath = path.join(VD, 'git-sync-state.json');
    const gatePath = path.join(VAULT, 'vault-scripts', 'sync-gate.ps1');
    // 尺的存在性：门脚本没了 = 机制被删（F，不是 W）
    if (!fs.existsSync(gatePath)) {
      check('同步门', 'F', 'sync-gate.ps1 不存在——唯一进出口被删（判#1259）', 'vault-scripts/sync-gate.ps1');
      return;
    }
    if (!fs.existsSync(statePath)) {
      check('同步门', 'W', '无状态文件——门未跑过或被清（判#1259 进门即知的前提没建立）', 'vault-data/git-sync-state.json');
      return;
    }
    let s = null;
    try { s = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {
      check('同步门', 'F', '状态文件解析失败：' + String(e.message).slice(0, 50) + '（门写了坏数据=不可判读）', 'vault-data/git-sync-state.json');
      return;
    }
    // 时效：超过 26 小时未刷新 = 门停摆（settle 日跑·radar 小时跑，>26h 必属异常）
    let ageH = null;
    try { ageH = (Date.now() - new Date(String(s.ts).replace(' ', 'T')).getTime()) / 3600000; } catch {}
    const parts = [];
    parts.push('本地 ' + (s.local || '?'));
    parts.push('通道 ' + (s.healthyCh || 0) + '/' + (s.totalCh || 0));
    if (typeof s.behind === 'number' && s.behind > 0) parts.push('落后 ' + s.behind);
    if (typeof s.ahead === 'number' && s.ahead > 0) parts.push('领先 ' + s.ahead);
    if (ageH !== null && isFinite(ageH)) parts.push('状态 ' + ageH.toFixed(1) + 'h 前');
    const detail = parts.join(' · ');

    // F：push 失败未处理（闸门必须报警 —— 根卡 5.4.19）
    if (String(s.result || '').match(/failed/)) {
      check('同步门', 'F', 'push 失败：' + detail + '（远端 ' + (s.failedRemotes || []).join(',') + '）→ 跑 sync-gate.ps1 -Mode out 复现', 'vault-data/git-sync-state.json');
      return;
    }
    // F：通道全断
    if ((s.totalCh || 0) > 0 && (s.healthyCh || 0) === 0) {
      check('同步门', 'F', '全部通道不可达：' + detail + '（本地/云端双向断流）', 'vault-data/git-sync-state.json');
      return;
    }
    // F：状态过期（门停摆=下次开门看到的是陈年状态）
    if (ageH !== null && isFinite(ageH) && ageH > 26) {
      check('同步门', 'F', '状态 ' + ageH.toFixed(1) + 'h 未刷新（>26h）—— 门停摆：' + detail, 'vault-data/git-sync-state.json');
      return;
    }
    // W：本地落后远端（没 pull · 进门 AI 必须先同步）
    if (typeof s.behind === 'number' && s.behind > 0) {
      check('同步门', 'W', '本地落后远端 ' + s.behind + ' 个提交 —— 云端写入没下来：' + detail + '（跑 sync-gate.ps1 -Mode in）', 'vault-data/git-sync-state.json');
      return;
    }
    // W：本地有未推送提交
    if (typeof s.ahead === 'number' && s.ahead > 0) {
      check('同步门', 'W', '本地领先远端 ' + s.ahead + ' 个提交未推：' + detail + '（跑 sync-gate.ps1 -Mode out）', 'vault-data/git-sync-state.json');
      return;
    }
    // W：通道部分不通（能用但有风险）
    if ((s.healthyCh || 0) < (s.totalCh || 0)) {
      check('同步门', 'W', '通道 ' + (s.healthyCh || 0) + '/' + (s.totalCh || 0) + ' 有不通：' + detail, 'vault-data/git-sync-state.json');
      return;
    }
    check('同步门', 'P', '已同步 · ' + detail, 'vault-data/git-sync-state.json');
  } catch (e) {
    check('同步门', 'W', '扫描失败：' + String(e.message || e).slice(0, 60), 'vault-scripts/sync-gate.ps1');
  }
})();

// ── ㊱ VS Code 窗口增殖（2026-10-18 实测根治圈·用户令「一直在打开窗口·找出原因根治」）──────
// 立据（实测，不是猜）：用户桌面出现 3 个 VS Code 窗（Vault + 2 个空 Welcome）。
//   源头机制 = VS Code 默认 window.restoreWindows="all"，每次启动按 storage.json 里的
//   openedWindows / backupWorkspaces.emptyWindows / profileAssociations.emptyWindows **原样再开一遍**，
//   一天三轮启动就堆出 3+ 个窗（实测 15:09:19 / 15:12:50 / 15:16:37 各拉起一轮）。
//   永久修已做：用户设置 window.restoreWindows="none" + 清掉已堆积的恢复条目。
// 本维只做「防复发观测」：跑同目录探针（探针是尺子唯一源，本维只消费它的 W 行，不另写一套判据）。
//   尺子自己哑掉/不存在 = F（哨哑了比没哨更危险），不报绿。
(() => {
  try {
    const probe = path.join(VAULT, 'vault-scripts', 'vault-vscode-window-probe.ps1');
    if (!fs.existsSync(probe)) {
      check('VS Code窗口增殖', 'F', '探针不存在——防复发观测被删（vault-vscode-window-probe.ps1）', 'vault-scripts/vault-vscode-window-probe.ps1');
      return;
    }
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe, '-Merge'], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
    const warns = [...String(out).split(/\r?\n/)].filter(l => /^W\s/.test(l)).map(l => l.replace(/^W\s+/, ''));
    const okLine = String(out).split(/\r?\n/).find(l => l.startsWith('OK ')) || '';
    // 尺子没给结论（既无 W 也无 OK）= 探针哑火，不判绿（判#854 测不了不判绿）
    if (!warns.length && !okLine) {
      check('VS Code窗口增殖', 'F', '探针没出结论（既无 OK 也无 W）—— ' + String(out).trim().slice(0, 80), '手动跑 vault-scripts/vault-vscode-window-probe.ps1 -Merge 看哪一步崩');
      return;
    }
    if (warns.length) {
      check('VS Code窗口增殖', 'W', warns.join(' ⏎ ') + '（永久修=用户设置 window.restoreWindows:none·探针看 vault-data/vscode-window-probe.jsonl）', 'window.restoreWindows 被改回 / storage.json 恢复条目又堆起来：清多余窗口后跑探针确认恢复条数回落到 1');
      return;
    }
    check('VS Code窗口增殖', 'P', okLine.replace(/^OK\s+/, '') + '（防复发观测在位·判据唯一源=探针）', '');
  } catch (e) {
    // 非零退出（探针崩）/ 超时：F，不吞
    check('VS Code窗口增殖', 'F', '探针跑不动：' + String((e && (e.stdout || e.message)) || e).slice(0, 90), '哨哑了比没有哨更危险·先修 vault-scripts/vault-vscode-window-probe.ps1');
  }
})();

// ── 写 JSON 产物（第二方校验：cross-audit 广度检查读此文件验证维度数）──
// 行为纠正#16·2026-08-21：health-radar 只 console.log 不写文件 → cross-audit 无第二方可读数据
try {
  const outRadar = {
    ts: new Date().toISOString().slice(0, 19),
    dimensions: radar.items.length,
    items: radar.items.map(i => ({ name: i.name, status: i.status, detail: i.detail })),
    anomalies: radar.anomalies
  };
  const radarOutPath = path.join(VD, 'health-radar.json');
  try {
    require('child_process').execSync(
      'node "' + path.join(VAULT, 'vault-scripts', 'atomic-write.js') + '" "' + radarOutPath + '" ' + JSON.stringify(JSON.stringify(outRadar)) + ' --json',
      { stdio: 'pipe' }
    );
  } catch { fs.writeFileSync(radarOutPath, JSON.stringify(outRadar, null, 2), 'utf-8'); }
} catch {}

// ── ㊱ 门覆盖率（判断#1351·发现回路收口）：根卡每条必须条文必须有机器身体——每小时点一次数，
//    愿望清单在 vault-data/gate-coverage.json（任何 AI 运行中撞到没门的条文 --wish 一条命令入册）。
//    覆盖率跌破基线=F（哪扇门被并发冲掉当场可见·判#1228 同族预防）；跑不动=W（哨哑比没有哨危险·判#999 同法）。
(() => {
  try {
    const out = require('child_process').execFileSync('node',
      [path.join(VAULT, 'vault-scripts', 'gate-coverage-audit.js')],
      { encoding: 'utf8', timeout: 60000, cwd: VAULT });
    check('门覆盖率', 'P', String(out || '').split('\n')[0].trim(), '愿望按生命线排序装门（判#1347/#1350）');
  } catch (e) {
    const so = String((e && e.stdout) || '');
    const first = (so.split('\n')[0] || String((e && e.message) || '')).trim().slice(0, 80);
    if (/低于基线/.test(first)) check('门覆盖率', 'F', first, '覆盖率只升不降（判#1347）·先查哪扇门被冲掉再谈新门');
    else check('门覆盖率', 'W', 'audit 跑不动: ' + first, '哨哑了比没有哨更危险·先修 gate-coverage-audit.js');
  }
})();

// ── 输出 ──
const statusMap = { P: '✅', W: '⚠️', F: '❌' };
const line = radar.items.map(i => `${i.name}${statusMap[i.status]}`).join(' ');
console.log(`🛰️ 健康雷达: ${line}`);
if (radar.anomalies.length) {
  for (const a of radar.anomalies) {
    console.log(`   ${statusMap[a.status]} ${a.name}: ${a.detail}${a.link ? ` → ${a.link}` : ''}`);
  }
} else {
  console.log('   ✅ 无异常，系统自检通过');
}
// 自愈可见：自动修复不消失（闭环行为值得看到）
if (jsonRepaired.length) {
  console.log(`   ⚙️ 自动修复 ${jsonRepaired.length} 个: ${jsonRepaired.join(', ')}（git HEAD 恢复，已闭环）`);
}
// ── 判#1378 源头：**radar 自己写状态快照**（用户令「发现问题从源头解决」）──
// 【病·实测铁证】_system-status.md 文件头自称「每小时 radar 扫」，而实测：
//   · radar          **只读不写**（ai-register 进门读它喂红灯，radar 从不产出）
//   · settle/sync-gate **只在失败时写**
//   ⇒ **成功时无人写** → 文件停在 2026-10-09（9 天前），每个 AI 进门都被喂这份 9 天前的红灯。
//   更糟：ai-register 有「>90 分钟即警告陈旧」的判断，**警告完照样用**——警告了但仍然用，比不警告更毒。
// 【为什么不让进门实时跑 radar】实测跑一次 54.7 秒（探 30+ 维），进门等不起 ⇒ 快照要留，病在没人刷新。
//   故由 radar 在自己跑完时写（它本来就是那个「每小时」的执行者）。
try {
  const stPath = path.join(VAULT, 'vault-data', '_system-status.md');
  const ts = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
  const reds = radar.anomalies.filter(a => a.status === 'F');
  const warns = radar.anomalies.filter(a => a.status === 'W');
  const body = [
    '# 系统状态（health-radar.js 自动生成·判#1378）',
    `更新: ${ts} · 本次雷达 ${radar.items.length} 维（红 ${reds.length}·黄 ${warns.length}）`,
    '',
    '> 本文件由 `vault-scripts/health-radar.js` **每次跑完自动覆写**。',
    '> 看到它陈旧（>90 分钟）= 雷达没在跑 → 先跑 `node vault-scripts/health-radar.js` 再信这里的结论。',
    '',
  ];
  if (reds.length) {
    body.push('## ❌ 红（必须处理·不留下圈）');
    for (const a of reds) body.push(`- ❌ **${a.name}**: ${a.detail}${a.link ? ` → ${a.link}` : ''}`);
    body.push('');
  }
  if (warns.length) {
    body.push('## ⚠ 黄（挂账跟踪）');
    for (const a of warns) body.push(`- ⚠ **${a.name}**: ${a.detail}${a.link ? ` → ${a.link}` : ''}`);
    body.push('');
  }
  if (!reds.length && !warns.length) { body.push('## ✅ 全绿', '本次无红无黄。', ''); }
  require('./atomic-write.js').atomicWrite(stPath, body.join('\n'));
} catch (e) {
  console.log(`   ⚠ 状态快照写入失败（不阻断雷达）：${String((e && e.message) || e).slice(0, 120)}`);
}
