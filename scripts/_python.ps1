function Get-NewsbotPythonCommand {
    param(
        [string]$Version = "3.12"
    )

    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($null -eq $pyLauncher) {
        throw "Python launcher 'py' was not found. Install Python $Version to run local validation."
    }

    try {
        & py "-$Version" -c "import sys; print(sys.executable)" 1>$null 2>$null
    }
    catch {
        throw "Python $Version is required for local validation. Install it or rely on GitHub Actions CI after push."
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Python $Version is required for local validation. Install it or rely on GitHub Actions CI after push."
    }

    return @("py", "-$Version")
}


function Set-NewsbotPythonPath {
    $paths = @(".\src", ".\.packages")
    if ($env:PYTHONPATH) {
        $paths += $env:PYTHONPATH
    }
    $env:PYTHONPATH = ($paths -join ";")
}
