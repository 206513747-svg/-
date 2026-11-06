from pathlib import Path
from zipfile import ZipFile
import re, shutil

ROOT = Path(".")
ARCHIVE = ROOT / "vault-repair-source.zip"
SRC = ROOT / "repair-work" / "vault-scripts"
OUT = ROOT / "repair-source" / "vault-scripts"
if not ARCHIVE.is_file():
    raise SystemExit("STOP: vault-repair-source.zip missing")
shutil.rmtree(SRC.parent, ignore_errors=True)
SRC.mkdir(parents=True, exist_ok=True)
with ZipFile(ARCHIVE) as z:
    for info in z.infolist():
        name = info.filename.replace("\\", "/")
        p = Path(name)
        if p.is_absolute() or ".." in p.parts:
            raise SystemExit("STOP: unsafe archive path " + name)
    z.extractall(SRC)

def read(name):
    p = SRC / name
    return p.read_text(encoding="utf-8-sig")

def write(name, text, bom=False):
    p = OUT / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8-sig" if bom else "utf-8", newline="")

def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"STOP: patch {label} expected 1 match, found {n}")
    return text.replace(old, new, 1)

# 1) memory-sync: bind writes to the script's own worktree and verify the actual bytes.
s = read("memory-sync.js")
s = replace_once(s,
"""// ─── 路径 ───────────────────────────────────────────────────────────
const VAULT = 'D:\\\\Vault';
const MEMORY_DIR = path.join(VAULT, 'vault-data');  // 已迁移：原 Claude记忆/ 废弃
""",
"""// ─── 路径 ───────────────────────────────────────────────────────────
// 脚本只作用于自身所属的 Git 工作树；worktree 不得误写正式库 D:\\\\Vault。
const VAULT = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(VAULT, '.git'))) {
    throw new Error('[memory-sync] 无法确认当前 Git 工作树，拒绝写入: ' + VAULT);
}
const MEMORY_DIR = path.join(VAULT, 'vault-data');  // 已迁移：原 Claude记忆/ 废弃
""", "memory-sync-root")
s = replace_once(s,
"""    safeWrite(handoffPath, handoff);
    console.log('[memory-sync] ✓ _session-handoff.md 已更新');
""",
"""    safeWrite(handoffPath, handoff);
    if (!fs.existsSync(handoffPath)) throw new Error('[memory-sync] 写后校验失败：handoff 文件不存在');
    const written = fs.readFileSync(handoffPath, 'utf-8');
    if (!written || written !== handoff) throw new Error('[memory-sync] 写后校验失败：handoff 内容不一致');
    console.log('[memory-sync] ✓ _session-handoff.md 已更新并通过写后校验');
""", "memory-sync-postwrite")
write("memory-sync.js", s)

# 2) settle-session: never suppress the child result or record false success.
s = read("settle-session.ps1")
s = replace_once(s,
"""# 11. memory-sync: 自动生成_session-handoff.md(由内而外:memory-sync.js已存在,缺调用)
& node "$Vault\\vault-scripts\\memory-sync.js" 2>&1 | Out-Null
$Changes += "memory-sync"
""",
"""# 11. memory-sync：失败必须闭锁，只有写后验证通过才记入 Changes
$MemorySyncScript = Join-Path $PSScriptRoot 'memory-sync.js'
$HandoffPath = Join-Path $Vault 'vault-data\\_session-handoff.md'
if (-not (Test-Path -LiteralPath $MemorySyncScript -PathType Leaf)) {
    throw "memory-sync 脚本缺失，停止结算：$MemorySyncScript"
}
$LASTEXITCODE = 0
$MemorySyncOutput = @(& node $MemorySyncScript 2>&1)
$MemorySyncExitCode = $LASTEXITCODE
if ($MemorySyncExitCode -ne 0) {
    $detail = ($MemorySyncOutput | Out-String).Trim()
    throw "memory-sync 执行失败（rc=$MemorySyncExitCode），本次结算未完成。输出：$detail"
}
if (-not (Test-Path -LiteralPath $HandoffPath -PathType Leaf)) {
    throw "memory-sync 返回成功但 handoff 不存在，拒绝伪报完成：$HandoffPath"
}
$HandoffItem = Get-Item -LiteralPath $HandoffPath -ErrorAction Stop
if ($HandoffItem.Length -le 0) {
    throw "memory-sync 返回成功但 handoff 为空，拒绝伪报完成：$HandoffPath"
}
$Changes += "memory-sync"
""", "settle-session-memory-sync")
write("settle-session.ps1", s, True)

# 3) ai-lock: shared identity includes window; corrupt metadata blocks; release errors are visible.
s = read("ai-lock.js")
s = replace_once(s, "const fs=require('fs'),path=require('path');",
                 "const fs=require('fs'),path=require('path'),crypto=require('crypto');", "ai-lock-crypto")
s = replace_once(s, "let ROOT; try { ROOT = require('./vault-root.js').ROOT; } catch { ROOT = 'D:/Vault'; }   // 运行根单一源（地基）·缺模块 fail-open 旧值",
                 "const ROOT = path.resolve(__dirname, '..'); // 跟随当前工作树，不回退到固定正式库", "ai-lock-root")
s = replace_once(s, "function fresh(o,nowMs){return !!o && (nowMs-o.ts)<o.ttl}",
                 "function fresh(o,nowMs){return !!o && Number.isFinite(o.ts) && Number.isFinite(o.ttl) && o.ttl>0 && (nowMs-o.ts)<o.ttl}", "ai-lock-fresh")
s = replace_once(s, "fs.writeSync(fd,JSON.stringify({name,ai,win,pid:process.pid,ts:now(),ttl}));",
                 "fs.writeSync(fd,JSON.stringify({name,ai,win,pid:process.pid,ts:now(),ttl,token:crypto.randomBytes(16).toString('hex')}));", "ai-lock-token")
start = s.index("function renew(name,ai)")
end = s.index("function status()", start)
s = s[:start] + """function renew(name,ai){
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
""" + s[end:]
start = s.index("function guard(name,ai)")
end = s.index("// 只读探", start)
s = s[:start] + """function guard(name,ai){
  const b=String(name).replace(/^.*[\\\\\\\\/]/,'');
  if(!GUARDED.has(b))return{guarded:false,free:true};
  try{
    const c=check(b,ai);
    return{guarded:true,free:!c.held,by:c.held?c.by:null,age_s:c.age_s,invalid:!!c.invalid};
  }catch(e){
    return{guarded:true,free:false,by:'LOCK_CHECK_ERROR',error:e.message};
  }
}
""" + s[end:]
start = s.index("function check(name,ai)")
end = s.index("\n\nif(require.main", start)
s = s[:start] + """function check(name,ai){
  ensure();
  const file=lf(name);
  if(!fs.existsSync(file))return{held:false};
  const o=read(file),t=now();
  if(!o)return{held:true,by:'LOCK_METADATA_INVALID',age_s:null,invalid:true};
  if(!fresh(o,t))return{held:false,stale:true};
  const win=winId(ai);
  const held=!sameOwner(o,ai,win);
  return{held,by:held?o.ai:null,ownerWin:held?o.win:null,age_s:Math.round((t-o.ts)/1000)};
}""" + s[end:]
write("ai-lock.js", s)

# 4) atomic-write: root is this worktree; unrecoverable JSON cannot masquerade as missing state.
s = read("atomic-write.js")
s = replace_once(s, "const VAULT = (()=>{try{return require('./vault-root.js').ROOT}catch{return 'D:/Vault'}})();",
                 "const VAULT = path.resolve(__dirname, '..');", "atomic-root")
s = replace_once(s,
"""      return null;
    }
  }
}

module.exports""",
"""      throw new Error('readJson fail-closed: ' + path.basename(filePath) + ' 无法验证或恢复；原文件备份/证据已保留。原因：' + e.message + '；恢复失败：' + e2.message);
    }
  }
}

module.exports""", "atomic-readjson-failclosed")
write("atomic-write.js", s)

# 5) global-state: no silent fixed-path fallback when root discovery fails.
s = read("global-state.js")
s = replace_once(s,
"""  const VR = (() => { try { return require('./vault-root.js'); } catch { return null; } })();
  const ROOT = fromRoot || (VR && VR.ROOT) || 'D:/Vault';
""",
"""  const VR = (() => { try { return require('./vault-root.js'); } catch { return null; } })();
  const ROOT = fromRoot || (VR && VR.ROOT) || path.resolve(__dirname, '..');
  if (!fs.existsSync(ROOT)) throw new Error('当前 Vault 根不存在，拒绝回退到固定路径：' + ROOT);
""", "global-master-root")
s = replace_once(s,
"""  const ROOT = fromRoot || (() => { try { return require('./vault-root.js').ROOT; } catch { return 'D:/Vault'; } })();
""",
"""  const ROOT = fromRoot || path.resolve(__dirname, '..');
  if (!fs.existsSync(ROOT)) throw new Error('当前 Vault 根不存在，拒绝解析共享状态路径：' + ROOT);
""", "global-resolve-root")
write("global-state.js", s)

# 6) kernel: a corrupt state file is not the same as an absent state file.
s = read("kernel.ps1")
s = replace_once(s,
"        try { return Get-Content $stateFile -Encoding UTF8 | ConvertFrom-Json } catch { return $null }",
'        try { return Get-Content $stateFile -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { throw "内核状态文件存在但无法解析，拒绝按未初始化处理或覆盖：$stateFile；$($_.Exception.Message)" }',
"kernel-state-failclosed")
write("kernel.ps1", s, True)

# 7) upgrade: transaction lock lives in git common-dir, is atomically created, and corrupt locks fail closed.
s = read("upgrade.ps1")
start = s.index("function Enter-UpgradeLock {")
end = s.index("function Invoke-UpgradeAction {", start)
block = r'''function Get-UpgradeLockPath {
    $commonRaw = (& git -C $vault rev-parse --git-common-dir 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or -not $commonRaw) { throw "无法解析 Git common-dir，拒绝创建局部升级锁：$vault" }
    $commonRaw = "$commonRaw".Trim()
    if ([System.IO.Path]::IsPathRooted($commonRaw)) { $common = [System.IO.Path]::GetFullPath($commonRaw) }
    else { $common = [System.IO.Path]::GetFullPath((Join-Path $vault $commonRaw)) }
    if (-not (Test-Path -LiteralPath $common -PathType Container)) { throw "Git common-dir 不存在：$common" }
    return (Join-Path $common 'upgrade-pipeline.lock')
}
function Get-UpgradeLockOwner {
    $myAi = if ($env:AI_NAME) { "$env:AI_NAME".Trim() } else { "unknown-ai" }
    $myWin = @($env:AI_WIN, $env:DSH_SESSION, $env:SESSION_ID, $env:CLAUDE_SESSION_ID) |
        Where-Object { $_ -and "$_".Trim() } | Select-Object -First 1
    if (-not $myWin) { $myWin = "ai-default-$myAi" }
    return @{ ai=$myAi; win="$myWin" }
}
function Enter-UpgradeLock {
    $upLockPath = Get-UpgradeLockPath
    $owner = Get-UpgradeLockOwner
    $script:UpgradeLockPath = $upLockPath
    $script:UpgradeLockOwner = $owner
    $now = Get-Date
    $payload = @{ ts=$now.ToString('o'); pid=$PID; ai=$owner.ai; win=$owner.win } | ConvertTo-Json -Compress
    if (Test-Path -LiteralPath $upLockPath -PathType Leaf) {
        try {
            $existing = Get-Content -LiteralPath $upLockPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if (-not $existing.ts -or -not $existing.ai -or -not $existing.win) { throw "锁字段不完整" }
            $lockTs = [datetime]::Parse("$($existing.ts)")
        } catch {
            Write-Host "  ⛔ 升级事务锁损坏，拒绝抢锁：$upLockPath；必须先审计" -ForegroundColor Red
            return $false
        }
        $ageMin = ($now - $lockTs).TotalMinutes
        if ($ageMin -lt 30) {
            if ("$($existing.ai)" -ne "$($owner.ai)" -or "$($existing.win)" -ne "$($owner.win)") {
                Write-Host "  ⛔ 全仓升级事务被占：$($existing.ai)/$($existing.win)，拒绝并发" -ForegroundColor Red
                return $false
            }
            # 排他句柄保护续租的读-校验-写；进程崩溃造成坏 JSON 时后续会 fail-closed。
            $stream = $null
            try {
                $stream = [System.IO.File]::Open($upLockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
                $buffer = New-Object byte[] ([int]$stream.Length)
                $null = $stream.Read($buffer, 0, $buffer.Length)
                $current = [System.Text.Encoding]::UTF8.GetString($buffer) | ConvertFrom-Json -ErrorAction Stop
                if ("$($current.ai)" -ne "$($owner.ai)" -or "$($current.win)" -ne "$($owner.win)") { throw "锁持有者已变化" }
                $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($payload)
                $stream.SetLength(0); $stream.Position = 0
                $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true)
                $stream.Dispose()
                return $true
            } catch {
                if ($stream) { $stream.Dispose() }
                Write-Host "  ⛔ 升级锁续租失败，拒绝继续：$($_.Exception.Message)" -ForegroundColor Red
                return $false
            }
        }
        $stale = $upLockPath + ".stale-$PID-$([guid]::NewGuid().ToString('N'))"
        try { [System.IO.File]::Move($upLockPath, $stale) }
        catch { Write-Host "  ⛔ 升级锁正在被更新，未能安全接管；请重试" -ForegroundColor Yellow; return $false }
        try {
            $moved = Get-Content -LiteralPath $stale -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            $movedAge = ($now - [datetime]::Parse("$($moved.ts)")).TotalMinutes
            if ($movedAge -lt 30) {
                if (-not (Test-Path -LiteralPath $upLockPath)) { [System.IO.File]::Move($stale, $upLockPath) }
                Write-Host "  ⛔ 升级锁在接管瞬间被续租，拒绝抢占" -ForegroundColor Yellow
                return $false
            }
            Remove-Item -LiteralPath $stale -Force -ErrorAction Stop
        } catch {
            if (Test-Path -LiteralPath $stale) { Write-Host "  ⛔ 过期锁审计失败，保留证据并停止：$stale" -ForegroundColor Red; return $false }
        }
    }
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($payload)
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($upLockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true); $stream.Dispose()
        return $true
    } catch {
        if ($stream) { $stream.Dispose() }
        Write-Host "  ⛔ 无法原子创建全仓升级锁，拒绝执行：$($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}
function Exit-UpgradeLock {
    $lockPath = $script:UpgradeLockPath
    $owner = $script:UpgradeLockOwner
    if (-not $lockPath -or -not $owner -or -not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return $false }
    $releasePath = $lockPath + ".release-$PID-$([guid]::NewGuid().ToString('N'))"
    try {
        [System.IO.File]::Move($lockPath, $releasePath)
        $current = Get-Content -LiteralPath $releasePath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ("$($current.ai)" -ne "$($owner.ai)" -or "$($current.win)" -ne "$($owner.win)") {
            if (-not (Test-Path -LiteralPath $lockPath)) { [System.IO.File]::Move($releasePath, $lockPath) }
            Write-Host "  ⛔ 锁持有者已变化，拒绝删除他人的升级锁" -ForegroundColor Red
            return $false
        }
        Remove-Item -LiteralPath $releasePath -Force -ErrorAction Stop
        return $true
    } catch {
        if ((Test-Path -LiteralPath $releasePath) -and -not (Test-Path -LiteralPath $lockPath)) { try { [System.IO.File]::Move($releasePath, $lockPath) } catch {} }
        Write-Host "  ⛔ 升级锁释放失败：$($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}
'''
s = s[:start] + block + s[end:]
s = replace_once(s,
'        Remove-Item "$vault\\vault-data\\.upgrade-pipeline.lock" -Force -ErrorAction SilentlyContinue  # 并发锁释放（判断#320）',
'        if (-not (Exit-UpgradeLock)) { throw "升级已提交，但全仓事务锁未能安全释放；需人工核验锁状态" }',
'upgrade-release')
write("upgrade.ps1", s, True)

# Keep all eight original files together; health-radar is reviewed but unchanged in this patch set.
write("health-radar.js", read("health-radar.js"))
print("Patched 7 files; health-radar.js retained unchanged.")
