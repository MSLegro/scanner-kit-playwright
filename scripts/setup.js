#!/usr/bin/env node
/**
 * scanner-kit-playwright — Setup Universal
 *
 * Configura todo el entorno en un solo paso tras clonar:
 * 1. Instala dependencias del proyecto (pnpm / npm)
 * 2. Descarga el navegador Chromium de Playwright
 * 3. Compila TypeScript (dist/ y permisos CLI)
 * 4. Enlaza el comando global (sk / scanner-kit)
 * 5. Verifica la instalación
 */

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

// 1. Preparar rutas de pnpm en memoria para evitar ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH
const pnpmHome = process.env.PNPM_HOME || (
  isWin 
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'pnpm')
    : path.join(os.homedir(), '.local', 'share', 'pnpm')
);
const pnpmBinDir = isWin ? path.join(pnpmHome, 'bin') : pnpmHome;

process.env.PNPM_HOME = pnpmHome;
process.env.PATH = `${pnpmBinDir}${path.delimiter}${process.env.PATH}`;

// Colores ANSI
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function banner() {
  console.log(`\n${c.cyan}${c.bold}===============================================================${c.reset}`);
  console.log(`${c.magenta}${c.bold}🛡️⚡ scanner-kit-playwright — Setup Automático Todo-en-Uno${c.reset}`);
  console.log(`${c.cyan}${c.bold}===============================================================${c.reset}\n`);
}

function checkCommand(cmd) {
  try {
    const checkCmd = isWin ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore', env: process.env });
    return true;
  } catch {
    return false;
  }
}

function runStep(title, command, options = {}) {
  process.stdout.write(`${c.bold}▶ ${title}...${c.reset} `);
  try {
    execSync(command, {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      env: process.env,
      timeout: options.timeout || 120000,
      ...options
    });
    console.log(`${c.green}✔ Hecho${c.reset}`);
    return true;
  } catch (error) {
    if (options.ignoreError) {
      console.log(`${c.yellow}⚠ Omitido${c.reset}`);
      return false;
    }
    console.log(`${c.red}✘ Error${c.reset}`);
    if (options.critical) {
      if (error.stdout) console.log(error.stdout.toString());
      if (error.stderr) console.error(c.yellow + error.stderr.toString() + c.reset);
      console.error(`\n${c.red}${c.bold}[FALLO CRÍTICO]${c.reset} No se pudo completar: "${command}"`);
      process.exit(1);
    }
    return false;
  }
}

function ensureWindowsPathPersistence() {
  if (!isWin) return;
  try {
    // Asegurar que PNPM_HOME y %PNPM_HOME%\bin queden persistidos en el registro de Windows
    const psScript = `
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $target = '${pnpmBinDir.replace(/'/g, "''")}'
      if ($userPath -notlike "*$target*") {
        [Environment]::SetEnvironmentVariable('PNPM_HOME', '${pnpmHome.replace(/'/g, "''")}', 'User')
        [Environment]::SetEnvironmentVariable('Path', "$target;$userPath", 'User')
      }
    `;
    execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'ignore' });
  } catch {}
}

async function main() {
  banner();

  // 1. Detección de Gestor de Paquetes
  const hasPnpm = checkCommand('pnpm');
  const hasNpm = checkCommand('npm');

  if (!hasPnpm && !hasNpm) {
    console.error(`${c.red}Error: No se encontró ni 'pnpm' ni 'npm' en el PATH. Instala Node.js primero.${c.reset}`);
    process.exit(1);
  }

  const pm = hasPnpm ? 'pnpm' : 'npm';
  console.log(`${c.dim}• Gestor de paquetes detectado: ${c.bold}${pm}${c.reset}\n`);

  // 2. Instalar dependencias
  const installCmd = pm === 'pnpm' ? 'pnpm install' : 'npm install';
  runStep('Instalando dependencias del proyecto', installCmd, { critical: true });

  // 3. Descargar navegador Chromium para Playwright
  const playwrightCmd = pm === 'pnpm' 
    ? 'pnpm exec playwright install chromium' 
    : 'npx playwright install chromium';
  runStep('Instalando navegador Chromium para Playwright', playwrightCmd, { ignoreError: true });

  // 4. Compilar TypeScript
  const buildCmd = `${pm} run build`;
  runStep('Compilando TypeScript (dist/)', buildCmd, { critical: true });

  // 5. Enlaces globales
  if (hasNpm) {
    runStep('Enlazando comando global con npm link', 'npm link --force', { ignoreError: true });
  }

  if (hasPnpm) {
    runStep('Enlazando comando global con pnpm', 'pnpm add -g .', { ignoreError: true });
    ensureWindowsPathPersistence();
  }

  // 6. Verificación de comando global 'sk'
  const isGlobalReady = checkCommand('sk');

  console.log(`\n${c.green}${c.bold}===============================================================${c.reset}`);
  console.log(`${c.green}${c.bold}🚀 ¡Configuración completada con éxito!${c.reset}`);
  console.log(`${c.green}${c.bold}===============================================================${c.reset}\n`);

  if (isGlobalReady) {
    console.log(`${c.bold}El comando ${c.cyan}sk${c.reset}${c.bold} está listo y disponible en tu sistema:${c.reset}`);
    console.log(`  ${c.cyan}sk --u=https://portal.ejemplo.com${c.reset}`);
    console.log(`  ${c.cyan}sk --help${c.reset}\n`);
  } else {
    console.log(`${c.yellow}Nota para la sesión actual de terminal:${c.reset}`);
    console.log(`Para usar el comando ${c.cyan}sk${c.reset} global en esta misma ventana:`);
    console.log(`  1. ${c.bold}Abre una nueva terminal${c.reset}, o`);
    console.log(`  2. ${c.bold}En tu PowerShell actual pega:${c.reset}`);
    console.log(`     ${c.dim}$env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")${c.reset}\n`);
  }

  console.log(`${c.bold}Alternativa local directa (sin necesidad de terminal nueva):${c.reset}`);
  console.log(`  ${c.cyan}${pm} scan --u=https://portal.ejemplo.com${c.reset}`);
  console.log(`  ${c.cyan}${pm} start --u=https://portal.ejemplo.com${c.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${c.red}Error inesperado en setup:${c.reset}`, err);
  process.exit(1);
});
