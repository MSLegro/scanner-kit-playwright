import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { ScannerKit } from '../scanner-kit';
import { SessionRefresher } from '../modules/session-refresher';
import { StaticSurfaceMiner } from '../modules/static-surface-miner';
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

    console.log('  -> Simulando login en API (Token Lineage)...');
    await scanner.page.locator('#btn-auth-login').click();
    await scanner.page.waitForTimeout(400);

    console.log('  -> Simulando clic en botón de acción (Fetch Invoices XHR)...');
    await scanner.page.locator('#btn-fetch-invoices').click();
    await scanner.page.waitForTimeout(500);

    console.log('  -> Simulando consulta GraphQL (GraphQL Disaggregation)...');
    await scanner.page.locator('#btn-fetch-graphql').click();
    await scanner.page.waitForTimeout(400);

    console.log('  -> Simulando descarga de reporte PDF (Binary Download Sniffer)...');
    await scanner.page.locator('#btn-download-pdf').click();
    await scanner.page.waitForTimeout(400);

    console.log('  -> Simulando envío de formulario JSF con ViewState (Legacy Server State)...');
    await scanner.page.locator('#btn-submit-jsf').click();
    await scanner.page.waitForTimeout(400);

    console.log('  -> Simulando apertura de ventana emergente (Popup)...');
    const [popup] = await Promise.all([
      scanner.page.waitForEvent('popup'),
      scanner.page.locator('#btn-open-popup').click()
    ]);
    await popup.waitForLoadState('domcontentloaded');
    console.log('  ✓ Ventana emergente detectada y cargada:', popup.url());
    await popup.close();

    console.log('  -> Simulando cambio de ruta SPA (#/contabilidad/reportes)...');
    await scanner.page.evaluate(() => {
      window.location.hash = '#/contabilidad/reportes?year=2026';
    });
    await scanner.page.waitForTimeout(300);

    console.log('  -> Simulando descarga pasiva de plantilla Stimulsoft (.mrt)...');
    await scanner.page.evaluate(async () => {
      await fetch('/reports/invoice-template.mrt').catch(() => null);
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
      'recon-report.json',
      'form-schema.json',
      'prompt-context.md',
      'accessibility-tree.json',
      'brand-identity.json',
      'discovered-api-surface.json'
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
    if (seqData.popupsDetected && seqData.popupsDetected.length > 0) {
      console.log(`  ✓ Multi-Tab Tracker detectó popup: "${seqData.popupsDetected[0].url}"`);
    } else {
      throw new Error('[FAIL] No se registró el evento de popup en execution-sequence.json');
    }
    if (seqData.routeDirectNavigations.length > 0) {
      console.log(`  ✓ RouteTracker detectó ruta directa: "${seqData.routeDirectNavigations[0].route}"`);
      console.log(`    Sugerencia generada: ${seqData.routeDirectNavigations[0].recommendedGoto}`);
    }

    // Validar Causal Network Triggers en execution-sequence.json
    const invoiceClick = seqData.actions.find((a: any) => a.target?.id === 'btn-fetch-invoices');
    if (!invoiceClick || !invoiceClick.triggeredRequests || invoiceClick.triggeredRequests.length === 0) {
      throw new Error('[FAIL] Action-to-Network Causal Linker no asoció peticiones a btn-fetch-invoices');
    }
    const hasInvoiceReq = invoiceClick.triggeredRequests.some((t: any) => t.url.includes('/api/v1/invoices'));
    if (!hasInvoiceReq) {
      throw new Error('[FAIL] Causal Linker no vinculó /api/v1/invoices a la acción de clic');
    }
    console.log(`  ✓ Action-to-Network Causal Linker verificado: ${invoiceClick.triggeredRequests.length} peticion(es) vinculadas al clic de btn-fetch-invoices`);

    // Validar Downloads & Binary Sniffer en execution-sequence.json y carpeta downloads/
    if (!seqData.downloadsCaptured || seqData.downloadsCaptured.length === 0) {
      throw new Error('[FAIL] Download & Binary Sniffer no capturó descargas en execution-sequence.json');
    }
    const pdfDl = seqData.downloadsCaptured.find((d: any) => d.suggestedFilename?.includes('factura_enero_2026.pdf') || d.mimeType?.includes('pdf'));
    if (!pdfDl) {
      throw new Error('[FAIL] Download Sniffer no detectó la descarga del PDF');
    }
    console.log(`  ✓ Download & Binary Sniffer verificado: ${pdfDl.suggestedFilename} (${pdfDl.mimeType})`);

    const downloadsManifest = path.join(artifacts.outputDirectory, 'downloads', 'downloads-manifest.json');
    if (!fs.existsSync(downloadsManifest)) {
      throw new Error('[FAIL] No se generó downloads/downloads-manifest.json en el blueprint');
    }
    console.log(`  ✓ Manifiesto de descargas verificado en disco: ${downloadsManifest}`);

    // Validar contenido de form-schema.json
    const formData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'form-schema.json'), 'utf-8'));
    console.log(`  ✓ form-schema.json: ${formData.totalFields} campos catalogados en ${formData.totalForms} formulario(s)`);
    const formFields = formData.forms['form-afiliados'] || [];
    const selectField = formFields.find((f: any) => f.tag === 'select');
    if (!selectField || !selectField.options || selectField.options.length < 4) {
      throw new Error('[FAIL] FormAnalyzer no capturó las opciones del dropdown en form-schema.json');
    }
    console.log(`  ✓ FormAnalyzer extrajo ${selectField.options.length} opciones válidas de "${selectField.label}":`, selectField.options.map((o: any) => o.value).join(', '));

    // Validar contenido de prompt-context.md
    const promptContext = fs.readFileSync(path.join(artifacts.outputDirectory, 'prompt-context.md'), 'utf-8');
    if (!promptContext.includes('Briefing Técnico para Agente de IA') || !promptContext.includes('Diccionario de Campos de Formulario')) {
      throw new Error('[FAIL] prompt-context.md no contiene las secciones esperadas del briefing');
    }
    if (!promptContext.includes('Identidad Visual y Recursos de Marca (Branding)')) {
      throw new Error('[FAIL] prompt-context.md no incluye la sección de Identidad Visual y Branding');
    }
    if (!promptContext.includes('BLUEPRINT-FIRST CON VÁLVULA DE ESCAPE')) {
      throw new Error('[FAIL] prompt-context.md no incluye la directiva Blueprint-First con Válvula de Escape');
    }
    if (!promptContext.includes('Detección Explícita de Brechas (Gap Analysis)')) {
      throw new Error('[FAIL] prompt-context.md no incluye el protocolo de Gap Analysis para brechas');
    }
    if (promptContext.includes("fs.readFileSync('./session-backup.json'")) {
      throw new Error('[FAIL] prompt-context.md todavía contiene el snippet riesgoso fs.readFileSync session-backup.json');
    }
    if (!promptContext.includes('PROHIBIDO NAVEGAR EN FRÍO A POPUPS/VISORES')) {
      throw new Error('[FAIL] prompt-context.md no advierte contra navegar en frío a popups/visores');
    }
    console.log(`  ✓ prompt-context.md verificado con éxito (directivas Blueprint-First, Forensic-Only y anti-hardcoding validadas)`);

    // Validar contenido de brand-identity.json
    const brandData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'brand-identity.json'), 'utf-8'));
    console.log(`  ✓ brand-identity.json: ${brandData.totalResources} recursos de marca identificados`);
    if (!brandData.primaryLogo) {
      throw new Error('[FAIL] BrandExtractor no detectó el logo principal');
    }
    console.log(`  ✓ Logo Principal identificado: ${brandData.primaryLogo.url}`);
    if (!brandData.primaryFavicon) {
      throw new Error('[FAIL] BrandExtractor no detectó el favicon principal');
    }
    console.log(`  ✓ Favicon Principal identificado: ${brandData.primaryFavicon.url}`);
    if (brandData.meta.themeColor !== '#0066cc') {
      throw new Error(`[FAIL] Color de tema no coincide: ${brandData.meta.themeColor}`);
    }
    console.log(`  ✓ Metadatos de marca extraídos: Título="${brandData.meta.pageTitle}", Tema="${brandData.meta.themeColor}"`);

    // Validar carpeta brand-assets/
    const brandAssetsDir = path.join(artifacts.outputDirectory, 'brand-assets');
    if (fs.existsSync(brandAssetsDir)) {
      const downloadedFiles = fs.readdirSync(brandAssetsDir);
      console.log(`  ✓ brand-assets/ contiene ${downloadedFiles.length} archivos descargados:`, downloadedFiles.join(', '));
    }

    // Validar carpeta dom-snapshots/ y snapshots HTML generados
    console.log('\n  -> Validando capturas completas del DOM por acción (dom-snapshots/)...');
    const domSnapshotsDir = path.join(artifacts.outputDirectory, 'dom-snapshots');
    if (!fs.existsSync(domSnapshotsDir)) {
      throw new Error('[FAIL] No se generó la subcarpeta dom-snapshots/');
    }
    const domFiles = fs.readdirSync(domSnapshotsDir).filter((f) => f.endsWith('.html'));
    if (domFiles.length === 0) {
      throw new Error('[FAIL] La carpeta dom-snapshots/ está vacía; no se guardaron snapshots');
    }
    console.log(`  ✓ dom-snapshots/ verificado con ${domFiles.length} snapshot(s) HTML:`, domFiles.join(', '));

    // Validar enlace en execution-sequence.json y contenido del snapshot
    const actionWithSnapshot = seqData.actions.find((a: any) => a.domSnapshotFile && a.actionType === 'click');
    if (!actionWithSnapshot) {
      throw new Error('[FAIL] Ninguna acción de tipo click en execution-sequence.json posee domSnapshotFile');
    }
    const sampleSnapshotPath = path.join(artifacts.outputDirectory, actionWithSnapshot.domSnapshotFile);
    if (!fs.existsSync(sampleSnapshotPath)) {
      throw new Error(`[FAIL] El archivo referenciado en domSnapshotFile no existe en disco: ${sampleSnapshotPath}`);
    }
    const sampleHtml = fs.readFileSync(sampleSnapshotPath, 'utf-8');
    if (!sampleHtml.includes('<!DOCTYPE html>') || !sampleHtml.includes('ScannerKit DOM Snapshot')) {
      throw new Error('[FAIL] El snapshot HTML no posee estructura HTML válida o cabecera forense');
    }
    if (!sampleHtml.includes('data-sk-action-target="true"')) {
      throw new Error('[FAIL] El snapshot HTML no marcó el elemento accionado con data-sk-action-target="true"');
    }
    if (sampleHtml.includes('<script') || sampleHtml.includes('<style')) {
      throw new Error('[FAIL] El snapshot HTML contiene scripts o estilos que debieron ser filtrados para IA');
    }
    console.log(`  ✓ Snapshot forense verificado: ${actionWithSnapshot.domSnapshotFile} (marcador data-sk-action-target="true" y limpieza de scripts/estilos validados)`);

    // Validar sección de snapshots en prompt-context.md
    if (!promptContext.includes('Secuencia de Acciones y Snapshots Forenses del DOM')) {
      throw new Error('[FAIL] prompt-context.md no incluye la sección de snapshots forenses del DOM');
    }
    console.log(`  ✓ prompt-context.md incluye tabla de snapshots forenses del DOM`);

    // Validar contenido de selectors-map.json
    const selData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'selectors-map.json'), 'utf-8'));
    console.log(`  ✓ selectors-map.json: ${selData.totalSelectorsAnalyzed} selectores analizados`);
    console.log(`    Distribución de robustez:`, selData.robustnessSummary);

    // Validar contenido de api-contracts.json y GraphQL Disaggregation
    const apiData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'api-contracts.json'), 'utf-8'));
    console.log(`  ✓ api-contracts.json: ${apiData.totalContractsDiscovered} contratos descubiertos`);
    const gqlContract = apiData.contracts.find((c: any) => c.graphqlOperationName === 'GetFinancialSummary');
    if (!gqlContract) {
      throw new Error('[FAIL] GraphQL Disaggregator no desagregó el endpoint /api/graphql por operationName');
    }
    console.log(`  ✓ GraphQL Disaggregator verificado: "${gqlContract.endpointKey}" (Operación: ${gqlContract.graphqlOperationName}, Tipo: ${gqlContract.graphqlOperationType})`);

    // Validar recon-report.json: Token Provenance y Legacy Server State
    const reconData = JSON.parse(fs.readFileSync(path.join(artifacts.outputDirectory, 'recon-report.json'), 'utf-8'));
    const bearerTok = reconData.securityTokens.find((t: any) => t.type === 'Bearer');
    if (!bearerTok || !bearerTok.provenance) {
      throw new Error('[FAIL] Token Provenance Tracker no pobló provenance para el token Bearer');
    }
    console.log(`  ✓ Token Provenance verificado: ${bearerTok.headerName} provino de ${bearerTok.provenance.sourceLocation} (${bearerTok.provenance.sourceType})`);

    if (!reconData.legacyServerState || reconData.legacyServerState.stateFields.length === 0) {
      throw new Error('[FAIL] Legacy Server State Analyzer no detectó javax.faces.ViewState');
    }
    const viewStateField = reconData.legacyServerState.stateFields.find((f: any) => f.fieldName === 'javax.faces.ViewState');
    if (!viewStateField || !viewStateField.domExtractionRegex) {
      throw new Error('[FAIL] Campo javax.faces.ViewState no posee domExtractionRegex en recon-report.json');
    }
    console.log(`  ✓ Legacy Server State verificado: Framework="${reconData.legacyServerState.frameworkDetected}", Campo="${viewStateField.fieldName}", Regex="${viewStateField.domExtractionRegex}"`);

    // Validar contenido de discovered-api-surface.json
    console.log('\n  -> Validando descubrimiento estático de superficie de APIs (discovered-api-surface.json)...');
    const surfaceData = JSON.parse(
      fs.readFileSync(path.join(artifacts.outputDirectory, 'discovered-api-surface.json'), 'utf-8')
    );
    console.log(`  ✓ discovered-api-surface.json: ${surfaceData.summary.totalEndpointsDiscovered} endpoints descubiertos en ${surfaceData.summary.totalScriptsAnalyzed} script(s)`);

    // Validar satélite multi-puerto 5004
    const sat5004 = surfaceData.satelliteServices.find((s: any) => s.port === '5004' || s.origin.includes('5004'));
    if (!sat5004) {
      throw new Error('[FAIL] StaticSurfaceMiner no detectó el servicio satélite en puerto 5004');
    }
    console.log(`  ✓ Servicio satélite detectado: ${sat5004.origin} (Rol: "${sat5004.inferredRole}")`);

    // Validar clasificación de alto valor
    const hasPdf = surfaceData.highValueEndpoints.some((e: any) => e.category === 'PDF_COMPILATION');
    const hasExport = surfaceData.highValueEndpoints.some((e: any) => e.category === 'EXPORT');
    const hasDocs = surfaceData.highValueEndpoints.some((e: any) => e.category === 'DOCUMENTS');
    if (!hasPdf || !hasExport || !hasDocs) {
      throw new Error('[FAIL] StaticSurfaceMiner no catalogó endpoints en PDF_COMPILATION, EXPORT o DOCUMENTS');
    }
    console.log(`  ✓ Clasificación de alto valor verificada: PDF_COMPILATION, EXPORT y DOCUMENTS presentes`);

    // Validar distinción entre ejecutado en vivo vs latente en código
    const liveEndpoint = surfaceData.highValueEndpoints.find((e: any) => e.endpoint.includes('/api/v1/invoices'));
    const latentEndpoint = surfaceData.highValueEndpoints.find((e: any) => e.endpoint.includes('/api/v1/reports/pdf/render'));
    if (!liveEndpoint || !liveEndpoint.executedInLiveSession) {
      throw new Error('[FAIL] /api/v1/invoices debió ser marcado como ejecutado en vivo (executedInLiveSession: true)');
    }
    if (!latentEndpoint || latentEndpoint.executedInLiveSession) {
      throw new Error('[FAIL] /api/v1/reports/pdf/render debió ser marcado como latente en código (executedInLiveSession: false)');
    }
    console.log(`  ✓ Cruce de endpoints ejecutados vs latentes validado con éxito`);

    // Validar plantilla Stimulsoft (.mrt) y DataSources
    const tplMrt = surfaceData.reportTemplates.find((t: any) => t.templateName.includes('invoice-template.mrt'));
    if (!tplMrt || tplMrt.format !== 'mrt') {
      throw new Error('[FAIL] No se parseó la plantilla Stimulsoft invoice-template.mrt');
    }
    const invoicesDs = tplMrt.dataSources.find((ds: any) => ds.name === 'Invoices');
    if (!invoicesDs || invoicesDs.columns.length < 4) {
      throw new Error('[FAIL] DataSource Invoices no fue extraído con sus columnas en la plantilla .mrt');
    }
    if (!tplMrt.correlatedEndpoints.some((e: any) => e.includes('/api/v1/invoices'))) {
      throw new Error('[FAIL] La plantilla .mrt no fue correlacionada con el endpoint /api/v1/invoices');
    }
    console.log(`  ✓ Plantilla Stimulsoft .mrt verificada: DataSource "${invoicesDs.name}" (${invoicesDs.columns.join(', ')}) correlacionada con ${tplMrt.correlatedEndpoints.join(', ')}`);

    // Validar sección en prompt-context.md
    if (!promptContext.includes('Oportunidades de Bypass API-First Detectadas')) {
      throw new Error('[FAIL] prompt-context.md no incluye la sección de Oportunidades de Bypass API-First Detectadas');
    }
    if (!promptContext.includes('5004') || !promptContext.includes('PDF_COMPILATION')) {
      throw new Error('[FAIL] prompt-context.md no incluye los detalles de satélites o categorías de alto impacto');
    }
    console.log(`  ✓ prompt-context.md incluye sección de Bypass API-First con satélites y plantillas`);

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

    // -----------------------------------------------------------------
    // TEST 4: StaticSurfaceMiner Unit Test (sample-bundle.js & template)
    // -----------------------------------------------------------------
    console.log('\n--- [TEST 4] StaticSurfaceMiner: Bundle Harvester & Template Parsing Unit Test ---');
    const unitMiner = new StaticSurfaceMiner();
    unitMiner.registerScript(
      'sample-bundle.js',
      `
      const routes = {
        invoices: '/api/v1/invoices',
        renderPdf: '/api/v1/reports/pdf/render',
        excelExport: '/api/v1/export/excel',
        attachments: '/documents/download/attachment',
        satelliteService: 'http://172.16.1.99:5004/api/reporting/generate-pdf'
      };
      console.log(routes);
    `
    );
    unitMiner.registerTemplate(
      'sample-invoice.mrt',
      JSON.stringify({
        Dictionary: {
          DataSources: [
            {
              Name: 'Invoices',
              Columns: [{ Name: 'id' }, { Name: 'total' }]
            }
          ]
        }
      })
    );
    const unitReport = unitMiner.mineDiscoveredSurface('http://localhost:3000', ['/api/v1/invoices']);
    if (!unitReport) {
      throw new Error('[FAIL] StaticSurfaceMiner unit test: no retornó reporte');
    }
    if (unitReport.satelliteServices.length === 0 || unitReport.satelliteServices[0].port !== '5004') {
      throw new Error('[FAIL] StaticSurfaceMiner unit test: no detectó el puerto satélite 5004');
    }
    if (!unitReport.highValueEndpoints.some((e) => e.category === 'PDF_COMPILATION')) {
      throw new Error('[FAIL] StaticSurfaceMiner unit test: no clasificó PDF_COMPILATION');
    }
    if (!unitReport.highValueEndpoints.some((e) => e.category === 'EXPORT')) {
      throw new Error('[FAIL] StaticSurfaceMiner unit test: no clasificó EXPORT');
    }
    if (!unitReport.highValueEndpoints.some((e) => e.category === 'DOCUMENTS')) {
      throw new Error('[FAIL] StaticSurfaceMiner unit test: no clasificó DOCUMENTS');
    }
    const unitTpl = unitReport.reportTemplates.find((t) => t.templateName === 'sample-invoice.mrt');
    if (!unitTpl || !unitTpl.correlatedEndpoints.some((e) => e.includes('/api/v1/invoices'))) {
      throw new Error('[FAIL] StaticSurfaceMiner unit test: no correlacionó DataSource Invoices con /api/v1/invoices');
    }
    console.log('  ✓ StaticSurfaceMiner unit test completado exitosamente sobre sample-bundle.js');
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
