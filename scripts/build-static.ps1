$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Set-Location (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "_python.ps1")

$python = Get-NewsbotPythonCommand
Set-NewsbotPythonPath

& $python[0] $python[1] -m newsbot.site_builder
