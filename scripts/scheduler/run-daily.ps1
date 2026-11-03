<#
.SYNOPSIS
  One scheduled SparkKindly content run: starts Claude Code headless with /daily-run for the given worlds.
.DESCRIPTION
  Task Scheduler calls this (see register-tasks.ps1). It runs `claude -p "/daily-run env=<env> worlds=<worlds>"` from
  the repository, with only the tools a run needs allowed, and writes everything Claude prints to a dated log under
  %USERPROFILE%\sparkkindly-runs (outside the repository; logs can hold item text and must never be committed).
  It exits with Claude's exit code. The master agent records the run itself (heartbeat and counts) through the site's
  API, so this script holds no key: keys are read from the owner's secrets file by the MCP server.
  Verified by: -DryRun (prints the command and the log path, runs nothing) and the first-week run in docs/OPERATIONS.md.
.EXAMPLE
  .\run-daily.ps1 -Worlds play,discover -Env staging
#>
param(
  [Parameter(Mandatory)][string[]]$Worlds,
  [ValidateSet('staging', 'prod')][string]$Env = 'staging',
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$LogDir = (Join-Path $env:USERPROFILE 'sparkkindly-runs'),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$worldList = ($Worlds -join ',') -replace '\s', ''
if ($worldList -notmatch '^[a-z0-9-]+(,[a-z0-9-]+)*$') { throw "Worlds must be lowercase slugs separated by commas: '$worldList'" }

$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$log = Join-Path $LogDir "$stamp-$Env-$($worldList -replace ',', '+').log"
$prompt = "/daily-run env=$Env worlds=$worldList"
# A fetched page can try to steer an agent (prompt injection). So the run loads only the project's settings, never the
# owner's user settings (their broad allow rules would make this list meaningless), reads only the goals files, and
# has no shell or file-writing tools. Web tools stay open because sources are arbitrary sites.
# Checked 3 Nov 2026: a file in the home folder is denied, a goals file reads, the MCP connector still works.
$tools = @('Agent', 'Read(./agents/worlds/**)', 'WebFetch', 'WebSearch', "mcp__sparkkindly-$Env")
$denied = @('Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit')

if ($DryRun) {
  Write-Output "repo:   $Repo"
  Write-Output "log:    $log"
  Write-Output "claude -p `"$prompt`" --setting-sources project --allowedTools $($tools -join ' ') --disallowedTools $($denied -join ' ')"
  exit 0
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Repo
"[$(Get-Date -Format o)] start: $prompt" | Out-File -FilePath $log -Encoding utf8
& claude -p $prompt --setting-sources project --allowedTools @tools --disallowedTools @denied 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] exit code $code" | Out-File -FilePath $log -Append -Encoding utf8
exit $code
