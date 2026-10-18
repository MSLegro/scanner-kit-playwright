#!/usr/bin/env node
/**
 * scanner-kit-playwright CLI
 *
 * Universal Web Reconnaissance, Reverse Engineering & RPA Blueprint CLI.
 * Ejecutable autónomo para auditar portales corporativos y generar blueprints
 * agnósticos de automatización en formato JSON.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { ScannerKit } from './scanner-kit';
import { TestServer } from './examples/test-server';

// Cargar variables de entorno desde .env si existe en el directorio de ejecución actual
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true } as any);
}

function getPackageVersion(): string {
  try {
    // Intentar leer package.json relativo a dist/ o a la raíz del paquete
    const candidates = [
      path.resolve(__dirname, '../package.json'),
      path.resolve(__dirname, 'package.json')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        return pkg.version || '1.1.0';
      }
    }
  } catch {}
  return '1.1.0';
}

function printHelp() {
  const version = getPackageVersion();
  console.log(`
===============================================================
🛡️⚡ scanner-kit-playwright CLI v${version}
Universal Web Reconnaissance & RPA Blueprint Engine
===============================================================

Uso:
  scanner-kit [opciones]
  scanner-kit scan [opciones]

Opciones principales:
  -u, --url <url>                URL objetivo a auditar (ej. https://portal.com/home)
                                 (Acepta alias: --u=..., -u=..., --url=..., o URL directa)
  -c, --category <nombre>        Subcarpeta para clasificar el blueprint
                                 (Acepta alias: -c=..., --cat=..., --category=...)
  -o, --out, --blueprint <ruta>  Directorio base de salida
                                 (Por defecto: ./blueprint en el directorio actual)
  --headless                     Ejecutar sin ventana visual (servidores / CI)
  --headed                       Forzar ventana visual interactiva
  --slowmo <ms>                  Pausa visual en ms entre acciones (por defecto: 0)

Opciones de optimización activa (para pruebas):
  --active-turbo                 Fuerza el bloqueo de recursos (imágenes/fuentes/trackers)
  --active-evasion               Fuerza neutralización de window.print() y diálogos UI

Información y ayuda:
  -h, --help                     Muestra este manual de ayuda y opciones
  -v, --version                  Muestra la versión instalada de scanner-kit

Ejemplos:
  $ scanner-kit --u=https://portal.nuevaeps.com.co/Portal/home.jspx
  $ scanner-kit --u=https://portal.nuevaeps.com.co/Portal/home.jspx -c autorizaciones
  $ scanner-kit --u=http://172.16.1.122:5002/ --out=./mi-carpeta
  $ scanner-kit scan --help
`);
}

async function runCli() {
  const rawArgs = process.argv.slice(2);

  // 1. Detección de flags de ayuda y versión
  if (rawArgs.includes('-h') || rawArgs.includes('--help') || rawArgs.includes('help')) {
    printHelp();
    process.exit(0);
  }

  if (rawArgs.includes('-v') || rawArgs.includes('--version') || rawArgs.includes('version')) {
    console.log(`v${getPackageVersion()}`);
    process.exit(0);
  }

  console.log('===============================================================');
  console.log('🚀 Iniciando escaneo con scanner-kit-playwright');
  console.log('===============================================================\n');

  // 2. Parser flexible de argumentos
  let cliUrl: string | undefined;
  let cliCategory: string | undefined;
  let cliOutputDir: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === 'scan') continue;

    if (
      arg.startsWith('--url=') ||
      arg.startsWith('--u=') ||
      arg.startsWith('-u=') ||
      arg.startsWith('--target=')
    ) {
      cliUrl = arg.split('=').slice(1).join('=').trim();
    } else if ((arg === '--url' || arg === '--u' || arg === '-u' || arg === '--target') && rawArgs[i + 1]) {
      cliUrl = rawArgs[++i].trim();
    } else if (
      arg.startsWith('--category=') ||
      arg.startsWith('--cat=') ||
      arg.startsWith('-cat=') ||
      arg.startsWith('--c=') ||
      arg.startsWith('-c=')
    ) {
      cliCategory = arg.split('=').slice(1).join('=').trim();
    } else if (
      (arg === '--category' || arg === '--cat' || arg === '-cat' || arg === '--c' || arg === '-c') &&
      rawArgs[i + 1]
    ) {
      cliCategory = rawArgs[++i].trim();
    } else if (
      arg.startsWith('--out=') ||
      arg.startsWith('--blueprint=') ||
      arg.startsWith('-o=')
    ) {
      cliOutputDir = arg.split('=').slice(1).join('=').trim();
    } else if ((arg === '--out' || arg === '--blueprint' || arg === '-o') && rawArgs[i + 1]) {
      cliOutputDir = rawArgs[++i].trim();
    } else if (!arg.startsWith('-') && (arg.startsWith('http://') || arg.startsWith('https://'))) {
      cliUrl = arg.trim();
    }
  }

  // Fallbacks de gestores de paquetes (pnpm / npm)
  const npmUrl = process.env.npm_config_url || process.env.npm_config_u || process.env.npm_config_target;
  if (!cliUrl && npmUrl && npmUrl !== 'true') {
    cliUrl = npmUrl.trim();
  }
  const npmCategory =
    process.env.npm_config_category || process.env.npm_config_cat || process.env.npm_config_c;
  if (!cliCategory && npmCategory && npmCategory !== 'true') {
    cliCategory = npmCategory.trim();
  }
  const npmOutputDir =
    process.env.npm_config_out || process.env.npm_config_blueprint || process.env.npm_config_o;
  if (!cliOutputDir && npmOutputDir && npmOutputDir !== 'true') {
    cliOutputDir = npmOutputDir.trim();
  }

  // Normalizar protocolo si pasaron dominio sin http(s)://
  if (cliUrl && !/^https?:\/\//i.test(cliUrl)) {
    const isLocalOrPrivateIp = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(cliUrl);
    cliUrl = `${isLocalOrPrivateIp ? 'http' : 'https'}://${cliUrl}`;
  }

  const envUrl = process.env.TARGET_URL?.trim();
  const customUrl = cliUrl || (envUrl ? envUrl : null);

  // 3. Detección de servidor gráfico
  const isWindowsOrMac = process.platform === 'win32' || process.platform === 'darwin';
  const waylandSocket = process.env.XDG_RUNTIME_DIR && process.env.WAYLAND_DISPLAY
    ? path.join(process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY)
    : null;
  const x11Socket = process.env.DISPLAY ? `/tmp/.X11-unix/X${process.env.DISPLAY.replace(':', '')}` : null;
  
  const hasLiveDisplay = isWindowsOrMac ||
                         Boolean(waylandSocket && fs.existsSync(waylandSocket)) ||
                         Boolean(x11Socket && fs.existsSync(x11Socket));

  const forceHeadless = rawArgs.includes('--headless');
  const forceHeaded = rawArgs.includes('--headed');
  const envHeadless = process.env.HEADLESS === 'true';
  const slowMo = parseInt(process.env.SLOW_MO || '0', 10);
  const turboMode = process.env.TURBO_MODE === 'true' || rawArgs.includes('--active-turbo');
  const evasionMode = process.env.EVASION_MODE === 'true' || rawArgs.includes('--active-evasion');
  const reconMode = process.env.RECON_MODE !== 'false';

  const isHeadless = forceHeadless || envHeadless || (!hasLiveDisplay && !forceHeaded);

  if (!isHeadless) {
    console.log('🖥️ Modo visual activo (HEADLESS=false) | Observación Pasiva Sigilosa (Stealth)...');
  } else if (!forceHeadless && !envHeadless) {
    console.log('ℹ️ Entorno sin servidor gráfico accesible (sandbox/CI). Ejecutando en modo headless para garantizar estabilidad.');
  }

  // 4. Determinar targetUrl
  let server: TestServer | null = null;
  let targetUrl: string;

  if (customUrl) {
    targetUrl = customUrl;
    console.log(`[1/6] URL objetivo configurada (${cliUrl ? 'desde CLI (--u)' : 'desde .env'}): ${targetUrl}`);
  } else {
    // Iniciar servidor de prueba local si no se definió URL externa
    server = new TestServer(3456);
    const serverUrl = await server.start();
    targetUrl = `${serverUrl}/portal`;
    console.log(`[1/6] Sin URL en CLI ni en .env. Usando servidor de simulación ERP local en: ${serverUrl}`);
  }

  // 5. Inicializar ScannerKit
  console.log(
    `[2/6] Inicializando ScannerKit (headless: ${isHeadless}, modo: Observador Pasivo Cero-Intrusión)...`
  );
  const resolvedBlueprintDir =
    cliOutputDir ||
    process.env.BLUEPRINT_DIR ||
    process.env.OUTPUT_DIR ||
    './blueprint';
  const targetCategory = cliCategory || process.env.TARGET_CATEGORY?.trim() || undefined;

  const scanner = await ScannerKit.create({
    headless: isHeadless,
    slowMo: isHeadless ? 0 : slowMo,
    turboMode,
    evasionMode,
    reconMode,
    blueprintDir: resolvedBlueprintDir,
    targetCategory,
    viewport: isHeadless ? { width: 1280, height: 720 } : null
  });

  // Manejo de señales SIGINT (Ctrl + C) para cierre ordenado
  let isClosing = false;
  const handleSigint = async () => {
    if (isClosing) return;
    isClosing = true;
    console.log('\n[Info] Interrupción detectada (Ctrl+C). Consolidando blueprint antes de salir...');
    try {
      await scanner.close();
      if (server) await server.stop();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', handleSigint);

  try {
    // 6. Navegar a la página objetivo
    console.log(`[3/6] Navegando a ${targetUrl} ...`);
    await scanner.goto(targetUrl);

    if (customUrl) {
      await scanner.page.waitForLoadState('domcontentloaded').catch(() => {});

      const isInteractive = process.env.INTERACTIVE !== 'false';

      if (isInteractive && !isHeadless) {
        console.log('\n===============================================================');
        console.log('🎮 MODO OBSERVADOR PASIVO & AUDITORÍA EN VIVO ACTIVO');
        console.log('===============================================================');
        console.log('El navegador funciona 100% normal y sin alteraciones para que explores libremente:');
        console.log('  • Inicia sesión, resuelve captchas si aparecen y navega entre módulos.');
        console.log('  • ReconEngine y TelemetryExtractor están auditando pasivamente en segundo plano.');
        console.log('  • No se bloquean imágenes ni se alteran prototipos para evitar detección Anti-Bot.\n');
        console.log('👉 ¿Listo para guardar sesión y generar el blueprint de automatización?');
        console.log('   Elige cualquiera de estas dos opciones para finalizar:');
        console.log('   1. Simplemente cierra la ventana del navegador con la [X] del ratón.');
        console.log('   2. O presiona [ENTER] aquí en la terminal.\n');

        // Esperar a que el usuario presione Enter O cierre la ventana del navegador
        await new Promise<void>((resolve) => {
          let resolved = false;

          const finish = (source: string) => {
            if (!resolved) {
              resolved = true;
              console.log(`\n[Info] Finalización detectada (${source}). Consolidando telemetría...`);
              try {
                process.stdin.removeListener('data', onStdinData);
                process.stdin.pause();
              } catch {}
              resolve();
            }
          };

          const onStdinData = () => {
            finish('tecla [ENTER] en la terminal');
          };

          // Si el usuario cierra la ventana del navegador con el ratón
          scanner.page.on('close', () => {
            finish('cierre de ventana con la [X]');
          });

          // Si el usuario presiona Enter en la terminal
          if (process.stdin.isTTY || process.stdin.readable) {
            process.stdin.resume();
            process.stdin.setEncoding('utf-8');
            process.stdin.once('data', onStdinData);
          }
        });
      } else {
        const waitSeconds = parseInt(process.env.WAIT_SECONDS || '5', 10);
        console.log(`  Esperando ${waitSeconds}s de actividad de red y telemetría...`);
        await scanner.page.waitForTimeout(waitSeconds * 1000);
      }

      console.log('  ✓ Flujo de navegación completado. Consolidando telemetría...');
    } else {
      // Flujo de prueba en servidor local
      console.log('[4/6] Probando Buscador Multi-Frame para localizar botón dentro de <iframe>...');
      const frameResult = await scanner.findElementAcrossFrames('#iframe-action-btn', {
        timeout: 5000,
        requireVisible: true
      });
      console.log(`  ✓ Elemento localizado. ¿Está en iframe? ${frameResult.isInIframe ? 'SÍ' : 'NO'}`);
      await frameResult.locator.click();
      console.log('  ✓ Clic ejecutado con éxito en el iframe anidado.');

      console.log('[5/6] Ejecutando clic y espiando respuesta JSON concurrente (clickAndSpyApi)...');
      interface InvoiceResponse {
        status: string;
        company: string;
        records: Array<{ id: string; amount: number; currency: string; status: string }>;
      }
      const spyResult = await scanner.clickAndSpyApi<InvoiceResponse>('#btn-fetch-invoices', {
        urlPattern: '/api/v1/invoices',
        method: 'GET',
        timeout: 8000
      });
      console.log(`  ✓ API interceptada exitosamente en ${spyResult.timingMs}ms:`, spyResult.data.records?.[0] || spyResult.data);
    }

    // 7. Generar y exportar artefactos
    console.log('\n[6/6] Generando artefactos integrales de auditoría e ingeniería inversa...');
    const exported = await scanner.exportAllArtifacts();

    // 8. Resumen en consola del Blueprint de Optimización Pasiva
    const reconReport = scanner.reconEngine?.generateReport();
    if (reconReport && reconReport.optimizationBlueprint) {
      const blueprint = reconReport.optimizationBlueprint;
      console.log('\n===============================================================');
      console.log('📊 BLUEPRINT DE OPTIMIZACIÓN PASIVA PARA TU BOT RPA');
      console.log('===============================================================');

      if (blueprint.antiBotWafDetected.length > 0) {
        console.log('🛡️ Protecciones Anti-Bot / WAF Detectadas:');
        blueprint.antiBotWafDetected.forEach((waf) => {
          console.log(`  • ${waf.provider}`);
          console.log(`    👉 Recomendación Bot: ${waf.rpaStrategy}`);
        });
      } else {
        console.log('🛡️ Protecciones WAF: No se detectaron retos de Cloudflare o WAF estricto.');
      }

      console.log('\n🏎️ Oportunidad de Rendimiento (Modo Turbo en Producción):');
      console.log(`  • Peticiones prescindibles capturadas: ${blueprint.turboPotential.totalBlockableRequests}`);
      console.log(`    - Imágenes: ${blueprint.turboPotential.imagesCount}`);
      console.log(`    - Fuentes tipográficas: ${blueprint.turboPotential.fontsCount}`);
      console.log(`  • Ahorro estimado de tráfico: ${blueprint.turboPotential.estimatedRequestSavingsPercent}%`);
      console.log(`  • ¿Recomendado activar en el bot final?: ${blueprint.turboPotential.recommendedForBot ? '✅ SÍ' : '⚠️ NO'}`);
      console.log(`    Motivo: ${blueprint.turboPotential.recommendationReason}`);

      if (blueprint.uiTrapsDetected.length > 0) {
        console.log(`\n🪤 Trampas de UI Detectadas (${blueprint.uiTrapsDetected.length}):`);
        blueprint.uiTrapsDetected.forEach((trap) => {
          console.log(`  • Tipo [${trap.type}]: "${trap.message}"`);
        });
        console.log('    👉 Recomendación Bot: Activa evasionMode: true en tu bot para neutralizarlas automáticamente.');
      }
    }

    console.log('\n===============================================================');
    console.log('🎉 Blueprint de reconocimiento completado.');
    console.log(`📁 Directorio: ${exported.outputDirectory}`);
    if (exported.promptContextFile) {
      console.log(`🤖 Briefing para Agente de IA: ${exported.promptContextFile}`);
    }
    if (exported.formSchemaFile) {
      console.log(`📋 Esquema de Formularios: ${exported.formSchemaFile}`);
    }
    console.log('===============================================================\n');

    await scanner.close({ exportArtifacts: false });
    if (server) await server.stop();
  } catch (error) {
    console.error('\n❌ Error durante el escaneo:', error);
    try {
      await scanner.close();
      if (server) await server.stop();
    } catch {}
    process.exit(1);
  }
}

// Ejecutar CLI
runCli().catch((err) => {
  console.error('Error fatal en scanner-kit CLI:', err);
  process.exit(1);
});
