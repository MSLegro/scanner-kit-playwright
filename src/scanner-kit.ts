import * as fs from 'fs';
import * as path from 'path';
import { Browser, BrowserContext, chromium, Locator, Page } from 'playwright';
import { ApiSpy } from './modules/api-spy';
import { EvasionManager, EvasionOptions } from './modules/evasion-manager';
import { FindFrameOptions, FrameExplorer } from './modules/frame-explorer';
import { ReconEngine } from './modules/recon-engine';
import { SessionManager } from './modules/session-manager';
import { TelemetryExtractor } from './modules/telemetry-extractor';
import { TurboManager, TurboOptions } from './modules/turbo-manager';
import { FormAnalyzer } from './modules/form-analyzer';
import { AgentBriefing } from './modules/agent-briefing';
import {
  ApiContractsReport,
  ClickAndSpyOptions,
  ExecutionSequenceReport,
  ExportArtifactsResult,
  FormSchemaReport,
  MultiFrameElementResult,
  ReconReport,
  ScannerKitOptions,
  SelectorsMapReport,
  SessionBackup,
  SpyResult
} from './types';

/**
 * ScannerKit - Kit Universal de Reconocimiento, Ingeniería Inversa y Automatización RPA.
 *
 * Encapsula el motor de Playwright con capacidades nativas avanzadas diseñadas para
 * sortear restricciones en plataformas web empresariales, portales con iframes complejos
 * y sistemas ERP.
 */
export class ScannerKit {
  private _browser: Browser;
  private _context: BrowserContext;
  private _page: Page;
  private _turboManager?: TurboManager;
  private _evasionManager?: EvasionManager;
  private _reconEngine?: ReconEngine;
  private _telemetryExtractor?: TelemetryExtractor;
  private _formAnalyzer: FormAnalyzer;
  private _options: ScannerKitOptions;

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    options: ScannerKitOptions,
    turboManager?: TurboManager,
    evasionManager?: EvasionManager,
    reconEngine?: ReconEngine,
    telemetryExtractor?: TelemetryExtractor
  ) {
    this._browser = browser;
    this._context = context;
    this._page = page;
    this._options = options;
    this._turboManager = turboManager;
    this._evasionManager = evasionManager;
    this._reconEngine = reconEngine;
    this._telemetryExtractor = telemetryExtractor;
    this._formAnalyzer = new FormAnalyzer();
  }

  /**
   * Inicializa e instancia un nuevo entorno de ScannerKit con todas las capas configuradas.
   *
   * @param options Opciones de configuración de navegador, evasión y telemetría.
   * @returns Instancia lista de ScannerKit.
   */
  public static async create(options: ScannerKitOptions = {}): Promise<ScannerKit> {
    const headless = options.headless ?? true;
    const slowMo = options.slowMo ?? 0;
    const turboMode = options.turboMode ?? false;
    const evasionMode = options.evasionMode ?? false;
    const reconMode = options.reconMode ?? true;

    const isLinux = process.platform === 'linux';
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      ...(options.launchArgs ?? [])
    ];

    // 1. Lanzar el navegador (en modo visual intenta usar Google Chrome nativo para huella TLS/Brand genuina)
    let browser: Browser;
    try {
      if (!headless) {
        try {
          browser = await chromium.launch({
            channel: 'chrome',
            headless: false,
            slowMo,
            args: launchArgs
          });
        } catch {
          browser = await chromium.launch({
            headless: false,
            slowMo,
            args: launchArgs
          });
        }
      } else {
        browser = await chromium.launch({
          headless: true,
          slowMo,
          args: launchArgs
        });
      }
    } catch (launchErr: unknown) {
      const errStr = String(launchErr);
      const isDisplayFailure =
        errStr.includes('Wayland') ||
        errStr.includes('ozone') ||
        errStr.includes('display') ||
        errStr.includes('The platform failed to initialize');

      if (!headless && isDisplayFailure) {
        console.warn(
          '[ScannerKit] ⚠️ Servidor gráfico no disponible en este entorno. Activando fallback automático a headless: true...'
        );
        browser = await chromium.launch({
          headless: true,
          slowMo: 0,
          args: launchArgs
        });
      } else {
        throw launchErr;
      }
    }

    // 2. Crear el BrowserContext preservando el User-Agent y Client-Hints nativos del navegador real
    const defaultViewport = headless ? { width: 1366, height: 768 } : null;
    const context = await browser.newContext({
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      viewport: options.viewport === undefined ? defaultViewport : options.viewport,
      ignoreHTTPSErrors: true
    });

    // 3. Inicializar e inyectar el Modo Turbo (solo si se solicita explícitamente para un bot en producción)
    let turboManager: TurboManager | undefined;
    if (turboMode) {
      turboManager = new TurboManager();
      await turboManager.applyToContext(context);
    }

    // 4. Inicializar e inyectar Evasión activa de UI (solo si se solicita explícitamente)
    let evasionManager: EvasionManager | undefined;
    if (evasionMode) {
      evasionManager = new EvasionManager();
      await evasionManager.applyToContext(context);
    }

    // 5. Crear la página inicial
    const page = await context.newPage();

    // 6. Configurar listeners de evasión activa en la página (si está habilitada)
    if (evasionManager) {
      evasionManager.attachToPage(page);
    }

    // 7. Configurar ReconEngine (escáner 100% pasivo de red, tokens, potencial Turbo, WAF y diálogos)
    let reconEngine: ReconEngine | undefined;
    if (reconMode) {
      reconEngine = new ReconEngine();
      reconEngine.attachToPage(page, { handleDialogsPassively: !evasionManager });
    }

    // 8. Configurar TelemetryExtractor sigiloso (acciones, selectores, contratos API, route tracker)
    const telemetryMode = options.telemetryMode ?? true;
    let telemetryExtractor: TelemetryExtractor | undefined;
    if (telemetryMode) {
      telemetryExtractor = new TelemetryExtractor();
      await telemetryExtractor.attach(page, context);
    }

    // 9. Registrar seguimiento reactivo de storage (permite guardar cookies y storage aun si se cierra con la [X])
    SessionManager.trackPageStorage(page);

    return new ScannerKit(browser, context, page, options, turboManager, evasionManager, reconEngine, telemetryExtractor);
  }

  // --- Accesores Principales ---

  public get page(): Page {
    return this._page;
  }

  public get context(): BrowserContext {
    return this._context;
  }

  public get browser(): Browser {
    return this._browser;
  }

  public get reconEngine(): ReconEngine | undefined {
    return this._reconEngine;
  }

  public get telemetry(): TelemetryExtractor | undefined {
    return this._telemetryExtractor;
  }

  public get formAnalyzer(): FormAnalyzer {
    return this._formAnalyzer;
  }

  // --- Funcionalidades Nativas ---

  /**
   * Navega a una URL utilizando la página activa.
   */
  public async goto(url: string, options?: Parameters<Page['goto']>[1]): Promise<ReturnType<Page['goto']>> {
    return this._page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
      ...options
    });
  }

  /**
   * Abre una nueva pestaña/página configurándole automáticamente las políticas
   * de reconocimiento pasivo y telemetría.
   */
  public async newPage(): Promise<Page> {
    const page = await this._context.newPage();
    if (this._evasionManager) {
      this._evasionManager.attachToPage(page);
    }
    if (this._reconEngine) {
      this._reconEngine.attachToPage(page, { handleDialogsPassively: !this._evasionManager });
    }
    if (this._telemetryExtractor) {
      await this._telemetryExtractor.attach(page, this._context);
    }
    SessionManager.trackPageStorage(page);
    return page;
  }

  /**
   * Buscador Multi-Frame:
   * Rastrea inteligentemente un elemento tanto en el DOM principal como dentro de cualquier iframe anidado.
   *
   * @param selector Selector CSS, XPath o selector de texto.
   * @param options Opciones de búsqueda (timeout, visibilidad).
   */
  public async findElementAcrossFrames(
    selector: string,
    options?: FindFrameOptions
  ): Promise<MultiFrameElementResult> {
    return FrameExplorer.findElementAcrossFrames(this._page, selector, options);
  }

  /**
   * El Espía de Botones Híbrido:
   * Ejecuta el clic sobre el elemento (o selector) y atrapa reactivamente la respuesta XHR/Fetch en vuelo,
   * retornando el cuerpo JSON parseado con métricas de latencia y cabeceras.
   *
   * @param target Selector de texto, selector CSS o Locator.
   * @param options Opciones de filtrado por URL, método HTTP, timeouts o predicados.
   */
  public async clickAndSpyApi<T = unknown>(
    target: Locator | string,
    options?: ClickAndSpyOptions
  ): Promise<SpyResult<T>> {
    return ApiSpy.clickAndSpyApi<T>(this._page, target, options);
  }

  /**
   * Exportador de Sesión Completa:
   * Empaqueta de manera unificada cookies, localStorage y sessionStorage en una estructura JSON.
   *
   * @param outputPath Ruta opcional donde guardar el archivo de respaldo .json.
   */
  public async exportSession(outputPath?: string): Promise<SessionBackup> {
    return SessionManager.exportSession(this._page, outputPath);
  }

  /**
   * Restaura una sesión previamente exportada (cookies, localStorage, sessionStorage).
   *
   * @param sessionInput Ruta al archivo .json de respaldo o el objeto SessionBackup.
   */
  public async restoreSession(sessionInput: string | SessionBackup): Promise<void> {
    return SessionManager.restoreSession(this._page, sessionInput);
  }

  /**
   * Generador de Radiografía Técnica:
   * Audita los endpoints descubiertos y cabeceras de autorización detectadas durante la navegación,
   * exportando el reporte técnico a disco.
   *
   * @param outputPath Ruta de destino para el informe (ej. './recon-report.json').
   */
  public generateReconReport(outputPath: string = './recon-report.json'): ReconReport {
    if (!this._reconEngine) {
      throw new Error('[ScannerKit] El ReconEngine no está habilitado en las opciones de configuración.');
    }
    return this._reconEngine.generateReport(outputPath);
  }

  /**
   * Resuelve la ruta del directorio de salida agrupada por target (dominio / host / IP)
   * y categoría opcional, asegurando nombres válidos y compatibles con el sistema de archivos (Windows / Linux).
   *
   * Ejemplo:
   *   - Base: './blueprint' (en el directorio actual process.cwd() donde se corre el CLI)
   *   - URL: 'http://localhost:3456/portal'
   *   - Resultado: 'C:/.../blueprint/localhost_3456'
   *   - Con categoría 'informes': 'C:/.../blueprint/localhost_3456/informes'
   *
   * @param customDir Directorio base opcional (sobreescribe options.blueprintDir / options.outputDir).
   * @param customCategory Subcarpeta o categoría opcional (ej. 'informes', 'login_flow').
   */
  public resolveTargetOutputDir(customDir?: string, customCategory?: string): string {
    const rawBase =
      customDir ||
      this._options.blueprintDir ||
      this._options.outputDir ||
      process.env.BLUEPRINT_DIR ||
      process.env.OUTPUT_DIR ||
      './blueprint';
    const baseDir = path.resolve(process.cwd(), rawBase);
    const shouldGroup = this._options.groupByTarget !== false;

    if (!shouldGroup) {
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
      return baseDir;
    }

    let targetName = 'default_target';
    try {
      const currentUrl = this._page ? this._page.url() : '';
      if (currentUrl && currentUrl !== 'about:blank') {
        const parsed = new URL(currentUrl);
        if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
          targetName = `${parsed.hostname}_${parsed.port}`;
        } else if (parsed.hostname) {
          targetName = parsed.hostname;
        }
      }
    } catch {
      targetName = 'unknown_target';
    }

    // Sanitizar caracteres inválidos para Windows / POSIX (: * ? " < > |)
    const safeTargetName = targetName.replace(/[^a-zA-Z0-9._-]/g, '_');

    const category = customCategory || this._options.targetCategory;
    const finalDir = category
      ? path.join(baseDir, safeTargetName, category.replace(/[^a-zA-Z0-9._-]/g, '_'))
      : path.join(baseDir, safeTargetName);

    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    return finalDir;
  }

  /**
   * Exportador Integral de Auditoría e Ingeniería Inversa:
   * Empaqueta y guarda en disco todos los artefactos de telemetría y reconocimiento:
   * 1. session-backup.json (cookies, localStorage, sessionStorage)
   * 2. recon-report.json (radiografía técnica de red y tokens)
   * 3. execution-sequence.json (orden cronológico de acciones del usuario y sugerencias de rutas)
   * 4. selectors-map.json (matriz de robustez y resiliencia de selectores Playwright)
   * 5. api-contracts.json (contratos y esquemas tipados de APIs XHR/Fetch)
   *
   * Los archivos se agrupan automáticamente en carpetas por target (ej: blueprint/localhost_3456/).
   *
   * @param outputDir Directorio de salida opcional (por defecto options.blueprintDir o './blueprint').
   * @param category Subcarpeta o categoría opcional (ej. 'informes').
   */
  public async exportAllArtifacts(
    outputDir?: string,
    category?: string
  ): Promise<ExportArtifactsResult> {
    const targetDir = this.resolveTargetOutputDir(outputDir, category);
    const results: ExportArtifactsResult = {
      outputDirectory: targetDir
    };

    console.log(`\n[ScannerKit] 📦 Consolidando y exportando blueprint en: ${targetDir}`);

    let sessionBackup: SessionBackup | null = null;
    let reconReport: ReconReport | null = null;
    let sequenceReport: ExecutionSequenceReport | null = null;
    let selectorsReport: SelectorsMapReport | null = null;
    let contractsReport: ApiContractsReport | null = null;
    let formReport: FormSchemaReport | null = null;
    let accessibilityData: unknown = null;

    // 1. Respaldo de Sesión
    try {
      const sessionPath = path.join(targetDir, 'session-backup.json');
      sessionBackup = await this.exportSession(sessionPath);
      results.sessionFile = sessionPath;
    } catch (e) {
      console.warn('[ScannerKit] No se pudo exportar sesión:', (e as Error).message);
    }

    // 2. Radiografía Técnica (ReconEngine)
    if (this._reconEngine) {
      try {
        const reconPath = path.join(targetDir, 'recon-report.json');
        reconReport = this.generateReconReport(reconPath);
        results.reconReportFile = reconPath;
      } catch (e) {
        console.warn('[ScannerKit] No se pudo exportar reporte de reconocimiento:', (e as Error).message);
      }
    }

    // 3. Telemetría Avanzada (Secuencia, Selectores, Contratos de API)
    if (this._telemetryExtractor) {
      try {
        const sequencePath = path.join(targetDir, 'execution-sequence.json');
        const selectorsPath = path.join(targetDir, 'selectors-map.json');
        const contractsPath = path.join(targetDir, 'api-contracts.json');

        sequenceReport = this._telemetryExtractor.generateExecutionSequence(sequencePath);
        selectorsReport = this._telemetryExtractor.generateSelectorsMap(selectorsPath);
        contractsReport = this._telemetryExtractor.generateApiContracts(contractsPath);

        results.sequenceFile = sequencePath;
        results.selectorsFile = selectorsPath;
        results.contractsFile = contractsPath;
      } catch (e) {
        console.warn('[ScannerKit] No se pudo exportar telemetría:', (e as Error).message);
      }
    }

    // 4. Esquema de Formularios y Catálogo de Desplegables (FormAnalyzer)
    try {
      formReport = this._formAnalyzer.getReport();
      if (!this._page.isClosed()) {
        formReport = await this._formAnalyzer.analyzePageForms(this._page).catch(() => formReport);
      }
      if (formReport) {
        const formSchemaPath = path.join(targetDir, 'form-schema.json');
        this._formAnalyzer.generateFormSchema(formSchemaPath, formReport);
        results.formSchemaFile = formSchemaPath;
      }
    } catch (e) {
      console.warn('[ScannerKit] No se pudo exportar esquema de formularios:', (e as Error).message);
    }

    // 5. Árbol de Accesibilidad (Accessibility Snapshot)
    if (!this._page.isClosed()) {
      try {
        let ariaSnapshotText: string | null = null;
        try {
          if (typeof this._page.locator === 'function') {
            ariaSnapshotText = await this._page.locator(':root').ariaSnapshot().catch(() => null);
          }
        } catch {
          // ignore
        }

        let axTreeNodes: any = null;
        try {
          const client = await this._page.context().newCDPSession(this._page).catch(() => null);
          if (client) {
            const cdpResult = await client.send('Accessibility.getFullAXTree').catch(() => null);
            axTreeNodes = cdpResult?.nodes || null;
            await client.detach().catch(() => null);
          }
        } catch {
          // CDP might not be supported in WebKit/Firefox
        }

        let legacySnapshot: any = null;
        try {
          legacySnapshot = await (this._page as any).accessibility?.snapshot?.().catch(() => null);
        } catch {
          // ignore
        }

        if (ariaSnapshotText || axTreeNodes || legacySnapshot) {
          accessibilityData = {
            capturedAt: new Date().toISOString(),
            url: this._page.url(),
            ariaSnapshot: ariaSnapshotText || undefined,
            nodesCount: axTreeNodes ? axTreeNodes.length : undefined,
            nodes: axTreeNodes || undefined,
            legacyTree: legacySnapshot || undefined
          };
          const a11yPath = path.join(targetDir, 'accessibility-tree.json');
          fs.writeFileSync(a11yPath, JSON.stringify(accessibilityData, null, 2), 'utf-8');
          results.accessibilityTreeFile = a11yPath;
          console.log(`[ScannerKit] Árbol de accesibilidad guardado en: ${a11yPath}`);
        }
      } catch (e) {
        console.warn('[ScannerKit] No se pudo exportar árbol de accesibilidad:', (e as Error).message);
      }
    }

    // 6. Briefing Consolidado para Agente de IA (prompt-context.md)
    try {
      const promptContextPath = path.join(targetDir, 'prompt-context.md');
      AgentBriefing.savePromptContext(promptContextPath, {
        targetUrl: this._page.url(),
        outputDirectory: targetDir,
        reconReport,
        sessionBackup,
        executionSequence: sequenceReport,
        selectorsMap: selectorsReport,
        apiContracts: contractsReport,
        formSchema: formReport,
        accessibilityTree: accessibilityData
      });
      results.promptContextFile = promptContextPath;
    } catch (e) {
      console.warn('[ScannerKit] No se pudo generar prompt-context.md:', (e as Error).message);
    }

    return results;
  }

  /**
   * Cierra de forma ordenada la página, el contexto y la instancia de Chromium.
   * Por defecto, finaliza y exporta automáticamente todos los artefactos pendientes
   * a la carpeta de salida antes de liberar los recursos del navegador.
   *
   * @param options Opciones de cierre (permite deshabilitar autoExport).
   */
  public async close(options?: { exportArtifacts?: boolean }): Promise<void> {
    const shouldExport = options?.exportArtifacts ?? (this._options.autoExportOnClose !== false);
    if (shouldExport) {
      await this.exportAllArtifacts().catch((err) => {
        console.warn('[ScannerKit] Advertencia en auto-exportación de artefactos:', err);
      });
    }

    try {
      await this._page.close().catch(() => {});
      await this._context.close().catch(() => {});
      await this._browser.close().catch(() => {});
    } catch (err) {
      console.warn('[ScannerKit] Advertencia al cerrar recursos del navegador:', err);
    }
  }
}
