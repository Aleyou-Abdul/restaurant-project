[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^https://")]
    [string]$DashboardUrl,

    [string]$ShortcutName = "PlateRoute POS - Silent Printing"
)

$ErrorActionPreference = "Stop"

# A separate Chrome profile keeps silent printing limited to the dedicated POS shortcut.
$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $chromePath) {
    throw "Google Chrome was not found. Install Chrome first, then run this setup again."
}

$uri = [Uri]$DashboardUrl
if (-not $uri.IsAbsoluteUri) {
    throw "Enter the complete HTTPS dashboard link."
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath ("{0}.lnk" -f $ShortcutName)
$profilePath = Join-Path $env:LOCALAPPDATA "PlateRoutePOSChrome"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)

$shortcut.TargetPath = $chromePath
$shortcut.Arguments = "--kiosk-printing --app=`"$DashboardUrl`" --user-data-dir=`"$profilePath`""
$shortcut.WorkingDirectory = Split-Path -Parent $chromePath
$shortcut.IconLocation = "$chromePath,0"
$shortcut.Description = "PlateRoute POS dashboard with silent receipt printing"
$shortcut.Save()

Write-Host ""
Write-Host "POS shortcut created: $shortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "Before using it:" -ForegroundColor Yellow
Write-Host "1. Set the Xprinter as the Windows default printer."
Write-Host "2. In Xprinter Printing Preferences, select the matching 80mm receipt roll."
Write-Host "3. Close all regular Chrome windows once, then open the new desktop shortcut."
Write-Host ""
Write-Host "The new Chrome window is only for PlateRoute. Print Receipt will send directly to the default thermal printer without a preview window."
