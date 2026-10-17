import { BrowserContext, Frame, Locator, Page, Request, Response, Route } from 'playwright';

/**
 * Configuración para inicializar el ScannerKit.
 */
export interface ScannerKitOptions {
  /**
   * Ejecutar el navegador en modo sin interfaz gráfica (headless).
   * Por defecto: true.
   */
  headless?: boolean;

  /**
   * Ralentización opcional en milisegundos entre acciones de Playwright.
   */
  slowMo?: number;

  /**
   * Activar Modo Turbo activo (intercepta y bloquea imágenes, fuentes y media).
   * En modo escaneo pasivo se recomienda false para no alterar la página ni disparar WAFs.
   * Por defecto: false.
   */
  turboMode?: boolean;

  /**
   * Activar evasión activa de UI (sobreescribe window.print, onbeforeunload, auto-dialogs).
   * En modo escaneo pasivo se recomienda false para mantener prototipos nativos intactos ante Cloudflare/Turnstile.
   * Por defecto: false.
   */
  evasionMode?: boolean;

  /**
   * Activar motor de reconocimiento y auditoría de tráfico pasivo.
   * Por defecto: true.
   */
  reconMode?: boolean;

  /**
   * Activar extractor de telemetría de acciones de usuario, robustez de selectores
   * y contratos de APIs XHR/Fetch.
   * Por defecto: true.
   */
  telemetryMode?: boolean;

  /**
   * Directorio base de salida para los artefactos y blueprint exportados.
   * Por defecto: './blueprint'.
   */
  blueprintDir?: string;

  /**
   * Alias de compatibilidad para blueprintDir.
   */
  outputDir?: string;

  /**
   * Agrupar automáticamente los informes en subcarpetas por target (dominio / host / IP).
   * Ejemplo: output/localhost_3456/ o output/172.16.1.93_49201/
   * Por defecto: true.
   */
  groupByTarget?: boolean;

  /**
   * Subcarpeta o categoría opcional dentro del target para clasificar informes
   * por objetivo o funcionalidad (ej. 'informes', 'login_flow', 'auditoria_hc').
   */
  targetCategory?: string;

  /**
   * Exportar automáticamente todos los artefactos de auditoría al invocar scanner.close().
   * Por defecto: true.
   */
  autoExportOnClose?: boolean;

  /**
   * User-Agent personalizado.
   */
  userAgent?: string;

  /**
   * Configuración de viewport para el navegador.
   */
  viewport?: { width: number; height: number } | null;

  /**
   * Argumentos adicionales para el ejecutable de Chromium.
   */
  launchArgs?: string[];
}

/**
 * Resultado de exportación consolidada de artefactos.
 */
export interface ExportArtifactsResult {
  /**
   * Directorio final donde se guardaron los artefactos generados.
   */
  outputDirectory: string;

  /**
   * Ruta al archivo de sesión empaquetada (session-backup.json).
   */
  sessionFile?: string;

  /**
   * Ruta al archivo de radiografía técnica y tokens (recon-report.json).
   */
  reconReportFile?: string;

  /**
   * Ruta a la secuencia cronológica de acciones y sugerencias RPA (execution-sequence.json).
   */
  sequenceFile?: string;

  /**
   * Ruta a la matriz de robustez de selectores (selectors-map.json).
   */
  selectorsFile?: string;

  /**
   * Ruta a los contratos de APIs XHR/Fetch descubiertos (api-contracts.json).
   */
  contractsFile?: string;
}

/**
 * Resultado estructurado del buscador Multi-Frame.
 */
export interface MultiFrameElementResult {
  /**
   * Locator de Playwright listo para interactuar con el elemento.
   */
  locator: Locator;

  /**
   * Referencia al frame contenedor (Page o Frame).
   */
  frame: Page | Frame;

  /**
   * Nombre asignado al iframe (si existe).
   */
  frameName: string;

  /**
   * URL actual del frame donde reside el elemento.
   */
  frameUrl: string;

  /**
   * Indica si el elemento fue encontrado dentro de un iframe o en el DOM principal.
   */
  isInIframe: boolean;
}

/**
 * Opciones para el espía de botones y llamadas a APIs de backend.
 */
export interface ClickAndSpyOptions {
  /**
   * Patrón de URL o expresión regular para filtrar la respuesta esperada.
   * Si no se especifica, capturará la primera respuesta XHR/Fetch exitosa posterior al clic.
   */
  urlPattern?: string | RegExp | ((url: URL) => boolean);

  /**
   * Método HTTP a filtrar (ej. 'GET', 'POST', 'PUT').
   */
  method?: string;

  /**
   * Tiempo máximo de espera en milisegundos para la respuesta de red.
   * Por defecto: 15000 ms.
   */
  timeout?: number;

  /**
   * Predicado personalizado para validar si la respuesta es la deseada.
   */
  predicate?: (response: Response) => boolean | Promise<boolean>;

  /**
   * Opciones para la acción de clic de Playwright (forzar, botón, etc.).
   */
  clickOptions?: Parameters<Locator['click']>[0];
}

/**
 * Resultado estructurado del espía de APIs.
 */
export interface SpyResult<T = unknown> {
  /**
   * Cuerpo JSON parseado de la respuesta del backend.
   */
  data: T;

  /**
   * Código de estado HTTP retornado (ej. 200, 201).
   */
  status: number;

  /**
   * Cabeceras de respuesta HTTP devueltas por el servidor.
   */
  headers: Record<string, string>;

  /**
   * URL exacta del endpoint interceptado.
   */
  url: string;

  /**
   * Método HTTP utilizado en la petición.
   */
  method: string;

  /**
   * Latencia medida en milisegundos desde el clic hasta la recepción de la respuesta.
   */
  timingMs: number;
}

/**
 * Formato de respaldo de sesión completa exportada.
 */
export interface SessionBackup {
  version: string;
  timestamp: string;
  originUrl: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/**
 * Metadatos de un endpoint descubierto pasivamente.
 */
export interface DiscoveredEndpoint {
  method: string;
  url: string;
  pathname: string;
  origin: string;
  queryParams: Record<string, string>;
  statusCodesObserved: number[];
  contentTypesObserved: string[];
  requestCount: number;
  samplePayload?: string;
}

/**
 * Token o credencial de seguridad identificada en el tráfico de red.
 */
export interface DetectedSecurityToken {
  headerName: string;
  type: 'Bearer' | 'Basic' | 'CSRF' | 'API-Key' | 'Custom-Auth';
  sampleValue: string;
  observedInEndpoints: string[];
}

/**
 * Informe de reconocimiento pasivo y radiografía técnica.
 */
export interface ReconReport {
  generatedAt: string;
  summary: {
    totalRequestsCaptured: number;
    totalEndpointsDiscovered: number;
    totalSecurityTokensIdentified: number;
  };
  /**
   * Diagnóstico pasivo de oportunidades de rendimiento (Turbo), bloqueos de UI (Evasión)
   * y protecciones Anti-Bot/WAF detectadas durante la exploración normal.
   */
  optimizationBlueprint?: {
    turboPotential: {
      totalBlockableRequests: number;
      imagesCount: number;
      fontsCount: number;
      mediaCount: number;
      trackersCount: number;
      estimatedRequestSavingsPercent: number;
      recommendedForBot: boolean;
      recommendationReason: string;
    };
    uiTrapsDetected: Array<{
      type: string;
      message: string;
      url: string;
      timestamp: string;
    }>;
    antiBotWafDetected: Array<{
      provider: string;
      evidenceUrl: string;
      rpaStrategy: string;
    }>;
  };
  securityTokens: DetectedSecurityToken[];
  endpoints: DiscoveredEndpoint[];
  domainsContacted: string[];
}

/**
 * Registro de acción cronológica del usuario en la interfaz.
 */
export interface UserActionRecord {
  id: string;
  timestamp: string;
  actionType: 'click' | 'input' | 'navigation' | 'url_change';
  url: string;
  target?: {
    tag: string;
    id?: string;
    name?: string;
    text?: string;
    ariaLabel?: string;
    role?: string;
    placeholder?: string;
    dataTestId?: string;
    classes?: string[];
    cssPath?: string;
    xpath?: string;
  };
  valuePreview?: string;
  suggestedLocator?: string;
  stabilityScore?: number;
  routeSuggestion?: {
    route: string;
    directRoutable: boolean;
    recommendedGoto: string;
    reason: string;
  };
}

/**
 * Reporte de secuencia de ejecución cronológica del usuario.
 */
export interface ExecutionSequenceReport {
  generatedAt: string;
  totalActionsCaptured: number;
  uniqueRoutesDiscovered: number;
  actions: UserActionRecord[];
  routeDirectNavigations: RouteTrackerRecord[];
}

/**
 * Candidato de selector evaluado para un elemento.
 */
export interface SelectorCandidate {
  type: 'data-testid' | 'id' | 'role' | 'aria' | 'placeholder' | 'text' | 'css' | 'xpath';
  selector: string;
  score: number;
  reason: string;
}

/**
 * Entrada en el mapa de robustez de selectores.
 */
export interface SelectorMapEntry {
  selectorKey: string;
  elementDescription: string;
  tagName: string;
  recommendedLocator: string;
  stabilityScore: number;
  reliabilityTier: 'EXCELLENT' | 'HIGH' | 'MEDIUM' | 'FRAGILE';
  candidates: SelectorCandidate[];
  interactionCount: number;
  lastObservedUrl: string;
}

/**
 * Reporte de mapa de selectores y análisis de estabilidad.
 */
export interface SelectorsMapReport {
  generatedAt: string;
  totalSelectorsAnalyzed: number;
  robustnessSummary: {
    excellentCount: number;
    highCount: number;
    mediumCount: number;
    fragileCount: number;
  };
  selectors: Record<string, SelectorMapEntry>;
}

/**
 * Contrato de endpoint de API XHR/Fetch interceptado.
 */
export interface ApiContractEndpoint {
  endpointKey: string;
  method: string;
  url: string;
  pathname: string;
  origin: string;
  queryParams: Record<string, string>;
  requestHeaders: Record<string, string>;
  requestPayloadSample?: unknown;
  requestSchema?: Record<string, string>;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responsePayloadSample?: unknown;
  responseSchema?: Record<string, string>;
  averageLatencyMs: number;
  callCount: number;
}

/**
 * Reporte consolidado de contratos de API XHR/Fetch.
 */
export interface ApiContractsReport {
  generatedAt: string;
  totalContractsDiscovered: number;
  contracts: ApiContractEndpoint[];
}

/**
 * Registro de ruta SPA descubierta y evaluación de navegación directa.
 */
export interface RouteTrackerRecord {
  route: string;
  fullUrl: string;
  directRoutable: boolean;
  recommendedGoto: string;
  detectedVia: 'framenavigated' | 'hashchange' | 'pushstate' | 'direct_goto';
  firstObservedAt: string;
}

/**
 * Opciones para configurar el SessionRefresher Anti-401.
 */
export interface SessionRefresherOptions {
  /**
   * URL base de la API (opcional, ej. 'http://172.16.1.93:49200').
   */
  baseUrl?: string;

  /**
   * Ruta al archivo session-backup.json o storageState.json.
   * Por defecto: './session-backup.json'.
   */
  sessionBackupPath?: string;

  /**
   * Token inicial en memoria (opcional).
   */
  initialToken?: string;

  /**
   * Función para extraer el token JWT desde el objeto de respaldo de sesión.
   */
  tokenExtractor?: (session: SessionBackup) => string | null;

  /**
   * Manejador de re-login silencioso cuando se detecta un 401 o 403.
   * Debe actualizar la sesión y retornar el nuevo token JWT válido.
   */
  reloginHandler?: () => Promise<string>;

  /**
   * Número máximo de reintentos automáticos tras re-login.
   * Por defecto: 2.
   */
  maxRetries?: number;

  /**
   * Delay inicial en milisegundos entre reintentos con backoff.
   * Por defecto: 500 ms.
   */
  retryDelayMs?: number;

  /**
   * Callback invocado cuando la sesión se renueva exitosamente.
   */
  onSessionRefreshed?: (newToken: string) => void | Promise<void>;
}

