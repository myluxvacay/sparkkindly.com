<#
.SYNOPSIS
  Registers the SparkKindly content runs in Windows Task Scheduler (three runs a day).
.DESCRIPTION
  Creates (or replaces) three tasks that each call run-daily.ps1: play+discover, together+grow+save, then kids. Kids runs last
  because its items wait for the owner. Times are local. A task that was missed (machine off) runs when the machine is
  next available; two runs of one task never overlap. The tasks run only while the owner is signed in, because Claude
  Code uses that sign-in; the content buffer covers days the machine is off.
  Use -WhatIf to see what would be registered without changing anything; -Unregister removes the three tasks.
  Verified by: -WhatIf output, then `Get-ScheduledTask 'SparkKindly*'` after registering (docs/OPERATIONS.md).
.EXAMPLE
  .\register-tasks.ps1 -WhatIf
  .\register-tasks.ps1 -Env staging
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('staging', 'prod')][string]$Env = 'staging',
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'run-daily.ps1'
$runs = @(
  @{ Name = 'SparkKindly daily-run 1 (play, discover)'; Worlds = 'play,discover'; At = '08:00' },
  @{ Name = 'SparkKindly daily-run 2 (together, grow)'; Worlds = 'together,grow,save'; At = '13:00' },
  @{ Name = 'SparkKindly daily-run 3 (kids)'; Worlds = 'kids'; At = '18:00' }
)

# Task names are unchanged when a world is added (run 2 also covers Save since 7 November 2026), so re-registering
# replaces the existing task instead of leaving the old one running beside a new one.
foreach ($r in $runs) {
  if ($Unregister) {
    if ($PSCmdlet.ShouldProcess($r.Name, 'Unregister')) { Unregister-ScheduledTask -TaskName $r.Name -Confirm:$false -ErrorAction SilentlyContinue }
    continue
  }
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Worlds $($r.Worlds) -Env $Env"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -Daily -At $r.At
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  if ($PSCmdlet.ShouldProcess($r.Name, "Register: daily $($r.At), worlds $($r.Worlds), env $Env")) {
    Register-ScheduledTask -TaskName $r.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Output "Registered: $($r.Name) at $($r.At)"
  }
}
