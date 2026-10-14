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
   * Activar Modo Turbo (intercepta y bloquea imágenes, fuentes y media).
   * Por defecto: true.
   */
  turboMode?: boolean;

  /**
   * Activar evasión y neutralización de UI (window.print, onbeforeunload, auto-dialogs).
   * Por defecto: true.
   */
  evasionMode?: boolean;

  /**
   * Activar motor de reconocimiento y auditoría de tráfico pasivo.
   * Por defecto: true.
   */
  reconMode?: boolean;

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
  securityTokens: DetectedSecurityToken[];
  endpoints: DiscoveredEndpoint[];
  domainsContacted: string[];
}
