import * as fs from 'fs';
import * as path from 'path';
import { Page, Request, Response } from 'playwright';
import { DetectedSecurityToken, DiscoveredEndpoint, ReconReport } from '../types';

/**
 * Motor de Reconocimiento Pasivo y Radiografía Técnica de Tráfico Web.
 *
 * Durante la navegación automatizada o manual asistida, este motor audita
 * de forma pasiva cada paquete HTTP entrante y saliente, extrayendo inteligencia
 * crítica sobre la arquitectura de la aplicación:
 * - Endpoints de microservicios y REST APIs.
 * - Esquemas de autenticación y tokens en tránsito (Bearer JWT, CSRF, API Keys).
 * - Parámetros de consulta y tipos de contenido negociados.
 */
export class ReconEngine {
  private endpointsMap: Map<string, DiscoveredEndpoint> = new Map();
  private securityTokensMap: Map<string, DetectedSecurityToken> = new Map();
  private domainsContactedSet: Set<string> = new Set();
  private totalRequests = 0;

  /**
   * Conecta los escuchadores pasivos a la página de Playwright.
   */
  public attachToPage(page: Page): void {
    page.on('request', (request: Request) => {
      this.handleRequest(request);
    });

    page.on('response', (response: Response) => {
      this.handleResponse(response);
    });
  }

  /**
   * Procesa peticiones salientes para detectar tokens de seguridad y registrar endpoints.
   */
  private handleRequest(request: Request): void {
    this.totalRequests++;
    const urlString = request.url();
    const method = request.method().toUpperCase();

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

        const contentType = response.headers()['content-type'];
        if (contentType && !endpoint.contentTypesObserved.includes(contentType)) {
          endpoint.contentTypesObserved.push(contentType);
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
    const report: ReconReport = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalRequestsCaptured: this.totalRequests,
        totalEndpointsDiscovered: this.endpointsMap.size,
        totalSecurityTokensIdentified: this.securityTokensMap.size
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
