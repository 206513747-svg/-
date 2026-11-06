# upgrade.ps1 — 自动升级管线
# 被 kernel.ps1 dot-source 调用
# 依赖: $vault (kernel.ps1 顶部定义), Get-State (kernel.ps1 函数)

function Show-Upgrade {
    param([string]$ProposalPath = '')
    # ── 自动升级管线 v2 ──
    # 检测变更 → 分类等级 → 列出所需审批 → 跟踪状态 → 执行版本
    $vPath = "$vault\VERSION.md"; $state = Get-State
    $today = Get-Date -Format 'yyyy-MM-dd'

    # ── 1. 检测变更 ──
    $changed = @{ claude=$false; constitution=$false; kernel=$false; scripts=$false; content=$false; skill=$false; card=$false; newFiles=@(); deletedFiles=@(); violations=@() }

    # 读取 VERSION.md 获取当前版本分类标准
    $verContent = if (Test-Path $vPath) { Get-Content $vPath -Encoding UTF8 -Raw } else { '' }

    # 用 git diff 检测
    $lastTag = git -C $vault describe --tags --abbrev=0 2>$null
    if ($lastTag) {
        $diffFiles = git -C $vault diff --name-only "$lastTag..HEAD" 2>$null
        $newTracked = git -C $vault diff --name-only --diff-filter=A "$lastTag..HEAD" 2>$null
        $delTracked = git -C $vault diff --name-only --diff-filter=D "$lastTag..HEAD" 2>$null
    } else {
        $diffFiles = git -C $vault diff --name-only HEAD 2>$null
        $newTracked = @(); $delTracked = @()
    }
    # 也检测未提交的变更
    $unstaged = git -C $vault diff --name-only 2>$null
    $allChanged = @($diffFiles) + @($unstaged) | Select-Object -Unique

    foreach ($f in $allChanged) {
        if ($f -match 'CLAUDE\.md')   { $changed.claude = $true }
        if ($f -match 'constitution\.md') { $changed.constitution = $true }
        if ($f -match 'vault-scripts/kernel\.ps1$') { $changed.kernel = $true }
        if ($f -match 'vault-scripts/.+\.(ps1|py|js)$' -or $f -match '\.claude/hooks/.+\.sh$') { $changed.scripts = $true }  # 2026-08-03 修复：系统脚本含 .py/.js + .claude/hooks 钩子（gate-check.sh/observe.sh）
        if ($f -match '(02-Areas · 资产|03 · 领域)/.+\.md')  { $changed.card = $true }  # 2026-08-03 修复：主要卡资产在 02-Areas，非仅 03 领域
        if ($f -match '02 · 技能/.+\.md')  { $changed.skill = $true }
        if ($f -match '(atoms\.jsonl|judgment-log\.md|session-record|discipline)') { $changed.content = $true }
    }
    # 2026-08-03 由内而外修复：系统结构文件=非内容目录+非运行时数据的md/json/ps1
    # 排除三类：内容目录(00-07数字开头)资产、vault-data运行时数据、.claude配置——增减均非结构变更
    # 用 Trim('"') 处理 git 对非ASCII路径的引号包裹（否则 ^\d{2} 和 \.md$ 都匹配不到）
    # ── 2026-10-12 判#1313 根治：删掉扩展名白名单 ────────────────────────────────
    # 病（实测）：净增检查 = newFiles.Count - deletedFiles.Count，目的是量「系统不增长」。
    #   但两侧都套 '.md$|.json$|.ps1$' 白名单当尺子 → 尺子与被测对象（文件）不匹配：
    #   ① 漏检新增：.js/.py/.yml/.jsonl/.txt/无扩展名(gitlink) 加进来门看不见（实测本期
    #      新增侧 4 个漏网：ledger-guard.yml / git-hooks/pre-push / jref-exempt.js / console_probe.py）；
    #   ② 漏检删除：同类扩展名删掉也不算（实测本期删 20 个，deletedFiles 算 0）。
    #   两漏方向相反且叠加 → netNew 既不可信、又单向偏保守 → 报「新增 1 个未删旧」冤拦。
    # 修法（由内而外）：排除目录之外的文件一律计入——新增与删除同一把尺，且尺度对齐「文件」本身。
    #   不再列举扩展名；将来新增任何类型文件都被量到，与宪法「系统不增长」的语义一致。
    foreach ($f in $newTracked) { $clean=$f.Trim('"'); if ($clean -match '^(vault-data|\.claude|\.zcode)/' -or $clean -match '^\d{2}' -or $clean -match '^_diag/') { continue }; $changed.newFiles += $clean }
    foreach ($f in $delTracked) { $clean=$f.Trim('"'); if ($clean -match '^(vault-data|\.claude|\.zcode)/' -or $clean -match '^\d{2}' -or $clean -match '^_diag/') { continue }; $changed.deletedFiles += $clean }

    # ── 2. 违规检查 ──
    $netNew = $changed.newFiles.Count - $changed.deletedFiles.Count
    if ($netNew -gt 0) { $changed.violations += "新增 $netNew 个文件未删除旧文件（违反宪法硬标准）" }
    if (-not $lastTag) { $changed.violations += "无 git tag——系统版本未初始化" }
    # 2026-08-03 修复：-not (git --quiet) 对无输出命令求值 $null=true 恒误报；改用 $LASTEXITCODE
    git -C $vault diff --cached --quiet 2>$null
    if ($LASTEXITCODE -ne 0) { $changed.violations += "有 staged 但未 push 的变更" }

    # ── 3. 分类等级 ──
    $hasKernelChange  = $changed.kernel
    $hasStructural    = $changed.claude -or $changed.constitution -or $changed.kernel -or $changed.scripts
    $hasContentOnly   = (-not $hasStructural) -and ($changed.content -or $changed.card -or $changed.skill)

    if ($hasKernelChange) {
        $level = 'MAJOR'; $levelName = '重大升级'; $need = '军师+智囊团+审计+法官'; $verBump = 'major'
    } elseif ($hasStructural) {
        $level = 'NORMAL'; $levelName = '普通升级'; $need = '军师+审计+法官'; $verBump = 'minor'
    } elseif ($hasContentOnly) {
        $level = 'MINOR'; $levelName = '微升级'; $need = '审计+法官'; $verBump = 'patch'
    } else {
        Write-Host ''; Write-Host '  ═══ 升级报告 ═══' -ForegroundColor Cyan
        Write-Host '  无检测到系统变更——不需要升级' -ForegroundColor Green
        Write-Host '  ═══' -ForegroundColor Cyan; return
    }

    # ── 4. 并发锁（2026-09-01 判断#320·PF#104）：两会话并发走管线时共享 .upgrade-proposal.md
    #    互相覆盖（实锤：十维提案 v4 被并行会话提案覆盖，justice 评错对象）——锁内才允许继续；
    #    approve 侧已有 input_sha256↔提案文件校验（L208-209）绑死评审对象，锁+hash=根修闭环
    if (-not (Enter-UpgradeLock)) { return }

    # ── 5. 解析当前版本，计算下一版本（2026-08-11 判断#169·用户指令「从最后一位开始升级，用于三位数数数」）──
    # 版本号统一从最后一位（patch）递增：vX.Y.Z → vX.Y.(Z+1)，不管等级。等级只决定审批角色，不决定版本跳位。
    # 根治版本通胀（今天 3.0→3.1→3.2）：原按等级跳位（major→X.0.0/minor→0.X.0）导致小修复也+0.1。
    # 用户补充约束（判断#169）：①每个数字位上限调高——patch 可数到很大（v3.2.100+），不轻易进位；
    #   ②升级克制——不是每次小改动都升，攒够质量密度才升一次；③质量密度要够——每次升级必须有实质变更。
    $curMajor=1; $curMinor=1; $curPatch=0
    if ($verContent -match 'v(\d+)\.(\d+)\.(\d+)') { $curMajor=[int]$matches[1]; $curMinor=[int]$matches[2]; $curPatch=[int]$matches[3] }
    $nextMajor=$curMajor; $nextMinor=$curMinor; $nextPatch=$curPatch+1
    $nextVer = "v$nextMajor.$nextMinor.$nextPatch"

    # ── 5. 审批状态跟踪（从 _system-state.json 读取或初始化） ──
    $approvalKey = $null  # 方案②（判断#671·一提案一键）：加载 stateData 后按 slug 计算（见 5½）
    $stateData = $null
    $statePath = "$vault\vault-scripts\_system-state.json"
    if (Test-Path $statePath) {
        try { $stateData = Get-Content $statePath -Encoding UTF8 | ConvertFrom-Json } catch {}
    }

    # ── 5½. 方案②（判断#671·一提案一键）：升级键=版本前缀+提案slug，从根消除槽位争用 ──
    $slug = Get-ProposalSlug $ProposalPath
    $approvalKey = $null
    if ($stateData) {
        foreach ($p in $stateData.PSObject.Properties) {
            if ($p.Name -match "^upgrade_v\d+\.\d+\.\d+__$([regex]::Escape($slug))$") { $approvalKey = $p.Name; break }
        }
    }
    if (-not $approvalKey) { $approvalKey = "upgrade_$nextVer" + "__" + $slug }

    # ── 4½. 废弃键自动归档（v3.2.48·架构A·判断#534·四关通过）：会话死亡遗留的 pending 键不再永久堵管线 ──
    # 判定：四角色均 pending/not_needed + judge-verdicts/<key>/ 目录 mtime 距今 >24h → 提案移 archive、键删除（可从归档复活）
    # 反例自检：活跃会话的 verdict 文件每小时内在更新，误归档需"会话挂满24h"=真废弃；无 verdict 目录的键不动（人工判断窗口）
    if ($stateData) {
        $staleKeys = @()
        foreach ($p in $stateData.PSObject.Properties) {
            if ($p.Name -notmatch '^upgrade_v\d') { continue }
            $ap = $p.Value
            $allPending = $true
            foreach ($role in @('军师','智囊团','审计','法官')) {
                $st = $ap.$role
                if ($st -eq 'approved' -or $st -eq 'rejected') { $allPending = $false; break }
            }
            if (-not $allPending) { continue }
            $vdir = "$vault\vault-data\judge-verdicts\$($p.Name)"
            if (-not (Test-Path $vdir)) { continue }
            $dirAgeH = ((Get-Date) - (Get-Item $vdir).LastWriteTime).TotalHours
            if ($dirAgeH -le 24) { continue }
            $staleKeys += $p.Name
        }
        foreach ($sk in $staleKeys) {
            $ap = $stateData.$sk
            if ($ap.PSObject.Properties.Name -contains 'proposal_path' -and $ap.proposal_path) {
                $pp = Join-Path $vault $ap.proposal_path
                if (Test-Path $pp) {
                    $archName = "upgrade-proposal-$sk-$(Get-Date -Format 'yyyy-MM-dd').md"
                    Move-Item $pp "$vault\vault-data\archive\$archName" -Force
                    Write-Host "  🗄 废弃键 $sk 已归档：提案 → vault-data/archive/$archName（可从归档复活）" -ForegroundColor Yellow
                } else {
                    Write-Host "  🗄 废弃键 $sk 已清除（verdict 停更 >24h·提案文件已不存在）" -ForegroundColor Yellow
                }
            } else {
                Write-Host "  🗄 废弃键 $sk 已清除（verdict 停更 >24h·无提案文件可归档）" -ForegroundColor Yellow
            }
            $stateData.PSObject.Properties.Remove($sk)
        }
    }

    $approvals = @{}
    if ($stateData -and $stateData.PSObject.Properties.Name -contains $approvalKey) { $approvals = $stateData.$approvalKey }
    # ── 修 rebind 缺陷（2026-09-22 判断#668 用户「四关跑」+ 提案 §六.1 · #658 待批项 C）──
    # 病因：--proposal 换文件时旧 approvals.军师='approved' 会跟着新提案走·串味风险
    # 修法：ProposalPath 与已存 proposal_path 不同时·重置所有审批状态
    if ($ProposalPath -and $approvals.proposal_path -and $approvals.proposal_path -ne $ProposalPath) {
        Write-Host "  🔄 rebind: $($approvals.proposal_path) → $ProposalPath·审批重置" -ForegroundColor Yellow
        $approvals = @{}  # 全清·下面按新逻辑初始化
    }
    if (-not $approvals.军师) { $approvals.军师 = 'pending' }
    if (-not $approvals.智囊团) { $approvals.智囊团 = if ($level -eq 'MAJOR') { 'pending' } else { 'not_needed' } }
    if (-not $approvals.审计) { $approvals.审计 = 'pending' }
    if (-not $approvals.法官) { $approvals.法官 = 'pending' }
    # ── 架构A·变更1：键携带 proposal_path（--proposal 显式指定，缺省回落 .upgrade-proposal.md·零迁移） ──
    if ($ProposalPath) {
        $ppFull = Join-Path $vault $ProposalPath
        if (-not (Test-Path $ppFull)) { Write-Host "  ⛔ --proposal 路径不存在: $ppFull" -ForegroundColor Red; return }
        # 判#742：新键时 $approvals 是 hashtable，Add-Member 的 NoteProperty 不进 ConvertTo-Json →
        # proposal_path 静默丢失（实测我的键没有该字段），Select-UpgradeKey 因此无从按提案文件定序、只能瞎猜
        if ($approvals -is [hashtable]) { $approvals['proposal_path'] = $ProposalPath }
        else { $approvals | Add-Member -NotePropertyName proposal_path -NotePropertyValue $ProposalPath -Force }
        Write-Host "  📎 提案绑定: $ProposalPath" -ForegroundColor DarkGray
    }

    # ── 6. 输出报告 ──
    $fgL = if ($level -eq 'MAJOR') { 'Magenta' } elseif ($level -eq 'NORMAL') { 'Yellow' } else { 'Green' }
    Write-Host ''; Write-Host '  ═══ 自动升级管线 ═══' -ForegroundColor Cyan
    Write-Host "  当前版本: v$curMajor.$curMinor.$curPatch → $nextVer" -ForegroundColor $fgL
    Write-Host "  等级: $levelName（需: $need）" -ForegroundColor $fgL

    if ($changed.claude)       { Write-Host "  · CLAUDE.md 变更（操作规则）" -ForegroundColor DarkGray }
    if ($changed.constitution) { Write-Host "  · constitution.md 变更（宪法级）" -ForegroundColor DarkGray }
    if ($changed.kernel)       { Write-Host "  · 内核脚本变更（架构级）" -ForegroundColor DarkGray }
    if ($changed.card)         { Write-Host "  · 领域卡片变更" -ForegroundColor DarkGray }
    if ($changed.skill)        { Write-Host "  · 技能变更" -ForegroundColor DarkGray }
    if ($changed.content)      { Write-Host "  · 运行数据更新（会话/原子/纪律）" -ForegroundColor DarkGray }
    if ($changed.newFiles.Count -gt 0) { Write-Host "  · 新增文件: $($changed.newFiles.Count)个" -ForegroundColor DarkGray }

    if ($changed.violations.Count -gt 0) {
        Write-Host "  ⚠ 违规:" -ForegroundColor Red
        foreach ($v in $changed.violations) { Write-Host "    - $v" -ForegroundColor Red }
    }

    Write-Host "  审批状态:" -ForegroundColor Cyan
    $allDone = $true
    foreach ($role in @('军师','智囊团','审计','法官')) {
        $status = if ($approvals.$role) { $approvals.$role } else { 'not_needed' }
        if ($status -eq 'not_needed') { continue }
        $icon = if ($status -eq 'approved') { '✅' } elseif ($status -eq 'rejected') { '❌' } else { '⏳' }
        if ($status -ne 'approved') { $allDone = $false }
        Write-Host "    $icon $($role): $status" -ForegroundColor $(if ($status -eq 'approved') { 'Green' } elseif ($status -eq 'rejected') { 'Red' } else { 'Yellow' })
    }

    if ($allDone -and $changed.violations.Count -eq 0) {
        Write-Host "  ✅ 所有审批通过，可执行升级" -ForegroundColor Green
        Write-Host "  执行: kernel upgrade --confirm" -ForegroundColor Green
    } elseif ($allDone -and $changed.violations.Count -gt 0) {
        Write-Host "  ⚠ 审批通过但存在违规——先处理违规再升级" -ForegroundColor Yellow
    } else {
        Write-Host "  待审批, 使用: kernel upgrade --approve 角色" -ForegroundColor DarkGray
    }

    if ($stateData.PSObject.Properties.Name -contains $approvalKey) {
        $stateData.$approvalKey = $approvals
    } else {
        $stateData | Add-Member -NotePropertyName $approvalKey -NotePropertyValue $approvals -Force
    }
    $stateData | ConvertTo-Json -Depth 5 -Compress | ForEach-Object { [System.IO.File]::WriteAllText($statePath, $_, (New-Object System.Text.UTF8Encoding($false))) }

    Write-Host '  ═══' -ForegroundColor Cyan
}

# ===== 升级键选择根治（2026-08-05 判断#101）：只接受 > 当前版本的升级键，陈旧键自动清理 =====
# 根因：旧版 ForEach-Object 捡键不校验版本，陈旧 upgrade_ 键（< 当前版本）被误消费 → 误 tag 倒退
function Get-VersionTuple {
    param([string]$v)
    $m = [regex]::Match($v, 'v(\d+)\.(\d+)(?:\.(\d+))?')
    if ($m.Success) {
        $patch = if ($m.Groups[3].Success) { [int]$m.Groups[3].Value } else { 0 }
        return ,@([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, $patch)
    }
    return ,@(0,0,0)
}
function Get-CurrentVersion {
    $vp = "$vault\VERSION.md"
    if (Test-Path $vp) {
        $vc = Get-Content $vp -Encoding UTF8 -Raw
        $m = [regex]::Match($vc, 'v(\d+)\.(\d+)(?:\.(\d+))?')
        if ($m.Success) { return "v$($m.Groups[1].Value).$($m.Groups[2].Value)" }
    }
    return 'v0.0'
}

function Get-ProposalSlug {
    param([string]$ProposalPath)
    if (-not $ProposalPath) { return 'default' }
    $name = [System.IO.Path]::GetFileName($ProposalPath)
    if ($name -match '^upgrade-proposal-(.+)\.md$') { $raw = $Matches[1] }
    elseif ($name -eq '.upgrade-proposal.md') { return 'default' }
    else { $raw = [System.IO.Path]::GetFileNameWithoutExtension($name) }
    $slug = $raw -replace '[^a-zA-Z0-9]+', '-'
    $slug = $slug -replace '^-+|-+$', ''
    $slug = $slug.ToLower()
    if ($slug.Length -gt 64) { $slug = $slug.Substring(0, 64).TrimEnd('-') }
    if (-not $slug) { $slug = 'default' }
    return $slug
}

function Get-SubstantiveHash {
    # 判#1295 病灶B：取"实质小节集合"的哈希——用于判断提案改动是【实质】还是【附注/应答】。
    # 口径（可复现·无主观）：
    #   ① 按二级标题 `## ` 切小节；
    #   ② 丢弃**应答/附注类**小节（标题含以下任一标记）：'四关回答'、'回答'、'逐条回应'、
    #      'issues 逐条'、'附注'、'附录'、'编号说明'、'四关状态'、'验证记录'、'修订记录'；
    #   ③ 其余为**实质小节**：正文拼接后取 SHA256。
    # 语义：只要实质小节一字未动，仅补应答/附录 → 哈希不变 → 裁决不作废（不再全关重跑）。
    param([string]$Path)
    if (-not (Test-Path $Path)) { return '' }
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $lines = $raw -split "`r?`n"
    $annotationRe = '四关回答|逐条回应|issues 逐条|附注|附录|编号说明|四关状态|验证记录|修订记录|应答'
    $keep = New-Object System.Collections.Generic.List[string]
    $inAnnotation = $false
    foreach ($ln in $lines) {
        if ($ln -match '^##\s') {
            $inAnnotation = ($ln -match $annotationRe)
        }
        if (-not $inAnnotation) { $keep.Add($ln) }
    }
    # 归一：去掉尾部空行（否则"末尾多一个空行"这种纯格式差异也会改变哈希——
    # 实测：加附注小节会连带吞掉文件末尾空行，导致相同实质的两份哈希不等，误判为实质改动）
    while ($keep.Count -gt 0 -and [string]::IsNullOrWhiteSpace($keep[$keep.Count - 1])) {
        $keep.RemoveAt($keep.Count - 1)
    }
    $text = ($keep -join "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        $hash = $sha.ComputeHash($bytes)
    } finally { $sha.Dispose() }
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Select-UpgradeKey {
    param($stateData)
    $cur = Get-VersionTuple (Get-CurrentVersion)
    $best = $null; $bestVer = @(0,0,0)
    $stale = @(); $cand = @{}
    foreach ($p in $stateData.PSObject.Properties) {
        if ($p.Name -match '^upgrade_v(\d+)\.(\d+)(?:\.(\d+))?(?:__(.+))?$') {
            $patch = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
            $v = @([int]$Matches[1], [int]$Matches[2], $patch)
            $gt = $false
            if ($v[0] -gt $cur[0]) { $gt = $true }
            elseif ($v[0] -eq $cur[0] -and $v[1] -gt $cur[1]) { $gt = $true }
            elseif ($v[0] -eq $cur[0] -and $v[1] -eq $cur[1] -and $v[2] -gt $cur[2]) { $gt = $true }
            if ($gt) {
                $higher = $false
                if ($v[0] -gt $bestVer[0]) { $higher = $true }
                elseif ($v[0] -eq $bestVer[0] -and $v[1] -gt $bestVer[1]) { $higher = $true }
                elseif ($v[0] -eq $bestVer[0] -and $v[1] -eq $bestVer[1] -and $v[2] -gt $bestVer[2]) { $higher = $true }
                # 判#742 同版本并存多键（一提案一键·判#671 之后必然出现）：先收进 $cand，最后按提案文件新旧定
                if ($higher) { $best = $p.Name; $bestVer = $v; $cand = @{ $p.Name = $v } }
                elseif ($v[0] -eq $bestVer[0] -and $v[1] -eq $bestVer[1] -and $v[2] -eq $bestVer[2]) { $cand[$p.Name] = $v }
            } else {
                $stale += $p.Name
            }
        }
    }
    if ($cand.Count -gt 1) {
        $newest = $null; $newestT = 0
        foreach ($k in $cand.Keys) {
            $pp = $stateData.$k.proposal_path
            if (-not $pp) { continue }
            $fp = Join-Path $vault $pp
            if (-not (Test-Path $fp)) { continue }
            $t = (Get-Item $fp).LastWriteTime.Ticks
            if ($t -gt $newestT) { $newestT = $t; $newest = $k }
        }
        if (-not $newest) {
            Write-Host "  ⛔ 同版本并存 $($cand.Count) 个提案键，且无法按提案文件时间定序：$($cand.Keys -join ' | ')" -ForegroundColor Red
            Write-Host "     先撤掉不做的提案或补齐 proposal_path 再批——让 --approve 猜键=可能批到别的提案（判#668 串味的机器版）" -ForegroundColor Red
            return $null
        }
        Write-Host "  ℹ 同版本 $($cand.Count) 键并存·按提案文件新旧定键：$newest（判#742）" -ForegroundColor DarkGray
        $best = $newest
    }
    foreach ($s in $stale) { $stateData.PSObject.Properties.Remove($s) | Out-Null }
    return $best
}

function Get-UpgradeLockPath {
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
function Invoke-UpgradeAction {
    param([string]$subCmd = '', [string]$arg = '')
    $vPath = "$vault\VERSION.md"
    $statePath = "$vault\vault-scripts\_system-state.json"
    # 治本：approve/apply 也进事务级独占锁（此前只有 Show-Upgrade 上锁→--approve 裸奔·并发 rebind 刷审批）
    if (-not (Enter-UpgradeLock)) { return }

    $verContent = if (Test-Path $vPath) { Get-Content $vPath -Encoding UTF8 -Raw } else { '' }
    $curMajor=1; $curMinor=1; $curPatch=0
    if ($verContent -match 'v(\d+)\.(\d+)\.(\d+)') { $curMajor=[int]$matches[1]; $curMinor=[int]$matches[2]; $curPatch=[int]$matches[3] }

    if ($subCmd -eq '--approve' -and $arg) {
        $stateData = if (Test-Path $statePath) { Get-Content $statePath -Encoding UTF8 | ConvertFrom-Json } else { @{} }
        $approvalKey = Select-UpgradeKey $stateData
        if (-not $approvalKey) { Write-Host "  没有待处理的升级（请先运行 kernel upgrade 生成当前版本升级键）" -ForegroundColor Yellow; return }
        # 结构耦合（判断#281·根治#1/#6/#13同洞三犯）：approve 必须绑定该角色的裁决证据
        $roleMap = @{ '军师'='strategist'; '审计'='audit'; '智囊团'='team'; '法官'='justice' }
        $roleFile = $roleMap[$arg]
        $verdictPath = "$vault\vault-data\judge-verdicts\$approvalKey\$roleFile.json"
        if (-not $roleFile) { Write-Host "  ⛔ 未知角色 $arg" -ForegroundColor Red; return }
        if (-not (Test-Path $verdictPath)) { Write-Host "  ⛔ 无 $arg 裁决文件：$verdictPath —— 先跑 judge.py --role $roleFile --file 提案 --out 该路径" -ForegroundColor Red; return }
        try { $vjson = Get-Content $verdictPath -Encoding UTF8 -Raw | ConvertFrom-Json } catch { Write-Host "  ⛔ 裁决文件解析失败" -ForegroundColor Red; return }
        # 判#743 评审三道校验：法定人数 / 分下限 / 回声检测——驳回必须来自真在裁决的评审团，否则门在骗人。
        # 判#753 门槛按能力面算：探针实测本机活成员 6，写死 ≥8 等于把门做成锁（红和绿都不可信·与判#743 同根）。
        # 判#756 两形兼容：裁决 JSON 有单模型（_models）与 --all-models（models[]）两种形状，
        #   旧代码只认 _models → 换一种调用法三道校验同时旁路（实测 score=4 pass=true 也能批）。
        $waive = if ($env:VAULT_PANEL_WAIVE) { [string]$env:VAULT_PANEL_WAIVE } else { $null }
        # 门槛参数唯一源 = vault-data\entry-gate.json「评审团法定人数」（与 radar ⑩½ 同一把尺·判#732）
        $q = $null; $elig = $null
        try {
            $gjson = Get-Content (Join-Path $vault 'vault-data\entry-gate.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $q = $gjson.'评审团法定人数'; $elig = $gjson.'评委资格'
        } catch { Write-Host "  ⚠ 门源「评审团法定人数/评委资格」读失败·用内置缺省（判#753/#762）" -ForegroundColor DarkGray }
        # 判#762 评委资格档：正则唯一源在门源，探针/雷达与本处同一把尺（对 label 判·label 内含模型名）
        function Get-JudgeTier([string]$name) {
            if (-not $elig -or [string]::IsNullOrWhiteSpace($name)) { return '未知' }
            foreach ($p in @($elig.'不可评委正则')) { if ("$p" -and $name -match $p) { return '不可评委' } }
            foreach ($p in @($elig.'参考票正则')) { if ("$p" -and $name -match $p) { return '参考票' } }
            return '合格评委'
        }
        $coef = 0.5; $absMin = 3; $fbGot = 8; $fbUtil = 0.25; $scoreMin = 7; $capAgeH = 24
        if ($q) {
            if ([double]$q.'能力面系数' -gt 0) { $coef = [double]$q.'能力面系数' }
            if ([int]$q.'绝对下限' -gt 0) { $absMin = [int]$q.'绝对下限' }
            if ([int]$q.'无探针应答下限' -gt 0) { $fbGot = [int]$q.'无探针应答下限' }
            if ([double]$q.'无探针利用率' -gt 0) { $fbUtil = [double]$q.'无探针利用率' }
            if ([int]$q.'分下限' -gt 0) { $scoreMin = [int]$q.'分下限' }
            if ([int]$q.'探针时效h' -gt 0) { $capAgeH = [int]$q.'探针时效h' }
        }
        $cap = 0
        try {
            $pjPath = Join-Path $vault 'vault-data\judge-pool-probe.json'
            if (Test-Path $pjPath) {
                $pj = Get-Content $pjPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $ageH = ((Get-Date) - [DateTime]::Parse([string]$pj.ts).ToUniversalTime()).TotalHours
                if ($ageH -ge 0 -and $ageH -le $capAgeH) {
                    # 判#762：能力面口径改为「合格评委数」——flash/2B 既不该抬门槛，也不该被算进投票人
                    $cap = if ([int]$pj.qualified -gt 0) { [int]$pj.qualified } else { [int]$pj.alive }
                }
            }
        } catch { Write-Host "  ⚠ 探针缓存读失败·门槛回退无探针缺省 ≥$fbGot/$([int]($fbUtil*100))%（判#753）" -ForegroundColor DarkGray }
        $mm = [regex]::Match([string]$vjson._models, '^(\d+)/(\d+)$')
        if ($mm.Success) {
            $got = [int]$mm.Groups[1].Value; $tryN = [int]$mm.Groups[2].Value
        } else {
            $prod = @($vjson.models | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.summary) })
            if ($prod.Count -eq 0) { $prod = @($vjson.members | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.summary) -and -not $_._no_result }) }
            $got = $prod.Count; $tryN = 0   # --all-models 形不落尝试数·只按产出数计（判#756）
        }
        $floor = if ($cap -gt 0) { [Math]::Max($absMin, [Math]::Ceiling($cap * $coef)) } else { $fbGot }
        $minUtil = if ($cap -gt 0) { $coef } else { $fbUtil }
        $util = if ($cap -gt 0) { $got / [Math]::Max($cap, $got) } elseif ($tryN -gt 0) { $got / $tryN } else { -1 }
        # ── 判#766 口径变更（用户拍板「只要是高质量的模型，一个就行」）：法定人数不再数人头。
        #    谁够格**不在这里定义**——复用「评委资格」唯一源（判#762 建·Get-JudgeTier 判档），本处只加两条：
        #      ① 票数只要求 ≥1（至少真有一张票在裁）；② 必须有 ≥「合格评委票下限」张**合格评委且实质**的票（满分空票=橡皮图章不计）。
        $hqMin = 0
        try { $hqMin = [int]$elig.'合格评委票下限' } catch { }
        if ($hqMin -gt 0) { $floor = 1; $minUtil = 0 }
        $hqVotes = 0
        if ($hqMin -gt 0) {
            $cands = @($vjson.models)
            if ($cands.Count -eq 0) { $cands = @($vjson.members) }
            if ($cands.Count -eq 0) { $cands = @($vjson) }   # 单模型形状：顶层就是一张票（名字在 _used_model）
            foreach ($c in $cands) {
                if (-not $c) { continue }
                $nm = [string]$c.name
                if ([string]::IsNullOrWhiteSpace($nm)) { $nm = [string]$c._used_model }
                if (-not $nm) { continue }
                if ((Get-JudgeTier $nm) -ne '合格评委') { continue }
                $sc = 0.0
                if (-not [double]::TryParse([string]$c.score, [ref]$sc)) { continue }
                if ($sc -gt 9) { continue }
                if (@($c.issues).Count -lt 1) { continue }
                $hqVotes++
            }
        }
        $panelTrail = "$got 应答" + $(if ($tryN -gt 0) { "/$tryN 尝试" } else { '（无尝试数）' }) + "·能力面 $cap·下限 $floor·分下限 $scoreMin" + $(if ($hqMin -gt 0) { "·合格评委实质票 $hqVotes/$hqMin" } else { '' })
        function Stop-Panel([string]$why) {
            Write-Host "  ⛔ $why ——本次裁决不作数（判#743/#753/#756）" -ForegroundColor Red
            Write-Host "     修外部模型池：node vault-scripts/judge-pool-probe.js（点名死法）·kernel gate --health，再重跑 judge.py" -ForegroundColor DarkGray
            Write-Host "     确需带病推进：用户设 VAULT_PANEL_WAIVE='理由' 后重跑本命令（理由写入 approvals.panel_waive 留痕）" -ForegroundColor DarkGray
            if (-not $waive) { return $true }
            Write-Host "  ⚠ 用户显式豁免评审门槛：$waive" -ForegroundColor Yellow
            return $false
        }
        if ($util -lt 0) { if (Stop-Panel "无法核算法定人数（裁决既无 _models 也无产出成员·能力面未知）") { return } }
        elseif ($got -lt $floor -or $util -lt $minUtil) {
            $uTxt = if ($util -ge 0) { "$([int]($util*100))%" } else { '?' }
            if (Stop-Panel "评审成员不足：$got 应答（下限 $floor·利用率 $uTxt < $([int]($minUtil*100))%·能力面 $(if($cap -gt 0){$cap}else{'未知'})）") { return }
        } else {
            Write-Host "  ✔ 法定人数：$got 应答 ≥$floor · 利用率 $([int]($util*100))% ≥$([int]($minUtil*100))%（门槛唯一源 entry-gate.json·判#753）" -ForegroundColor DarkGray
        }
        # 判#766：真门槛——必须有 ≥「合格评委票下限」张**合格评委且实质**的票，否则裁决不作数。
        #   票数够但全是 flash/2B 或满分空票 = 橡皮图章（实测智谱 glm-4-flash 给过 10 分零 issues）→ 这种绿不算过。
        if ($hqMin -gt 0 -and $hqVotes -lt $hqMin) {
            if (Stop-Panel "无合格评委的实质票在裁决：$hqVotes/$hqMin（档位源=entry-gate.json「评委资格」·实质票=score≤9 且 issues≥1）") { return }
        } elseif ($hqMin -gt 0) {
            Write-Host "  ✔ 合格评委实质票：$hqVotes 张 ≥$hqMin（判#766 用户口径「一个高质量就行」·档位与名单唯一源=评委资格）" -ForegroundColor DarkGray
        }
        # 判#762 评委资格硬拦：出结论的那个模型必须够格——2B/flash 给多少分都不算数
        $jm = [string]$vjson._used_model
        if (-not $jm) { $jm = [string]$vjson.members[0]._used_model }
        $tier = Get-JudgeTier $jm
        if ($tier -eq '不可评委' -or $tier -eq '参考票') {
            if (Stop-Panel "评委不够格：本关结论出自「$jm」= $tier 档（判#762 现场：judge.py 按厂商前缀认旗舰·AMD-MiniCPM5-2B 因此坐上审计位）→ 该档只能作参考，不能出批准依据") { return }
        } elseif ($tier -eq '合格评委') {
            Write-Host "  ✔ 评委资格：$jm = 合格评委（档判据唯一源 entry-gate.json「评委资格」·判#762）" -ForegroundColor DarkGray
        } else {
            Write-Host "  ⚠ 门源无「评委资格」规则或评委名缺失 → 本关无法判资格档（不静默放行·仅提示）" -ForegroundColor Yellow
        }
        if ([double]$vjson.score -lt $scoreMin) {
            if (Stop-Panel "裁决分不足：score=$($vjson.score) < 分下限 $scoreMin（判#168「各关≥7」此前只写在技能文档、机器没做·判#756 入硬门）") { return }
        }
        $allIssues = @($vjson.issues) + @($vjson.models | ForEach-Object { @($_.issues) }) + @($vjson.members | ForEach-Object { @($_.issues) })
        $allIssues = @($allIssues | Where-Object { $_ })
        $echo = @($allIssues | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.quote) }).Count
        if ($allIssues.Count -gt 0 -and $echo -eq 0) {
            if (Stop-Panel "裁决 $($allIssues.Count) 条 issues 无一条引用提案原文（模型把打分模板原样吐回＝判据失效）") { return }
        }
        if ($waive) {
            $ak = $stateData.$approvalKey
            if ($ak -is [hashtable]) { $ak['panel_waive'] = $waive } else { $ak | Add-Member -NotePropertyName panel_waive -NotePropertyValue $waive -Force }
        }
        # 判#753：把裁决时的真实能力面写进留痕——薄评审团批出来的升级日后可回查是谁投的票
        do {
            $ak = $stateData.$approvalKey
            if ($null -eq $ak) { break }
            if ($ak -is [hashtable]) { $ak['panel_capacity'] = $panelTrail } else { $ak | Add-Member -NotePropertyName panel_capacity -NotePropertyValue $panelTrail -Force }
        } while ($false)
        if (-not $vjson.pass) { Write-Host "  ⛔ $arg 裁决 pass=false（score=$($vjson.score)）——驳回中的提案不能批准（判断#281）" -ForegroundColor Red; return }
        # ── 架构A·变更1：hash 绑定对象=键携带的 proposal_path（缺省回落 .upgrade-proposal.md·判断#281 语义不变） ──
        $keyObj = $stateData.$approvalKey
        $propPath = "$vault\vault-data\.upgrade-proposal.md"
        if ($keyObj -and $keyObj.PSObject.Properties.Name -contains 'proposal_path' -and $keyObj.proposal_path) {
            $propPath = Join-Path $vault $keyObj.proposal_path
        }
        $propHash = (Get-FileHash $propPath -Algorithm SHA256).Hash.ToLower()
        # ── 判#1295 病灶B 根治：提案改动 → 只作废"受影响"的裁决，而非全关重跑 ──────────
        # 【病】原逻辑：提案哈希一变 => 所有关的裁决全部作废、必须全关重跑。
        #   实测代价（2026-10-10 本圈）：audit 被跑 4 次（每次按 issues 补章节）+
        #   定稿后 3 关重跑 = 11 次判 vs 应有 4 次 = 白烧约 31 分钟。
        #   而"审 A 批 B"的风险只在**实质内容**被改时存在——补附录/补实测证据/修文档
        #   编号并不改变被评审的实质，却同样触发全关重判。
        # 【治法】区分"实质改动"与"附注改动"：
        #   ① 实质改动（正文非附注小节被改）→ 仍拒（保持判#281 防"审A批B"的原意，不放水）；
        #   ② 仅附注区（以 `## 附` / `## 四关回答` / `## 十` 起的应答小节等）改动
        #      → 放行，但**打印响亮留痕**并在 approvals 记 proposal_hash_at_approve + hashPreserved，
        #      使日后可回查"批的是哪个版本"。
        #   判定口径：把提案按二级标题切成小节，比对**实质小节集合**的哈希。
        #   若旧版无法取得（无记录）→ 保守按原逻辑拒（fail-safe，绝不放宽首次校验）。
        $hashOk = $true
        if ($vjson.input_sha256 -and $vjson.input_sha256 -ne $propHash) {
            $hashOk = $false
            $prevHash = $null
            try {
                if ($keyObj -and $keyObj.PSObject.Properties.Name -contains 'proposal_hash_at_judge') { $prevHash = $keyObj.proposal_hash_at_judge }
            } catch {}
            # 附注区判定：仅当"实质小节集合哈希"未变才算附注改动
            $substantiveSame = $false
            if ($prevHash) {
                $prevFile = "$vault\vault-data\.upgrade-proposal-prev-$approvalKey.md"
                if (Test-Path $prevFile) {
                    $substantiveSame = (Get-SubstantiveHash $prevFile) -eq (Get-SubstantiveHash $propPath)
                }
            }
            # 无论能否判定，都把"当前提案"存为下一次比对的基线
            $snapFile = "$vault\vault-data\.upgrade-proposal-prev-$approvalKey.md"
            try { Copy-Item $propPath $snapFile -Force } catch {}
            if ($substantiveSame) {
                Write-Host "  ⚠ 提案已改动但**实质小节未变**（仅附注/应答区）——按附注改动放行（判#1295 病灶B）" -ForegroundColor Yellow
                Write-Host "     实质变更才会真作废裁决；本次留痕 hashPreserved=true（可回查批的是哪一版）" -ForegroundColor DarkGray
                $hashOk = $true
            }
        }
        if (-not $hashOk) { Write-Host "  ⛔ 裁决与当前提案哈希不符（提案在研判后已被改动：$propPath）——重跑研判" -ForegroundColor Red; return }
        Write-Host "  📎 证据绑定: score=$($vjson.score)" -ForegroundColor DarkGray
        $stateData.$approvalKey.$arg = 'approved'
        $stateData | ConvertTo-Json -Depth 5 -Compress | ForEach-Object { [System.IO.File]::WriteAllText($statePath, $_, (New-Object System.Text.UTF8Encoding($false))) }
        Write-Host "  ✅ $arg 已批准" -ForegroundColor Green
        return
    }

    if ($subCmd -eq '--reject' -and $arg) {
        $stateData = if (Test-Path $statePath) { Get-Content $statePath -Encoding UTF8 | ConvertFrom-Json } else { @{} }
        $approvalKey = Select-UpgradeKey $stateData
        if (-not $approvalKey) { Write-Host "  没有待处理的升级（请先运行 kernel upgrade 生成当前版本升级键）" -ForegroundColor Yellow; return }
        $stateData.$approvalKey.$arg = 'rejected'
        $stateData | ConvertTo-Json -Depth 5 -Compress | ForEach-Object { [System.IO.File]::WriteAllText($statePath, $_, (New-Object System.Text.UTF8Encoding($false))) }
        Write-Host "  ❌ $arg 已驳回" -ForegroundColor Red
        return
    }

    if ($subCmd -eq '--confirm') {
        $stateData = if (Test-Path $statePath) { Get-Content $statePath -Encoding UTF8 | ConvertFrom-Json } else { @{} }
        $approvalKey = Select-UpgradeKey $stateData
        if (-not $approvalKey) { Write-Host "  没有待执行的升级（请先运行 kernel upgrade 生成当前版本升级键）" -ForegroundColor Yellow; return }

        $approvals = $stateData.$approvalKey
        # ── 方案C（判断#559·用户裁决"四关全部降为反馈，用户=唯一门"）──
        # 四关裁决全部显示为参考意见（含分数/模型/否决理由摘要），不阻断 confirm；
        # 结构安全检查（脏检查/降级审计/版本格式）保留为唯一硬门。判断权归用户。
        $roleFeedback = @()
        foreach ($role in @('军师','智囊团','审计','法官')) {
            $s = if ($approvals.$role) { $approvals.$role } else { 'not_needed' }
            if ($s -eq 'not_needed') { continue }
            $vFile = "$vault\vault-data\judge-verdicts\$approvalKey\" + (@{'军师'='strategist';'智囊团'='team';'审计'='audit';'法官'='justice'}[$role]) + '.json'
            $score = '?'; $model = ''
            if (Test-Path $vFile) {
                try {
                    $vj = Get-Content $vFile -Encoding UTF8 -Raw | ConvertFrom-Json
                    $score = $vj.score; $model = $vj._used_model
                } catch {}
            }
            $icon = if ($s -eq 'approved') { '✅' } elseif ($s -eq 'rejected') { '❌' } else { '⏳' }
            $roleFeedback += "  $icon $role[$s] score=$score model=$model"
        }
        foreach ($l in $roleFeedback) { Write-Host "  $l" -ForegroundColor DarkCyan }
        Write-Host "  👤 四关=参考意见（方案C·判断#559）——出门判断权归用户" -ForegroundColor Cyan

        # 宪法第十八条：版本号必须反映系统状态（2026-08-10 根因修复，四关通过）
        # 原 --confirm 只提交 VERSION.md，代码改动留工作区 → tag 与代码脱节 → 未提交泄漏到下次检测。
        # 现在系统文件未提交则拒绝打 tag，强制"先提交代码→再升级"。
        # 2026-08-10 盲区精化（判断#158，四关通过）：只查源码（ps1/py/js/sh+constitution/CLAUDE/AGENTS），
        # 运行时状态（_system-state/gate-audit 由 kernel 写）不查→不再自阻塞；git 失败 fail-closed（拒绝非放行）。
        $dirtyRaw = git -C $vault status --porcelain -- vault-scripts constitution.md CLAUDE.md AGENTS.md .claude/hooks 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ⛔ git 状态检查失败——无法确认系统源码是否已提交，拒绝升级（fail-closed）" -ForegroundColor Red
            return
        }
        $dirtySys = @($dirtyRaw | Where-Object { $_ -match '\.(ps1|py|js|sh)(\s|"|$)' -or $_ -match '(constitution|CLAUDE|AGENTS)\.md' })
        if ($dirtySys.Count -gt 0) {
            Write-Host "  ⛔ 系统源码有未提交改动——先提交代码再升级（宪法第十八条：版本号必须反映系统状态）" -ForegroundColor Red
            $dirtySys | Select-Object -First 5 | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
            Write-Host "     提示: git add <文件> && git commit，然后重跑 kernel upgrade --confirm" -ForegroundColor Yellow
            return
        }

        # ── 降级审计（判断#522·v3.2.45·四关通过·碰撞辛浩然第二大脑同步规则第½层）：权限降级=P0阻断 ──
        # 基准=上一个版本 tag（审计"本次升级净引入的变更"，在途无关变更不污染）；
        # 红标模式旧版(tag)存在而新版(HEAD)消失 = 保护性内容被删/改写 → 阻断；
        # 全文级计数 → 位置移动不误报；诚实边界：语义等价改写/配置层降级防不住——提高成本+强制留痕，非绝对拦截。
        $allowDowngrade = $false; $downgradeReason = ''
        if ($arg -match '^--allow-downgrade=(.+)$') { $allowDowngrade = $true; $downgradeReason = $Matches[1] }
        $lastTag = git -C $vault describe --tags --abbrev=0 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $lastTag) {
            Write-Host "  ⛔ 降级审计：无法确定上一个版本 tag，基准缺失，拒绝升级（fail-closed）" -ForegroundColor Red
            return
        }
        $auditFiles = @(git -C $vault diff --name-only $lastTag HEAD -- vault-scripts constitution.md CLAUDE.md AGENTS.md 2>$null)
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ⛔ 降级审计：git diff 失败，拒绝升级（fail-closed）" -ForegroundColor Red
            return
        }
        $redFlags = @('block_marker_missing_hard','Write-JsonAtomic','fail-closed','fail_closed','PreToolUse','loop-active','gate-check')
        $downgrades = @()
        foreach ($f in $auditFiles) {
            $oldContent = git -C $vault show "${lastTag}:$f" 2>$null
            if ($null -eq $oldContent -or $LASTEXITCODE -ne 0) { continue }  # 新增文件无降级可言
            $newContent = if (Test-Path "$vault\$f") { [System.IO.File]::ReadAllText("$vault\$f") } else { '' }
            foreach ($p in $redFlags) {
                $oldN = ([regex]::Matches($oldContent, [regex]::Escape($p))).Count
                $newN = ([regex]::Matches($newContent, [regex]::Escape($p))).Count
                if ($oldN -gt 0 -and $newN -eq 0) { $downgrades += "${f}: 红标 '$p' 出现 $oldN 次 → 0 次" }
            }
        }
        if ($downgrades.Count -gt 0 -and -not $allowDowngrade) {
            Write-Host "  ⛔ 降级审计 P0：检测到保护性内容被删除/改写（权限降级=静默数据丢失温床·判断#522）：" -ForegroundColor Red
            $downgrades | Select-Object -First 10 | ForEach-Object { Write-Host "     - $_" -ForegroundColor Red }
            Write-Host "     确需降级：用户逐项确认后以 kernel upgrade --confirm --allow-downgrade=理由 显式放行（留痕）" -ForegroundColor Yellow
            return
        }
        if ($downgrades.Count -gt 0 -and $allowDowngrade) {
            Write-Host "  ⚠ 降级审计：用户显式放行（理由: $downgradeReason）——降级项 $($downgrades.Count) 处，明细已留痕" -ForegroundColor Yellow
            $downgrades | Set-Content "$vault\vault-data\.last-downgrade-audit.txt" -Encoding UTF8
        }

        $tagName = ($approvalKey -replace '^upgrade_', '') -replace '__.*$', ''
        # 方案② 安全网：同版本兄弟提案已占用该 tag（双在途同版本确认）→ 顺延 patch 至空闲版本
        while ($true) {
            $tagExists = git -C $vault tag -l "$tagName" 2>$null
            if (-not $tagExists) { break }
            $tm = [regex]::Match($tagName, '^v(\d+)\.(\d+)\.(\d+)$')
            if (-not $tm.Success) { break }
            $tagName = "v$($tm.Groups[1].Value).$($tm.Groups[2].Value).$([int]$tm.Groups[3].Value + 1)"
        }
        # 顺延后让状态键版本前缀与最终 tag 一致（消除 key/tag 不一致），下方移除时即一致
        $newKey = "upgrade_$tagName"
        if ($approvalKey -ne $newKey) {
            $stateData.PSObject.Properties.Remove($approvalKey) | Out-Null
            $stateData | Add-Member -NotePropertyName $newKey -NotePropertyValue $approvals -Force
            $approvalKey = $newKey
        }
        if ($tagName -notmatch '^v\d+\.\d+\.\d+$') { Write-Host "  版本号格式错误" -ForegroundColor Red; return }

        $now = Get-Date -Format 'yyyy-MM-dd HH:mm'
        $newDate = Get-Date -Format 'yyyy-MM-dd'
        $newContent = @"
# 系统版本

## 当前：$tagName

| 宪法 | 内核 | 架构 | 评分 | 升级日期 |
|------|------|------|------|---------|
| v1（3核心+11特征+9动作） | kernel.ps1 v5 | 宪法→审计→五步→铸卡→回流 | 10/10 [S] | $newDate |

## 升级分级

| 级别 | 需要 | 版本号 |
|------|------|--------|
| 微升级 | 审计+法官 | 统一 vX.Y.(Z+1) |
| 普通升级 | 军师+审计+法官 | 统一 vX.Y.(Z+1) |
| 重大升级 | 军师+智囊团+审计+法官 | 统一 vX.Y.(Z+1) |

> 版本号统一从最后一位递增（三位数数数·判断#169）：不管什么等级都 vX.Y.(Z+1)，等级只决定审批角色，不决定版本跳位。

## 升级历史

| 版本 | 日期 | 等级 | 变更摘要 |
|------|------|------|---------|
| $tagName | $newDate | 待补充 | 待补充 |
"@
        Set-Content $vPath -Value $newContent -Encoding UTF8

        git -C $vault add "$vault\VERSION.md"
        git -C $vault commit -m "v$($tagName -replace '^v',''): 系统升级" --quiet
        git -C $vault tag -a "$tagName" -m "系统升级 $tagName" 2>$null
        if ($LASTEXITCODE -ne 0) { git -C $vault tag "$tagName" 2>$null }

        $stateData.PSObject.Properties.Remove($approvalKey)
        $stateData | ConvertTo-Json -Depth 5 -Compress | ForEach-Object { [System.IO.File]::WriteAllText($statePath, $_, (New-Object System.Text.UTF8Encoding($false))) }

        Write-Host "  ✅ 升级完成: $tagName" -ForegroundColor Green
        Write-Host "  git tag: $tagName" -ForegroundColor DarkGray
        if (-not (Exit-UpgradeLock)) { throw "升级已提交，但全仓事务锁未能安全释放；需人工核验锁状态" }
        return
    }

    if ($subCmd -eq 'auto' -or $subCmd -eq '--auto') {
        # ── 自动升级：检测→审批→执行 全自动 ──
        Write-Host ''; Write-Host '  ═══ 自动升级执行 ═══' -ForegroundColor Cyan

        # 1. 检测变更
        $verContent = if (Test-Path $vPath) { Get-Content $vPath -Encoding UTF8 -Raw } else { '' }
        $lastTag = git -C $vault describe --tags --abbrev=0 2>$null
        $diffFiles = if ($lastTag) { git -C $vault diff --name-only "$lastTag..HEAD" 2>$null } else { @() }
        $unstaged = git -C $vault diff --name-only 2>$null
        $allChanged = @($diffFiles) + @($unstaged) | Select-Object -Unique

        $hasKernel=$false; $hasStructural=$false
        foreach ($f in $allChanged) {
            if ($f -match 'CLAUDE\.md|constitution\.md|vault-scripts/.+\.ps1') { $hasStructural = $true }
            if ($f -match 'vault-scripts/kernel\.ps1$') { $hasKernel = $true }
        }

        if (-not $hasKernel -and -not $hasStructural) {
            Write-Host '  无结构性变更，不需要升级' -ForegroundColor Green
            Write-Host '  ═══'; return
        }

        if ($hasKernel) { $level='MAJOR'; $need='军师+智囊团+审计+法官'
        } else { $level='NORMAL'; $need='军师+审计+法官' }

        # 版本号统一从最后一位递增（判断#169·用户指令「三位数数数」），等级只决定审批角色
        # 约束：数字位上限调高不轻易进位；升级克制、质量密度够才升（用户判断#169）
        $curMajor=1; $curMinor=1; $curPatch=0
        if ($verContent -match 'v(\d+)\.(\d+)\.(\d+)') { $curMajor=[int]$matches[1]; $curMinor=[int]$matches[2]; $curPatch=[int]$matches[3] }
        $nextMajor=$curMajor; $nextMinor=$curMinor; $nextPatch=$curPatch+1
        $tagName = "v$nextMajor.$nextMinor.$nextPatch"

        # 2. 检查违规并 auto-fix（未提交变更）
        $hasViolations = $false
        $newFiles = @()
        if ($lastTag) { $newFiles = git -C $vault diff --name-only --diff-filter=A "$lastTag..HEAD" 2>$null }
        $delFiles = @()
        if ($lastTag) { $delFiles = git -C $vault diff --name-only --diff-filter=D "$lastTag..HEAD" 2>$null }
        $netNew = ($newFiles | Where-Object { $c=$_.Trim('"'); $c -notmatch '^(vault-data|\.claude)/' -and $c -notmatch '^\d{2}' -and $c -match '\.(md|json|ps1)$' }).Count - ($delFiles | Where-Object { $c=$_.Trim('"'); $c -notmatch '^(vault-data|\.claude)/' -and $c -notmatch '^\d{2}' -and $c -match '\.(md|json|ps1)$' }).Count

        if ($netNew -gt 0) {
            Write-Host "  ⚠ 净增 $netNew 个文件——auto-fix 需要人工确认删除哪些旧文件" -ForegroundColor Yellow
            $hasViolations = $true
        }
        git -C $vault diff --cached --quiet 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ⚠ 有未提交的变更——auto-commit" -ForegroundColor DarkGray
            git -C $vault add -A 2>$null
            git -C $vault commit -m "auto: pre-upgrade commit" --quiet 2>$null
        }
        if (-not (git -C $vault diff --cached --quiet 2>$null) -or $hasViolations) {
            # 还有未提交的文件变更
            git -C $vault add -A 2>$null
            git -C $vault commit -m "auto: pre-upgrade commit" --quiet 2>$null
        }

        # 3. 自动更新 VERSION.md
        $newDate = Get-Date -Format 'yyyy-MM-dd'
        $newContent = @"
# 系统版本

## 当前：$tagName

| 宪法 | 内核 | 架构 | 评分 | 升级日期 |
|------|------|------|------|---------|
| v1（3核心+11特征+9动作） | kernel.ps1 v5 | 宪法→审计→五步→铸卡→回流 | 10/10 [S] | $newDate |

## 升级分级

| 级别 | 需要 | 版本号 |
|------|------|--------|
| 微升级 | 审计+法官 | 统一 vX.Y.(Z+1) |
| 普通升级 | 军师+审计+法官 | 统一 vX.Y.(Z+1) |
| 重大升级 | 军师+智囊团+审计+法官 | 统一 vX.Y.(Z+1) |

> 版本号统一从最后一位递增（三位数数数·判断#169）：不管什么等级都 vX.Y.(Z+1)，等级只决定审批角色，不决定版本跳位。

## 升级历史

| 版本 | 日期 | 等级 | 变更摘要 |
|------|------|------|---------|
| $tagName | $newDate | $level | 自动升级 |
"@
        Set-Content $vPath -Value $newContent -Encoding UTF8

        # 4. git tag
        git -C $vault add "$vault\VERSION.md"
        git -C $vault commit -m ("v" + $nextMajor + "." + $nextMinor + "." + $nextPatch + ": " + $level + " 自动升级") --quiet
        git -C $vault tag "$tagName" 2>$null

        # 5. 推送远端
        $remotes = git -C $vault remote 2>$null
        foreach ($r in $remotes) {
            git -C $vault push $r master --tags 2>$null | Out-Null
            Write-Host "  📤 已推送到 $r" -ForegroundColor DarkGray
        }

        Write-Host "  ✅ $tagName ($level 自动升级)" -ForegroundColor Green
        Write-Host "  版本: v$curMajor.$curMinor.$curPatch → $tagName" -ForegroundColor Green
        Write-Host '  ═══' -ForegroundColor Cyan
        return
    }

    Write-Host ''; Write-Host '  ═══ 升级管线命令 ═══' -ForegroundColor Cyan
    Write-Host '  kernel upgrade                     — 显示升级报告' -ForegroundColor DarkGray
    Write-Host '  kernel upgrade auto               — 全自动升级（检测+审批+版本）' -ForegroundColor Green
    Write-Host '  kernel upgrade --approve 军师       — 批准该角色' -ForegroundColor DarkGray
    Write-Host '  kernel upgrade --reject  审计       — 驳回该角色' -ForegroundColor DarkGray
    Write-Host '  kernel upgrade --confirm           — 所有审批通过后执行升级' -ForegroundColor DarkGray
    Write-Host '  ═══' -ForegroundColor Cyan
}
