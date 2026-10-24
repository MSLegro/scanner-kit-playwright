# scanner-kit-playwright - Setup para Windows (PowerShell)
# Ejecuta todo el flujo de instalacion, compilacion y enlace global en un solo paso.
$ErrorActionPreference = "Stop"

Write-Host "Iniciando instalacion automatica de scanner-kit-playwright..." -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js no esta instalado o no se encuentra en el PATH." -ForegroundColor Red
    Write-Host "Descargalo de https://nodejs.org antes de continuar." -ForegroundColor Yellow
    exit 1
}

# Ejecutar el orquestador principal multiplataforma
& node "$PSScriptRoot\scripts\setup.js"

# Refrescar PATH tanto a nivel de Proceso como en el entorno de PowerShell
$pnpmBin = if ($env:PNPM_HOME) { "$env:PNPM_HOME\bin" } else { "$env:LOCALAPPDATA\pnpm\bin" }
$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$currentMachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$newPath = "$pnpmBin;$currentUserPath;$currentMachinePath"

[Environment]::SetEnvironmentVariable("Path", $newPath, "Process")
$env:Path = $newPath
