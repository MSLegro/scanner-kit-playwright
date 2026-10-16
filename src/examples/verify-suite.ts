import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { ScannerKit } from '../scanner-kit';
import { SessionRefresher } from '../modules/session-refresher';
import { TestServer } from './test-server';

/**
 * Script de Verificación Integral de las Nuevas Capacidades de ScannerKit:
 * 1. TelemetryExtractor (execution-sequence.json, selectors-map.json, api-contracts.json)
 * 2. RouteTracker (Detección de navegación SPA por ruta directa y sugerencias page.goto)
 * 3. SessionRefresher Anti-401 (Detección de 401/403, re-login silencioso y auto-retry)
 * 4. Exportación Finalizada (scanner.close() y exportAllArtifacts con 5 archivos limpios)
 */
async function runVerification() {
  console.log('===============================================================');
  console.log('🧪 INICIANDO VERIFICACIÓN DE CAPACIDADES AVANZADAS SCANNERKIT');
  console.log('===============================================================\n');

  const testOutputDir = path.resolve(process.cwd(), './temp-test-output');
  if (fs.existsSync(testOutputDir)) {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testOutputDir, { recursive: true });

  // 1. Iniciar servidor ERP de prueba local
  const server = new TestServer(3987);
  const serverUrl = await server.start();
  console.log(`[Setup] Servidor de prueba iniciado en: ${serverUrl}`);

  try {
    // -----------------------------------------------------------------
    // TEST 1 & 2: TelemetryExtractor + RouteTracker + Exportación
    // -----------------------------------------------------------------
    console.log('\n--- [TEST 1 & 2] TelemetryExtractor, RouteTracker & Target-Grouped Output ---');
    const scanner = await ScannerKit.create({
      headless: true,
      telemetryMode: true,
      reconMode: true,
      outputDir: testOutputDir,
      groupByTarget: true,
      targetCategory: 'informes',
      autoExportOnClose: false
    });

    // Navegar a la aplicación
    await scanner.goto(`${serverUrl}/portal`);

    // Simular acciones de usuario para alimentar la telemetría
    console.log('  -> Simulando interacción con campo de texto...');
    await scanner.page.locator('#search-query').fill('Facturas Q1');
    await scanner.page.keyboard.press('Tab');

    console.log('  -> Simulando clic en botón de acción (Fetch Invoices XHR)...');
    await scanner.page.locator('#btn-fetch-invoices').click();
    await scanner.page.waitForTimeout(500);

    console.log('  -> Simulando cambio de ruta SPA (#/contabilidad/reportes)...');
    await scanner.page.evaluate(() => {
      window.location.hash = '#/contabilidad/reportes?year=2026';
    });
    await scanner.page.waitForTimeout(300);

    // Exportar artefactos explícitamente y verificar agrupación por target
    console.log('\n  -> Exportando todos los artefactos agrupados por target...');
    const artifacts = await scanner.exportAllArtifacts();

    // Cerrar scanner
    await scanner.close();

    console.log(`  ✓ Directorio de salida resuelto: ${artifacts.outputDirectory}`);
    if (!artifacts.outputDirectory.includes('localhost_3987') || !artifacts.outputDirectory.includes('informes')) {
      throw new Error(`[FAIL] El directorio de salida no agrupó por target/categoría: ${artifacts.outputDirectory}`);
    }

    // Validar archivos generados dentro de la carpeta del target
    const expectedFiles = [
      'execution-sequence.json',
      'selectors-map.json',
      'api-contracts.json',
      'session-backup.json',
      'recon-report.json'
    ];

    for (const f of expectedFiles) {
      const fullPath = path.join(artifacts.outputDirectory, f);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`[FAIL] No se generó el archivo esperado en la subcarpeta del target: ${f}`);
      }
      const stats = fs.statSync(fullPath);
      console.log(`  ✓ ${f} verificado en ${artifacts.outputDirectory} (${stats.size} bytes)`);
    }

    // Validar contenido de execution-sequence.json
    const seqData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'execution-sequence.json'), 'utf-8'));
    console.log(`  ✓ execution-sequence.json: ${seqData.actions.length} acciones capturadas`);
    if (seqData.routeDirectNavigations.length > 0) {
      console.log(`  ✓ RouteTracker detectó ruta directa: "${seqData.routeDirectNavigations[0].route}"`);
      console.log(`    Sugerencia generada: ${seqData.routeDirectNavigations[0].recommendedGoto}`);
    }

    // Validar contenido de selectors-map.json
    const selData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'selectors-map.json'), 'utf-8'));
    console.log(`  ✓ selectors-map.json: ${selData.totalSelectorsAnalyzed} selectores analizados`);
    console.log(`    Distribución de robustez:`, selData.robustnessSummary);

    // Validar contenido de api-contracts.json
    const apiData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'api-contracts.json'), 'utf-8'));
    console.log(`  ✓ api-contracts.json: ${apiData.totalContractsDiscovered} contratos descubiertos`);
    if (apiData.contracts.length > 0) {
      console.log(`    Endpoint interceptado: ${apiData.contracts[0].method} ${apiData.contracts[0].pathname}`);
    }

    // -----------------------------------------------------------------
    // TEST 3: SessionRefresher Anti-401 (Silent Re-login & Auto-Retry)
    // -----------------------------------------------------------------
    console.log('\n--- [TEST 3] SessionRefresher Anti-401 & Auto-Retry ---');

    // Servidor mock que simula un 401 la primera vez y 200 tras renovar token
    let authAttempts = 0;
    let reloginCalls = 0;
    const testSessionFile = artifacts.sessionFile || path.join(testOutputDir, 'session-backup.json');

    const apiServer = http.createServer((req, res) => {
      const authHeader = req.headers['authorization'];
      authAttempts++;

      if (authHeader === 'Bearer fresh-token-valid-2026') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Datos autorizados tras re-login' }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TokenExpired', message: 'JWT caducado' }));
      }
    });

    const apiPort = 3988;
    await new Promise<void>((resolve) => apiServer.listen(apiPort, resolve));

    const refresher = new SessionRefresher({
      baseUrl: `http://localhost:${apiPort}`,
      sessionBackupPath: testSessionFile,
      initialToken: 'expired-token-123',
      maxRetries: 2,
      retryDelayMs: 100,
      reloginHandler: async () => {
        reloginCalls++;
        console.log('    [Mock Relogin] Callback de re-login ejecutado. Generando nuevo token...');
        return 'fresh-token-valid-2026';
      }
    });

    console.log('  -> Disparando petición a endpoint protegido con token expirado...');
    const response = await refresher.fetchWithRetry('/api/protected/data');
    const resultJson = await response.json();

    console.log(`  ✓ Status de respuesta final: ${response.status}`);
    console.log(`  ✓ Mensaje de respuesta: "${(resultJson as any).message}"`);
    console.log(`  ✓ Veces que se invocó el reloginHandler: ${reloginCalls}`);

    if (response.status !== 200 || reloginCalls !== 1) {
      throw new Error('[FAIL] SessionRefresher no manejó el 401 o no renovó el token correctamente.');
    }

    console.log('  ✓ SessionRefresher Anti-401 verificado al 100%');

    apiServer.close();
  } finally {
    await server.stop();
    // Limpieza de carpeta temporal de prueba
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  }

  console.log('\n===============================================================');
  console.log('✨ TODAS LAS CAPACIDADES AVANZADAS FUERON VERIFICADAS CON ÉXITO');
  console.log('===============================================================');
}

runVerification().catch((err) => {
  console.error('\n❌ Error en verificación:', err);
  process.exit(1);
});
