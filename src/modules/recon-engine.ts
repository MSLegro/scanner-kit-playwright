import * as fs from 'fs';
import * as path from 'path';
import { Dialog, Page, Request, Response } from 'playwright';
import { DetectedSecurityToken, DiscoveredEndpoint, ReconReport } from '../types';

const PASSIVE_TRACKER_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /hotjar\.com/i,
  /segment\.io/i,
  /facebook\.net/i,
  /clarity\.ms/i
];

/**
 * Motor de Reconocimiento Pasivo y Radiografía Técnica de Tráfico Web.
 *
 * Durante la navegación automatizada o manual asistida, este motor audita
 * de forma 100% pasiva cada paquete HTTP entrante y saliente, sin bloquear recursos
 * ni alterar prototipos del navegador, extrayendo inteligencia sobre:
 * - Endpoints de microservicios y REST APIs.
 * - Esquemas de autenticación y tokens en tránsito (Bearer JWT, CSRF, API Keys).
 * - Potencial de ahorro con Modo Turbo (imágenes, fuentes, multimedia, trackers).
 * - Trampas de UI nativas (alert, confirm, prompt, beforeunload).
 * - Sistemas Anti-Bot / WAF (Cloudflare Turnstile, Waiting Room, reCAPTCHA, hCaptcha, Imperva).
 */
export class ReconEngine {
  private endpointsMap: Map<string, DiscoveredEndpoint> = new Map();
  private securityTokensMap: Map<string, DetectedSecurityToken> = new Map();
  private domainsContactedSet: Set<string> = new Set();
  private totalRequests = 0;

  // Contadores pasivos de potencial Turbo
  private imagesCount = 0;
  private fontsCount = 0;
  private mediaCount = 0;
  private trackersCount = 0;

  // Trampas de UI y WAFs detectados pasivamente
  private uiTrapsDetected: Array<{
    type: string;
    message: string;
    url: string;
    timestamp: string;
  }> = [];

  private antiBotWafMap: Map<
    string,
    {
      provider: string;
      evidenceUrl: string;
      rpaStrategy: string;
    }
  > = new Map();

  /**
   * Conecta los escuchadores pasivos a la página de Playwright.
   *
   * @param page Instancia de Page.
   * @param options Si handleDialogsPassively es true, registra y acepta diálogos nativos sin bloquear el flujo humano.
   */
  public attachToPage(page: Page, options?: { handleDialogsPassively?: boolean }): void {
    page.on('request', (request: Request) => {
      this.handleRequest(request);
    });

    page.on('response', (response: Response) => {
      this.handleResponse(response);
    });

    if (options?.handleDialogsPassively !== false) {
      page.on('dialog', async (dialog: Dialog) => {
        const trap = {
          type: dialog.type(),
          message: dialog.message(),
          url: page.url(),
          timestamp: new Date().toISOString()
        };
        this.uiTrapsDetected.push(trap);
        console.log(
          `\n💡 [ReconEngine] Diálogo nativo detectado pasivamente: tipo="${trap.type}", mensaje="${trap.message}"`
        );
        try {
          // Aceptamos para no cancelar confirmaciones del usuario ni congelar el hilo JS
          await dialog.accept();
        } catch {
          // Ignorar si ya fue cerrado
        }
      });
    }
  }

  /**
   * Procesa peticiones salientes para detectar tokens de seguridad, oportunidades Turbo, WAFs y endpoints.
   */
  private handleRequest(request: Request): void {
    this.totalRequests++;
    const urlString = request.url();
    const method = request.method().toUpperCase();
    const resourceType = request.resourceType();

    // 1. Contabilizar pasivamente recursos bloqueables por Modo Turbo (sin abortarlos)
    if (resourceType === 'image' || resourceType === 'imageset') {
      this.imagesCount++;
    } else if (resourceType === 'font') {
      this.fontsCount++;
    } else if (resourceType === 'media') {
      this.mediaCount++;
    } else if (PASSIVE_TRACKER_PATTERNS.some((p) => p.test(urlString))) {
      this.trackersCount++;
    }

    // 2. Detectar pasivamente desafíos Anti-Bot / WAF
    this.detectAntiBotWaf(urlString);

    try {
      const parsedUrl = new URL(urlString);
      this.domainsContactedSet.add(parsedUrl.host);

      // Clave única por método y pathname para evitar explosión de endpoints duplicados
      const endpointKey = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;

      let endpoint = this.endpointsMap.get(endpointKey);
      if (!endpoint) {
        const queryParams: Record<string, string> = {};
        parsedUrl.searchParams.forEach((val, key) => {
          queryParams[key] = val;
        });

        endpoint = {
          method,
          url: urlString,
          pathname: parsedUrl.pathname,
          origin: parsedUrl.origin,
          queryParams,
          statusCodesObserved: [],
          contentTypesObserved: [],
          requestCount: 0
        };

        const postData = request.postData();
        if (postData) {
          // Truncar muestras de payload para mantener el reporte legible y seguro
          endpoint.samplePayload = postData.length > 500 ? `${postData.slice(0, 500)}... [truncado]` : postData;
        }

        this.endpointsMap.set(endpointKey, endpoint);
      }

      endpoint.requestCount++;

      // Auditar cabeceras de seguridad
      const headers = request.headers();
      this.auditSecurityHeaders(headers, urlString);
    } catch {
      // Ignorar URLs malformadas o esquemas no estándares (data:, about:, blob:)
    }
  }

  /**
   * Detecta pasivamente proveedores Anti-Bot / Captcha en base al tráfico observado.
   */
  private detectAntiBotWaf(url: string): void {
    const lower = url.toLowerCase();
    if (lower.includes('challenges.cloudflare.com') || lower.includes('/cdn-cgi/challenge-platform')) {
      if (!this.antiBotWafMap.has('Cloudflare Turnstile / Challenge')) {
        this.antiBotWafMap.set('Cloudflare Turnstile / Challenge', {
          provider: 'Cloudflare Turnstile / Challenge',
          evidenceUrl: url.slice(0, 140),
          rpaStrategy:
            'Mantener turboMode: false y evasionMode: false para no alterar prototipos nativos. Conservar la cookie cf_clearance viva mediante tu SessionManager dinámico y ejecutar con canal Chrome nativo.'
        });
      }
    } else if (lower.includes('google.com/recaptcha') || lower.includes('gstatic.com/recaptcha')) {
      if (!this.antiBotWafMap.has('Google reCAPTCHA')) {
        this.antiBotWafMap.set('Google reCAPTCHA', {
          provider: 'Google reCAPTCHA',
          evidenceUrl: url.slice(0, 140),
          rpaStrategy:
            'Mantener la sesión autenticada viva en tu SessionManager dinámico para evitar disparar el reCAPTCHA en cada ejecución.'
        });
      }
    } else if (lower.includes('hcaptcha.com')) {
      if (!this.antiBotWafMap.has('hCaptcha')) {
        this.antiBotWafMap.set('hCaptcha', {
          provider: 'hCaptcha',
          evidenceUrl: url.slice(0, 140),
          rpaStrategy: 'Mantener cookies de sesión dinámicas y ejecutar navegador sin bloqueo de recursos visuales.'
        });
      }
    }
  }

  /**
   * Procesa respuestas entrantes para registrar códigos de estado y content-types observados.
   */
  private handleResponse(response: Response): void {
    const urlString = response.url();
    const method = response.request().method().toUpperCase();

    try {
      const parsedUrl = new URL(urlString);
      const endpointKey = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;
      const endpoint = this.endpointsMap.get(endpointKey);

      if (endpoint) {
        const status = response.status();
        if (!endpoint.statusCodesObserved.includes(status)) {
          endpoint.statusCodesObserved.push(status);
        }

        const headers = response.headers();
        const contentType = headers['content-type'];
        if (contentType && !endpoint.contentTypesObserved.includes(contentType)) {
          endpoint.contentTypesObserved.push(contentType);
        }

        const setCookie = headers['set-cookie'] || '';
        if (setCookie.includes('__cfwaitingroom')) {
          if (!this.antiBotWafMap.has('Cloudflare Waiting Room')) {
            this.antiBotWafMap.set('Cloudflare Waiting Room', {
              provider: 'Cloudflare Waiting Room',
              evidenceUrl: urlString,
              rpaStrategy:
                'Preservar la cookie __cfwaitingroom_portal en el SessionManager para conservar el turno en la cola virtual.'
            });
          }
        }
      }
    } catch {
      // Ignorar errores en URLs no estándares
    }
  }

  /**
   * Inspecciona cabeceras buscando esquemas de autenticación y tokens CSRF.
   */
  private auditSecurityHeaders(headers: Record<string, string>, requestUrl: string): void {
    for (const [headerName, rawValue] of Object.entries(headers)) {
      const lowerHeader = headerName.toLowerCase();

      let detectedType: DetectedSecurityToken['type'] | null = null;

      if (lowerHeader === 'authorization') {
        if (/^Bearer\s+/i.test(rawValue)) {
          detectedType = 'Bearer';
        } else if (/^Basic\s+/i.test(rawValue)) {
          detectedType = 'Basic';
        } else {
          detectedType = 'Custom-Auth';
        }
      } else if (
        lowerHeader.includes('csrf') ||
        lowerHeader.includes('xsrf') ||
        lowerHeader === 'x-csrf-token' ||
        lowerHeader === 'x-xsrf-token'
      ) {
        detectedType = 'CSRF';
      } else if (
        lowerHeader === 'x-api-key' ||
        lowerHeader === 'api-key' ||
        lowerHeader === 'apikey' ||
        lowerHeader === 'x-apikey'
      ) {
        detectedType = 'API-Key';
      } else if (
        lowerHeader === 'x-auth-token' ||
        lowerHeader === 'x-access-token' ||
        lowerHeader === 'x-user-token'
      ) {
        detectedType = 'Custom-Auth';
      }

      if (detectedType) {
        const tokenKey = `${headerName}:${detectedType}`;
        let tokenRecord = this.securityTokensMap.get(tokenKey);
        const isPlaceholder = rawValue.includes('undefined') || rawValue.includes('null');

        if (!tokenRecord) {
          // Ocultar parcialmente el valor por seguridad en reportes corporativos
          const maskedValue = this.maskSensitiveString(rawValue);
          tokenRecord = {
            headerName,
            type: detectedType,
            sampleValue: maskedValue,
            observedInEndpoints: []
          };
          this.securityTokensMap.set(tokenKey, tokenRecord);
        } else if (tokenRecord.sampleValue.includes('undefined') && !isPlaceholder) {
          // Reemplazar muestra preliminar/placeholder por el token real autenticado
          tokenRecord.sampleValue = this.maskSensitiveString(rawValue);
        }

        if (!tokenRecord.observedInEndpoints.includes(requestUrl) && tokenRecord.observedInEndpoints.length < 15) {
          tokenRecord.observedInEndpoints.push(requestUrl);
        }
      }
    }
  }

  /**
   * Oculta el secreto conservando los primeros y últimos caracteres para diagnóstico.
   */
  private maskSensitiveString(value: string): string {
    if (value.length <= 12) {
      return '***REDACTED***';
    }
    const start = value.slice(0, 8);
    const end = value.slice(-4);
    return `${start}...${end} (longitud: ${value.length})`;
  }

  /**
   * Genera el informe consolidado de reconocimiento y lo guarda en disco si se especifica la ruta.
   *
   * @param outputPath Ruta de salida para recon-report.json (opcional).
   * @returns Estructura completa ReconReport.
   */
  public generateReport(outputPath?: string): ReconReport {
    const totalBlockable = this.imagesCount + this.fontsCount + this.mediaCount + this.trackersCount;
    const savingsPercent =
      this.totalRequests > 0 ? Math.round((totalBlockable / this.totalRequests) * 100) : 0;
    const hasStrictWaf = this.antiBotWafMap.has('Cloudflare Turnstile / Challenge');

    const report: ReconReport = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalRequestsCaptured: this.totalRequests,
        totalEndpointsDiscovered: this.endpointsMap.size,
        totalSecurityTokensIdentified: this.securityTokensMap.size
      },
      optimizationBlueprint: {
        turboPotential: {
          totalBlockableRequests: totalBlockable,
          imagesCount: this.imagesCount,
          fontsCount: this.fontsCount,
          mediaCount: this.mediaCount,
          trackersCount: this.trackersCount,
          estimatedRequestSavingsPercent: savingsPercent,
          recommendedForBot: !hasStrictWaf && savingsPercent >= 10,
          recommendationReason: hasStrictWaf
            ? 'No activar TurboMode: Se detectó Cloudflare Turnstile/Challenge que verifica la carga íntegra de sub-recursos.'
            : savingsPercent >= 10
              ? `Se puede ahorrar ~${savingsPercent}% de peticiones HTTP (${totalBlockable} recursos estáticos/trackers) activando turboMode: true en el bot de producción.`
              : 'La página es ligera; el impacto de TurboMode es menor al 10%.'
        },
        uiTrapsDetected: this.uiTrapsDetected,
        antiBotWafDetected: Array.from(this.antiBotWafMap.values())
      },
      securityTokens: Array.from(this.securityTokensMap.values()),
      endpoints: Array.from(this.endpointsMap.values()),
      domainsContacted: Array.from(this.domainsContactedSet)
    };

    if (outputPath) {
      const resolvedPath = path.resolve(outputPath);
      const targetDir = path.dirname(resolvedPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`[ReconEngine] Radiografía técnica guardada exitosamente en: ${resolvedPath}`);
    }

    return report;
  }
}

