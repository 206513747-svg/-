# settle-session.ps1 - session startup settlement
# auto-fills missing records from the previous session
# v3.2.37 (2026-09-02) P0c内联合并: ai-register.ps1 逻辑合入 (-RegisterAi 模式)

param(
  [ValidateSet('cursor','workbuddy','codex','opencode','qwen','gemini','trae','qclaw','local','dsh','qoder')]
  [string]$RegisterAi
)

$Vault = & (Join-Path $PSScriptRoot 'vault-root.ps1')

# ── RegisterAi 模式：先解析当前根，再将共享登记写入主树 ──
if ($RegisterAi) {
  # 唯一登记入口：不再复制 ai-register 的写入逻辑，确保台账门、requiredReads、标准输出和原子登记只有一份实现。
  $registerScript = Join-Path $PSScriptRoot 'ai-register.ps1'
  if (-not (Test-Path -LiteralPath $registerScript)) { throw "唯一 AI 登记入口缺失：$registerScript" }
  $env:AI_NAME = $RegisterAi.ToLower()
  $LASTEXITCODE = 0
  & $registerScript -Ai $RegisterAi -Read all
  if ($LASTEXITCODE -ne 0) { throw "ai-register.ps1 未成功完成：$RegisterAi（rc=$LASTEXITCODE）" }
  exit 0
}
# 判#870 自愈：指令循环 marker 丢失自动补位（09-27 实测 .loop-active 被清后写操作全拦只能手动救）
# ——会话启动第一件事把循环接回；heartbeat 只监测不修复·本行是唯一的自动自愈点
if (-not (Test-Path "$Vault\vault-data\.loop-active")) {
    New-Item -Path "$Vault\vault-data\.loop-active" -ItemType File -Force | Out-Null
    Write-Output "  [self-heal] .loop-active 缺失已自动补位（判#870）"
}
. "$Vault\vault-scripts\safe-file.ps1"
. "$Vault\vault-scripts\Write-JsonAtomic.ps1"  # 2026-08-30 审计：BOM 根治（写入宪法·atomic-write）
Init-Encoding
$AtomsPath = $Vault + "\07 · 原子库\atoms.jsonl"
$CursorPath = $Vault + "\vault-data\session-atom-cursor.json"
$CardsDir = $Vault + "\02-Areas · 资产"

# ===== 代理自愈已由内而外归位（2026-08-03）=====
# 代理是基础设施组件（与 Ollama 同级），自愈照 Ollama 模式归入 hub.ps1（Check-Proxy/Repair-Proxy，状态栏每2分钟后台自愈，记 PROXY RECOVERED）。
# 从启动路径拆出：启动只做会话必需；github 走 SSH 直连不依赖代理，不再用"走代理测 github"判断可达性（代理坏会误判）。
# ===== git 网络超时保护（2026-08-03 根因修复）=====
# 根因：GitHub 不可达时，git push / ls-remote 无超时无限重试，阻塞会话启动 ~90s。
# 修复：ConnectTimeout 让不可达 SSH 远端快速失败；BatchMode 禁止交互等密码；不可达时推送失败快速返回，不阻塞启动。
$env:GIT_SSH_COMMAND = 'ssh -o ConnectTimeout=5 -o BatchMode=yes'

# ===== 钩子耗时记录（2026-08-03 提前性机制：供 gate.ps1 r16 钩子基线审计）=====
# 每次启动把 settle 耗时写入 gate-log.jsonl(type=startup)，下次启动 r16 对比基线，
# 连续2次超阈值 → WARN。让"启动变慢"在下一次就被自动发现，不靠用户感觉。
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$SessionRecord = $Vault + "\vault-scripts\session-record.json"
$JudgmentLog = $Vault + "\vault-scripts\judgment-log.md"
$AtomizeScript = $Vault + "\vault-scripts\auto-atomize.js"

$Changes = @()
$today = Get-Date -Format "yyyy-MM-dd"

# 1. sync atom cursor
$AtomCount = 0
if (Test-Path $AtomsPath) {
    $lines = Get-Content $AtomsPath | Where-Object { $_ -ne "" }
    $AtomCount = $lines.Count
}
$Cursor = @{ total_atoms = 0; last_atom_id = ""; updated_at = "" }
if (Test-Path $CursorPath) {
    $c = [System.IO.File]::ReadAllText($CursorPath, (New-Object System.Text.UTF8Encoding($false)))
    try { $Cursor = $c | ConvertFrom-Json } catch {}
}
if ($Cursor.total_atoms -ne $AtomCount) {
    $Cursor.total_atoms = $AtomCount
    $Cursor.updated_at = $today
    Write-JsonAtomic -Path $CursorPath -Json ($Cursor | ConvertTo-Json)
    $Changes += "cursor-sync:" + $AtomCount
}

# 2. scan for missing atoms from KC cards — 验证分层(204788b2): 变化O(Δ)+12h兜底, 不每次启动O(N)
# 根因(2026-08-05): 每次启动187次node spawn≈6.4s, 扫"从未发生"的缺原子(auto-atomize历史0触发, reconcile missing=0)
# 由内而外: 复用本脚本4b/4c既有 git-driven+12h marker 模式——卡没变跳过, 变了/超12h才扫
$AtomMarker = "$Vault\vault-data\.atoms-check-last"
$atomsDue = $true
if (Test-Path $AtomMarker) {
    try {
        $lastAtomCheck = [datetime](Get-Content $AtomMarker -Raw)
        if ((Get-Date) - $lastAtomCheck -lt [timespan]::FromHours(12)) { $atomsDue = $false }
    } catch {}
}
$atomsCardsChanged = $false
$atomHead = & git -C "$Vault" log -1 --format=%H 2>$null
if ($atomHead) {
    $atomPrevHead = & git -C "$Vault" rev-parse "$atomHead^" 2>$null
    if ($atomPrevHead) {
        $atomD1 = @(& git -C "$Vault" diff --name-only "$atomPrevHead" "$atomHead" -- "02-Areas · 资产" 2>$null)
        if ($atomD1.Count -gt 0) { $atomsCardsChanged = $true }
    } else { $atomsCardsChanged = $true }
}
$atomD2 = @(& git -C "$Vault" status --porcelain -- "02-Areas · 资产" 2>$null)
if ($atomD2.Count -gt 0) { $atomsCardsChanged = $true }

if (($atomsCardsChanged -or $atomsDue) -and (Test-Path $CardsDir)) {
    $Cards = Get-ChildItem -Path $CardsDir -Filter "KC-*.md"
    $Missing = @()
    foreach ($Card in $Cards) {
        $id = $null
        if ($Card.BaseName -match "(KC-[A-Z]+-[0-9]+)") { $id = $Matches[1] }
        if (-not $id) { continue }
        $found = $false
        if (Test-Path $AtomsPath) {
            # 用 node 精确匹配（检查 source 字段 = 卡片:KC-xxx，而非全文模糊搜）
            $match = & node -e "try{const fs=require('fs');const d=fs.readFileSync('$($AtomsPath.replace('\','\\'))','utf-8');const found=d.split('\n').filter(Boolean).some(l=>{try{const j=JSON.parse(l);return j.source==='卡片:$id'||j.atom_id==='$id'}catch(e){return false}});process.stdout.write(found?'1':'0')}catch(e){process.stdout.write('0')}" 2>&1
            if ($match -eq "1") { $found = $true }
        }
        if (-not $found) {
            $Missing += $Card.FullName
        }
    }
    if ($Missing.Count -gt 0) {
        $Changes += "atoms-missing:" + $Missing.Count
        foreach ($m in $Missing) {
            & node $AtomizeScript $m 2>&1 | Out-Null
        }
        $Changes += "atoms-auto:" + $Missing.Count
    }
    (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Set-Content $AtomMarker -Encoding UTF8
}

# 3. 终身雷达触发器 — 每季度检测一次
# 2026-08-12 由内而外修复（判断#173 用户质疑"怎么就开始季度复盘了"）：
# 对齐判断#48 优雅降级——last_review 空=从未复盘过，只提醒"建立基线"不当"到期强制"；
# 真实超期=有上次日期且>90天 才 DUE。原逻辑空值每次启动 DUE → 用户被反复催，顺水执行了模板复盘。
$radarFile = $Vault + "\vault-data\lifetime-radar.json"
$radarDue = $false
if (Test-Path $radarFile) {
    $radar = [System.IO.File]::ReadAllText($radarFile, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
    if ($radar.last_review) {
        try {
            $lastRadar = [datetime]$radar.last_review
            # 对齐判断#48 优雅降级（evidence-audit.ps1:249「空=首次只提醒不超期；真实超期=有上次日期且>间隔」）
            # 边界明确：=90天 不 DUE（严格 >90 才 DUE）；非法日期走 catch 按未复盘处理
            if ((Get-Date) - $lastRadar -gt [timespan]::FromDays(90)) { $radarDue = $true }
        } catch {
            Write-Host "🧭 Lifecycle radar: last_review 非法日期（$($radar.last_review)）→ 按未复盘处理，建议建立基线（非到期强制）"
            $Changes += "LIFETIME-RADAR-BASELINE"
        }
    } else {
        # 空=从未复盘：只提醒建立基线，不当到期强制（判断#48 优雅降级）
        Write-Host "🧭 Lifecycle radar: 从未季度复盘——建议建立首次基线（非到期强制）"
        $Changes += "LIFETIME-RADAR-BASELINE"
    }
} else {
    Write-JsonAtomic -Path $radarFile -Json (@{ last_review = ""; next_review = "" } | ConvertTo-Json)
    Write-Host "🧭 Lifecycle radar: 首次启动——建立雷达基线（非到期强制）"
    $Changes += "LIFETIME-RADAR-BASELINE"
}
if ($radarDue) {
    $Changes += "LIFETIME-RADAR-DUE"
    Write-Host "🧭 Lifecycle radar: >90d since last quarterly review"
}

# 4. auto-settle session-record from evidence files
$SessionOk = $true
if (Test-Path $SessionRecord) {
    $sr = [System.IO.File]::ReadAllText($SessionRecord, (New-Object System.Text.UTF8Encoding($false)))
    try {
        $parsed = $sr | ConvertFrom-Json
        $last = $parsed.sessions | Select-Object -Last 1
        if ($last.date -and ($last.date -ne $today)) { $SessionOk = $false }
    } catch { $SessionOk = $false }
}
if (-not $SessionOk) {
    # 从已有证据链自动补充上次的会话记录
    $lastJudgment = ""
    if (Test-Path $JudgmentLog) {
        $jLines = Get-Content $JudgmentLog -Tail 50
        foreach ($jl in $jLines) {
            if ($jl -match '\|\s*\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|') { $lastJudgment = $jl.Trim() }
        }
    }
    $cardCount = 0
    $cardFile = "$Vault\vault-data\card-calls.jsonl"
    if (Test-Path $cardFile) { $cardCount = (Get-Content $cardFile | Where-Object { $_ -match "create" } | Measure-Object).Lines }
    $autoEntry = @{
        date = $today
        auto_generated = $true
        judgment_log_summary = $lastJudgment.Substring(0, [Math]::Min(120, $lastJudgment.Length))
        cards_created = $cardCount
        generated_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    }
    $parsed.sessions += $autoEntry
    $jsonOut = $parsed | ConvertTo-Json -Depth 3
    Write-File -Path $SessionRecord -Content $jsonOut
    $Changes += "session-record:auto-filled"
}

# 4. judgment-log outdated → 生产性工作未沉淀则 BLOCK（2026-08-10 物理化·判断#158）
# 2026-08-11 判定修正（判断#159·天团+智囊团研判）：判断日志是人工编辑的沉淀，不该要求"今天必须写"。
# 正确判据：上次会话结束后，判断日志是否有新增（按文件修改时间）——任何时间补了判断都 PASS，防误报死锁。
$JudgmentOk = $true
if (Test-Path $JudgmentLog) {
    try {
        # 上次会话日期：从 session-record 取最后一条非 auto 的真实会话日期
        $lastRealDate = $null
        if (Test-Path $SessionRecord) {
            $sr2 = Get-Content $SessionRecord -Raw -Encoding UTF8 | ConvertFrom-Json
            $realSess = $sr2.sessions | Where-Object { $_ -and -not $_.auto_generated } | Select-Object -Last 1
            if ($realSess -and $realSess.date) { $lastRealDate = [datetime]$realSess.date }
        }
        # 判断日志最后修改时间
        $jLogWrite = (Get-Item $JudgmentLog).LastWriteTime
        if ($lastRealDate) {
            # 有真实上次会话：判断日志必须在上次会话日期当天或之后新增过（文件修改时间）
            if ($jLogWrite.Date -lt $lastRealDate.Date) { $JudgmentOk = $false }
        } else {
            # 无真实会话记录（新系统）：退回日期匹配判定
            $dates = Select-String -Path $JudgmentLog -Pattern "\d{4}-\d{2}-\d{2}"
            $lastDate = $dates | Select-Object -Last 1
            if ($lastDate -and ($lastDate.Matches.Value -ne $today)) { $JudgmentOk = $false }
        }
    } catch { $JudgmentOk = $true }  # 读取失败不误报（宽容降级：宁可放行不误拦）
}
if (-not $JudgmentOk) {
    # 2026-08-11 移除 BLOCK 门控（判断#159·真四关 4.2/10 驳回"修门"方案，天团日日新点破：
    # 判断日志是人工沉淀，不该被程序当启动门控强制。第三次复发证明"修门"永远无效——拆门）。
    # 判断沉淀回归纠正#8 行为标准（AI 会话中主动补），settle 只提示不写标记不拦写。
    $productive = git -C $Vault status --porcelain 2>$null | Where-Object { $_ -notmatch 'gate-log|observations|_system-state|card-calls|llm-cost|_schema\.|audit-todo|signals|network-status|gate-health|\.proxy-heal|\.sync-refs|\.evidence|_judgment-missing' }
    if ($productive) {
        # 有生产性工作但判断日志可能未沉淀 → 仅提示（AI 会话中主动补判断，纠正#8），不写 .judgment-missing、不 BLOCK
        $Changes += "judgment-log:overdue-remind"
    } else {
        $Changes += "judgment-log:outdated"
    }
    # 双面报告提示（2026-08-10 诚实标注·判断#158）：判断日志条目建议含"完成/未做"，语义判断靠用户检查，不假装物理门
    $Changes += "report:double-sided-reminder"
}

# 4a. auto-detect correction → no permanent fix
if (Test-Path $JudgmentLog) {
    $lastEntry = Get-Content $JudgmentLog -Tail 30 | Where-Object { $_ -match '\|\s*\d+\s*\|' } | Select-Object -Last 1
    if ($lastEntry -and $lastEntry -match '纠正|纠正了|纠正后的') {
        # 检查permanent-fixes.md是否有最近（今天）的条目
        $fixFile = "$Vault\vault-data\permanent-fixes.md"
        $fixFound = $false
        if (Test-Path $fixFile) {
            $fixLines = Get-Content $fixFile | Where-Object { $_ -match '\|\s*\d+\s*\|' }
            $todayFix = ($fixLines | Select-Object -Last 1)
            if ($todayFix -and $todayFix -match $today) { $fixFound = $true }
        }
        if (-not $fixFound) {
            # 创建阻止标记——gate-check.sh会拦截写操作
            $today | Out-File -FilePath "$Vault\vault-data\.fix-pending" -Encoding utf8 -Force
            $Changes += "fix-pending: correction found without permanent fix"
            Write-Host "  ⛔ Previously corrected but permanent fix not installed. Fix first:" -ForegroundColor Red
            Write-Host "  Read permanent-fixes.md → add entry → rm vault-data/.fix-pending" -ForegroundColor Red
        }
    }
}

# 4a½. permanent-fixes 末尾条目连续性自检（由内而外·防并发覆盖丢失 2026-07-31）
# 根因：permanent-fixes 多写入者（AI Edit + 手动），基于旧版本写回会覆盖未提交条目（#18 曾丢失）
# 检测末尾5条编号连续性——丢失总发生在最近条目。历史重复编号（如#3）不在末尾，不误报
$fixSkipFile = "$Vault\vault-data\permanent-fixes.md"
$fixNumList = @()
if (Test-Path $fixSkipFile) {
    Get-Content $fixSkipFile | ForEach-Object {
        if ($_ -match '^\|\s*(\d+)\s*\|') { $fixNumList += [int]$Matches[1] }
    }
    if ($fixNumList.Count -ge 3) {
        $fixTail = $fixNumList | Select-Object -Last 5
        $prevNum = $fixTail[0]
        foreach ($n in $fixTail[1..($fixTail.Count-1)]) {
            if ($n -ne ($prevNum + 1)) {
                Write-Host "  ⚠️ permanent-fixes 末尾条目跳号: $prevNum -> $n（缺 $($prevNum+1)），可能被并发覆盖，查 git diff" -ForegroundColor Yellow
                $Changes += "permanent-fixes skip: $prevNum -> $n"
                break
            }
            $prevNum = $n
        }
    }
}

# 4a⅔. judgment-log 防污染自检（由内而外·防重复条目 2026-08-04）
# 根因：vault-data/judgment-log.md 镜像曾 #50 重复12次污染。live 文件防复发。
# 检测条目编号重复（count vs unique）——重复=可能被并发追加污染
$jlogFile = "$Vault\vault-scripts\judgment-log.md"
$jnumList = @()
if (Test-Path $jlogFile) {
    Get-Content $jlogFile | ForEach-Object {
        if ($_ -match '（第(\d+)条）') { $jnumList += [int]$Matches[1] }
        elseif ($_ -match '^## \[#(\d+)\]') { $jnumList += [int]$Matches[1] }
    }
    if ($jnumList.Count -ge 3) {
        $jdups = $jnumList | Group-Object | Where-Object { $_.Count -gt 1 }
        if ($jdups.Count -gt 0) {
            Write-Host "  ⚠️ judgment-log 条目编号重复: $($jdups.Name -join ',')（可能被并发追加污染，查 git diff）" -ForegroundColor Yellow
            $Changes += "judgment-log dup: $($jdups.Name -join ',')"
        }
        $jsorted = $jnumList | Sort-Object
        $jmax = $jsorted[-1]; $jmin = $jsorted[0]
        $jexpected = $jmax - $jmin + 1
        if ($jsorted.Count -gt $jexpected) {
            Write-Host "  ⚠️ judgment-log 条目疑似重复($($jsorted.Count)条 vs 编号应有$jexpected)" -ForegroundColor Yellow
            $Changes += "judgment-log count-mismatch"
        }
    }
}

# 4a¾. 数据压缩提炼检查（边界·2026-08-04）
# 边界(用户): ①每次对话完成必须数据压缩提炼(蒸馏成判断/卡片/共享记忆精华) ②提炼压缩≠删除,我的数据都保留
# 检查: 会话是否产出精华(今日判断日志 or 今日共享记忆)——没产出=未提炼。不删任何数据。
$refineDate = (Get-Date).Date
$Refined = $false
if (Test-Path $jlogFile) {
    $jlToday = Get-Content $jlogFile -ErrorAction SilentlyContinue | Where-Object { $_ -match $refineDate.ToString('yyyy-MM-dd') } | Measure-Object
    if ($jlToday.Count -gt 0) { $Refined = $true }
}
$sharedToday = Get-ChildItem "$Vault\06 · 共享记忆" -Filter "*.md" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime.Date -eq $refineDate } | Measure-Object
if ($sharedToday.Count -gt 0) { $Refined = $true }
if (-not $Refined) {
    Write-Host "  ⚠️ 会话未数据压缩提炼(无今日判断/卡片/共享记忆)——边界:每次对话完成要提炼压缩,数据都保留不删除" -ForegroundColor Yellow
    $Changes += "refine:missing"
}

# 4b/4c/9c½ 合并为"卡片健康检查"——2026-08-03 极致优化：git变更驱动 + 一次遍历三检查 + 12h兜底
# 质量不降：任何卡变更(产生 root-link缺失/重复ID/编码损坏)都会触发检查；12h强制全扫兜底历史遗留
# 效率不降：正常会话(无卡变更)跳过全库扫描；变更时一次 ReadAllText 同时做三个检查
$CardDir = "$Vault\02-Areas · 资产"
# ── 判#1418 续（根源修复·第二轮）：根卡链接名不再写死，从门源推导 ──
# 【上一轮我修错了什么（如实记）】上轮只把「链接形态转换」当成别人做的噪声去清理，
#   没问一句「机器为什么一直在补这行」。真源在这里：`$RootLink = '[[KC-SYS-001]]'`。
#   实测（本轮）：库里**没有**叫 `KC-SYS-001` 的卡，只有 `KC-SYS-001-系统根系`
#   ⇒ 这个常量指的是**断链（判#685 假链）**。后果三层，逐层实测：
#     ① 拿断链名去判「卡里有没有根链接」→ 505 张卡**全部**判「缺」；
#     ② 于是每轮都往卡里追加一行 `· [上游] [[KC-SYS-001]] …——自动补全`，加进去的仍是断链名；
#     ③ 实测分布：只有旧名 242 张 / 新旧都有 263 张 / 只有新名 0 张
#        ——**263 张挂着两条（一断一真）**，242 张只挂断链。机在无限补一条永远不会对的链接。
# 【治法·减法三问①用现成的】根卡真名不该在这里再写死一份（判#1328 唯一源），
#   门源 `entry-gate.json` 的 requiredReads 已给出真实路径（token=standard）。
#   从那里取 basename ⇒ 卡改名时这里**自动跟随**，不会再与库分叉。
#   取不到才退回写死的全名（fail-safe，且是全名而非断名）。
$RootLink = ''
try {
    $gateSrc = Get-Content "$Vault\vault-data\entry-gate.json" -Raw -Encoding UTF8 -EA Stop | ConvertFrom-Json
    $std = @($gateSrc.requiredReads) | Where-Object { $_.token -eq 'standard' } | Select-Object -First 1
    if ($std -and $std.file) {
        $base = [System.IO.Path]::GetFileNameWithoutExtension($std.file)   # KC-SYS-001-系统根系
        if ($base) { $RootLink = "[[$base]]" }
    }
} catch { }
if (-not $RootLink) { $RootLink = '[[KC-SYS-001-系统根系]]' }   # fail-safe：全名，绝不是断链名
# 旧断链名：只用于**识别并清理**历史遗留的 `[[KC-SYS-001]]` 行，绝不用它判存在性
$RootLinkLegacy = '[[KC-SYS-001]]'
$HealthMarker = "$Vault\vault-data\.card-health-last"
$CardMissing = 0
$RootLinkLegacyCleaned = 0
$DuplicateIds = 0
$SeenIds = @{}
$encodingIssues = @()
$cardsChanged = $false
$healthDue = $true
# 12h 兜底：即使无 git 变更也定期全扫，防止历史遗留问题漏检
if (Test-Path $HealthMarker) {
    try {
        $lastHealth = [datetime](Get-Content $HealthMarker -Raw)
        if ((Get-Date) - $lastHealth -lt [timespan]::FromHours(12)) { $healthDue = $false }
    } catch {}
}
# git 变更驱动：最近提交或工作树有卡变更 → 必须检查
$curHead = & git -C "$Vault" log -1 --format=%H 2>$null
if ($curHead) {
    $prevHead = & git -C "$Vault" rev-parse "$curHead^" 2>$null
    if ($prevHead) {
        $d1 = @(& git -C "$Vault" diff --name-only "$prevHead" "$curHead" -- "02-Areas · 资产" 2>$null)
        if ($d1.Count -gt 0) { $cardsChanged = $true }
    } else { $cardsChanged = $true }
}
$d2 = @(& git -C "$Vault" status --porcelain -- "02-Areas · 资产" 2>$null)
if ($d2.Count -gt 0) { $cardsChanged = $true }

if (($cardsChanged -or $healthDue) -and (Test-Path $CardDir)) {
    # 一次遍历：Get-ChildItem -Recurse + ReadAllText 一次，同时做 root-link / duplicate / encoding 三检查
    $allCards = Get-ChildItem -Path $CardDir -Recurse -Filter "KC-*.md" -File
    foreach ($c in $allCards) {
        try {
            $text = [System.IO.File]::ReadAllText($c.FullName, (New-Object System.Text.UTF8Encoding($false)))
            # 4b root-link：缺则补全（判#1418 续：补**真名**；并顺手清掉历史断链行——加删同步，不是只加）
            #   旧行为两个病：① 用断链名判存在性 ⇒ 永远判缺；② 补进去的还是断链名 ⇒ 卡里两条重复一断一真。
            #   新行为：① 用真名判；② 补真名；③ 若卡里残留 `· [上游] [[KC-SYS-001]] …自动补全` 断链行 → 就地删掉（提纯）。
            $legacyLine = '· [上游] [[KC-SYS-001]] 系统根系——自动补全'
            if ($text -match [regex]::Escape($legacyLine)) {
                $newText = ($text -split "`r?`n" | Where-Object { $_.Trim() -ne $legacyLine }) -join "`r`n"
                [System.IO.File]::WriteAllText($c.FullName, $newText, (New-Object System.Text.UTF8Encoding($false)))
                $text = $newText
                $RootLinkLegacyCleaned++
            }
            if ($text -notmatch [regex]::Escape($RootLink)) {
                $CardMissing++
                Append-File -Path $c.FullName -Content "`n· [上游] $RootLink 系统根系——自动补全"
            }
            # 4c duplicate：同 ID 多目录冲突
            if ($c.BaseName -match "(KC-[A-Z]+-[0-9]+)") { $id = $Matches[1] } else { $id = $c.BaseName }
            if ($SeenIds.ContainsKey($id)) { $DuplicateIds++ } else { $SeenIds[$id] = $true }
            # 9c½ encoding：UTF-8 替换符
            if ($text -match "�") { $encodingIssues += "$($c.Name)" }
        } catch { $encodingIssues += "$($c.Name)" }
    }
    if ($CardMissing -gt 0) { $Changes += "root-link-fixed:$CardMissing cards" }
    if ($DuplicateIds -gt 0) { $Changes += "duplicate-kc-ids:$DuplicateIds conflicts" }
    (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Set-Content $HealthMarker -Encoding UTF8
}

# 5. sync-refs full scan + auto-fix (use node to parse report, avoid PS encoding issue)
$Python = "C:\Users\Mi\AppData\Local\Programs\Python\Python312\python.exe"
$SyncRef = $Vault + "\vault-scripts\sync-refs.py"
$SyncReport = $Vault + "\vault-data\sync-report.json"
# 2026-08-03 根因修复：sync-refs 全库扫描 ~24s，限频每 12h 跑一次（质量不降：依赖地图保证 ≤12h 新鲜）
# v3.2.37 (P0a/P0b/P1/P4)：后台化拆出独立 runner 脚本 + 12h jitter + fg-done/fg-count 熔断 + fail 计数 + mtime 超龄
$SyncMarker = "$Vault\vault-data\.sync-refs-last"
# v3.2.37 (P0c)：合回本脚本——sync-refs-runner.ps1 逻辑以内联 EncodedCommand 方式嵌入，消除外部脚本依赖（满足先删后加）
$syncStatePath = "$Vault\vault-data\.sync-refs-state.json"
$syncFgDone = "$Vault\vault-data\.sync-refs-fg-done"
$syncFgCount = "$Vault\vault-data\.sync-refs-fg-count"
$syncStarted = $false
$failThreshold = 3
$staleThresholdHours = 24
$fgMaxRetry = 2

# P4：读取 fg-done，存在且 <12h 则跳过前台执行
$fgSkipped = $false
if (Test-Path $syncFgDone) {
    try {
        $fgTime = [datetime]::Parse((Get-Content $syncFgDone -Raw))
        if (((Get-Date) - $fgTime).TotalHours -lt 12) { $fgSkipped = $true }
        else { Remove-Item $syncFgDone -ErrorAction SilentlyContinue; Remove-Item $syncFgCount -ErrorAction SilentlyContinue }
    } catch {}
}

# P1：12h 限频 + ±30min jitter
$syncDue = $true
if (Test-Path $SyncMarker) {
    try {
        $lastSync = [datetime](Get-Content $SyncMarker -Raw)
        $jitter = [TimeSpan]::FromMinutes((Get-Random -Minimum (-30) -Maximum 30))
        if ((Get-Date) - $lastSync -lt ([timespan]::FromHours(12) + $jitter)) { $syncDue = $false }
    } catch {}
}

if ($syncDue -and (-not $fgSkipped)) {
    $state = $null
    if (Test-Path $syncStatePath) {
        try { $state = Get-Content $syncStatePath -Raw | ConvertFrom-Json } catch { $state = $null }
    }
    # mtime 超龄检测（残余风险：依赖系统时钟单调性，≤36.5h 窗口由 mtime 兜底）
    $stale = $false
    if ($state -and $state.mtime) {
        try { $stale = ((Get-Date) - [datetime]::Parse($state.mtime)).TotalHours -ge $staleThresholdHours }
        catch { $stale = $true }
    }
    if (-not $state) { $stale = $true }

    if ($state -and [int]$state.fail -ge $failThreshold) {
        # fail≥3 → 前台兜底
        & $Python $SyncRef 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $now = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
            $json = @{success=$now;mtime=$now;fail=0} | ConvertTo-Json -Compress
            $tmp = "$syncStatePath.tmp"; [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
            Move-Item -Path $tmp -Destination $syncStatePath -Force -ErrorAction SilentlyContinue
            Remove-Item $syncFgCount -ErrorAction SilentlyContinue
        }
        $Changes += "sync-refs:foreground-recovery"
    } elseif ($stale) {
        # mtime 超龄或无状态 → 前台兜底
        & $Python $SyncRef 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $now = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
            $json = @{success=$now;mtime=$now;fail=0} | ConvertTo-Json -Compress
            $tmp = "$syncStatePath.tmp"; [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
            Move-Item -Path $tmp -Destination $syncStatePath -Force -ErrorAction SilentlyContinue
        }
        $Changes += "sync-refs:foreground"
    } else {
        # 正常状态 → 后台 runner（v3.2.37 P0c：原 sync-refs-runner.ps1 逻辑内联为 EncodedCommand，消除外部脚本依赖）
        try {
            $runnerScript = @"
`$StatePath = '$($syncStatePath.Replace("'","''"))'
`$Python = '$($Python.Replace("'","''"))'
`$SyncRef = '$($SyncRef.Replace("'","''"))'
`$LogPath = "`$StatePath.log"
`$output = & `$Python `$SyncRef 2>&1 | Out-String
`$success = (`$LASTEXITCODE -eq 0)
if (`$output.Length -gt 0) {
  `$truncated = `$output.Substring(0, [Math]::Min(`$output.Length, 65536))
  [System.IO.File]::WriteAllText(`$LogPath, `$truncated, (New-Object System.Text.UTF8Encoding($false)))
}
function Get-SyncRefsState {
  try {
    if (Test-Path `$StatePath) {
      `$raw = [System.IO.File]::ReadAllText(`$StatePath)
      if (`$raw.Length -gt 0) {
        `$obj = `$raw | ConvertFrom-Json
        `$obj | Add-Member -NotePropertyName fail -NotePropertyValue ([Math]::Max(0, [int]`$obj.fail)) -Force
        return `$obj
      }
    }
  } catch {}
  return `$null
}
function Write-SyncRefsState {
  param([hashtable]`$NewState)
  `$pathBytes = [System.Text.Encoding]::UTF8.GetBytes(`$StatePath)
  `$hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash(`$pathBytes)).Replace("-","").Substring(0,8)
  `$lockName = "Local\sync-refs-`$hash"
  try { `$mutex = New-Object System.Threading.Mutex(`$false, `$lockName) } catch { `$mutex = New-Object System.Threading.Mutex(`$false, "Local\sync-refs-fallback-`$hash") }
  try {
    if (-not `$mutex.WaitOne(5000)) { return }
    `$tmp = "`$StatePath.tmp"
    `$content = `$NewState | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText(`$tmp, `$content, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Path `$tmp -Destination `$StatePath -Force -ErrorAction Stop
  } catch {} finally { `$mutex.ReleaseMutex(); `$mutex.Dispose() }
}
`$old = Get-SyncRefsState
`$now = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
if (`$success) {
  Write-SyncRefsState @{ success=`$now; mtime=`$now; fail=0 }
} else {
  `$newFail = if (`$old) { [int]`$old.fail + 1 } else { 1 }
  `$oldSuccess = if (`$old -and `$old.success) { `$old.success } else { "0001-01-01T00:00:00" }
  Write-SyncRefsState @{ success=`$oldSuccess; mtime=`$now; fail=`$newFail }
}
"@
            $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($runnerScript))
            Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-EncodedCommand",$encoded `
                -WindowStyle Hidden -ErrorAction Stop | Out-Null
            $syncStarted = $true
        } catch {
            & $Python $SyncRef 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                $prevFail = if ($state) { [int]$state.fail } else { 0 }
                $oldSuccess = if ($state -and $state.success) { $state.success } else { "0001-01-01T00:00:00" }
                $now = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
                $json = @{success=$oldSuccess;mtime=$now;fail=($prevFail+1)} | ConvertTo-Json -Compress
                $tmp = "$syncStatePath.tmp"; [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -Path $tmp -Destination $syncStatePath -Force -ErrorAction SilentlyContinue
            }
        }
        $Changes += "sync-refs:background"
    }

    (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Set-Content $SyncMarker -Encoding UTF8

    # P4：前台失败后写计数器
    if ($LASTEXITCODE -ne 0 -and $Changes -notmatch 'sync-refs:background') {
        $fgCount = 0
        if (Test-Path $syncFgCount) { try { $fgCount = [int](Get-Content $syncFgCount -Raw) } catch {} }
        $fgCount = $fgCount + 1
        $fgCount | Set-Content $syncFgCount -Encoding UTF8
        if ($fgCount -ge $fgMaxRetry) {
            (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Set-Content $syncFgDone -Encoding UTF8
            Remove-Item $syncFgCount -ErrorAction SilentlyContinue
            $Changes += "sync-refs:fg-blocked"
        }
    }
} elseif ($fgSkipped) {
    $Changes += "sync-refs:fg-skipped"
}
if (-not $syncStarted) {
    $brCount = & node -e "try{const j=require('$($SyncReport.replace('\','\\'))');process.stdout.write((j.broken?.length||0).toString())}catch(e){process.stdout.write('-1')}" 2>&1
    $fxCount = & node -e "try{const j=require('$($SyncReport.replace('\','\\'))');process.stdout.write((j.auto_fixed?.length||0).toString())}catch(e){process.stdout.write('-1')}" 2>&1
    if ($brCount -match '^\d+$' -and [int]$brCount -gt 0) { $Changes += "broken:" + $brCount }
    if ($fxCount -match '^\d+$' -and [int]$fxCount -gt 0) { $Changes += "auto-fixed:" + $fxCount }
}

# 6. dependency-map timestamp refresh (node)
$DepMap = $Vault + "\vault-data\dependency-map.json"
if (Test-Path $DepMap) {
    & node -e @"
const fs=require('fs');const p='$($DepMap.replace('\','\\'))';
try{let j=JSON.parse(fs.readFileSync(p,'utf-8'));j.created='$today';fs.writeFileSync(p,JSON.stringify(j,null,2),'utf-8');console.log('ok')}catch(e){console.log('fail')}
"@ 2>&1 | Out-Null
    $Changes += "dep-map:refreshed"
}

# 7. scan KC cards for cross-refs → backlink-log
$ScanBacklinks = $Vault + "\vault-scripts\scan-backlinks.js"
$blCount = & node $ScanBacklinks 2>&1
if ($blCount -match '^\d+$' -and [int]$blCount -gt 0) {
    $Changes += "backlinks:" + $blCount
}

# 8. auto-diagnostic: scan existing data for anomalies
$DiagCheck = & node "$Vault\vault-scripts\auto-diagnostic.js" 2>&1
if ($DiagCheck -and $DiagCheck.Trim() -ne "") {
    Write-Output "diag: $($DiagCheck.Trim())"
}

# 9. auto-settle: fill missing session-level records from available data
$SettleResult = & node "$Vault\vault-scripts\auto-settle.js" 2>&1
if ($SettleResult -and $SettleResult.Trim() -ne "") {
    Write-Output "settle: $($SettleResult.Trim())"
}

# 9a+9b. ai-registry: 原子更新（标记旧会话关闭 + 注册新会话，一步原子完成）
# 根因修复（2026-08-19 SSD寿命检查#79）：原 Set-Content(全量重写)+Append-File(追加) 两步非原子
# → 多 Vault 定时任务并发时产生竞态：互相覆盖 close 操作 + 产生孤立 .tmp-* 文件
# → 改用 node atomicWrite 单步原子追加（read→modify→atomicWrite→rename），彻底消除竞态
$RegistryPath = "$Vault\vault-data\ai-registry.jsonl"
$RegistryUpdateScript = @"
const fs = require('fs');
const { atomicUpdate } = require('$($Vault.replace('\\','\\\\'))\\vault-scripts\\atomic-write.js');

const registryPath = '$($RegistryPath.replace('\\','\\\\'))';
const sessionActivePath = '$($Vault.replace('\\','\\\\'))\\vault-data\\.session-active';
const oldSession = fs.existsSync(sessionActivePath) ? fs.readFileSync(sessionActivePath, 'utf-8').trim() : null;
const hostname = require('os').hostname();
const username = process.env.USERNAME || process.env.USER || 'Unknown';
const session = require('crypto').randomUUID().substring(0, 8);
const ts = new Date().toISOString().slice(0, 19);
const entry = { ts, ai: process.env.AI_NAME || 'claude-code', host: hostname, user: username, session, status: 'active' };

// Read-modify-validate-replace is one transaction under the canonical SHARED lock.
atomicUpdate(registryPath, (raw) => {
  const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (oldSession) {
    for (const row of rows) {
      if (row.session === oldSession && row.status === 'active') row.status = 'closed';
    }
  }
  rows.push(entry);
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}, { validate: 'jsonl' });
fs.writeFileSync(sessionActivePath, session, 'utf-8');
console.log('ai-registry:updated session=' + session);
"@
& node -e "$RegistryUpdateScript" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ai-registry 共享事务失败（rc=$LASTEXITCODE）；本次会话登记未完成" }

# 9c. tmp 垃圾清理：删除 vault-data 与 vault-scripts 下超过 1 天的孤立 .tmp-* 文件（SSD 寿命保护·2026-08-28 范围补全：atomic-write 同目录tmp两处落点）
# 根因：atomic-write.js 写入中断或并发竞态会留下孤立 .tmp-FILE-PID 文件
# → 每次启动清理 >1天 的 tmp 文件，保证新 tmp 不会积累（新 tmp 是正在进行的原子写，跳过）
$tmpFiles = Get-ChildItem "$Vault\vault-data","$Vault\vault-scripts" -Filter "*.tmp-*" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) }
if ($tmpFiles.Count -gt 0) {
    $tmpFiles | Remove-Item -ErrorAction SilentlyContinue
    Write-Output "tmp-cleanup:removed $($tmpFiles.Count) orphan tmp files"
}

# 9d. JSONL 日志轮转：超限即截断（SSD 寿命保护·#79）
# 根因：6 个 JSONL 日志无限增长→持续小写放大→SSD 寿命浪费
# 解决：每次启动检查日志大小，超限保留尾部、归档头部
& "$Vault\vault-scripts\log-rotate.ps1" 2>&1 | Out-Null
& "$Vault\vault-scripts\gate-log-cleanup.ps1" 2>&1 | Out-Null  # 2026-09-01 判断#309：孤儿脚本接线（清理 gate-log 坏行，随轮转一并跑）

# 9c½. 编码修复处理（遍历已在"卡片健康检查"一次完成；此处只处理损坏文件，正常时完全静默）
$cardsDir = $CardDir
if ($encodingIssues.Count -gt 0) {
	Write-Output "Encoding corruption: $($encodingIssues.Count) cards affected, trying git restore..."
	$restored = @()
	foreach ($f in $encodingIssues) {
		$restorePath = & git -C "$Vault" ls-tree --name-only HEAD -- "02-Areas · 资产/*/$f" 2>$null
		if ($restorePath) {
			& git -C "$Vault" checkout HEAD -- "$restorePath" 2>$null
			Write-Output "  Restored: $f"
			$restored += $f
		} else {
			Write-Output "  Cannot restore (no git history): $f"
		}
	}
	# 只验证被恢复的文件（不重扫全库，2026-08-03 极致优化）
	$encodingIssues = @()
	foreach ($f in $restored) {
		$fp = Get-ChildItem -Path $CardDir -Recurse -Filter $f -File | Select-Object -First 1
		if ($fp) {
			try {
				$text = [System.IO.File]::ReadAllText($fp.FullName, (New-Object System.Text.UTF8Encoding($false)))
				if ($text -match "�") { $encodingIssues += $f }
			} catch { $encodingIssues += $f }
		}
	}
	if ($encodingIssues.Count -gt 0) {
		Write-Output "Encoding corruption not fully repaired: $($encodingIssues.Count) cards still broken, skipping git commit"
	} else {
		Write-Output "Encoding corruption fully repaired, committing"
	}
}
# ── 情报验证（判#1281·铁律「push 前必先 verify」机械化·必须在 §9c 推送之前）────────────────
# 病：原在 §12.9 跑 ⇒ 落在 §9c 提交+推送**之后** = 先把未验的产物推出去，铁律被破。
# 治：前移到推送之前；intel-verify 自身已自守「先过唯一进出口拉取 → 验证 → 落环提交+推送」（判#1280）。
# 非阻断：验证异常不拦收工（fail-open），如实打印。
$PredFile = "$Vault\vault-data\intel-predictions.jsonl"
if (Test-Path $PredFile) {
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\intel-verify.ps1" 2>&1 | ForEach-Object { Write-Output "  $_" }
        $Changes += "intel-verify"
    } catch { Write-Output "  ⚠ 情报验证异常（不阻断收工）：$($_.Exception.Message)" }
}

if ($encodingIssues.Count -eq 0) {

# 9c. git auto-sync: 自动提交+推送所有远程(由内而外:复用已有远程配置)
$GitStatus = & git -C "$Vault" status --porcelain 2>&1
if ($GitStatus -and $GitStatus.Trim() -ne "") {
    $ChangedCount = ($GitStatus | Measure-Object -Line).Lines
    $now = Get-Date -Format 'yyyy-MM-dd HH:mm'
    # 读最新判断日志摘要作为commit上下文
    $ctx = ""
    if (Test-Path $JudgmentLog) {
        $lastJ = Get-Content $JudgmentLog -Tail 30 | Where-Object { $_ -match '\|\s*\d{4}-\d{2}-\d{2}\s*\|' } | Select-Object -Last 1
        if ($lastJ) { $ctx = $lastJ -replace '^\|\s*','' -replace '\s*\|$','' }
    }
    $msg = "auto-sync $now | $ctx"
    if ($msg.Length -gt 200) { $msg = $msg.Substring(0,197) + "..." }
    & git -C "$Vault" add -A 2>&1 | Out-Null
    # 源头止血（判#1244·治 #1221 被无声冲掉的机制）：auto-sync 只持久化数据/投影，**绝不无差别裹走「源逻辑类」文件**——
    #   脚本/契约 md 必须编辑者带 ai-lock 租约、走完整出门门刻意提交；否则 auto-sync 的 `--no-verify`+`add -A` 会把并发半成品静默裹走/覆盖。
    # 判#1418 根治（判#1244 的名单法本身是错的）：本条往上都是**枚举要保护的路径**，而枚举必然漏。
    #   【实测】判#1244 之后最近一次 auto-sync（7fff255a）仍裹走 **24 张卡片**；更早 e10f4ba4 连
    #   `KC-SYS-004-系统标准总纲` 都裹了（它不在 L683 名单里）。当前主树就有 **23 张卡**未提交，
    #   下一次 settle-session 一跑，又会无差别提交 → 与各工作树自己的卡片改动撞成跨树冲突。
    #   【为什么这是「所有卡片冲突」的真源头】卡片是 AI 最常留未提交改动的地方（写卡是主要工作），
    #   而 auto-sync 每轮把主树所有卡片一次性提交掉；别的树从同一基线各自演进同一张卡 ⇒ 必然分叉。
    #   DSH 那 4 个合并冲突里 2 个正是这样产生的（KC-FIGURE-034 / KC-ENT-011 同基线两次独立演进）。
    #   【治法】不再枚举「要保护的」，改成**白名单「允许裹走的」**——只放行数据/投影/产物目录。
    #   白名单法的好处：**新增的源逻辑目录默认受保护**（漏 = 安全），而枚举法的漏 = 事故。
    #   这是从「黑名单保平安」翻成「白名单才放行」，方向反过来，漏的口子才真正堵死。
    #   reset 到 HEAD 之后，没被 add 的就退回未暂存，工作区内容**分毫不动**（只动索引）。
    if (Test-Path (Join-Path $Vault 'vault-data')) {
        & git -C "$Vault" reset -q HEAD -- . 2>&1 | Out-Null
        # 白名单：这些是机器/会话产出，本来就该由 auto-sync 持久化
        & git -C "$Vault" add -A -- 'vault-data' 2>&1 | Out-Null
        & git -C "$Vault" add -A -- '00-Inbox · 收件箱' 2>&1 | Out-Null
        & git -C "$Vault" add -A -- '01-Projects · 项目' 2>&1 | Out-Null
        & git -C "$Vault" add -A -- 'out' 2>&1 | Out-Null
        # 判#1418 补：`03-Resources/来自飞轮-参考/成员流水` 同属采集器产出（星球成员每日快照·机器写），
        #   不放进白名单就会永久挂在主树工作区——白名单过窄 = 另一种形式的永久脏。
        #   只放行「成员流水」这一个子目录，不放行整个 03-Resources（已消化源/手动整理的东西必须走门）。
        & git -C "$Vault" add -A -- '03-Resources · 资源/来自飞轮-参考/成员流水' 2>&1 | Out-Null
        # 显式保留旧名单的语义（即便将来有人把脚本挪进白名单目录，也裹不走）
        & git -C "$Vault" reset -q -- 'vault-scripts/*.js' 'vault-scripts/*.ps1' 'vault-scripts/*.py' 'vault-scripts/*.sh' 'vault-scripts/*.cmd' 'CLAUDE.md' 'AGENTS.md' 'constitution.md' 2>&1 | Out-Null
        # ── 【判#1477·2026-11-04 源头根治】派生投影不得再进历史 ─────────────────────
        # 病灶（实测·整类）：
        #   vault-data/{meta-learning,synthesis,trust-status}.json 由本步上面的
        #   meta-learn.js / synthesize.js / trust-score.js **每次收工重算一遍**，内容随
        #   「本次算的时候 gate-log/情报长什么样」而变。
        #   而 auto-sync 的 `add -A -- vault-data` 把它们一并提交推送 ⇒ **本机与云端各自收工
        #   各推一份不同内容** ⇒ 两端历史必然分叉 ⇒ sync-gate 判「含真冲突·拒绝自动整合」
        #   ⇒ VaultSync5min **每 5 分钟 exit=2**，备份链路几周没通过，且失败被 hidden 吞掉。
        # 判据：**派生数据只该有"重新生成"，不该有"合并"**。凡内容由别的输入重算得出、
        #   且换台机器就会不同的文件，不进版本控制——它进历史就等于给未来埋一个必冲突点。
        # 治法：白名单之后再显式 reset 这三项（只动索引，磁盘文件分毫不动）。
        #   .gitignore 已含它们；这里补的是"已跟踪文件不受 ignore 约束"那道口子。
        # 恢复法：若某天确实需要把投影入库，从这里删掉对应行即可（勿只改 .gitignore）。
        & git -C "$Vault" reset -q -- 'vault-data/meta-learning.json' 'vault-data/synthesis.json' 'vault-data/trust-status.json' 2>&1 | Out-Null  # 判#1478 实证闭环：本行使 sync-gate 三模式 exit=0
        Write-Host "  auto-sync 白名单模式（判#1418）：只裹 vault-data/00-Inbox/01-Projects/out/成员流水 —— 卡片与源逻辑留在工作区待其作者走门提交" -ForegroundColor DarkGray
        Write-Host "  派生投影已排除（判#1477）：meta-learning / synthesis / trust-status 只重算不入库，避免两端各生成一份造成永久冲突" -ForegroundColor DarkGray
    } else {
        # 兜底分支（vault-data 目录不在时的退化路径）。
        # 判#1420 续修：原兜底**只排除 KC-SYS-001 一张卡**，其余 504 张会被 add -A 整批裹走——
        #   这正是判#1418 刚治掉的「枚举必然漏」在同一文件里的**第二份副本**，上一轮我漏了它。
        #   同一个病只治主路径不治兜底路径 = 换个入口照样复发。
        #   治法一致：不再逐张枚举，改为**整目录排除** `02-Areas · 资产`（含全部卡片与根卡）。
        #   宁可这次少提交一些，也不让任何一张卡被机器无声裹进历史。
        & git -C "$Vault" reset -q -- 'vault-scripts/*.js' 'vault-scripts/*.ps1' 'vault-scripts/*.py' 'vault-scripts/*.sh' 'vault-scripts/*.cmd' 'CLAUDE.md' 'AGENTS.md' 'constitution.md' '02-Areas · 资产' 2>&1 | Out-Null
        Write-Host "  auto-sync 兜底模式（判#1420）：已整目录排除 02-Areas·资产 —— 卡片一张都不裹" -ForegroundColor DarkGray
    }
    & git -C "$Vault" commit --no-verify -m $msg 2>&1 | Out-Null
    # 推所有远程——判断#1259 根治（2026-10-08 实测铁证）：
    #   旧法病②：`& git push ... 2>&1 | Out-File push.log -Append` —— git 把进度写 stderr（正常行为），
    #     PowerShell 2>&1 把它包成 NativeCommandError，push.log 458KB/414 行把「成功」记成「失败」，
    #     一个多月无人察觉（KC-SYS-065 假绿家族）。且 Start-Process fire-and-forget，失败无感知。
    #   新法：一律走唯一进出口 vault-scripts\sync-gate.ps1 —— 判定只认 exit code（绝不解析 stderr 文本），
    #     状态落 git-sync-state.json，失败写 _system-status.md 供 radar 扫（根卡 5.4.19 闸门不报警=没闸）。
    #   仍后台化（不阻塞收工）：Start-Process 跑同步门，同步门自带状态留痕，不再依赖读日志判成败。
    $syncGate = Join-Path $Vault 'vault-scripts\sync-gate.ps1'
    if (Test-Path $syncGate) {
        Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$syncGate`"","-Mode","out","-Quiet" -WindowStyle Hidden | Out-Null
        Write-Output "git-sync:$ChangedCount files -> sync-gate out (background)"
    } else {
        # 兜底：同步门缺失时退回旧直推（不静默失效·判#1259 由内而外）
        $remotes = @(& git -C "$Vault" remote 2>&1 | Where-Object { $_ -match 'secondbrain|vault' })
        foreach ($rm in $remotes) { & git -C "$Vault" push $rm HEAD 2>&1 | Out-Null }
        Write-Output "git-sync:$ChangedCount files -> direct push (sync-gate missing)"
    }
}
}
# 版本tag同步(推所有远程)——2026-08-03 限频12h：ls-remote 网络开销大(gitee0.8s+github3.5s)，移到低频
$CurrentTag = & git -C "$Vault" tag --list "v1.*" 2>$null | Select-Object -Last 1
$TagMarker = "$Vault\vault-data\.git-tag-last"
$tagDue = $true
if (Test-Path $TagMarker) {
    try {
        $lastTagCheck = [datetime](Get-Content $TagMarker -Raw)
        if ((Get-Date) - $lastTagCheck -lt [timespan]::FromHours(12)) { $tagDue = $false }
    } catch {}
}
if ($CurrentTag -and $tagDue) {
    $remotes = @(& git -C "$Vault" remote 2>&1 | Where-Object { $_ -match 'secondbrain|vault' })
    foreach ($r in $remotes) {
        # 直接尝试：ConnectTimeout 兜底，不再用坏代理检测跳过
        $remoteTags = & git -C "$Vault" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 ls-remote --tags $r "v1.*" 2>$null
        if ($remoteTags -notlike "*$CurrentTag*") {
            & git -C "$Vault" push $r $CurrentTag 2>&1 | Out-Null
            Write-Output "git-tag-push:$CurrentTag -> $r"
        }
    }
    (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Set-Content $TagMarker -Encoding UTF8
}

# 9c. root-cleanup: remove disallowed root dirs (temp, old .rag-data if service not running)
if (Test-Path "$Vault\temp") { Remove-Item -Recurse -Force "$Vault\temp" -ErrorAction SilentlyContinue; Write-Output "root-clean:temp removed" }
if (Test-Path "$Vault\.rag-data") {
    $ragInUse = $false
    try { $ragInUse = (Get-Process -Name "knowledge-rag" -ErrorAction SilentlyContinue).Count -gt 0 } catch {}
    if (-not $ragInUse) { Remove-Item -Recurse -Force "$Vault\.rag-data" -ErrorAction SilentlyContinue; Write-Output "root-clean:.rag-data moved to vault-data/rag/" }
}

# 10. dir-cleanup: auto-remove empty non-standard directories
$CleanDirs = @(
    @{path="$Vault\vault-data\social-cards"; note="social-cards output"},
    @{path="$Vault\vault-scripts\templates"; note="empty templates"},
    @{path="$Vault\vault-data\decisions"; note="empty decisions"}
)
$DirCleanCount = 0
foreach ($d in $CleanDirs) {
    $p = $d.path
    if (Test-Path $p) {
        $children = Get-ChildItem -Path $p -Recurse -ErrorAction SilentlyContinue
        if (-not $children -or $children.Count -eq 0) {
            Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
            $DirCleanCount++
        }
    }
}
if ($DirCleanCount -gt 0) { Write-Output "dir-cleanup:$DirCleanCount" }

# 11. memory-sync: 自动生成_session-handoff.md；失败必须阻断，不得记假成功
$MemorySyncScript = Join-Path $Vault 'vault-scripts\memory-sync.js'
$HandoffPath = Join-Path $Vault 'vault-data\_session-handoff.md'
if (-not (Test-Path -LiteralPath $MemorySyncScript -PathType Leaf)) {
    throw "memory-sync 脚本不存在：$MemorySyncScript"
}
$MemorySyncOutput = & node $MemorySyncScript 2>&1
$MemorySyncExitCode = $LASTEXITCODE
if ($MemorySyncExitCode -ne 0) {
    $detail = ($MemorySyncOutput | Out-String).Trim()
    throw "memory-sync 执行失败（rc=$MemorySyncExitCode）：$detail"
}
if (-not (Test-Path -LiteralPath $HandoffPath -PathType Leaf)) {
    throw "memory-sync 未生成交接文件：$HandoffPath"
}
if ((Get-Item -LiteralPath $HandoffPath).Length -le 0) {
    throw "memory-sync 生成的交接文件为空：$HandoffPath"
}
$Changes += "memory-sync"
# （2026-08-11 精简：移除 startup-standard-read 挂载——gate 强制门已物理保证三卡已读，
#   不重复跑 node 进程省 token；脚本保留 vault-data/startup-standard-read.js 按需可跑）

# 12. 最新状态收敛: 上次终点只写引用到 handoff（根治快照复制漂移·2026-08-05 v1.41.0）
# 根因：截断复制 .next-step 前3行 → MEMORY.md 与 handoff 双副本打架 → 启动读到旧状态（违反宪法第十二条）
# 改法：MEMORY.md 只写一行引用（指向 memory-sync 生成的 _session-handoff.md），内容不再复制
# 单一真相源 = _session-handoff.md（memory-sync 聚合生成，唯一启动读源；接续协议第一步已挂载）
$MemoryMdPath = "C:\Users\Mi\.claude\projects\C--Users-Mi\memory\MEMORY.md"
if (-not (Test-Path $MemoryMdPath)) { $MemoryMdPath = "C:\Users\Mi\.claude\projects\D--Vault\memory\MEMORY.md" }
if (Test-Path $MemoryMdPath) {
    try {
        $mmLines = Get-Content $MemoryMdPath -Encoding UTF8
        $entry = "- **📌 上次会话终点(auto-sync $today)** — 最新交接见 vault-data/_session-handoff.md（memory-sync 自动生成）"
        $found = $false
        for ($i=0; $i -lt $mmLines.Count; $i++) {
            if ($mmLines[$i] -match '^-\s+\*\*📌 上次会话终点') { $mmLines[$i] = $entry; $found = $true }
        }
        if (-not $found) { $mmLines += $entry }
        Write-File $MemoryMdPath ($mmLines -join "`n")
        $Changes += "memory-sync:last-endpoint"
    } catch { }
}

# 12.5 假证据根治: 会话结束写真实 .standards-passed（2026-08-05 v1.41.0）
# 根因：该文件只被 gate auto_standards touch 成 0 字节 → 空文件=假证据（宪法第六条靠证据不靠记忆）
# 改法：settle 结束时用真实 checksum 写 JSON 内容，gate 校验非空即拦假证据
$SpPath = "$Vault\vault-data\.standards-passed"
try {
    $spChecksum = (Get-FileHash -Path "$Vault\constitution.md" -Algorithm SHA256).Hash.ToLower()
    $spJson = '{"passed_at":"' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + '","checksum":"' + $spChecksum + '","version":5}'
    Write-JsonAtomic -Path $SpPath -Json $spJson
    $Changes += "standards-passed:real-json"
} catch { }

# 12.6 系统健康雷达: SessionStart 自动扫系统脆弱维度（2026-08-05 v1.43.0）
# 由内而外: 天团研判修正版——系统专属维度(单点/新鲜/缺失/owner/JSON)，替代文本放大镜
# 判#855：radar 已有每小时任务承载（Vault-Radar-Hourly·判#852 孤岛第三案根治），会话启动 1h 内新鲜即复用
# ——省 ~17s/次启动；超过 1h 才真跑。复用不是跳过监测，是把监测挪到它该住的地方（常转任务）。
$radarJson = "$Vault\vault-data\health-radar.json"
$radarFresh = $false
try {
    if (Test-Path $radarJson) {
        $ageMin = ((Get-Date) - (Get-Item $radarJson).LastWriteTime).TotalMinutes
        if ($ageMin -lt 60) { $radarFresh = $true; Write-Output "  [radar] 1h内新鲜复用(${ageMin}min前·判#855)" }
    }
} catch { }
if (-not $radarFresh) {
    & node "$Vault\vault-scripts\health-radar.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
    $Changes += "health-radar"
} else {
    $Changes += "health-radar:skipped-fresh(判#855)"
}

# 12.7 卡片健康唯一真相源（2026-09-02 v3.2.38 判断#338·KC-SYS-052 防自我确认闭环）
# 由内而外: card-calls.jsonl 被 hub.ps1/gate.ps1/sync-flow-index.py/evidence-audit 4 处独立解析，
#           口径互斥=自我确认闭环风险。build-card-health.ps1 作为唯一解析方，落 card-health.json 结构出口，
#           各消费方改读 JSON 即得同口径，消除私写解析逻辑。
# 顺序: 在 card-promote 前跑（card-promote 依赖 card-health.json 的 dead/high_read 数据）
$CardHealthScript = "$Vault\vault-scripts\build-card-health.ps1"
if (Test-Path $CardHealthScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $CardHealthScript -action build 2>&1 | ForEach-Object { Write-Output "  $_" }
    $Changes += "card-health"
}

# 12.8 运行数据驱动卡片升级: 按实际调用(次数+质量+效率)自动升 L1/L2/L3（2026-08-05 v1.44.0）
# 用户「数据运行数据按照实际数据进行升级技能」+「调用质量效率也需要」
& node "$Vault\vault-scripts\card-promote.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
$Changes += "card-promote"

# 12.9 信任分自动结算（2026-08-11 判断#161·由内而外：每拦截一次扣一次分，精准只扣失当型）
# 从 gate-log 读失当型拦截（block/block_sysfile/block_no_ninestep/block_evidence）→ 自动扣信任分
# 幂等：游标只结算新增拦截。用户指令「信任机制落地闭环，每拦截一次就扣一次分」
& node "$Vault\vault-scripts\trust-score.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
$Changes += "trust-score"

# 12.9 情报预测验证——**已前移到 §9c 推送之前**（判#1281·铁律「push 前必先 verify」·见上方 §9b½ 注释块）
# 原位置病：verify 落在 push 之后 ⇒ 先把未验产物推出去；前移后由 §9c 一起提交推送。

# 12.9b 生态生命力「输血」回写（判#1111·根卡判#1034 双向环流系统→书腿）：呼吸(拉书)已自动·此补输血腿自转。
# 验证✅的书回写实证进其卡·幂等/锁护/限量/append专用段不碰原内容·无交叠日静默返回（失败不阻断 settle）。失败不阻断·fail-open。
try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\intel-shuxue.ps1" 2>&1 | ForEach-Object { Write-Output "  $_" }
    $Changes += "intel-shuxue"
} catch { Write-Output "  ⚠️ 输血回写跳过(不阻断): $_" }

# 12.10 今日情报补跑（2026-08-12 P1·由内而外：早间定时依赖用户在线）
# 根因：Vault-Intel-Daily 定时 08:30 但 LogonType=Interactive 仅登录时运行——用户不在线则错过且不补
# 由内而外：启动检测「今日 intel 未生成」→ Start-Process 后台补跑（不阻塞 settle，用户打开时情报已在）
# 2026-08-14 判断#201 扩展：只查存在不够——8/13 文件存在但无数据体（定时错过+占位）→ 补跑未触发。
# 现在：文件缺失 或 存在但无五线数据行（数据行契约，与 intel-analysis 采集层闸一致）→ 都触发补跑。
# 只检测今日文件，历史文件不触发。契约版本化：写方 market.ps1 与读方同仓同版本（智囊团条件①）。
$todayIntel = "$Vault\00-Inbox · 收件箱\情报\$($today.Substring(0,7))\intel-$today.md"
$intelNeedsBackfill = $false
if (-not (Test-Path $todayIntel)) {
    $intelNeedsBackfill = $true
} else {
    $intelBody = Get-Content $todayIntel -Encoding UTF8 -Raw -ErrorAction SilentlyContinue
    if ($intelBody -and -not ($intelBody -match '(?m)^- (WTI原油|黄金|COMEX铜|美债10Y|人民币汇率|科创50|上证指数):')) {
        $intelNeedsBackfill = $true
    }
}
if ($intelNeedsBackfill) {
    try {
        Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Vault\vault-scripts\market.ps1`" -intel" -WindowStyle Hidden
        Write-Output "  ⚠️ 今日情报未生成/数据为空（定时错过）→ 后台补跑 market.ps1 -intel"
    } catch {
        Write-Output "  ⚠️ 今日情报未生成，后台补跑失败——手动跑 market.ps1 -intel"
    }
    $Changes += "intel-backfill"
}

# 12.11 永久机制落地验证 + 新鲜度扫描 + 审计节奏（2026-08-17 v3.2.17·fix#64·由内而外）
# 根因（攻击审计#199）：permanent-fixes.md 声明机制但不验证落地，P0 潜伏 5 天无人知
# 由内而外：①verify-permanent-fixes 扫 fix 声明→断言文件存在/grep 命中/调用链通→失败写信号
# ②freshness-scan 自动跑（fix#49：脚本存在但从未被调）③audit-cadence daily 自动更新（fix#48 副作用）
# 自动：每次 settle 启动即跑，非手动；下次启动看到失败信号立即显形
# 永久：验证机制自己验证自己——声明≠落地的漂移下次即现
# 三问：由内而外✓（长在已有 fix 验证模式）/ 永久✓（每次启动）/ 自动✓（无手动触发）

# #64 永久机制落地验证
& node "$Vault\vault-scripts\verify-permanent-fixes.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Output "  ⚠️ fix-verify FAIL（验证机制未全通过，exit=$LASTEXITCODE —— 非真实"已验证"，见上 FAIL 项）"
    $Changes += "fix-verify-FAIL"
} else { $Changes += "fix-verify" }

# 成功率追踪+意外检测（判断#227·genesis MetaLearning vault版·碰撞提取由内而外）
# 读回路核心：写 meta-learning.json → settle 下次读 → stderr 提示高 block 规则 → 用户判断优化
# 迭代3轮碰撞落地v3：①成功定义(用gate-log明确信号非card-calls) ②读回路(写+读+影响) ③v4改进点(尽职vs摩擦)
try {
    & node "$Vault\vault-scripts\meta-learn.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
    $Changes += "meta-learn"
} catch { Write-Output "  ⚠️ meta-learn 失败: $_"; Add-Content "$Vault\vault-data\_system-status.md" -Value "`n- [settle] meta-learn FAIL $(Get-Date -Format 'MM-dd HH:mm'): $_"; $Changes += "meta-learn-FAIL" }  # 判#826：失败不再只蒸发在console——写status下圈进门必见

# 综合层（判断#227·gbrain synthesis vault版·碰撞提取由内而外）
# graph traversal(沿atoms.links遍历) + synthesis(跨域连接) + gap analysis(孤立原子)
try {
    & node "$Vault\vault-scripts\synthesize.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
    $Changes += "synthesize"
} catch { Write-Output "  ⚠️ synthesize 失败: $_"; Add-Content "$Vault\vault-data\_system-status.md" -Value "`n- [settle] synthesize FAIL $(Get-Date -Format 'MM-dd HH:mm'): $_"; $Changes += "synthesize-FAIL" }

# #49 新鲜度扫描（脚本存在但从未被调——本次修复）
try {
    & python "$Vault\vault-scripts\freshness-scan.py" --json 2>&1 | ForEach-Object { Write-Output "  $_" }
    $Changes += "freshness-scan"
} catch { Write-Output "  ⚠️ freshness-scan 失败: $_"; Add-Content "$Vault\vault-data\_system-status.md" -Value "`n- [settle] freshness-scan FAIL $(Get-Date -Format 'MM-dd HH:mm'): $_"; $Changes += "freshness-scan-FAIL" }

# #48 审计节奏 daily 自动更新（evidence-audit 逻辑外化，本次直接更新 cadence 文件）
# 由内而外根治（2026-08-20 判断#225）：与 #80 互补——#80 删双注册防并发双写（双对象拼接），
#   本改动防单进程写的 BOM（PS5.1 -Encoding UTF8 带 BOM，verify JSON.parse 失败）。
#   接入 atomic-write.js（永久机制#31：显式UTF-8无BOM+原子写+写后JSON校验，坏写回滚不落盘）。
try {
    $cadencePath = "$Vault\vault-data\audit-cadence.json"
    $todayStr = (Get-Date -Format 'yyyy-MM-dd')
    if (Test-Path $cadencePath) {
        # 读取：用 .NET 直读绕过 PS5.1 BOM/GBK 行为，解析失败用安全默认值（不裸写坏文件）
        $raw = [System.IO.File]::ReadAllText($cadencePath, [System.Text.UTF8Encoding]::new($false))
        $raw = $raw -replace '^﻿', ''  # 容忍历史 BOM
        try { $cadence = $raw | ConvertFrom-Json } catch { $cadence = $null }
        if ($null -eq $cadence) {
            $cadence = [PSCustomObject]@{ daily=$todayStr; weekly=''; monthly=''; quarterly=''; halfyear=''; yearly='' }
        }
        if ($cadence.daily -lt $todayStr) { $cadence.daily = $todayStr }
        $json = $cadence | ConvertTo-Json -Compress
        # 写入：PS5.1 原生参数会剥掉 JSON 内层引号、管道加 BOM（2026-08-21 判断#232），
        #   故 .NET 写无BOM临时文件 → atomic-write.js --from-file 读文件内容 → 原子写+校验
        $tmpJson = Join-Path $Vault ("vault-data\.cadence-arg-{0}.json" -f $PID)
        try {
            [System.IO.File]::WriteAllText($tmpJson, $json, (New-Object System.Text.UTF8Encoding($false)))
            & node "$Vault\vault-scripts\atomic-write.js" "$cadencePath" --from-file $tmpJson --json | Out-Null
        } finally {
            if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue }
        }
        $Changes += "audit-cadence:daily"
    }
} catch { Write-Output "  ⚠️ audit-cadence 更新失败: $_" }

# 情报管线闭环：启动时若今日 intel 未生成则自动补跑（2026-08-20 判断#225）
# 解决电脑关机/睡眠导致 8:30 定时任务未触发、intel 缺失的问题
try {
    $todayIntel = "$Vault\00-Inbox · 收件箱\情报\$(Get-Date -Format 'yyyy-MM')\intel-$(Get-Date -Format 'yyyy-MM-dd').md"
    if (-not (Test-Path $todayIntel)) {
        Write-Output "  📡 今日 intel 未生成，自动补跑 market.ps1 -intel..."
        & "$Vault\vault-scripts\market.ps1" -intel 2>&1 | Out-Null
        $Changes += "intel-auto-fill"
        Write-Output "  ✅ intel 自动补跑完成"
    }
} catch { Write-Output "  ⚠️ intel 自动补跑失败: $_" }

# 钩子耗时记录（2026-08-03 提前性机制：gate.ps1 r16 基线审计的数据源）
# 每次启动把 settle 总耗时写入 gate-log.jsonl(type=startup)，下次启动 r16 对比基线，
# 连续2次超阈值 → WARN。让"启动变慢"在下一次就被自动发现，不靠用户感觉。
$sw.Stop()
$durMs = [math]::Round($sw.Elapsed.TotalMilliseconds)
Write-JsonAtomic -Path "$Vault\vault-data\gate-log.jsonl" -Json "{`"ts`":`"$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')`",`"type`":`"startup`",`"hook`":`"settle-session`",`"dur`":$durMs,`"result`":`"done`"}" -Jsonl -Append

# output
if ($Changes.Count -gt 0) {
    $Changes_msg = [string]::Join("; ", $Changes)
    Write-Output $Changes_msg
}

# 12.13 组件健康自检（2026-08-18 v3.2.18·由内而外修正后保留）
# 根因：单个组件故障无感知，直到影响下游才发现
# 改法：每个能力自检并写 signals，hub 汇总展示
# 由内而外：复用 signals.jsonl 模式（注：事件总线12.12已按军师评审回滚，此为纯由内而外项）
& node "$Vault\vault-scripts\component-health.js" 2>&1 | ForEach-Object { Write-Output "  $_" }
$Changes += "component-health"

# 12.14 DSH 模型窗口声明校验（2026-08-19 判断#215·由内而外）
# 根因：DSH settings 里模型 contextWindow 声明 != 后端真实窗口 -> 压缩阈值算错 -> CONTEXT_WINDOW_EXCEEDED
# 改法：启动即校验 E:\.dsh\settings.yaml 全部模型窗口；新增/改动模型漏配即暴露
# 由内而外：复用 verify-dsh-models.ps1（在线端点对齐真实 /v1/models，本地端点保调度声明）
$dshCheck = "$Vault\vault-scripts\verify-dsh-models.ps1"
if (Test-Path $dshCheck) {
    $dshProbe = & powershell -NoProfile -ExecutionPolicy Bypass -File $dshCheck 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Output "  ⚠ DSH 模型窗口校验未通过:`n$dshProbe"
        $Changes += "dsh-models-FAIL"
    }
    else { $Changes += "dsh-models" }
}

# 12.15 flash-lite 上下文退化检测（2026-08-19 判断#218·由内而外）
# 根因：sensenova-6.7-flash-lite 在长上下文下丢失 tool_use → 纯文本空转
# 检测：连续 N 轮无 tool_call → WARN（写 signals，不阻塞不干预）
# 由内而外：长在 gate-log 上（已有逐条 cmd 记录），不依赖新数据源
# 永久：脚本常驻 settle 启动路径
# 自动：每次启动自动检测
# 复利：下次退化自动 WARN
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\check-flash-lite-degradation.ps1" 2>&1 | Out-Null
$Changes += "flash-lite-degradation-check"

# 12.16 DSH cordis.patch.yml 配置变更自动重启（2026-08-19 判断#218·永久根源自动）
# 根因：cordis.patch.yml 修改后 DSH 不热加载，必须重启才生效 → 配置改即生效
# 解决：每次 settle 启动时检查 cordis.patch.yml 修改时间 vs DSH 进程启动时间
#        若文件更新在进程启动之后 → 10秒后自动重启 DSH（后台，不阻塞 settle）
# 永久：常驻 settle 启动路径，每次启动自动检查
# 自动：完全无需人工干预
# 由内而外：长在已有的 DSH 进程检测方法上（Get-NetTCPConnection + Win32_Process）
$ConfigPath = "E:\.dsh\profiles\web\cordis.patch.yml"
if (Test-Path $ConfigPath) {
    $configLastWrite = (Get-Item $ConfigPath).LastWriteTime
    try {
        $dshPids = Get-NetTCPConnection -LocalPort 3080 -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq "Listen" } |
            Select-Object -ExpandProperty OwningProcess -Unique
        if ($dshPids -and $dshPids.Count -gt 0) {
            $dshStartStr = (Get-CimInstance Win32_Process -Filter "ProcessId=$($dshPids[0])").CreationDate
            if ($dshStartStr) {
                $dshStart = [datetime]::ParseExact($dshStartStr.Substring(0, 14), "yyyyMMddHHmmss", $null)
                if ($configLastWrite -gt $dshStart) {
                    Write-Output "⚠ DSH-CONFIG-CHANGED:cordis.patch.yml 在 DSH 启动后修改 → 10 秒后自动重启 DSH 3080"
                    $RestartCmd = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command & { Start-Sleep -Seconds 10; & powershell -NoProfile -ExecutionPolicy Bypass -File ""D:\Vault\vault-scripts\restart-dsh-web.ps1"" }"
                    Start-Process -FilePath "powershell" -ArgumentList $RestartCmd -WindowStyle Hidden | Out-Null
                    $Changes += "dsh-config-restart"
                }
            }
        }
    } catch { }
}

# 12.17 SenseNova proxy 17888 健康检测 + 自动重启（2026-08-19 判断#218·proxy 端根治）
# 根因：proxy_openai.py v1 三个 bug → 40% 429 + 9% 503：
#   1. MAX_ATTEMPTS=4 < 5 keys → 第5个 key 永远试不到
#   2. 无 key 级冷却 → 429 后下轮立即重试同一 key
#   3. 无并发限制 → 并行请求同时烧穿 key 池
# 解决：v2 代码已修复（冷却 60s + 试遍所有 key + semaphore 限流）
# 永久：常驻 settle 启动路径，每次启动自动检测+重启
# 自动：完全无需人工干预
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\restart-proxy-openai.ps1" 2>&1 | Out-Null
$Changes += "proxy-health-check"

# 12.18 Verge config.yaml 双轨制自动恢复（2026-08-26 判断#256·永久修复#89）
# 根因：Verge GUI 间歇性清空 config.yaml → mihomo 加载空壳 → 代理活着但全直连
# 与#17互补：#17处理节点死亡，本条处理 config 被清空
# 永久：heal-verge-config.ps1 常驻（检测→恢复→重启→验证 + 6h限频）
# 自动：settle 启动自动检测 config 完整性
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\heal-verge-config.ps1" 2>&1 | Out-Null
$Changes += "verge-config-heal"

# 12.19 技能镜像日自愈（判断#844·根治债⑥⑦㉖：唯一源→三镜像每日同步，不再靠人肉 robocopy）
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\sync-skill-mirrors.ps1" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Add-Content "$Vault\vault-data\_system-status.md" "$(Get-Date -Format 'yyyy-MM-dd HH:mm') ⚠ 技能镜像同步失败(判#844) rc=$LASTEXITCODE" }
$Changes += "skill-mirror-sync"

# 12.20 画像转运日自愈（判断#844·根治债⑥：轨迹→画像搬运·答疑prep鲜度门供给侧·判#834铁证）
& node "$Vault\vault-scripts\profile-relay.js" 2>&1 | Out-Null
$Changes += "profile-relay"

# 12.21 证据审计挂链（判#852·根治债㉕：evidence-audit自09-12无调度的审计域孤岛→daily自带+cadence按产物mtime回写）
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Vault\vault-scripts\evidence-audit.ps1" 2>&1 | Out-Null
$Changes += "evidence-audit"

# 12.22 安装验收关卡（判#871·upgrade-proposal-868 四关通过落地：近7天新装机制逐条跑验收命令·未过=signal路由）
& node "$Vault\vault-scripts\install-acceptance.js" 2>&1 | Out-Null
$Changes += "install-acceptance"

# 12.23 判号兑现自动重算（判#1384·由内而外·治「pending 是默认值·写进去就永不重算」）
# 【病·实证】pending 默认值 = 'pending'，判#1339 出生门**只验 delivered 不验 pending** ⇒ pending 免责通道；
#   写进账本后**永不重算** → 实测 120 条 pending 里 **82 条早就做完（69%）**，直到手动跑 jverify 才发现。
#   这就是「每次都在重复查一遍」的根。
# 【治法】每日收尾自动重算：jverify --write 把「回检命令能跑通」的 pending 精确改写为 delivered。
#   · 只换行首 [pending] 标记·括号说明与回检命令原样保留（不碰 JHASH）
#   · 测不了的(env)与真没做的保持 pending 不动（不可核≠没做·判#848）
#   · 跑在最末、失败不阻断收尾（收尾比重算重要）
try {
    $jv = (& node "$Vault\vault-scripts\jverify.js" --write 2>&1 | Out-String)
    if ($jv -match '已改写\s+(\d+)\s+条') {
        $n = $matches[1]
        if ([int]$n -gt 0) { Write-Host ("  ✅ 判号兑现重算：$n 条 pending → delivered（判#1384）") }
        $Changes += "jverify($n)"
    } else { $Changes += "jverify" }
} catch { Write-Host "  ⚠ 判号兑现重算跳过（不阻断收尾）：$_" }
