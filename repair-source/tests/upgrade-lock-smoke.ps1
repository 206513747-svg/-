$ErrorActionPreference = 'Stop'
$base = Join-Path $env:TEMP ("upgrade-lock-smoke-" + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $base 'main'
$worktree = Join-Path $base 'wt'
New-Item -ItemType Directory -Path (Join-Path $repo 'vault-scripts') -Force | Out-Null
git init -b main $repo | Out-Null
git -C $repo config user.name 'repair-test'
git -C $repo config user.email 'repair-test@example.invalid'
Set-Content -LiteralPath (Join-Path $repo 'vault-scripts\seed.txt') -Value 'seed' -Encoding UTF8
git -C $repo add .
git -C $repo commit -m 'seed' --quiet
git -C $repo worktree add -b other $worktree | Out-Null

$vault = $repo
. (Join-Path $PSScriptRoot '..\vault-scripts\upgrade.ps1')
$env:AI_NAME = 'test-ai'
$env:AI_WIN = 'window-A'
if (-not (Enter-UpgradeLock)) { throw 'first worktree could not acquire transaction lock' }

$common = (& git -C $repo rev-parse --git-common-dir).Trim()
if (-not [System.IO.Path]::IsPathRooted($common)) { $common = [System.IO.Path]::GetFullPath((Join-Path $repo $common)) }
$lock = Join-Path $common 'upgrade-pipeline.lock'
if (-not (Test-Path -LiteralPath $lock)) { throw 'lock not placed in git common-dir' }

$vault = $worktree
$env:AI_WIN = 'window-B'
if (Enter-UpgradeLock) { throw 'second worktree bypassed active transaction lock' }
$held = Get-Content -LiteralPath $lock -Raw -Encoding UTF8 | ConvertFrom-Json
if ($held.win -ne 'window-A') { throw 'second worktree overwrote first owner metadata' }

$vault = $repo
$env:AI_WIN = 'window-A'
if (-not (Enter-UpgradeLock)) { throw 'same owner could not renew transaction lock' }
if (-not (Exit-UpgradeLock)) { throw 'owner could not release transaction lock' }
if (Test-Path -LiteralPath $lock) { throw 'lock remained after verified release' }

[System.IO.File]::WriteAllText($lock, '{broken')
if (Enter-UpgradeLock) { throw 'corrupt lock was treated as free' }
if ((Get-Content -LiteralPath $lock -Raw) -ne '{broken') { throw 'corrupt lock evidence was modified' }

$expired = @{ ts=(Get-Date).AddMinutes(-31).ToString('o'); pid=1; ai='old-ai'; win='old-window' } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($lock, $expired)
$env:AI_WIN = 'window-C'
if (-not (Enter-UpgradeLock)) { throw 'expired lock was not safely reclaimed' }
if (-not (Exit-UpgradeLock)) { throw 'reclaimed lock could not be released' }

Write-Host 'PASS upgrade lock is shared across worktrees'
Write-Host 'PASS competing window is blocked and cannot overwrite owner'
Write-Host 'PASS same owner renews and releases its lock'
Write-Host 'PASS corrupt lock fails closed and preserves evidence'
Write-Host 'PASS expired lock is reclaimed through stale-file handoff'
Remove-Item -LiteralPath $base -Recurse -Force
