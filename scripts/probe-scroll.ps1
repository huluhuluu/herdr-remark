# Observe the same helper without metadata writes or conversation inspection.
param([ValidateRange(1, 60)][int]$Seconds = 30)
& "$PSScriptRoot/wheel.ps1" -Seconds $Seconds -Probe
