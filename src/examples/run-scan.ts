import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { ScannerKit } from '../scanner-kit';
import { TestServer } from './test-server';

// Cargar variables de entorno desde el archivo .env
dotenv.config();

/**
 * Script de demostración integral de scanner-kit-playwright.
 *
 * Muestra el ciclo de vida completo:
 * 1. Inicialización configurable por .env o flags CLI.
 * 2. Navegación con Modo Turbo y Evasión activa.
 * 3. Descubrimiento y acción en elementos anidados en iframes (Buscador Multi-Frame).
 * 4. Espía de Botones Híbrido (clickAndSpyApi) extrayendo JSON puro y latencia de backend.
 * 5. Exportación de sesión completa (Cookies, localStorage, sessionStorage).
 * 6. Generación de radiografía técnica (recon-report.json) con auditoría de tokens.
 */
async function main() {
  console.log('===============================================================');
  console.log('🚀 Iniciando escaneo con scanner-kit-playwright');
  console.log('===============================================================\n');

  // Detección de socket gráfico real para compatibilidad
  const isWindowsOrMac = process.platform === 'win32' || process.platform === 'darwin';
  const waylandSocket = process.env.XDG_RUNTIME_DIR && process.env.WAYLAND_DISPLAY
    ? path.join(process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY)
    : null;
  const x11Socket = process.env.DISPLAY ? `/tmp/.X11-unix/X${process.env.DISPLAY.replace(':', '')}` : null;
  
  const hasLiveDisplay = isWindowsOrMac ||
                         Boolean(waylandSocket && require('fs').existsSync(waylandSocket)) ||
                         Boolean(x11Socket && require('fs').existsSync(x11Socket));

  const forceHeadless = process.argv.includes('--headless');
  const forceHeaded = process.argv.includes('--headed');
  
  // Lectura de configuración desde .env con prioridades CLI
  const envHeadless = process.env.HEADLESS === 'true';
  const slowMo = parseInt(process.env.SLOW_MO || '300', 10);
  const turboMode = process.env.TURBO_MODE !== 'false';
  const evasionMode = process.env.EVASION_MODE !== 'false';
  const reconMode = process.env.RECON_MODE !== 'false';
  
  let isHeadless = forceHeadless || envHeadless || (!hasLiveDisplay && !forceHeaded);

  if (!isHeadless) {
    console.log('🖥️ Modo visual activo (HEADLESS=false)...');
  } else if (!forceHeadless && !envHeadless) {
    console.log('ℹ️ Entorno sin servidor gráfico accesible (sandbox/CI). Ejecutando en modo headless para garantizar estabilidad.');
  }

  // 1. Detectar URL objetivo (Prioridad: Argumento CLI > TARGET_URL de .env > Servidor local de prueba)
  const cliUrl = process.argv.slice(2).find((arg) => arg.startsWith('http://') || arg.startsWith('https://'));
  const envUrl = process.env.TARGET_URL?.trim();
  const customUrl = cliUrl || (envUrl ? envUrl : null);

  let server: TestServer | null = null;
  let targetUrl: string;

  if (customUrl) {
    targetUrl = customUrl;
    console.log(`[1/6] URL objetivo configurada (${cliUrl ? 'desde CLI' : 'desde .env'}): ${targetUrl}`);
  } else {
    // Iniciar servidor de prueba local si no se definió URL externa
    server = new TestServer(3456);
    const serverUrl = await server.start();
    targetUrl = `${serverUrl}/portal`;
    console.log(`[1/6] TARGET_URL vacío en .env. Usando servidor de simulación ERP local en: ${serverUrl}`);
  }

  // 2. Inicializar ScannerKit con la configuración de .env
  console.log(`[2/6] Inicializando ScannerKit (headless: ${isHeadless}, turboMode: ${turboMode}, evasionMode: ${evasionMode})...`);
  const scanner = await ScannerKit.create({
    headless: isHeadless,
    slowMo: isHeadless ? 0 : slowMo,
    turboMode,
    evasionMode,
    reconMode,
    viewport: { width: 1280, height: 720 }
  });

  try {
    // 3. Navegar a la página objetivo
    console.log(`[3/6] Navegando a ${targetUrl} ...`);
    await scanner.goto(targetUrl);

    if (customUrl) {
      await scanner.page.waitForLoadState('domcontentloaded').catch(() => {});

      // Verificar si el modo interactivo está habilitado (por defecto true si hay URL personalizada o modo visual)
      const isInteractive = process.env.INTERACTIVE !== 'false';

      if (isInteractive && !isHeadless) {
        console.log('\n===============================================================');
        console.log('🎮 MODO INTERACTIVO & AUDITORÍA EN VIVO ACTIVO');
        console.log('===============================================================');
        console.log('El navegador permanece abierto para que explores la web libremente:');
        console.log('  • Inicia sesión, navega entre módulos, llena formularios o haz clic.');
        console.log('  • ReconEngine está auditando cada llamada de red y token en tiempo real.');
        console.log('  • Modo Turbo y Evasión están protegiendo la navegación en segundo plano.\n');
        console.log('👉 ¿Listo para guardar sesión y reporte?');
        console.log('   Presiona [ENTER] aquí en la terminal mientras la ventana sigue abierta.');
        console.log('   (⚠️ Si cierras la ventana con la [X] del ratón, el navegador destruirá el DOM antes de extraer localStorage/sessionStorage).\n');

        // Esperar a que el usuario presione Enter O cierre la ventana del navegador
        await new Promise<void>((resolve) => {
          let resolved = false;

          const onStdinData = () => {
            console.log('\n[Info] Finalización manual solicitada desde la terminal.');
            finish();
          };

          const finish = () => {
            if (!resolved) {
              resolved = true;
              try {
                process.stdin.removeListener('data', onStdinData);
                process.stdin.pause();
              } catch {}
              resolve();
            }
          };

          // Si el usuario cierra la ventana del navegador con el ratón
          scanner.page.on('close', () => {
            console.log('\n[Info] Ventana del navegador cerrada por el usuario.');
            finish();
          });

          // Si el usuario presiona Enter en la terminal
          if (process.stdin.isTTY || process.stdin.readable) {
            process.stdin.resume();
            process.stdin.setEncoding('utf-8');
            process.stdin.once('data', onStdinData);
          }
        });
      } else {
        // En modo headless o no interactivo, esperamos a que la red se estabilice
        const waitSeconds = parseInt(process.env.WAIT_SECONDS || '5', 10);
        console.log(`  Esperando ${waitSeconds}s de actividad de red y telemetría...`);
        await scanner.page.waitForTimeout(waitSeconds * 1000);
      }

      console.log('  ✓ Flujo de navegación completado. Consolidando telemetría...');
    } else {
      // 4. Probar Buscador Multi-Frame en el iframe anidado (solo en test server local)
      console.log('[4/6] Probando Buscador Multi-Frame para localizar botón dentro de <iframe>...');
      const frameResult = await scanner.findElementAcrossFrames('#iframe-action-btn', {
        timeout: 5000,
        requireVisible: true
      });

      console.log(`  ✓ Elemento localizado!`);
      console.log(`    - ¿Está en iframe?: ${frameResult.isInIframe}`);
      console.log(`    - Nombre del iframe: "${frameResult.frameName}"`);
      console.log(`    - URL del frame: ${frameResult.frameUrl}`);

      // Interactuar con el elemento dentro del frame descubierto
      await frameResult.locator.click();
      console.log('  ✓ Clic ejecutado con éxito en el iframe anidado.');

      // 5. Probar El Espía de Botones Híbrido (clickAndSpyApi)
      console.log('\n[5/6] Ejecutando El Espía de Botones Híbrido (clickAndSpyApi)...');
      console.log('  Haciendo clic en "#btn-fetch-invoices" y esperando concurrentemente la respuesta del backend...');

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

      console.log(`  ✓ Respuesta de API interceptada exitosamente!`);
      console.log(`    - Status HTTP: ${spyResult.status}`);
      console.log(`    - Latencia de backend: ${spyResult.timingMs} ms`);
      console.log(`    - URL interceptada: ${spyResult.url}`);
      console.log(`    - Registros recibidos: ${spyResult.data.records.length} facturas`);
      console.log('    - Muestra de datos:', JSON.stringify(spyResult.data.records[0]));
    }

    // 6. Exportar Sesión, Radiografía y Telemetría Completa
    console.log('\n[6/6] Generando artefactos integrales de auditoría, telemetría e ingeniería inversa...');

    const artifacts = await scanner.exportAllArtifacts();

    // 1. Sesión
    const sessionFilePath = process.env.SESSION_BACKUP_PATH || './session-backup.json';
    const sessionFile = path.resolve(process.cwd(), sessionFilePath);
    if (fs.existsSync(sessionFile)) {
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      console.log(`\n  📁 [1/5] Sesión empaquetada en: ${sessionFile}`);
      console.log(`    - Cookies: ${session.cookies?.length || 0}`);
      console.log(`    - LocalStorage keys: ${Object.keys(session.localStorage || {}).length}`);
      console.log(`    - SessionStorage keys: ${Object.keys(session.sessionStorage || {}).length}`);
    }

    // 2. Radiografía técnica (ReconEngine)
    const reconFilePath = process.env.RECON_REPORT_PATH || './recon-report.json';
    const reconFile = path.resolve(process.cwd(), reconFilePath);
    if (fs.existsSync(reconFile)) {
      const recon = JSON.parse(fs.readFileSync(reconFile, 'utf-8'));
      console.log(`\n  📁 [2/5] Radiografía técnica guardada en: ${reconFile}`);
      console.log(`    - Peticiones HTTP totales capturadas: ${recon.summary?.totalRequestsCaptured || 0}`);
      console.log(`    - Endpoints catalogados: ${recon.summary?.totalEndpointsDiscovered || 0}`);
      console.log(`    - Tokens de seguridad identificados: ${recon.summary?.totalSecurityTokensIdentified || 0}`);
      if (recon.securityTokens?.length > 0) {
        for (const token of recon.securityTokens) {
          console.log(`      * [${token.type}] Header: "${token.headerName}" -> Valor: ${token.sampleValue}`);
        }
      }
    }

    // 3. Secuencia de Ejecución y Rutas Directas (TelemetryExtractor)
    const sequenceFile = path.resolve(process.cwd(), 'execution-sequence.json');
    if (fs.existsSync(sequenceFile)) {
      const seq = JSON.parse(fs.readFileSync(sequenceFile, 'utf-8'));
      console.log(`\n  📁 [3/5] Secuencia de ejecución en: ${sequenceFile}`);
      console.log(`    - Acciones de usuario registradas: ${seq.totalActionsCaptured || 0}`);
      console.log(`    - Rutas SPA navegables descubiertas: ${seq.uniqueRoutesDiscovered || 0}`);
      if (seq.routeDirectNavigations?.length > 0) {
        console.log('    - Sugerencias directas de navegación RPA (page.goto):');
        for (const route of seq.routeDirectNavigations.slice(0, 3)) {
          console.log(`      * Ruta: "${route.route}" -> ${route.recommendedGoto}`);
        }
      }
    }

    // 4. Mapa de Selectores y Robustez
    const selectorsFile = path.resolve(process.cwd(), 'selectors-map.json');
    if (fs.existsSync(selectorsFile)) {
      const selMap = JSON.parse(fs.readFileSync(selectorsFile, 'utf-8'));
      console.log(`\n  📁 [4/5] Mapa de robustez de selectores en: ${selectorsFile}`);
      console.log(`    - Selectores únicos analizados: ${selMap.totalSelectorsAnalyzed || 0}`);
      console.log(
        `    - Calidad: Excelente: ${selMap.robustnessSummary?.excellentCount || 0} | Alta: ${selMap.robustnessSummary?.highCount || 0} | Media: ${selMap.robustnessSummary?.mediumCount || 0} | Frágil: ${selMap.robustnessSummary?.fragileCount || 0}`
      );
    }

    // 5. Contratos de API XHR/Fetch
    const contractsFile = path.resolve(process.cwd(), 'api-contracts.json');
    if (fs.existsSync(contractsFile)) {
      const contracts = JSON.parse(fs.readFileSync(contractsFile, 'utf-8'));
      console.log(`\n  📁 [5/5] Contratos y esquemas de API en: ${contractsFile}`);
      console.log(`    - Contratos de microservicios descubiertos: ${contracts.totalContractsDiscovered || 0}`);
    }

    console.log('\n===============================================================');
    console.log('✨ Escaneo y demostración completados con 100% de éxito.');
    console.log('===============================================================');
  } catch (error) {
    console.error('\n❌ Error durante la ejecución del escaneo:', error);
    process.exitCode = 1;
  } finally {
    // Limpieza de recursos
    console.log('\nCerrando navegador y finalizando servicios...');
    await scanner.close();
    if (server) {
      await server.stop();
    }
    console.log('Recursos liberados.');
    process.exit(process.exitCode ?? 0);
  }
}

// Ejecutar script principal
if (require.main === module) {
  main().catch((err) => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
}
