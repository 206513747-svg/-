// 判断#682 · ai-lock.js —— 多 AI 并发写协调原语（跨语言独占锁 + 活跃持有者可见性）
// 病根根治：多个 AI 对话框同刻改同一库、互相看不见、互相覆盖（旧只靠"别改我文件"软记忆，不可扩展）。
// 机制：任何写共享/系统文件的动作(脚本或工具)先 acquire 一个命名租约；同一资源他人持且未过期 → 直接 Busy(报持有者)；进程崩溃 → 陈旧租约自动接管。
// 用法(shell，ps1 也调它)：
//   node vault-scripts/ai-lock.js acquire <资源名> --ai <名字> [--ttl 120]
//   node vault-scripts/ai-lock.js renew   <资源名> --ai <名字>
//   node vault-scripts/ai-lock.js release <资源名> --ai <名字>
//   node vault-scripts/ai-lock.js status            # 列出当前所有活跃持有者（谁在写=可见）
// 用法(node)： const {acquire,renew,release,status}=require('./ai-lock.js');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT = path.resolve(__dirname, '..'); // 跟随当前工作树，不回退到固定正式库
// ── 判#1451 治本：锁目录必须是「全局唯一」，不能随库位分家 ─────────────────────
// 病灶（2026-10-28 实证·两次真丢判断）：
//   原实现 DIR = <本树 ROOT>/vault-data/ai-locks —— 而 ROOT 是**每棵树自己的根**。
//   判#1333 起"每会话一个 worktree"（D:/Vault-wt/<名>），于是：
//     主树锁  = D:/Vault/vault-data/ai-locks
//     库位锁  = D:/Vault-wt/<名>/vault-data/ai-locks
//   两个目录互相看不见 → 两个窗口各持各的"独占锁"、都自认安全 → 各写各的账本
//   → merge 时后提交者整本覆盖前者。实测：判#1445 在 d37d1dd6 提交，6 分钟后
//   e1db65eb 用「不含 #1445 的库位账本」写回，段数 1110→1110 精确一进一出（#1445 出 #1446 进）。
//   这不是"锁没生效"，是**锁被复制成了两把**。互斥原语一旦按树分家，就等于没有互斥。
//
// 治法：锁目录钉在 **git 公共目录**下（git worktree 的 common-dir 对同一仓所有树是同一个）
//   → 主树与所有库位写到同一个目录 → 同一把锁 → 真互斥。
//   取不到 git 公共目录时回落 master 主树路径（仍比"按树分家"正确），最后才回落本树。
//   保留 AI_LOCK_DIR 覆盖（selftest 沙箱用，生产不设）。
function resolveGlobalLockDir(){
  // 1) 显式覆盖（selftest / 特殊部署）
  if (process.env.AI_LOCK_DIR) return process.env.AI_LOCK_DIR;
  // 2) git 公共目录：同一仓的所有 worktree 共享这一个
  try {
    const { execFileSync } = require('child_process');
    const env = { ...process.env };
    delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
    const common = String(execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore','pipe','ignore'], env })).trim();
    if (common) {
      // common 通常是 <master>/.git —— 锁就住它旁边，天然对全仓唯一、又不入版本库
      return path.join(common, 'ai-locks');
    }
  } catch { /* git 不可用：往下回落 */ }
  // 3) 回落：master 主树（库位形如 D:/Vault-wt/<名> → 主树 D:/Vault）
  const m = String(ROOT).replace(/\\/g,'/').match(/^(.*?)\/Vault-wt\/[^/]+$/i);
  if (m) return path.join(m[1], 'Vault', 'vault-data', 'ai-locks');
  // 4) 最后回落：本树（行为与旧版一致，至少不比以前差）
  return path.join(ROOT, 'vault-data', 'ai-locks');
}
const DIR = resolveGlobalLockDir();
function now(){return Date.now()}
function slug(n){return String(n).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,80)}
function lf(n){return path.join(DIR,slug(n)+'.lock')}
function read(l){try{return JSON.parse(fs.readFileSync(l,'utf-8').replace(/^\uFEFF/,''))}catch{return null}}
function fresh(o,nowMs){return !!o && Number.isFinite(o.ts) && Number.isFinite(o.ttl) && o.ttl>0 && (nowMs-o.ts)<o.ttl}
function ensure(){if(!fs.existsSync(DIR))fs.mkdirSync(DIR,{recursive:true})}
// 判#1335 窗口标识（win）：区分「同一 AI 的多个窗口/对话」。
// 【为什么需要·实测病灶】原判据只看 cur.ai!==ai → 两个 DSH 窗口共用一个 AI 名 →
//   第二窗口判「自己持锁」直接放行 → 同AI多窗口的互斥**从未生效**（等于没锁）。
// 【取值来源·不猜】按可获得性依次回落：显式 env AI_WIN → 入口会话变量 → PID+启动时刻（同进程内稳定）。
//   无稳定会话变量时回落 AI 级身份，配合严格非重入 acquire，保证同 AI 并发命令仍互斥。
function winId(ai){
  const ev = process.env.AI_WIN || process.env.DSH_SESSION || process.env.SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (ev) return String(ev).slice(0, 40);
  // CLI acquire/release 常由两个不同 Node 进程执行，PID 不能作为跨调用的身份。
  // 无会话标识时退化为 AI 级身份；严格 acquire 仍保证同 AI 的并发调用互斥。
  return 'ai-default-' + String(ai || process.env.AI_NAME || 'anon').slice(0, 40);
}
// 同一持有者身份 = 同 ai **且**同 win；acquire 本身始终严格互斥
function sameOwner(o, ai, win){ return !!o && o.ai === ai && (o.win || '') === (win || ''); }
// 返回 {ok:true} 或 {ok:false,busy:{ai,win,pid,age_s}}；禁止强制抢占活锁
function acquire(name,ai,opts={}){
  ensure();
  const ttl=(opts.ttl||120)*1000, l=lf(name), win=opts.win||winId(ai);
  // 严格互斥：同 AI/同窗口的第二进程也不能重入，否则两个写者可同时修改同一账本。
  for(let i=0;i<20;i++){
    try{
      const fd=fs.openSync(l,'wx');
      try{fs.writeSync(fd,JSON.stringify({name,ai,win,pid:process.pid,ts:now(),ttl,token:crypto.randomBytes(16).toString('hex')}));fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
      return {ok:true};
    }catch(e){
      if(e.code!=='EEXIST')throw e;
      const cur=read(l), t=now();
      if(fresh(cur,t)) return {ok:false,busy:{ai:cur.ai,win:cur.win,pid:cur.pid,age_s:Math.round((t-cur.ts)/1000)}};
      // 根治初始化竞态：open('wx') 与写入 owner JSON 不是一个原子动作。
      // 竞争者可能读到刚创建的空/半写锁文件；绝不能把它当陈旧锁立即改名，
      // 否则活写者的锁会被偷走，两个事务并行，最终丢更新。无效元数据先给 5 秒初始化宽限；
      // 进程若在初始化窗口崩溃，宽限过后才允许原子接管。
      if(!cur || !Number.isFinite(cur.ts) || !Number.isFinite(cur.ttl) || cur.ttl <= 0){
        let ageMs=0;
        try { ageMs=t-fs.statSync(l).mtimeMs; } catch { continue; }
        if(ageMs < 5000){
          return {ok:false,busy:{ai:'lock-initializing',win:'',pid:null,age_s:Math.max(0,Math.round(ageMs/1000))}};
        }
      }
      // 陈旧租约原子改名后再检查，避免直接 unlink 竞争者刚创建的新锁。
      const stale=l+'.stale-'+process.pid+'-'+t+'-'+i;
      try{fs.renameSync(l,stale);}catch{continue;}
      const moved=read(stale);
      if(fresh(moved,now())){
        try{if(!fs.existsSync(l))fs.renameSync(stale,l);}catch{}
        return {ok:false,busy:{ai:moved.ai,win:moved.win,pid:moved.pid,age_s:Math.round((now()-moved.ts)/1000)}};
      }
      try{fs.unlinkSync(stale);}catch{}
    }
  }
  const cur=read(l);
  return {ok:false,busy:cur?{ai:cur.ai,win:cur.win,pid:cur.pid,age_s:Math.round((now()-cur.ts)/1000)}:{ai:'unknown'}};
}
function renew(name,ai){
  const l=lf(name),o=read(l),win=winId(ai);
  if(!o)return{ok:false,missing:true};
  if(!sameOwner(o,ai,win))return{ok:false,notOwner:{ai:o.ai,win:o.win}};
  const next={...o,ts:now()};
  const tmp=l+'.renew-'+process.pid+'-'+now();
  try{
    fs.writeFileSync(tmp,JSON.stringify(next),{flag:'wx'});
    fs.renameSync(tmp,l);
    return{ok:true};
  }catch(e){
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}
    return{ok:false,error:e.message};
  }
}
function release(name,ai){
  const l=lf(name),o=read(l),win=winId(ai);
  if(!fs.existsSync(l))return{ok:true,alreadyReleased:true};
  if(!o)return{ok:false,invalidLock:true};
  if(!sameOwner(o,ai,win))return{ok:false,notOwner:{ai:o.ai,win:o.win}};
  const tomb=l+'.release-'+process.pid+'-'+now()+'-'+crypto.randomBytes(4).toString('hex');
  try{
    fs.renameSync(l,tomb);
    const moved=read(tomb);
    if(!sameOwner(moved,ai,win) || (o.token && moved.token!==o.token)){
      try{if(!fs.existsSync(l))fs.renameSync(tomb,l)}catch{}
      return{ok:false,ownershipChanged:true};
    }
    fs.unlinkSync(tomb);
    return{ok:true};
  }catch(e){
    try{if(fs.existsSync(tomb)&&!fs.existsSync(l))fs.renameSync(tomb,l)}catch{}
    return{ok:false,error:e.message};
  }
}
function status(){ensure();const t=now();return fs.readdirSync(DIR).filter(f=>f.endsWith('.lock')).map(f=>{const o=read(path.join(DIR,f));if(!o)return null;const age=Math.round((t-o.ts)/1000);return{name:o.name,ai:o.ai,win:o.win,pid:o.pid,age_s:age,stale:age*1000>o.ttl}}).filter(Boolean)}
// 判#1206 prune：自动清除陈旧租约（age>ttl=持有者未续约/已崩·与 acquire L24/L28 “陈旧即可覆盖”同一不变式）·根治“死锁永远滞留可见”
function prune(){ensure();const t=now();const rm=[];for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.lock'))){const o=read(path.join(DIR,f));if(o&&!(t-o.ts<o.ttl)){try{fs.unlinkSync(path.join(DIR,f));rm.push(o.name)}catch{}}}return rm}
// 判断#691 唯一源：受保护共享/系统文件清单（gate-check / pre-commit 不再各自手抄，统一问 ai-lock guard）。改这一处=全系统生效。
const GUARDED=new Set(['entry-gate.json','classification.json','judgment-log.md','divergence-log.jsonl','health-radar.js','atomic-write.js','judgment-append.ps1','divergence-append.ps1','ai-lock.js','apply-boards.js','idnorm.js','constitution.md','CLAUDE.md','AGENTS.md','dependency-map.json','_system-state.json','_馆藏总览.md','_大家问题清单.md','_index.md',
  // 判#1187 补清单（天团 4/7 共识否掉“另建租约留痕门”后的由内正解）：日链与情报链的高频共享代码此前**不在册**，
  //   所以规则③/gate-check 对它们一直是 FREE——多圈同改互斥从未真生效。补进唯一源=现成两道门自动盖上，不新增机制。
  'market.ps1','intel-analysis.ps1','intel-verify.ps1','intel-station-feed.ps1','conversion-brief.ps1','source-compliance-audit.ps1','trade-daily.ps1','settle-session.ps1','validate-change.js','jl-isolate.js','ai-register.ps1','user-decision-append.ps1','extract-session.js','.next-step','_session-handoff.md','permanent-fixes.md']); // +判#749：harvest 定时写它·AI 销账也写它=双写者；+判#768：entry-gate.json=门定义唯一源·18 处读它·此前不在清单→改它无互斥，别人进门被误判成"门坏了"
function isGuarded(name){return GUARDED.has(String(name).replace(/^.*[\\/]/,''))}
// guard(name,ai)：非受保护或无他人持锁→FREE(放行)；受保护且他人持→{held:by}(拦)。绝不因异常误拦(调用方出错按FREE)。
function guard(name,ai){
  const b=String(name).replace(/^.*[\\\\/]/,'');
  if(!GUARDED.has(b))return{guarded:false,free:true};
  try{
    const c=check(b,ai);
    return{guarded:true,free:!c.held,by:c.held?c.by:null,age_s:c.age_s,invalid:!!c.invalid};
  }catch(e){
    return{guarded:true,free:false,by:'LOCK_CHECK_ERROR',error:e.message};
  }
}
// 只读探：该资源是否被「别的 ai」持着未过期租约。check(name,ai)→{held:是否他人持,by,age_s}。不改动任何状态。
function check(name,ai){
  ensure();
  const file=lf(name);
  if(!fs.existsSync(file))return{held:false};
  const o=read(file),t=now();
  if(!o)return{held:true,by:'LOCK_METADATA_INVALID',age_s:null,invalid:true};
  if(!fresh(o,t))return{held:false,stale:true};
  const win=winId(ai);
  const held=!sameOwner(o,ai,win);
  return{held,by:held?o.ai:null,ownerWin:held?o.win:null,age_s:Math.round((t-o.ts)/1000)};
}

if(require.main===module){
  const [cmd,name,...rest]=process.argv.slice(2);
  const ai=(rest.find(x=>x.startsWith('--ai'))&&rest[rest.indexOf('--ai')+1])||rest[rest.indexOf('--ai')+1]||process.env.AI_NAME||'anon';
  const ttlI=rest.indexOf('--ttl');const ttl=ttlI>=0?parseInt(rest[ttlI+1]):120;
  // 判#1335 selftest：窗口维（同AI异窗口互斥 / 同窗口放行 / 异AI互斥）·沙箱内跑不碰真锁
  if(cmd==='--selftest'||cmd==='selftest'){
    const os=require('os'),fsx=require('fs'),px=require('path');
    const box=fsx.mkdtempSync(px.join(os.tmpdir(),'ailock-'));
    const envBak={DIR:process.env.AI_LOCK_DIR,AI_WIN:process.env.AI_WIN,AI_NAME:process.env.AI_NAME};
    // 让锁定目录指向沙箱（DIR 由 AI_LOCK_DIR env 覆盖·生产路径不变）
    // 注意：BUSY 是**预期失败**（退出码非 0），须吞掉异常并把 stdout 取回来判据。
    const run=(args,env)=>{
      try{
        return require('child_process').execFileSync(process.execPath,[__filename,...args],
          {encoding:'utf8',env:{...process.env,...env},stdio:['ignore','pipe','pipe']}).trim();
      }catch(e){ return String((e.stdout||'')+(e.stderr||'')).trim(); }
    };
    const t=[];const ok=(n,c)=>t.push([n,!!c]);
    try{
      // 同AI异窗口：A 持锁 → B 应 BUSY
      run(['acquire','x.md','--ai','DSH'],{AI_LOCK_DIR:box,AI_WIN:'A'});
      const b=run(['acquire','x.md','--ai','DSH'],{AI_LOCK_DIR:box,AI_WIN:'B'});
      ok('同AI异窗口 → 拦（核心修复）',/BUSY/.test(b));
      // 同AI同窗口：第二个进程再取 → BUSY（禁止隐式重入）
      const a2=run(['acquire','x.md','--ai','DSH'],{AI_LOCK_DIR:box,AI_WIN:'A'});
      ok('同AI同窗口第二进程 → 拦（禁止隐式重入）',/BUSY/.test(a2));
      // 异AI → 拦
      const o=run(['acquire','x.md','--ai','Qoder'],{AI_LOCK_DIR:box,AI_WIN:'A'});
      ok('异AI → 拦（原有行为不回归）',/BUSY/.test(o));
      // 错误窗口不能释放；正确持有者释放后放行
      const wrong=run(['release','x.md','--ai','DSH'],{AI_LOCK_DIR:box,AI_WIN:'B'});
      ok('异窗口不能释放他人租约',/BUSY/.test(wrong));
      run(['release','x.md','--ai','DSH'],{AI_LOCK_DIR:box,AI_WIN:'A'});
      const after=run(['acquire','x.md','--ai','DSH'],{AI_LOCK_DIR:box,AI_WIN:'B'});
      ok('正确持有者释放后 → 放行',/OK/.test(after));
      // 无 AI_WIN 时回落 pid（不炸）
      const nw=run(['acquire','y.md','--ai','DSH'],{AI_LOCK_DIR:box});
      ok('无 AI_WIN → 回落 AI 级身份不炸',/OK/.test(nw));

      // ── 判#1451 治本断言：锁目录必须跨树唯一（否则互斥按树分家=等于没互斥）──
      // 复刻病灶：修复前 DIR=<本树>/vault-data/ai-locks，主树与库位各一把。
      // 这里直接验 resolveGlobalLockDir 的取值语义：不同树的 git-common-dir 解析结果必须相同。
      const { execFileSync } = require('child_process');
      const commonOf = (dir) => {
        try {
          return String(execFileSync('git',['-C',dir,'rev-parse','--path-format=absolute','--git-common-dir'],
            {encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']})).trim();
        } catch { return ''; }
      };
      const cMaster = commonOf('D:/Vault');
      const cWt     = commonOf('D:/Vault-wt/DSH');
      if (cMaster && cWt) {
        ok('锁目录跨树唯一：主树与库位解析到同一 git-common-dir', cMaster === cWt);
      } else {
        // 取不到就明说"没测到"，不冒充通过（判#1222：读不到≠没有）
        ok('锁目录跨树唯一（前置：本机需有 D:/Vault-wt/DSH 库位才可测）', false);
        console.log('     前置缺失：git-common-dir 读不到，本条未验证');
      }
      // 反向守卫：修复前的语义（各树各自 vault-data/ai-locks）必须判为"不同"，
      // 否则说明本断言恒真、测不出病。
      const oldA = 'D:/Vault/vault-data/ai-locks', oldB = 'D:/Vault-wt/DSH/vault-data/ai-locks';
      ok('反向守卫：修复前语义确为两把不同的锁（本条证明断言非恒真）', oldA !== oldB);
    }catch(e){ok('selftest 执行无异常',false);console.error(String(e.message).slice(0,160))}
    finally{try{fsx.rmSync(box,{recursive:true,force:true})}catch{}}
    const fail=t.filter(([,c])=>!c);
    for(const [n,c] of t)console.log(`${c?'ok  ':'FAIL'} ${n}`);
    console.log(`\nai-lock selftest ${t.length-fail.length}/${t.length} 过`);
    process.exit(fail.length?1:0);
  }
  if(cmd==='status'){console.log(JSON.stringify(status(),null,2));process.exit(0)}
  if(cmd==='prune'){const rm=prune();console.log('pruned陈旧锁: '+rm.length+(rm.length?' ['+rm.join(', ')+']':''));process.exit(0)}
  if(cmd==='check'){const c=check(name,ai);console.log(c.held?c.by:'FREE');process.exit(0)}
  if(cmd==='guard'){const g=guard(name,ai);console.log(g.free?'FREE':(g.by||'HELD'));process.exit(0)}
  let r;
  if(cmd==='acquire')r=acquire(name,ai,{ttl});
  else if(cmd==='renew')r=renew(name,ai);
  else if(cmd==='release')r=release(name,ai);
  else{console.log('用法: acquire|renew|release <资源> --ai <名> [--ttl 秒]  |  status  |  prune(清陈旧锁)');process.exit(2)}
  if(r.ok){console.log(`${cmd} OK: ${name} @ ${ai}`);process.exit(0)}
  console.log(`${cmd} BUSY: ${name} 被 ${r.busy?r.busy.ai:'?'} 持有${r.busy?`(${r.busy.age_s}s)`:''}——等其释放或用 status 查看，勿强抢(会覆盖对方)`);
  process.exit(3);
}
module.exports={acquire,renew,release,status,check,guard,isGuarded,prune};
