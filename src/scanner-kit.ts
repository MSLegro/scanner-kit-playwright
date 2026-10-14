import { Browser, BrowserContext, chromium, Locator, Page } from 'playwright';
import { ApiSpy } from './modules/api-spy';
import { EvasionManager, EvasionOptions } from './modules/evasion-manager';
import { FindFrameOptions, FrameExplorer } from './modules/frame-explorer';
import { ReconEngine } from './modules/recon-engine';
import { SessionManager } from './modules/session-manager';
import { TurboManager, TurboOptions } from './modules/turbo-manager';
import {
  ClickAndSpyOptions,
  MultiFrameElementResult,
  ReconReport,
  ScannerKitOptions,
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
  private _options: ScannerKitOptions;

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    options: ScannerKitOptions,
    turboManager?: TurboManager,
    evasionManager?: EvasionManager,
    reconEngine?: ReconEngine
  ) {
    this._browser = browser;
    this._context = context;
    this._page = page;
    this._options = options;
    this._turboManager = turboManager;
    this._evasionManager = evasionManager;
    this._reconEngine = reconEngine;
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
    const turboMode = options.turboMode ?? true;
    const evasionMode = options.evasionMode ?? true;
    const reconMode = options.reconMode ?? true;

    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      ...(options.launchArgs ?? [])
    ];

    // 1. Lanzar el navegador Chromium (con fallback resiliente a headless si no hay servidor gráfico accesible)
    let browser: Browser;
    try {
      browser = await chromium.launch({
        headless,
        slowMo,
        args: launchArgs
      });
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

    // 2. Crear el BrowserContext con viewport y user-agent personalizado
    const context = await browser.newContext({
      userAgent:
        options.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: options.viewport === null ? null : options.viewport ?? { width: 1366, height: 768 },
      ignoreHTTPSErrors: true
    });

    // 3. Inicializar e inyectar el Modo Turbo (bloqueo de recursos pesados)
    let turboManager: TurboManager | undefined;
    if (turboMode) {
      turboManager = new TurboManager();
      await turboManager.applyToContext(context);
    }

    // 4. Inicializar e inyectar Evasión de UI (print, beforeunload)
    let evasionManager: EvasionManager | undefined;
    if (evasionMode) {
      evasionManager = new EvasionManager();
      await evasionManager.applyToContext(context);
    }

    // 5. Crear la página inicial
    const page = await context.newPage();

    // 6. Configurar listeners de evasión en la página (diálogos)
    if (evasionManager) {
      evasionManager.attachToPage(page);
    }

    // 7. Configurar ReconEngine (escáner pasivo de red y tokens)
    let reconEngine: ReconEngine | undefined;
    if (reconMode) {
      reconEngine = new ReconEngine();
      reconEngine.attachToPage(page);
    }

    return new ScannerKit(browser, context, page, options, turboManager, evasionManager, reconEngine);
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
   * de evasión de diálogos y telemetría de reconocimiento pasivo.
   */
  public async newPage(): Promise<Page> {
    const page = await this._context.newPage();
    if (this._evasionManager) {
      this._evasionManager.attachToPage(page);
    }
    if (this._reconEngine) {
      this._reconEngine.attachToPage(page);
    }
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
   * Cierra de forma ordenada la página, el contexto y la instancia de Chromium.
   */
  public async close(): Promise<void> {
    try {
      await this._page.close().catch(() => {});
      await this._context.close().catch(() => {});
      await this._browser.close().catch(() => {});
    } catch (err) {
      console.warn('[ScannerKit] Advertencia al cerrar recursos del navegador:', err);
    }
  }
}
