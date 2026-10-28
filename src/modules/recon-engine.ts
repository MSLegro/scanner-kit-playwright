import * as fs from 'fs';
import * as path from 'path';
import { Dialog, Page, Request, Response } from 'playwright';
import {
  DetectedSecurityToken,
  DiscoveredEndpoint,
  LegacyServerStateField,
  LegacyServerStateReport,
  ReconReport,
  TokenProvenance
} from '../types';

const PASSIVE_TRACKER_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /hotjar\.com/i,
  /segment\.io/i,
  /facebook\.net/i,
  /clarity\.ms/i
];

function findTokenInJson(obj: unknown, tokenSubstring: string, currentPath = ''): string | null {
  if (!obj || typeof obj !== 'object' || !tokenSubstring || tokenSubstring.length < 6) return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 5); i++) {
      const res = findTokenInJson(obj[i], tokenSubstring, `${currentPath}[${i}]`);
      if (res) return res;
    }
    return null;
  }
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (typeof val === 'string' && val.includes(tokenSubstring)) {
      return keyPath;
    }
    if (typeof val === 'object' && val !== null) {
      const res = findTokenInJson(val, tokenSubstring, keyPath);
      if (res) return res;
    }
  }
  return null;
}

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

  // Historial de respuestas recientes para análisis de linaje de tokens y estado del servidor
  private responseHistory: Array<{
    url: string;
    timestamp: string;
    headers: Record<string, string>;
    bodyText?: string;
    jsonBody?: any;
  }> = [];

  private rawTokensObserved: Map<string, string> = new Map();
  private legacyStateFieldsMap: Map<string, LegacyServerStateField> = new Map();

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
          this.detectLegacyServerState(postData, urlString);
        }

        this.endpointsMap.set(endpointKey, endpoint);
      } else {
        const postData = request.postData();
        if (postData) {
          this.detectLegacyServerState(postData, urlString);
        }
      }

      endpoint.requestCount++;

      // Auditar cabeceras de seguridad
      const headers = request.headers();
      if (headers['faces-request']) {
        this.detectLegacyServerState(`Faces-Request: ${headers['faces-request']}`, urlString);
      }
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
   * Procesa respuestas entrantes para registrar códigos de estado, content-types,
   * linaje de tokens de sesión y campos de estado legacy.
   */
  private async handleResponse(response: Response): Promise<void> {
    const urlString = response.url();
    const method = response.request().method().toUpperCase();

    try {
      const parsedUrl = new URL(urlString);
      const endpointKey = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;
      const endpoint = this.endpointsMap.get(endpointKey);
      const headers = response.headers();

      if (endpoint) {
        const status = response.status();
        if (!endpoint.statusCodesObserved.includes(status)) {
          endpoint.statusCodesObserved.push(status);
        }

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

      // Rastrear respuestas para auditoría de linaje de tokens y estado de servidor
      let bodyText: string | undefined;
      let jsonBody: any = undefined;
      const ct = (headers['content-type'] || '').toLowerCase();
      if (ct.includes('json') || ct.includes('text') || ct.includes('html') || ct.includes('xml')) {
        try {
          bodyText = await response.text().catch(() => undefined);
          if (bodyText) {
            if (ct.includes('json')) {
              try {
                jsonBody = JSON.parse(bodyText);
              } catch {}
            }
            if (ct.includes('html') || ct.includes('xml')) {
              this.detectLegacyServerState(bodyText, urlString);
            }
          }
        } catch {}
      }

      this.responseHistory.push({
        url: urlString,
        timestamp: new Date().toISOString(),
        headers,
        bodyText,
        jsonBody
      });
      if (this.responseHistory.length > 50) {
        this.responseHistory.shift();
      }

      // Reintentar rastreo de procedencia para tokens identificados previamente
      for (const [tokenKey, tokenRecord] of this.securityTokensMap.entries()) {
        if (!tokenRecord.provenance || tokenRecord.provenance.sourceType === 'storage') {
          const raw = this.rawTokensObserved.get(tokenKey);
          if (raw) {
            this.traceTokenProvenance(tokenRecord, raw);
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

        const cleanRawValue = rawValue.replace(/^(Bearer|Basic)\s+/i, '').trim();
        this.rawTokensObserved.set(tokenKey, cleanRawValue);
        this.traceTokenProvenance(tokenRecord, cleanRawValue);

        if (!tokenRecord.observedInEndpoints.includes(requestUrl) && tokenRecord.observedInEndpoints.length < 15) {
          tokenRecord.observedInEndpoints.push(requestUrl);
        }
      }
    }
  }

  /**
   * Rastrea la procedencia (lineage) de un token de seguridad en las respuestas previas del servidor.
   */
  private traceTokenProvenance(tokenRecord: DetectedSecurityToken, rawToken: string): void {
    if (!rawToken || rawToken.length < 6 || rawToken.includes('undefined') || rawToken.includes('null')) {
      return;
    }

    // 1. Buscar en Set-Cookie de respuestas previas
    for (const res of this.responseHistory) {
      const sc = res.headers['set-cookie'] || '';
      if (sc.includes(rawToken)) {
        tokenRecord.provenance = {
          sourceType: 'cookie',
          sourceLocation: res.url,
          observedAt: res.timestamp,
          description: `Emitido por el servidor en la cabecera Set-Cookie de ${res.url}`
        };
        return;
      }
    }

    // 2. Buscar en cabeceras de respuestas previas
    for (const res of this.responseHistory) {
      for (const [hk, hv] of Object.entries(res.headers)) {
        if (hv.includes(rawToken)) {
          tokenRecord.provenance = {
            sourceType: 'response_header',
            sourceLocation: res.url,
            fieldPath: hk,
            observedAt: res.timestamp,
            description: `Emitido por el servidor en la cabecera "${hk}" de ${res.url}`
          };
          return;
        }
      }
    }

    // 3. Buscar en el cuerpo JSON de respuestas previas
    for (const res of this.responseHistory) {
      if (res.jsonBody) {
        const foundPath = findTokenInJson(res.jsonBody, rawToken);
        if (foundPath) {
          tokenRecord.provenance = {
            sourceType: 'response_body',
            sourceLocation: res.url,
            fieldPath: foundPath,
            observedAt: res.timestamp,
            description: `Retornado en el cuerpo JSON de ${res.url} (campo: "${foundPath}")`
          };
          return;
        }
      }
    }

    // 4. Buscar en texto del cuerpo de respuestas previas
    for (const res of this.responseHistory) {
      if (res.bodyText && res.bodyText.includes(rawToken)) {
        tokenRecord.provenance = {
          sourceType: 'response_body',
          sourceLocation: res.url,
          observedAt: res.timestamp,
          description: `Retornado en el cuerpo de respuesta de ${res.url}`
        };
        return;
      }
    }

    // 5. Si no se observó en respuestas de red, clasificar como storage
    if (!tokenRecord.provenance) {
      tokenRecord.provenance = {
        sourceType: 'storage',
        sourceLocation: 'localStorage / sessionStorage / sesión previa',
        observedAt: new Date().toISOString(),
        description: 'Token preexistente en el cliente (almacenamiento web o sesión guardada)'
      };
    }
  }

  /**
   * Detecta campos de estado de servidor legacy (JSF ViewState, ASP.NET __VIEWSTATE, PrimeFaces).
   */
  private detectLegacyServerState(payload: string, sourceUrl: string): void {
    if (!payload || typeof payload !== 'string') return;

    // 1. JSF ViewState
    if (payload.includes('javax.faces.ViewState')) {
      let sample = '';
      const match = /(?:name=["']javax\.faces\.ViewState["']\s+value=["']([^"']+)["']|javax\.faces\.ViewState=([^&]+))/i.exec(payload);
      if (match) {
        sample = decodeURIComponent(match[1] || match[2] || '');
      }
      const existing = this.legacyStateFieldsMap.get('javax.faces.ViewState');
      if (!existing) {
        this.legacyStateFieldsMap.set('javax.faces.ViewState', {
          framework: 'JSF',
          fieldName: 'javax.faces.ViewState',
          sampleValue: sample.length > 70 ? `${sample.slice(0, 70)}...` : sample,
          domExtractionRegex: 'name=["\']javax\\.faces\\.ViewState["\']\\s+value=["\']([^"\']+)["\']',
          observedInEndpoints: [sourceUrl]
        });
      } else if (!existing.observedInEndpoints.includes(sourceUrl)) {
        existing.observedInEndpoints.push(sourceUrl);
      }
    }

    // 2. ASP.NET __VIEWSTATE
    if (payload.includes('__VIEWSTATE')) {
      let sample = '';
      const match = /(?:id=["']__VIEWSTATE["']\s+value=["']([^"']+)["']|__VIEWSTATE=([^&]+))/i.exec(payload);
      if (match) {
        sample = decodeURIComponent(match[1] || match[2] || '');
      }
      const existing = this.legacyStateFieldsMap.get('__VIEWSTATE');
      if (!existing) {
        this.legacyStateFieldsMap.set('__VIEWSTATE', {
          framework: 'ASP_NET',
          fieldName: '__VIEWSTATE',
          sampleValue: sample.length > 70 ? `${sample.slice(0, 70)}...` : sample,
          domExtractionRegex: 'id=["\']__VIEWSTATE["\']\\s+value=["\']([^"\']+)["\']',
          observedInEndpoints: [sourceUrl]
        });
      } else if (!existing.observedInEndpoints.includes(sourceUrl)) {
        existing.observedInEndpoints.push(sourceUrl);
      }
    }

    // 3. ASP.NET __EVENTVALIDATION
    if (payload.includes('__EVENTVALIDATION')) {
      let sample = '';
      const match = /(?:id=["']__EVENTVALIDATION["']\s+value=["']([^"']+)["']|__EVENTVALIDATION=([^&]+))/i.exec(payload);
      if (match) {
        sample = decodeURIComponent(match[1] || match[2] || '');
      }
      const existing = this.legacyStateFieldsMap.get('__EVENTVALIDATION');
      if (!existing) {
        this.legacyStateFieldsMap.set('__EVENTVALIDATION', {
          framework: 'ASP_NET',
          fieldName: '__EVENTVALIDATION',
          sampleValue: sample.length > 70 ? `${sample.slice(0, 70)}...` : sample,
          domExtractionRegex: 'id=["\']__EVENTVALIDATION["\']\\s+value=["\']([^"\']+)["\']',
          observedInEndpoints: [sourceUrl]
        });
      } else if (!existing.observedInEndpoints.includes(sourceUrl)) {
        existing.observedInEndpoints.push(sourceUrl);
      }
    }

    // 4. PrimeFaces / Ajax Faces-Request
    if (payload.includes('Faces-Request') || payload.includes('primefaces')) {
      const existing = this.legacyStateFieldsMap.get('Faces-Request');
      if (!existing) {
        this.legacyStateFieldsMap.set('Faces-Request', {
          framework: 'PRIMEFACES',
          fieldName: 'Faces-Request',
          sampleValue: 'partial/ajax',
          domExtractionRegex: 'Header HTTP requerido en peticiones XHR: Faces-Request: partial/ajax',
          observedInEndpoints: [sourceUrl]
        });
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

    let legacyServerState: LegacyServerStateReport | undefined;
    if (this.legacyStateFieldsMap.size > 0) {
      const fields = Array.from(this.legacyStateFieldsMap.values());
      const isJsf = fields.some((f) => f.framework === 'JSF' || f.framework === 'PRIMEFACES');
      const isAspNet = fields.some((f) => f.framework === 'ASP_NET');
      const fwName = isJsf ? 'JSF (JavaServer Faces)' : isAspNet ? 'ASP.NET WebForms' : 'Legacy Stateful';
      const targetEndpoint = fields[0]?.observedInEndpoints[0] || 'https://target-portal.com/form';

      let bypassRecipe = '';
      if (isJsf) {
        bypassRecipe = `// ⚡ Bypass Híbrido JSF sin interacción con la UI:
// 1. Extraer el ViewState actual del DOM:
const viewState = await page.locator('input[name="javax.faces.ViewState"]').inputValue();

// 2. Disparar directamente la petición POST de negocio:
const response = await page.request.post('${targetEndpoint}', {
  headers: {
    'Faces-Request': 'partial/ajax',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
  },
  form: {
    'javax.faces.ViewState': viewState,
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': 'form_button_id'
  }
});
const result = await response.text();`;
      } else if (isAspNet) {
        bypassRecipe = `// ⚡ Bypass Híbrido ASP.NET WebForms sin interacción con la UI:
// 1. Extraer los campos de estado ocultos del DOM:
const viewState = await page.locator('#__VIEWSTATE').inputValue();
const eventValidation = await page.locator('#__EVENTVALIDATION').inputValue();

// 2. Disparar directamente la petición POST de negocio:
const response = await page.request.post('${targetEndpoint}', {
  form: {
    '__VIEWSTATE': viewState,
    '__EVENTVALIDATION': eventValidation,
    '__EVENTTARGET': 'ctl00$MainContent$btnSubmit'
  }
});
const result = await response.text();`;
      }

      legacyServerState = {
        frameworkDetected: fwName,
        requiresStatefulPost: true,
        stateFields: fields,
        hybridBypassRecipe: bypassRecipe
      };
    }

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
      legacyServerState,
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

