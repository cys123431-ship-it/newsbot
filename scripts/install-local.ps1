$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Set-Location (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "_python.ps1")

$python = Get-NewsbotPythonCommand

& $python[0] $python[1] -m pip install --upgrade --target .\.packages `
    apscheduler `
    fastapi `
    feedparser `
    httpx `
    jinja2 `
    pydantic `
    sqlalchemy `
    telethon `
    uvicorn `
    pytest
