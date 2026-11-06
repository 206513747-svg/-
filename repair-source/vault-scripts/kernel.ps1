# kernel.ps1 — 系统内核 v5
# 碰撞融合：宪法 + 入口审计 + 五步循环 + 铸卡 + 仪表盘 + 内容引擎
# 吸收: gate.ps1(审计) + status.ps1(仪表盘) + chain.ps1(步骤门)

param(
    [ValidateSet('status','show','score','entry','step','card','skill','upgrade','reset','next-content','collide','thinktank','gate','audit','review','backlink')][string]$action = 'status',
    [string]$arg1 = '', [string]$arg2 = ''
)


$vault = & (Join-Path $PSScriptRoot 'vault-root.ps1'); $stateFile = "$vault\vault-scripts\_system-state.json"
$today = Get-Date -Format 'yyyy-MM-dd'; $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$utf8 = [System.Text.Encoding]::UTF8
. "$PSScriptRoot\header.ps1"
. "$PSScriptRoot\Write-JsonAtomic.ps1"  # 2026-08-30 审计：BOM 根治（写入宪法·atomic-write）
. "$PSScriptRoot\upgrade.ps1"

$stepNames  = @($null,'find','solve','feedback','review','reflow')
$stepLabels = @($null,'发现','解决','反馈','复盘','回流')
$stepChecks = @($null, @('stated','clear'), @('done','verifiable'), @('observed'), @('纠偏','补全','编织','融合','重构','提纯','语言','密度','出门'), @('judgment','domain','skill'))

# ═══════════════════════════════════════════════
# 数据层（吸收自 gate.ps1 + status.ps1）
# ═══════════════════════════════════════════════

function Read-File { param([string]$path)
    if (Test-Path $path) { return [System.IO.File]::ReadAllText($path, $utf8) }; return $null
}
function Read-Json { param([string]$path)
    $raw = Read-File $path; if ($raw) { try { return $raw | ConvertFrom-Json } catch {} }; return $null
}

function Get-VaultData {
    $d = @{}
    $d.focus      = Read-Json "$vault\vault-data\weekly-focus.json"
    $d.signals    = Read-Json "$vault\vault-data\daily-signals.json"
    $d.principles = Read-Json "$vault\vault-data\principles.json"
    $d.feedback   = Read-Json "$vault\vault-data\content-feedback.json"
    $d.kanban     = Read-File "$vault\01-Projects · 项目\_看板.md"
    $d.disc       = Read-Json "$vault\vault-scripts\discipline.json"
    $d.sess       = Read-Json "$vault\vault-scripts\session-record.json"

    # 判断日志最新日期
    $d.lastJudge = '无'
    $judgeRaw = Read-File "$vault\vault-scripts\judgment-log.md"
    if ($judgeRaw) {
        # 2026-09-01 原生对齐(判断#320)：真实格式=### 判断#N - 日期 条目行，不再依赖 ## 日期 兼容段；旧 ## 段/表格行保留为兜底；跳过 [auto-settled] 占位(非判断)；取最大有效日期(防乱序追加)；@()防标量陷阱
        $valid = @($judgeRaw -split "`n" | ForEach-Object {
            if ($_ -match '^###\s+判断#\d+\s*[-·]\s*(\d{4}-\d{2}-\d{2})') { $Matches[1] }   # 判断#340：[-·]双格式兼容（实测日志 dash=25/dot=28 并存，对齐 gate.ps1/evidence-audit.ps1）
            elseif ($_ -match '^##\s+(\d{4}-\d{2}-\d{2})' -and $_ -notmatch '\[auto-settled\]') { $Matches[1] }
            elseif ($_ -match '^\|\s*\d+\s*\|.*?(\d{4}-\d{2}-\d{2})') { $Matches[1] }
        } | Where-Object { $_ -match '^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' } | Sort-Object)
        if ($valid.Count -gt 0) { $d.lastJudge = $valid[-1] }
    }

    # Git
    try {
        $d.gitUncommitted = (git -C $vault status --porcelain 2>$null | Measure-Object).Count
        $d.gitLastCommit  = git -C $vault log -1 --format=%s 2>$null
        $d.gitTag         = git -C $vault describe --tags --abbrev=0 2>$null
    } catch { $d.gitUncommitted = -1; $d.gitLastCommit = '?'; $d.gitTag = '?' }

    return $d
}

function Invoke-GateAudit {
    $d = Get-VaultData

    # 1-资源（数据新鲜 — 查判断日志而非会话记录，判断是每次运转的沉积）
    $r1 = ($d.lastJudge -eq $today)
    $r1r = if ($r1) { '判断已到今日 · 数据新鲜' } else { "最新判断: ${($d.lastJudge)}" }

    # 2-发现（纠正复发 + hub正常）
    $repeats = 0
    if ($d.disc -and $d.disc.ai_corrections) { foreach ($c in $d.disc.ai_corrections) { $repeats += $c.repeat_count } }
    $hubOk = $true
    try { $hub = powershell -ExecutionPolicy Bypass -NoProfile -File "$vault\vault-scripts\hub.ps1" -status 2>&1; $hubOk = "$hub" -match '^OK' } catch { $hubOk = $false }
    $r2 = ($repeats -eq 0 -and $hubOk)
    $r2r = if ($r2) { '纠正零复发 · 组件正常' } else { "复发${repeats}次 · 组件异常" }

    # 3-应对（行动完成 + 判断到当日）
    $pending = 0
    if ($d.disc -and $d.disc.action_items) { foreach ($a in $d.disc.action_items) { if (-not $a.done) { $pending++ } } }
    $r3 = ($pending -eq 0 -and $d.lastJudge -eq $today)
    $r3r = if ($r3) { '行动全完成 · 判断已到位' } else { "待处理${pending}项 · 最新判断${($d.lastJudge)}" }

    # 4-系统（看板项目）
    $r4 = 'I'; $r4r = '无当前项目'
    if ($d.kanban -match '当前项目[^#]+- (.+)') { $r4 = 'I'; $r4r = $matches[1].Trim() }

    # 5-执行（留档）
    $r5 = 'P'; $r5r = '本次审计已记录'

    # 6-路由（知识位置检查—禁止写入的路径不能有内容）
    $r6 = $true
    $r6issues = @()
    if (Test-Path "$vault\Claude记忆") { $r6issues += 'Claude记忆/ 已废弃但还存在'; $r6 = $false }
    $wrongRoot = @(Get-ChildItem "$vault\*.md" | Where-Object {
        $_.Name -notmatch '^(CLAUDE|constitution|AGENTS|VERSION)\.md$'
    })
    if ($wrongRoot.Count -gt 0) {
        $r6issues += "根目录含 $($wrongRoot.Count) 个非系统md文件: $($wrongRoot.Name -join ', ')"
        $r6 = $false
    }
    $r6r = if ($r6) { '知识位置正确 · 路由合规' } else { $r6issues -join '; ' }

    # 7-活力（死代码检查—无人调用的脚本标记）
    $r7 = 'P'
    $r7issues = @()
    $scripts = Get-ChildItem "$vault\vault-scripts\*.ps1", "$vault\vault-scripts\*.js"
    $allScriptNames = $scripts.Name
    # 2026-08-11 修复（判断#164）：活工具索引/hooks/settings 是真实引用源——之前只扫脚本+CLAUDE.md，21个已登记活工具全误报孤儿
    $extraRefsStr = ''
    $extraRefs = @()
    $indexRaw = Read-File "$vault\vault-scripts\_tools-index.md"; if ($indexRaw) { $extraRefs += $indexRaw }
    $hookRaw = Read-File "$vault\.claude\hooks\gate-check.sh"; if ($hookRaw) { $extraRefs += $hookRaw }
    $observeRaw = Read-File "$vault\.claude\hooks\observe.sh"; if ($observeRaw) { $extraRefs += $observeRaw }
    $settingsRaw = Read-File "$vault\.claude\settings.json"; if ($settingsRaw) { $extraRefs += $settingsRaw }
    if ($extraRefs.Count -gt 0) { $extraRefsStr = $extraRefs -join "`n" }
    foreach ($s in $scripts) {
        if ($s.Name -eq 'header.ps1') { continue }  # 被kernel引用的库
        $refs = 0
        foreach ($other in $allScriptNames) {
            if ($other -eq $s.Name) { continue }
            $otherContent = Read-File "$vault\vault-scripts\$other"
            if ($otherContent -and $otherContent -match [regex]::Escape($s.Name)) { $refs++ }
        }
        # Also check CLAUDE.md
        $claudeRaw = Read-File "$vault\CLAUDE.md"
        if ($claudeRaw -and $claudeRaw -match [regex]::Escape($s.Name)) { $refs++ }
        # 活工具索引/hooks/settings 引用（2026-08-11 补）
        if ($extraRefsStr -and $extraRefsStr -match [regex]::Escape($s.Name)) { $refs++ }
        if ($refs -eq 0) {
            $r7issues += "$($s.Name) 无人引用"
            $r7 = 'W'
        }
    }
    $r7r = if ($r7 -eq 'P') { '所有脚本均有引用' } else { $r7issues -join '; ' }

    # 8-永久：C08永久修复机制审计
    $r8 = $true
    $r8issues = @()
    $fixFile = Read-File "$vault\vault-data\permanent-fixes.md"
    if ($fixFile -match '待完善|⚠️|❌') { $r8issues += '永久修复有待完善项'; $r8 = $false }
    $gitTag = & git -C $vault describe --tags --abbrev=0 2>$null
    if ($gitTag) {
        $vmContent = Read-File "$vault\VERSION.md"
        if ($vmContent -match '## 当前：v(\S+)') {
            $verFile = "v$($matches[1])"
            if ($verFile -ne $gitTag) { $r8issues += "版本不一致: VERSION.md=$verFile tag=$gitTag"; $r8 = $false }
        }
    }
    $r8r = if ($r8) { '永久机制健全' } else { $r8issues -join '; ' }

    # 9-产出验证：检查上次会话是否完成产出验证
    $r9 = $false; $r9r = '未检查'
    $sessFile = "$vault\vault-scripts\session-record.json"
    if (Test-Path $sessFile) {
        try {
            $sessData = Get-Content $sessFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($sessData.sessions -and $sessData.sessions.Count -gt 0) {
                # 由内而外(2026-09-12)：取最后一条真实会话(非auto_generated)判定产出验证，
                # 口径同 settle-session.ps1:199；避免每日 auto 占位挤到末位导致门永远红灯
                $lastReal = @($sessData.sessions | Where-Object { $_ -and -not $_.auto_generated })
                $lastSess = if ($lastReal.Count -gt 0) { $lastReal[-1] } else { $sessData.sessions[-1] }
                if ($lastSess.产出验证 -eq $true) { $r9 = $true; $r9r = '上次会话已通过' }
                else { $r9r = '上次会话产出验证缺失' }
        } else { $r9r = '无会话记录' }
    } catch { $r9r = '读取失败' }
} else { $r9r = '无会话文件' }

# 10-系统文件合规：检测是否有系统文件绕过升级流程被修改
$r10 = $true; $r10r = '合规'
$sysFiles = @("constitution.md","CLAUDE.md","AGENTS.md","VERSION.md")
$upgradeAuth = "$vault\vault-data\.upgrade-auth"
try {
    $modified = git -C $vault diff --name-only HEAD 2>$null
    if ($modified) {
        $violations = @()
        foreach ($sf in $sysFiles) {
            $matched = $modified | Where-Object { $_ -match [regex]::Escape($sf) }
            foreach ($m in $matched) { $violations += $m }
        }
        if ($violations.Count -gt 0 -and -not (Test-Path $upgradeAuth)) {
            $r10 = $false; $r10r = "绕过升级: $($violations -join ', ')"
        }
    }
} catch {}

    $allPass = ($r1 -and $r2 -and $r3 -and $r9 -and $r10)
    return @{
        items = @(
            @{n='资源';   tag='1'; status=if($r1){'P'}else{'F'}; detail=$r1r}
            @{n='发现';   tag='2'; status=if($r2){'P'}else{'F'}; detail=$r2r}
            @{n='应对';   tag='3'; status=if($r3){'P'}else{'F'}; detail=$r3r}
            @{n='系统';   tag='4'; status=$r4; detail=$r4r}
            @{n='执行';   tag='5'; status=$r5; detail=$r5r}
            @{n='路由';   tag='6'; status=if($r6){'P'}else{'F'}; detail=$r6r}
            @{n='活力';   tag='7'; status=$r7; detail=$r7r}
            @{n='永久';   tag='8'; status=if($r8){'P'}else{'I'}; detail=$r8r}
            @{n='产出验证'; tag='9'; status=if($r9){'P'}else{'F'}; detail=$r9r}
            @{n='文件合规'; tag='10'; status=if($r10){'P'}else{'F'}; detail=$r10r}
        )
        allPass  = $allPass
        repeats  = $repeats
        pending  = $pending
        gitUncommitted = $d.gitUncommitted
        lastJudge= $d.lastJudge
        hubOk    = $hubOk
        sessDate = $lastSessDate
    }
}

# ═══════════════════════════════════════════════
# 内核状态管理
# ═══════════════════════════════════════════════

function Get-State {
    if (Test-Path $stateFile) {
        try { return Get-Content $stateFile -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { throw "内核状态文件存在但无法解析，拒绝按未初始化处理或覆盖：$stateFile；$($_.Exception.Message)" }
    }
    return $null
}

function New-State {
    $s = @{session=$today; status='active'; focus='entry'; entry_status=$null; steps=@(); cards=@(); history=@(); gate_audit=$null; updated_at=$now}
    for ($i=0; $i -le 5; $i++) { $s.steps += if ($i -eq 0) { $null } else { @{status='standby'; checks=@{}} } }
    for ($i=1; $i -le 5; $i++) { foreach ($c in $stepChecks[$i]) { $s.steps[$i].checks[$c] = $false } }
    return $s
}

function Save-State($s) { $s.updated_at = $now; Write-JsonAtomic -Path $stateFile -Json ($s | ConvertTo-Json -Depth 5) }

function Get-Score { param($s)
    $base = 10
    for ($i=1; $i -le 5; $i++) { if ($s.steps[$i].status -eq 'blocked') { $base -= 2 } }
    if ($base -lt 0) { $base = 0 }
    $g = if ($base -ge 9) { 'S' } elseif ($base -ge 7) { 'A' } elseif ($base -ge 5) { 'B' } elseif ($base -ge 3) { 'C' } elseif ($base -ge 1) { 'D' } else { 'F' }
    return @{score=$base; grade=$g}
}

# ═══════════════════════════════════════════════
# 显示层（吸收自 status.ps1 仪表盘 + gate.ps1 审计 + 五步状态）
# ═══════════════════════════════════════════════

function Show-Status {
    $s = Get-State
    $vd = Get-VaultData
    Write-Host ''
    Write-Host '═══════════════════════════════════════' -ForegroundColor Cyan
    Write-Host "  $today · 系统内核 v5" -ForegroundColor Cyan
    Write-Host "  宪法已激活 · 第二篇" -ForegroundColor DarkGray
    Write-Host '───────────────────────────────────────' -ForegroundColor Cyan

    if (-not $s) {
        Write-Host '  未初始化。运行: kernel.ps1 reset' -ForegroundColor Yellow
        Write-Host '═══════════════════════════════════════' -ForegroundColor Cyan
        return
    }

    # ──── 区块1：五步循环状态 ────
    Write-Host "  入口: $(if($s.entry_status -eq 'passed'){'✅ 已通过'}else{'⏳ 待通过'})" -ForegroundColor $(if($s.entry_status -eq 'passed'){'Green'}else{'Yellow'})
    for ($i = 1; $i -le 5; $i++) {
        $st = $s.steps[$i].status
        $icon = switch ($st) { 'done' { '✅' } 'active' { '▶' } 'blocked' { '⛔' } default { '◻' } }
        $fg   = switch ($st) { 'done' { 'Green' } 'active' { 'Cyan' } 'blocked' { 'Red' } default { 'DarkGray' } }
        $mark = if ($s.focus -eq "$i") { ' ← 当前' } else { '' }
        $msg  = "  $icon $($stepLabels[$i])$mark"
        Write-Host $msg -ForegroundColor $fg
        if ($st -ne 'done' -and $st -ne 'standby') {
            $unchecked = @($stepChecks[$i] | Where-Object { -not $s.steps[$i].checks.$_ })
            if ($unchecked.Count -gt 0) {
                Write-Host "      待检: $($unchecked -join ', ')" -ForegroundColor DarkGray
            }
            # 复盘步激活时显示铸卡管线
            if ($i -eq 4) {
                Write-Host '' -ForegroundColor DarkGray
                Write-Host '    📋 铸卡管线:' -ForegroundColor Cyan
                $pipeline = @('纠偏:偏差校正','补全:缺口补完','编织:系统+关联+查重','融合:合并冲突','重构:结构重组','提纯:核心提取','语言:表达精炼','密度:收尾自检','出门:发布')
                foreach ($p in $pipeline) {
                    $pc = $p -split ':' | Select-Object -First 1
                    $done = if ($s.steps[4].checks.$pc) { '✅' } else { '□' }
                    Write-Host "    $done $p" -ForegroundColor $(if($s.steps[4].checks.$pc){'Green'}else{'DarkGray'})
                }
            }
        }
    }

    # ──── 区块2：入口审计（吸收自 gate.ps1） ────
    $audit = Invoke-GateAudit
    Write-Host '───────────────────────────────────────' -ForegroundColor Cyan
    Write-Host '  启动审计' -ForegroundColor Cyan
    foreach ($item in $audit.items) {
        $fg = switch ($item.status) { 'P' { 'Green' } 'F' { 'Red' } 'I' { 'Cyan' } 'W' { 'Yellow' } default { 'DarkGray' } }
        Write-Host "  [$($item.status)] $($item.n) → $($item.detail)" -ForegroundColor $fg
    }
    if ($audit.allPass) {
        Write-Host '  ✅ 全部通过 · 可以开始' -ForegroundColor Green
    } else {
        Write-Host '  ⛔ 未通过 · 先解决问题' -ForegroundColor Red
    }

    # Git
    Write-Host "  $($audit.gitTag) | $($vd.gitLastCommit) | 未提交:$($audit.gitUncommitted)" -ForegroundColor DarkGray

    # ──── 区块2.3：启动四读（规则#3自动执行） ────
    Write-Host '───────────────────────────────────────' -ForegroundColor Cyan
    Write-Host '  📋 启动四读' -ForegroundColor Cyan
    # ① 待回收反馈
    $fbPath = "$vault\vault-data\pending-feedback.json"
    $fbDue = 0
    if (Test-Path $fbPath) {
        try { $fb = Get-Content $fbPath -Encoding UTF8 | ConvertFrom-Json; $fbDue = ($fb.items | Where-Object { $_.status -eq 'awaiting' }).Count } catch {}
    }
    if ($fbDue -gt 0) { Write-Host "  ⏳ 有 $fbDue 条反馈待回收" -ForegroundColor Yellow }
    else { Write-Host "  ✅ 无待回收反馈" -ForegroundColor Green }
    # ② 增量原子
    $cursorPath = "$vault\vault-data\session-atom-cursor.json"
    $atomPath = "$vault\07 · 原子库\atoms.jsonl"
    $cursorAtom = ''; $totalAtoms = 0
    if (Test-Path $cursorPath) { try { $c = Get-Content $cursorPath -Encoding UTF8 | ConvertFrom-Json; $cursorAtom = $c.last_atom_id; $totalAtoms = $c.total_atoms } catch {} }
    $currentCount = 0
    if (Test-Path $atomPath) { $currentCount = (Get-Content $atomPath -Encoding UTF8 | Where-Object { $_ -ne '' }).Count }
    $delta = $currentCount - $totalAtoms
    if ($delta -gt 0) { Write-Host "  ⏳ 有 $delta 条新原子（上次读到 $cursorAtom，现有 $currentCount 条）" -ForegroundColor Yellow }
    else { Write-Host "  ✅ 无新原子（共 $currentCount 条）" -ForegroundColor Green }
    # ③ 规则绑定状态
    $rbPath = "$vault\vault-data\rule-bindings.json"
    $unbound = 0; $totalRules = 0
    if (Test-Path $rbPath) { try { $rb = Get-Content $rbPath -Encoding UTF8 | ConvertFrom-Json; $unbound = ($rb.rules | Where-Object { -not $_.bound }).Count; $totalRules = $rb.rules.Count } catch {} }
    if ($unbound -gt 0) { Write-Host "  ⏳ $totalRules 条规则中 $unbound 条未绑定机械触发器" -ForegroundColor Yellow }
    else { Write-Host "  ✅ 全部 $totalRules 条规则已绑定" -ForegroundColor Green }
    # ④ 上次沉淀检查（C07·必须有沉淀 + C11·原子为通货）
    $lastSessJudgment = $vd.lastJudge
    $todayDate = $today
    if ($lastSessJudgment -eq $todayDate) {
        Write-Host "  ✅ 上次会话有判断沉淀" -ForegroundColor Green
        if ($delta -eq 0 -and $currentCount -gt 0) { Write-Host "     原子在光标范围内——C11原子化已完成" -ForegroundColor Green }
        elseif ($delta -gt 0) { Write-Host "     有增量原子——C11原子化已完成" -ForegroundColor Green }
    } else {
        Write-Host "  ⏳ 上次会话：$lastSessJudgment——最近一次有判断的日期" -ForegroundColor Yellow
        if ($currentCount -gt 0 -and $totalAtoms -eq $currentCount) { Write-Host "     C11原子化检查通过" -ForegroundColor Green }
    }

    # ──── 区块2.5：今日例行（标准化日程） ────
    $dayOfWeek = (Get-Date).DayOfWeek
    $weekday = [int][DayOfWeek]::$dayOfWeek
    Write-Host '───────────────────────────────────────' -ForegroundColor Cyan
    Write-Host "  📋 ${dayOfWeek} · 今日例行" -ForegroundColor Cyan
    $routines = @()
    $routines += @{task='6个信号'; needed=$true; desc='每日必问'}
    if ($weekday -eq 1) { $routines += @{task='本周主要矛盾'; needed=$true; desc='周一：设周焦点'} }
    if ($weekday -eq 5) { $routines += @{task='内容反馈+提炼原则'; needed=$true; desc='周五：cron待触发'} }
    # 检查哪些已记录到信号文件
    $signalDone = if ($todaySignals) { $todaySignals.已过入口 -eq '是' } else { $false }
    $focusDone = if ($vd.focus -and $vd.focus.focus) { $vd.focus.focus -ne '' } else { $false }
    foreach ($r in $routines) {
        $done = switch ($r.task) {
            '6个信号' { $signalDone }
            '本周主要矛盾' { $focusDone }
            '内容反馈+提炼原则' { $false }
            default { $false }
        }
        $icon = if ($done) { '✅' } else { '⏳' }
        Write-Host "  $icon $($r.task)" -ForegroundColor $(if($done){'Green'}else{'Yellow'})
        Write-Host "      $($r.desc)" -ForegroundColor DarkGray
    }

    # ──── 区块3：本周焦点 + 信号（吸收自 status.ps1） ────
    Write-Host '───────────────────────────────────────' -ForegroundColor Cyan
    Write-Host '  📌 本周焦点' -ForegroundColor Cyan
    if ($vd.focus) {
        Write-Host "  主要矛盾: $($vd.focus.focus)" -ForegroundColor Yellow
        if ($vd.focus.taleb_risk) { Write-Host "  ⚠ 风险: $($vd.focus.taleb_risk)" -ForegroundColor Magenta }
    } else {
        Write-Host '  未设定' -ForegroundColor DarkGray
    }

    $dateStr = $today; $dayOfWeek = (Get-Date).DayOfWeek
    $allSignals = $vd.signals
    $todaySignals = $null
    if ($allSignals -and (Get-Member -InputObject $allSignals -Name $dateStr)) { $todaySignals = $allSignals.$dateStr }
    Write-Host '  🚦 今日信号' -ForegroundColor Cyan
    if ($todaySignals) {
        $triggered = @($todaySignals.PSObject.Properties | Where-Object { $_.Name -ne 'date' -and $_.Value -eq '是' } | ForEach-Object { $_.Name })
        if ($triggered.Count -eq 0) { Write-Host '  ✅ 全部正常' -ForegroundColor Green }
        else { foreach ($t in $triggered) { Write-Host "  ⚠ $t" -ForegroundColor Red } }
    } else {
        Write-Host '  尚未检查' -ForegroundColor DarkGray
    }

    # ──── 区块4：原则 + 内容反馈 ────
    Write-Host '  📚 原则库' -ForegroundColor Cyan
    if ($vd.principles -and $vd.principles.Count -gt 0) {
        $last = $vd.principles[-1]; Write-Host "  共 $($vd.principles.Count) 条 · 最新: $($last.principle)" -ForegroundColor Yellow
    } else { Write-Host '  暂无' -ForegroundColor DarkGray }

    Write-Host '  📊 内容反馈' -ForegroundColor Cyan
    if ($vd.feedback -and $vd.feedback.Count -gt 0) {
        $hasData = $vd.feedback | Where-Object { $_.views -ne $null }
        if ($hasData.Count -eq 0) { Write-Host '  已发布但尚无数据' -ForegroundColor DarkGray }
        else { foreach ($f in $hasData) { Write-Host "  $($f.platform): $($f.views)次浏览" -ForegroundColor DarkGray } }
    } else { Write-Host '  暂无' -ForegroundColor DarkGray }

    # ──── 区块5：评分 ────
    $sc = Get-Score $s
    $bar = '█' * [math]::Round($sc.score/2) + '░' * (5 - [math]::Round($sc.score/2))
    Write-Host '───────────────────────────────────────' -ForegroundColor Cyan
    Write-Host "  评分: $($sc.score)/10 [$($sc.grade)]  $bar" -ForegroundColor $(if ($sc.score -ge 7) { 'Green' } elseif ($sc.score -ge 4) { 'Yellow' } else { 'Red' })

    if ($s.history.Count -gt 0) {
        Write-Host "  最新: $($s.history[-1].action)" -ForegroundColor DarkGray
    }
    Write-Host '═══════════════════════════════════════' -ForegroundColor Cyan
}

function Show-Friendly {
    $s = Get-State; if (-not $s) { Write-Host '未初始化' -ForegroundColor Yellow; return }
    $d = 0; $a = 0; $b = 0
    for ($i = 1; $i -le 5; $i++) { $st = $s.steps[$i].status; if ($st -eq 'done') { $d++ } elseif ($st -eq 'active') { $a++ } elseif ($st -eq 'blocked') { $b++ } }
    $sc = Get-Score $s
    Write-Host ">> 焦点: $($s.focus) | 步骤: $d 完成 / $a 活跃 / $b 阻塞 | 评分: $($sc.score)/10 ($($sc.grade))" -ForegroundColor Cyan
}

function Show-Score {
    $s = Get-State; if (-not $s) { Write-Host '无状态' -ForegroundColor Yellow; return }
    $sc = Get-Score $s
    Write-Host ''; Write-Host '  ═══ 评分 ═══' -ForegroundColor Cyan
    Write-Host "  $($sc.score)/10 [$($sc.grade)]" -ForegroundColor $(if ($sc.score -ge 7) { 'Green' } elseif ($sc.score -ge 4) { 'Yellow' } else { 'Red' })
    $bar = '█' * [math]::Round($sc.score) + '░' * (10 - [math]::Round($sc.score))
    Write-Host "  $bar" -ForegroundColor $(if ($sc.score -ge 7) { 'Green' } else { 'Red' })
    Write-Host '  ═══' -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════
# 宪法门（宪法规则强制执行点）
# ═══════════════════════════════════════════════

# ═══════════════════════════════════════════════
# 会话记录自动写入（解决根因：session-record.json无人写）
# ═══════════════════════════════════════════════

function Write-SessionRecord {
    $sessFile = "$vault\vault-scripts\session-record.json"
    $sess = Read-Json $sessFile
    if (-not $sess) { $sess = @{sessions=@()} }
    if (-not $sess.sessions) { $sess.sessions = @() }

    $hasToday = $sess.sessions | Where-Object { $_.date -eq $today }
    if (-not $hasToday) {
        $judgeRaw = Read-File "$vault\vault-scripts\judgment-log.md"
        $latestJudge = ''
        if ($judgeRaw) {
            # 契约(2026-08-11)：## 日期 — 标题 段；旧表格行兜底
            $jd = @()
            foreach ($line in ($judgeRaw -split "`n")) {
                if ($line -match '^##\s+(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$') { $jd += "$($Matches[1]) $($Matches[2].Trim())" }
                elseif ($line -match '^\|\s*\d+\s*\|.*?(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|') { $jd += "$($Matches[1]) $($Matches[2].Trim())" }
            }
            if ($jd.Count -gt 0) { $latestJudge = $jd[-1] }
        }
        # 不覆盖，只追加
        $sess.sessions = @($sess.sessions) + @(@{
            date = $today
            start_time = (Get-Date -Format 'HH:mm')
            one_thing = ''
            one_thing_done = $false
            key_judgment_change = $latestJudge
            ai_errors = 0
        })
        Write-JsonAtomic -Path $sessFile -Json ($sess | ConvertTo-Json -Depth 5)
    }
}

function Invoke-ConstitutionGate {
    $results = @()
    $allPass = $true

    # 检查1：整合优先于添加（新增文件必须有对应删除）
    try {
        $porcelain = git -C $vault status --porcelain 2>$null
        $added  = @($porcelain | Where-Object { $_ -match '^\?\?' })
        $deleted = @($porcelain | Where-Object { $_ -match '^ D' -or $_ -match '^D ' -or $_ -match '^!!' })
        $netAdd = $added.Count - $deleted.Count
        if ($netAdd -gt 0) {
            $results += @{check='整合优先于添加'; status='F'; detail="新增 $($added.Count) 文件 · 删除 $($deleted.Count) · 净增 $netAdd"; line='新增一个文件必须先删一个旧文件'}
            $allPass = $false
        } else {
            $results += @{check='整合优先于添加'; status='P'; detail="净增 $netAdd（新增 $($added.Count) / 删除 $($deleted.Count)）"}
        }
    } catch {
        $results += @{check='整合优先于添加'; status='?'; detail="git 检查失败: $_"}
    }

    # 检查2：能运行（写了不算，跑了才算）
    $auditFile = "$vault\vault-scripts\gate-audit.json"
    if (Test-Path $auditFile) {
        try {
            $auditJson = Get-Content $auditFile -Encoding UTF8 | ConvertFrom-Json
            $auditDate = $auditJson.date
            if ($auditDate -eq $today) {
                $results += @{check='能运行'; status='P'; detail="审计已跑 · $today"}
            } else {
                $results += @{check='能运行'; status='F'; detail="审计记录最后日期: $auditDate，非今日"; line='写了不算，跑了才算'}
                $allPass = $false
            }
        } catch {
            $results += @{check='能运行'; status='F'; detail="审计文件无法解析"; line='写了不算，跑了才算'}
            $allPass = $false
        }
    } else {
        $results += @{check='能运行'; status='F'; detail="无审计记录"; line='写了不算，跑了才算'}
        $allPass = $false
    }

    # 检查3：出口指向统一（CLAUDE.md 引用单入口）
    $claudeFile = "$vault\CLAUDE.md"
    if (Test-Path $claudeFile) {
        $claude = [System.IO.File]::ReadAllText($claudeFile, $utf8)
        $hasKernelRef = $claude -match 'kernel\.ps1' -or $claude -match 'kernel ps1'
        $hasSingleEntry = ($claude -match '单入口' -or $claude -match '唯一入口' -or $claude -match '统一入口')
        if ($hasKernelRef -and $hasSingleEntry) {
            $results += @{check='出口指向统一'; status='P'; detail='CLAUDE.md 指向 kernel 单入口'}
        } elseif ($hasKernelRef) {
            $results += @{check='出口指向统一'; status='W'; detail='CLAUDE.md 有 kernel 引用但未明确单入口'; line='系统只有一个入口'}
            $allPass = $false
        } else {
            $results += @{check='出口指向统一'; status='F'; detail='CLAUDE.md 未引用 kernel 入口'; line='系统只有一个入口'}
            $allPass = $false
        }
    } else {
        $results += @{check='出口指向统一'; status='?'; detail='CLAUDE.md 不存在'}
    }

    return @{results=$results; allPass=$allPass}
}

function Show-ConstitutionGate {
    $cg = Invoke-ConstitutionGate
    Write-Host ''
    Write-Host '  ═══ 宪法门 ═══' -ForegroundColor Cyan
    foreach ($r in $cg.results) {
        $fg = switch ($r.status) { 'P' { 'Green' } 'F' { 'Red' } 'W' { 'Yellow' } default { 'DarkGray' } }
        Write-Host "  [$($r.status)] $($r.check)" -ForegroundColor $fg
        Write-Host "       $($r.detail)" -ForegroundColor $fg
        if ($r.line) { Write-Host "       ⚖ 宪法: $($r.line)" -ForegroundColor DarkGray }
    }
    if ($cg.allPass) {
        Write-Host '  ✅ 宪法门通过 · 遵守宪法' -ForegroundColor Green
    } else {
        Write-Host '  ⛔ 宪法门未通过 · 先修正' -ForegroundColor Red
    }
    Write-Host '  ═══' -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════
# 入口 + 五步控制（审计门 + 宪法门）
# ═══════════════════════════════════════════════

function Set-Entry {
    $s = Get-State; if (-not $s) { Write-Host '无状态' -ForegroundColor Yellow; return }

    if ($arg1 -eq 'pass') {
        # 第零关：钥匙门（检查 .gate-passed 文件）
        $keyFile = "$vault\vault-data\.gate-passed"
        if (-not (Test-Path $keyFile)) {
            Write-Host '⛔ 钥匙门未通过：.gate-passed 文件不存在。' -ForegroundColor Red
            Write-Host '   创建钥匙：echo 同意 > D:\Vault\vault-data\.gate-passed' -ForegroundColor Yellow
            $s.entry_status = 'blocked'
            $s.history += @{at=$now; action='entry blocked by key gate'}
            Save-State $s
            return
        }
        # 第一关：审计门
        $audit = Invoke-GateAudit
        if (-not $audit.allPass) {
            Write-Host '⛔ 审计门未通过，入口阻塞。' -ForegroundColor Red
            $s.entry_status = 'blocked'
            $s.history += @{at=$now; action='entry blocked by audit'}
            Save-State $s
            return
        }
        # 第二关：宪法门
        $cg = Invoke-ConstitutionGate
        if (-not $cg.allPass) {
            Write-Host '⛔ 宪法门未通过，入口阻塞。' -ForegroundColor Red
            Show-ConstitutionGate
            $s.entry_status = 'blocked'
            $s.history += @{at=$now; action='entry blocked by constitution'}
            Save-State $s
            return
        }
        # 双门全过
        $s.entry_status = 'passed'
        $s.focus = '1'
        $s.steps[1].status = 'active'
        $s.history += @{at=$now; action='entry passed'}
        Write-SessionRecord  # 自动写今日会话记录
        Save-State $s
        Write-Host '✅ 审计门通过 · 宪法门通过 · 入口通过 → 步骤1（发现）' -ForegroundColor Green
        return
    }

    if ($arg1 -eq 'fail') {
        $s.entry_status = 'blocked'
        $s.history += @{at=$now; action='entry blocked'}
        Save-State $s
        Write-Host '⛔ 入口阻塞' -ForegroundColor Red
        return
    }

    if ($arg1 -eq 'audit') {
        $audit = Invoke-GateAudit
        foreach ($item in $audit.items) {
            $fg = switch ($item.status) { 'P' { 'Green' } 'F' { 'Red' } 'I' { 'Cyan' } default { 'DarkGray' } }
            Write-Host "  [$($item.status)] $($item.n) → $($item.detail)" -ForegroundColor $fg
        }
        Write-Host "  综合: $(if($audit.allPass){'✅ 通过'}else{'⛔ 阻塞'})" -ForegroundColor $(if($audit.allPass){'Green'}else{'Red'})
        return
    }

    if ($arg1 -eq 'constitution') {
        Show-ConstitutionGate
        return
    }

    Write-Host '用法: kernel.ps1 entry pass|fail|audit|constitution' -ForegroundColor Cyan
}

function Set-Step {
    $s = Get-State; if (-not $s) { Write-Host '无状态' -ForegroundColor Yellow; return }
    $n = [int]$arg2; if ($n -lt 1 -or $n -gt 5) { Write-Host '步骤 1-5' -ForegroundColor Yellow; return }

    if ($arg1 -eq 'pass') {
        foreach ($c in $stepChecks[$n]) { $s.steps[$n].checks.$c = $true }
        $s.steps[$n].status = 'done'
        $next = $n + 1
        if ($next -le 5) { $s.focus = "$next"; $s.steps[$next].status = 'active' }
        else { $s.focus = 'entry'; $s.entry_status = $null; for ($i=1; $i -le 5; $i++) { $s.steps[$i].status = 'standby'; foreach ($c in $stepChecks[$i]) { $s.steps[$i].checks.$c = $false } }; $s.history += @{at=$now; action='五步循环完成·回到入口'}; Write-SessionRecord }
        $s.history += @{at=$now; action="步骤$n 完成"}
        Save-State $s
        Write-Host "✅ 步骤 $n ($($stepLabels[$n])) 完成" -ForegroundColor Green
    } elseif ($arg1 -eq 'warn') {
        $s.steps[$n].status = 'active'
        $s.history += @{at=$now; action="步骤$n 警告"}
        Save-State $s
        Write-Host "⚠ 步骤 $n 警告" -ForegroundColor Yellow
    } elseif ($arg1 -eq 'fail') {
        $s.steps[$n].status = 'blocked'
        $s.history += @{at=$now; action="步骤$n 阻塞"}
        Save-State $s
        Write-Host "⛔ 步骤 $n 阻塞" -ForegroundColor Red
    } else { Write-Host '用法: kernel.ps1 step pass|warn|fail N' -ForegroundColor Cyan }
}

# ═══════════════════════════════════════════════
# 铸卡 + 技能 + 升级 + 内容引擎
# ═══════════════════════════════════════════════

function Show-Forge {
    Write-Host ''; Write-Host '  ═══ 铸卡 ═══' -ForegroundColor Cyan
    Write-Host '  /forge       — 从素材铸卡' -ForegroundColor Cyan
    Write-Host '  /iterate     — 更新卡片' -ForegroundColor Cyan
    Write-Host '  /upgrade     — 升级等级' -ForegroundColor Cyan
    Write-Host '  /eval        — 健康检查' -ForegroundColor Cyan
    Write-Host '  backlink     — 回链: kernel backlink "卡路径"' -ForegroundColor Cyan
    Write-Host '  四铁律: 原子 | 可行动 | 可证伪 | 诚实' -ForegroundColor Yellow
    Write-Host '  ═══' -ForegroundColor Cyan
}

function Show-Skills {
    Write-Host ''; Write-Host '  ═══ 技能库 ═══' -ForegroundColor Cyan
    $dir = Get-ChildItem "$vault" -Directory -Filter '02*' | Select-Object -First 1
    if ($dir) {
        $files = Get-ChildItem $dir.FullName -Filter '*.md' -Recurse | Sort-Object LastWriteTime -Descending
        if ($files.Count -eq 0) { Write-Host '  暂无技能' -ForegroundColor DarkGray } else { foreach ($f in $files) { Write-Host "  $($f.LastWriteTime.ToString('MM-dd'))  $($f.BaseName)" -ForegroundColor DarkGray } }
    } else { Write-Host '  无技能目录' -ForegroundColor DarkGray }
    Write-Host '  ═══' -ForegroundColor Cyan
}

function Show-NextContent {
    # 吸收自 gate.ps1 -nextContent
    $d = Get-VaultData
    Write-Host ''
    Write-Host '  ═══ 内容选题建议 ═══' -ForegroundColor Cyan
    Write-Host "  $today" -ForegroundColor DarkGray
    Write-Host ''

    $suggestions = @()

    # 源1: 高分原子（近7天）
    $atomFile = "$vault\07 · 原子库\atoms.jsonl"
    if (Test-Path $atomFile) {
        $recentAtoms = Get-Content -Encoding UTF8 $atomFile | ForEach-Object {
            try { $_ | ConvertFrom-Json } catch { $null }
        } | Where-Object { $_ -and $_.created -ge (Get-Date).AddDays(-7).ToString('yyyy-MM-dd') -and $_.score -ge 3 } | Sort-Object score -Descending | Select-Object -First 3
        foreach ($a in $recentAtoms) {
            $suggestions += @{source = "原子库 (s=$($a.score))"; topic = $a.core; domain = $a.domain }
        }
    }

    # 源2: 近期领域卡片
    $domainDir = "$vault\02-Areas · 资产"
    if (Test-Path $domainDir) {
        $recentCards = Get-ChildItem -Recurse -Path $domainDir -Filter '*.md' | Where-Object { $_.LastWriteTime -ge (Get-Date).AddDays(-7) } | Sort-Object LastWriteTime -Descending | Select-Object -First 5
        foreach ($card in $recentCards) {
            $c = [IO.File]::ReadAllText($card.FullName, $utf8)
            $title = if ($c -match '^# (.+)') { $matches[1].Trim() } else { '' }
            $core = ''
            $sections = $c -split "`n## "
            foreach ($sec in $sections) { if ($sec -match '^核心判断\s*(.+?)(?=`n|$)') { $core = $matches[1].Trim() -replace '（.+?）','' -replace '_',''; if ($core.Length -gt 60) { $core = $core.Substring(0,60) + '..' }; break } }
            $relPath = $card.FullName.Replace($vault,'').TrimStart('\')
            $suggestions += @{source = "领域卡片: $relPath"; topic = if ($core) { "$title - $core" } else { $title }; domain = '' }
        }
    }

    # 源3: 最新判断（契约 2026-08-11：## 日期 — 标题 段）
    $judgeRaw = Read-File "$vault\vault-scripts\judgment-log.md"
    if ($judgeRaw) {
        $lastHeading = @($judgeRaw -split "`n" | ForEach-Object {
            if ($_ -match '^##\s+(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$') { "$($Matches[1]) $($Matches[2].Trim())" }
        })
        if ($lastHeading.Count -gt 0) {
            $suggestions += @{source = "判断日志（最新）"; topic = $lastHeading[-1]; domain = '' }
        }
    }

    # 去重 + 选3
    $seen = @{}; $deduped = @()
    foreach ($s in $suggestions) { $key = if ($s.topic.Length -ge 20) { $s.topic.Substring(0,20) } else { $s.topic }; if (-not $seen.ContainsKey($key)) { $seen[$key] = $true; $deduped += $s } }
    $selected = @(); $domains = @{}
    foreach ($s in $deduped) { if ($selected.Count -ge 3) { break }; if ($s.domain -and $domains.ContainsKey($s.domain)) { continue }; if ($s.domain) { $domains[$s.domain] = $true }; $selected += $s }
    foreach ($s in $deduped) { if ($selected.Count -ge 3) { break }; $found = $selected | Where-Object { $_.topic -eq $s.topic }; if (-not $found) { $selected += $s } }

    if ($selected.Count -eq 0) {
        Write-Host '  没有可生成选题的系统资产。多积累原子和领域卡片。' -ForegroundColor Yellow
    } else {
        for ($i = 0; $i -lt $selected.Count; $i++) {
            $s = $selected[$i]
            Write-Host "  [$($i+1)] $($s.topic)" -ForegroundColor Green
            Write-Host "    ← $($s.source)" -ForegroundColor DarkGray
            if ($s.domain) { Write-Host "    领域: $($s.domain)" -ForegroundColor DarkGray }
            Write-Host ''
        }
    }

    # 反馈状态
    if ($d.feedback -and $d.feedback.Count -gt 0) {
        $hasData = $d.feedback | Where-Object { $_.views -ne $null }
        if ($hasData) {
            Write-Host '  你有内容反馈数据未消化' -ForegroundColor Yellow
            foreach ($f in $hasData) { Write-Host "  $($f.platform): $($f.card) - views:$($f.views) likes:$($f.likes)" -ForegroundColor DarkGray }
        } else {
            Write-Host "  已发布 $($d.feedback.Count) 条内容，暂无反馈数据" -ForegroundColor DarkGray
        }
    }
    Write-Host '  ═══' -ForegroundColor Cyan
}

function Reset-Kernel {
    Remove-Item $stateFile -ErrorAction SilentlyContinue
    $s = New-State; Save-State $s
    Write-Host '✅ 内核已重置' -ForegroundColor Green
}

function Invoke-Collide {
    # 吸收自旧版 judge.py 碰撞引擎
    # 从管道或参数读取内容 → 调用 judge.py --role strategist 补充视角
    $content = $arg1
    if (-not $content) {
        $content = @($input) -join "`n"
    }
    # 支持 @文件路径 语法（解决跨shell中文编码问题）
    if ($content -and $content.StartsWith('@')) {
        $filePath = $content.Substring(1)
        if (Test-Path $filePath) {
            $content = [System.IO.File]::ReadAllText($filePath, (New-Object System.Text.UTF8Encoding($false)))
        } else {
            Write-Host "  ⚠️ 文件不存在: $filePath" -ForegroundColor Yellow
            return
        }
    }
    if (-not $content -or $content.Trim() -eq '') {
        Write-Host '  ⚠️ 没有输入内容。用法: echo "你的分析" | kernel collide' -ForegroundColor Yellow
        Write-Host '    或: kernel collide "你的分析判断"' -ForegroundColor DarkGray
        Write-Host '    或: kernel collide @文件路径  (解决跨shell中文编码问题)' -ForegroundColor DarkGray
        return
    }
    $judgePath = "$vault\vault-scripts\judge.py"
    if (-not (Test-Path $judgePath)) {
        Write-Host '  ⚠️ judge.py 不存在' -ForegroundColor Yellow
        return
    }
    $envFile = "$vault\vault-scripts\.env.judge"
    if (-not (Test-Path $envFile)) {
        Write-Host '  ⚠️ .env.judge 未配置，无法调用 API' -ForegroundColor Yellow
        Write-Host '  请创建 vault-scripts/.env.judge 填入 API Key（参考 README）' -ForegroundColor DarkGray
        return
    }
    Write-Host ''
    Write-Host '  ═══ 碰撞引擎 · 军师视角 ═══' -ForegroundColor Cyan
    Write-Host "  $today" -ForegroundColor DarkGray
    Write-Host ''

    # 运行 judge.py（用 python，Windows 上 python3 可能不存在）
    # 用临时文件 --file 参数传递中文内容（解决 PowerShell 管道编码损坏问题）
    $pythonCmd = if (Get-Command 'python3' -ErrorAction SilentlyContinue) { 'python3' } else { 'python' }
    $tempInput = [System.IO.Path]::GetTempFileName() + ".txt"
    [System.IO.File]::WriteAllText($tempInput, $content, (New-Object System.Text.UTF8Encoding($false)))
    $result = & $pythonCmd $judgePath --role strategist --file $tempInput 2>&1
    Remove-Item $tempInput -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
        Write-Host "  ⚠️ 碰撞调用失败: $result" -ForegroundColor Red
        return
    }
    try {
        $parsed = $result | ConvertFrom-Json
        $score = $parsed.score
        $issues = $parsed.issues
        $summary = $parsed.summary
        $model = if ($parsed._used_model) { " · 模型: $($parsed._used_model)" } else { '' }

        Write-Host "  评分: $score/10$model" -ForegroundColor $(if($score -ge 7){'Green'}elseif($score -ge 4){'Yellow'}else{'Red'})
        Write-Host "  总评: $summary" -ForegroundColor White
        Write-Host ''
        if ($issues -and $issues.Count -gt 0) {
            Write-Host '  发现的盲区：' -ForegroundColor Cyan
            for ($i = 0; $i -lt $issues.Count; $i++) {
                $iss = $issues[$i]
                Write-Host "  [$($i+1)] $($iss.type): $($iss.detail)" -ForegroundColor Yellow
                if ($iss.quote) { Write-Host "      原文: $($iss.quote)" -ForegroundColor DarkGray }
                Write-Host ''
            }
        }
        if ($parsed._degraded) {
            Write-Host '  ⚠️ 模型已降级（付费→免费）' -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  ⚠️ 解析碰撞结果失败: $_" -ForegroundColor Red
        Write-Host "  原始输出:" -ForegroundColor DarkGray
        $result | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }
    Write-Host '  ═══' -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════
# 天团：一键调全角色+综合报告
# ═══════════════════════════════════════════════

# 共享契约校验（2026-08-10 MAJOR 根治）：judge.py 输出按 vault-data/judge-output-schema.json 校验，
# 防形状漂移静默吞结果（v1.61.0 根因：单角色无 members vs 显示层只认 members）。
function Test-JudgeOutput {
    param($result)
    if (-not $result) { return @('result-null') }
    $schemaPath = "$vault\vault-data\judge-output-schema.json"
    if (-not (Test-Path $schemaPath)) { return @() }
    try { $schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return @() }
    $missing = @($schema.required | Where-Object { -not ($result.PSObject.Properties.Name -contains $_) })
    return $missing
}

function Invoke-ThinkTank {
    $content = $arg1
    if (-not $content) { $content = @($input) -join "`n" }
    if ($content -and $content.StartsWith('@')) {
        $fp = $content.Substring(1)
        if (Test-Path $fp) { $content = [System.IO.File]::ReadAllText($fp, (New-Object System.Text.UTF8Encoding($false))) }
        else { Write-Host '  ⚠️ 文件不存在' -ForegroundColor Yellow; return }
    }
    if (-not $content -or $content.Trim() -eq '') {
        Write-Host '  用法: kernel thinktank "分析内容" 或 kernel thinktank @输入文件' -ForegroundColor Cyan; return
    }

    $judgePath = "$vault\vault-scripts\judge.py"
    $pythonCmd = if (Get-Command 'python3' -ErrorAction SilentlyContinue) { 'python3' } else { 'python' }
    $tempInput = [System.IO.Path]::GetTempFileName() + ".txt"
    [System.IO.File]::WriteAllText($tempInput, $content, (New-Object System.Text.UTF8Encoding($false)))

    $results = @{}
    $roles = @(
        @{role='team'; name='天团9模型'; emoji='🧠'},
        @{role='audit'; name='审计'; emoji='✅'},
        @{role='justice'; name='大法官'; emoji='⚖️'}
    )

    Write-Host ''; Write-Host '  ═══ 天团研判（并行） ═══' -ForegroundColor Cyan
    Write-Host "  $today · 9模型天团: DeepSeek/智谱/MiniMax/Kimi/Doubao/Qwen/Agnes/日日新/Ollama" -ForegroundColor DarkGray

    # 并行启动三个角色
    $jobs = @()
    foreach ($r in $roles) {
        Write-Host "  ── $($r.emoji) $($r.name) 研判中..." -ForegroundColor Yellow
        $job = Start-Job -ScriptBlock {
            param($path, $py, $role, $inputFile)
            # 判#1222 根治吞错（统一失败语义标准首个实例）：旧 `2>$null` 把子任务 stderr 全丢→拿不到 JSON 时冒报「无结果/0票」
            #   （实测直连 judge.py 能出 8 真票=壳子坏非天团坏）。分离 stdout(JSON)/stderr(错)：正常路照解，失败时把真错交回上层显式报，禁止冒充「没有」。
            $raw = & $py $path --role $role --file $inputFile 2>&1
            $errTxt = ($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | Out-String)
            $jsonTxt = ($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | Out-String)
            return [pscustomobject]@{ json = $jsonTxt; err = $errTxt }
        } -ArgumentList $judgePath, $pythonCmd, $r.role, $tempInput
        $jobs += @{role=$r.name; job=$job}
    }
    # 等待全部完成，不限时
    $jobs | ForEach-Object { $_.job | Wait-Job | Out-Null }
    foreach ($j in $jobs) {
        $obj = Receive-Job -Job $j.job
        $raw = if ($obj -is [pscustomobject] -and $obj.PSObject.Properties['json']) { $obj.json } else { ($obj | Out-String) }
        try { $json = $raw | ConvertFrom-Json; $results[$j.role] = $json }
        catch {
            # 判#1222 fail-loud：拿不到有效裁决时露出壳子/调用真错，禁止只报「调用失败」冒充「天团0票」
            $e = ''
            if ($obj -is [pscustomobject] -and $obj.PSObject.Properties['err']) { $e = (($obj.err -split "`n" | Where-Object { $_ -and $_ -notmatch '绕过系统入口|NativeCommandError|CategoryInfo|FullyQualified|At line|\+\+\+|\+ ~|^\s*$' } | Select-Object -First 3) -join ' | ') }
            Write-Host "  ⚠️ $($j.role): 壳子未获有效裁决（非天团投 0 票·真错见下）$e" -ForegroundColor Red
        }
        Remove-Job -Job $j.job -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $tempInput -ErrorAction SilentlyContinue

    Write-Host ''; Write-Host '  ═══ 天团结论 ═══' -ForegroundColor Cyan

    # 显示天团9模型（team 格式：members[]）
    $team = $results['天团9模型']
    $audit = $results['审计']
    $justice = $results['大法官']

    if ($team -and $team.members) {
        $available = $team.members | Where-Object { $_ -and -not $_._no_result }
        Write-Host "  🧠 天团9模型（${($available.Count)}/$total个可用）" -ForegroundColor Cyan
        foreach ($m in $available) {
            $icon = if ($m.pass) { '✅' } else { '⚠️' }
            Write-Host "     $icon $($m.name): $($m.score)/10" -ForegroundColor $(if ($m.score -ge 7){'Green'}elseif($m.score -ge 4){'Yellow'}else{'Red'})
            if ($m.summary) { Write-Host "        ↳ $($m.summary)" -ForegroundColor DarkGray }
        }
        $unavailable = $team.members | Where-Object { $_._no_result }
        foreach ($m in $unavailable) {
            Write-Host "     ⏳ $($m.name): 超时/不可用" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  🧠 天团9模型: ⚠️ 未获有效成员裁决（多因壳子/网络/编码·非天团判0；直连 judge.py 可复现真票·判#1222）" -ForegroundColor DarkGray
    }

    # 审计
    if ($audit) {
        $auditMissing = Test-JudgeOutput $audit
        if ($auditMissing.Count -gt 0) {
            Write-Host "  ⚠️ 审计: 契约校验失败（缺: $($auditMissing -join ',')）" -ForegroundColor Red
        } elseif ($audit.members) {
            $avail = $audit.members | Where-Object { $_ -and -not $_.pass -eq $null }
            Write-Host "  ✅ 审计（${($avail.Count)}个模型）" -ForegroundColor Cyan
            foreach ($m in $avail) {
                $icon = if ($m.pass) { '✅' } else { '⚠️' }
                Write-Host "     $icon $($m.name): $($m.score)/10" -ForegroundColor $(if ($m.score -ge 7){'Green'}elseif($m.score -ge 4){'Yellow'}else{'Red'})
                if ($m.summary) { Write-Host "        ↳ $($m.summary)" -ForegroundColor DarkGray }
            }
            # 契约 schema_error 显示（judge.py 自校验标记）
            foreach ($iss in @($audit.issues | Where-Object { $_.type -eq 'schema_error' } | Select-Object -First 2)) {
                Write-Host "        ↳ [契约] $($iss.detail)" -ForegroundColor Yellow
            }
        } else { Write-Host "  ✅ 审计: ⚠️ 无结果" -ForegroundColor DarkGray }
    }

    # 大法官
    if ($justice) {
        $justiceMissing = Test-JudgeOutput $justice
        if ($justiceMissing.Count -gt 0) {
            Write-Host "  ⚠️ 大法官: 契约校验失败（缺: $($justiceMissing -join ',')）" -ForegroundColor Red
        } elseif ($justice.members) {
            $avail = $justice.members | Where-Object { $_ -and -not $_.pass -eq $null }
            Write-Host "  ⚖️ 大法官（${($avail.Count)}个模型）" -ForegroundColor Cyan
            foreach ($m in $avail) {
                $icon = if ($m.pass) { '✅' } else { '⚠️' }
                Write-Host "     $icon $($m.name): $($m.score)/10" -ForegroundColor $(if ($m.score -ge 7){'Green'}elseif($m.score -ge 4){'Yellow'}else{'Red'})
                if ($m.summary) { Write-Host "        ↳ $($m.summary)" -ForegroundColor DarkGray }
            }
            # 契约 schema_error 显示（judge.py 自校验标记）
            foreach ($iss in @($justice.issues | Where-Object { $_.type -eq 'schema_error' } | Select-Object -First 2)) {
                Write-Host "        ↳ [契约] $($iss.detail)" -ForegroundColor Yellow
            }
        } else { Write-Host "  ⚖️ 大法官: ⚠️ 无结果" -ForegroundColor DarkGray }
    }

    # 综合裁决
    $allScores = @()
    if ($team -and $team.members) { $allScores += $team.members | Where-Object { $_ } | ForEach-Object { $_.score } }
    if ($audit -and $audit.members) { $allScores += $audit.members | Where-Object { $_ } | ForEach-Object { $_.score } }
    if ($justice -and $justice.members) { $allScores += $justice.members | Where-Object { $_ } | ForEach-Object { $_.score } }
    # 2026-08-11 修复（判断#164）：排除 -1格式异常/0不可达 死模型——非判词计入平均导致四关永远压7以下（v4实质判词7.3可过）
    $liveScores = @($allScores | Where-Object { $_ -ge 1 })
    $deadCount = $allScores.Count - $liveScores.Count
    $avgScore = if ($liveScores.Count -gt 0) { [math]::Round(($liveScores | Measure-Object -Average).Average, 1) } else { 0 }
    Write-Host ''; Write-Host "  ⚖️ 综合评分: $avgScore/10（$($liveScores.Count)个有效模型，$deadCount 个死模型不计入）" -ForegroundColor Cyan
    Write-Host '  ═══' -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════
# 门报告：用审计门向用户报告状态
# ═══════════════════════════════════════════════

function Show-GateReport {
    $audit = Invoke-GateAudit
    Write-Host ''; Write-Host '══════ 门报告 ══════' -ForegroundColor Cyan
    Write-Host "  $today · $($audit.gitTag)" -ForegroundColor DarkGray
    Write-Host ''
    foreach ($item in $audit.items) {
        $icon = switch ($item.status) { 'P' { '✅' } 'F' { '⛔' } 'W' { '⚠️' } 'I' { 'ℹ️' } default { '❓' } }
        $fg   = switch ($item.status) { 'P' { 'Green' } 'F' { 'Red' } 'W' { 'Yellow' } 'I' { 'Cyan' } default { 'DarkGray' } }
        Write-Host "  $icon [$($item.status)] $($item.n) → $($item.detail)" -ForegroundColor $fg
    }
    Write-Host ''
    if ($audit.allPass) {
        Write-Host '  ✅ 全部通过 · 可以开始' -ForegroundColor Green
    } else {
        Write-Host '  ⛔ 未通过 · 先解决问题' -ForegroundColor Red
        $failures = $audit.items | Where-Object { $_.status -eq 'F' }
        foreach ($f in $failures) {
            Write-Host "      → $($f.n): $($f.detail)" -ForegroundColor DarkGray
        }
    }
    Write-Host '══════' -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════
# 主分发
# ═══════════════════════════════════════════════

switch ($action) {
    'status'       { Show-Status }
    'show'         { Show-Friendly }
    'score'        { Show-Score }
    'entry'        { Set-Entry }
    'step'         { Set-Step }
    'card'         { Show-Forge }
    'skill'        { Show-Skills }
    'upgrade'      { if ($arg1 -eq '--proposal') { Show-Upgrade -ProposalPath $arg2 } elseif ($arg1) { Invoke-UpgradeAction -subCmd $arg1 -arg $arg2 } else { Show-Upgrade } }
    'next-content' { Show-NextContent }
    'collide'      { Invoke-Collide }
    'thinktank'    { Invoke-ThinkTank }
    'gate'         { Show-GateReport }
    'backlink'     { & "$PSScriptRoot\backlink.ps1" -CardPath $arg1 }
    'reset'        { Reset-Kernel }
}

