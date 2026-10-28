import * as fs from 'fs';
import * as path from 'path';
import { Page, Request, Response } from 'playwright';
import {
  DiscoveredApiSurfaceReport,
  HighValueCategory,
  HighValueEndpoint,
  ReportTemplateDefinition,
  SatelliteService
} from '../types';

const THIRD_PARTY_IGNORE_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /facebook\.net/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /challenges\.cloudflare\.com/i,
  /cdn-cgi\/challenge-platform/i,
  /recaptcha/i,
  /hcaptcha/i
];

/**
 * StaticSurfaceMiner - Minero Estático Pasivo de Bundles JS y Esquemas de Reportes.
 *
 * Responsabilidades:
 * 1. Bundle Harvester: Registra asíncronamente en memoria el código de scripts cargados en vivo.
 * 2. Multi-Port & Satellite Discovery: Descubre puertos y dominios satélites (ej. microservicios en :5004, :8080).
 * 3. High-Value Endpoint Classifier: Identifica endpoints de compilación PDF, exportación Excel y documentos,
 *    clasificándolos entre "ejecutados en vivo" y "latentes en código".
 * 4. Report & Template Sniffer: Intercepta e inspecciona plantillas Stimulsoft (.mrt), DevExpress (.repx)
 *    y Jasper (.jrxml), extrayendo DataSources y cruzándolos con los endpoints del código.
 */
export class StaticSurfaceMiner {
  private scriptBundles: Map<string, string> = new Map();
  private rawReportTemplates: Map<string, { url: string; content: string; name: string }> = new Map();
  private attachedPages = new WeakSet<Page>();
  private currentBytesCollected = 0;
  private readonly maxAggregateBytes = 25 * 1024 * 1024; // 25 MB máximo en memoria

  /**
   * Conecta escuchadores pasivos no bloqueantes a la página para recolectar scripts y plantillas.
   */
  public attachToPage(page: Page): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);

    page.on('response', async (response: Response) => {
      try {
        const status = response.status();
        if (status < 200 || status >= 300) return;

        const url = response.url();
        const request = response.request();
        const resourceType = request.resourceType();

        // 1. Filtrar proveedores externos conocidos
        if (THIRD_PARTY_IGNORE_PATTERNS.some((p) => p.test(url))) return;

        const isScript =
          resourceType === 'script' ||
          /\.js(\?.*)?$/i.test(url) ||
          (response.headers()['content-type'] || '').includes('javascript');

        // 2. Recolección de Scripts de la aplicación
        if (isScript) {
          if (this.currentBytesCollected < this.maxAggregateBytes && !this.scriptBundles.has(url)) {
            // Leer asíncronamente del buffer sin pausar la navegación
            response.text().then((text) => {
              if (text && text.length > 50 && this.currentBytesCollected + text.length <= this.maxAggregateBytes) {
                this.scriptBundles.set(url, text);
                this.currentBytesCollected += text.length;
              }
            }).catch(() => {});
          }
          return;
        }

        // 3. Recolección de Plantillas de Reporte (.mrt, .repx, .jasper, .jrxml o endpoints de reporte)
        const isReportTemplate =
          /\.(mrt|repx|jasper|jrxml)(\?.*)?$/i.test(url) ||
          /(stimulsoft|reporttemplate|getreport|dxxrdv|jasperreport)/i.test(url);

        if (isReportTemplate && !this.rawReportTemplates.has(url)) {
          response.text().then((content) => {
            if (content && content.length > 20) {
              const parsedName = path.basename(new URL(url).pathname) || `template_${this.rawReportTemplates.size + 1}`;
              this.rawReportTemplates.set(url, { url, content, name: parsedName });
            }
          }).catch(() => {});
        }
      } catch {}
    });
  }

  /**
   * Registra manualmente un script en memoria (útil para pruebas unitarias).
   */
  public registerScript(nameOrUrl: string, content: string): void {
    this.scriptBundles.set(nameOrUrl, content);
  }

  /**
   * Registra manualmente una plantilla de reporte (útil para pruebas unitarias).
   */
  public registerTemplate(nameOrUrl: string, content: string): void {
    this.rawReportTemplates.set(nameOrUrl, { url: nameOrUrl, content, name: path.basename(nameOrUrl) });
  }

  /**
   * Ejecuta la fase de minería estática sobre todos los scripts y plantillas recolectados.
   *
   * @param targetOrigin Origen principal auditado (ej. "http://localhost:3456" o "http://172.16.1.122:5002").
   * @param liveExecutedEndpoints Lista de endpoints que sí fueron observados en vivo por ReconEngine / Telemetry.
   */
  public mineDiscoveredSurface(
    targetOrigin: string,
    liveExecutedEndpoints: string[] = []
  ): DiscoveredApiSurfaceReport | null {
    const normalizedLiveSet = new Set(
      liveExecutedEndpoints.map((ep) => this.normalizeEndpointPath(ep).toLowerCase())
    );

    let parsedTargetOrigin: URL | null = null;
    try {
      if (targetOrigin && targetOrigin !== 'about:blank') {
        parsedTargetOrigin = new URL(targetOrigin);
      }
    } catch {}

    const discoveredEndpointsMap: Map<string, { category: HighValueCategory; source: string }> = new Map();
    const satelliteServicesMap: Map<string, SatelliteService> = new Map();

    // 1. Minería sobre cada script en memoria
    for (const [scriptUrl, scriptContent] of this.scriptBundles.entries()) {
      const scriptName = path.basename(scriptUrl) || scriptUrl;

      // A. Extracción de Endpoints Relativos (/api/..., /v1/..., /reports/..., etc.)
      const relativeRegex = /(?:["'`])(\/(?:api|v1|v2|v3|reports?|documents?|services?|results?|download)\/[a-zA-Z0-9_\-\/]+)(?:["'`?#])/gi;
      let match: RegExpExecArray | null;
      while ((match = relativeRegex.exec(scriptContent)) !== null) {
        const rawEndpoint = match[1];
        if (rawEndpoint && rawEndpoint.length > 4 && !rawEndpoint.endsWith('/')) {
          const category = this.classifyEndpoint(rawEndpoint);
          if (!discoveredEndpointsMap.has(rawEndpoint)) {
            discoveredEndpointsMap.set(rawEndpoint, { category, source: scriptName });
          }
        }
      }

      // B. Extracción de URLs Absolutas y Detección de Satélites Multi-Puerto
      const absoluteUrlRegex = /https?:\/\/([a-zA-Z0-9.\-]+(?::(\d+))?)(\/[a-zA-Z0-9_\-\/]+)?/gi;
      while ((match = absoluteUrlRegex.exec(scriptContent)) !== null) {
        const fullMatchedUrl = match[0];
        const hostWithPort = match[1];
        const port = match[2];
        const pathname = match[3] || '/';

        try {
          const urlObj = new URL(fullMatchedUrl);
          const origin = urlObj.origin;

          // Ignorar orígenes que coinciden con el origin principal de la página
          const isSameAsTarget =
            parsedTargetOrigin &&
            urlObj.hostname === parsedTargetOrigin.hostname &&
            (urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')) ===
              (parsedTargetOrigin.port || (parsedTargetOrigin.protocol === 'https:' ? '443' : '80'));

          // Ignorar CDNs y trackers conocidos
          const isIgnoredDomain = THIRD_PARTY_IGNORE_PATTERNS.some((p) => p.test(urlObj.hostname));

          if (!isSameAsTarget && !isIgnoredDomain) {
            let sat = satelliteServicesMap.get(origin);
            if (!sat) {
              const inferredRole = this.inferSatelliteRole(origin, port, pathname);
              sat = {
                origin,
                host: urlObj.hostname,
                port: port || (urlObj.protocol === 'https:' ? '443' : '80'),
                inferredRole,
                sampleEndpoints: []
              };
              satelliteServicesMap.set(origin, sat);
            }

            if (pathname && pathname !== '/' && !sat.sampleEndpoints.includes(pathname) && sat.sampleEndpoints.length < 10) {
              sat.sampleEndpoints.push(pathname);
            }

            // Si el pathname parece un endpoint de negocio, registrarlo también
            if (/(api|v1|v2|report|export|document|download|render)/i.test(pathname)) {
              const fullEp = `${origin}${pathname}`;
              if (!discoveredEndpointsMap.has(fullEp)) {
                discoveredEndpointsMap.set(fullEp, {
                  category: this.classifyEndpoint(pathname),
                  source: scriptName
                });
              }
            }
          }
        } catch {}
      }
    }

    // 2. Parser y Análisis de Plantillas de Reporte (Stimulsoft, DevExpress, Jasper)
    const reportTemplatesList: ReportTemplateDefinition[] = [];
    for (const [tplUrl, tplData] of this.rawReportTemplates.entries()) {
      const parsedTemplate = this.parseReportTemplate(tplData.name, tplData.content, tplUrl);
      if (parsedTemplate) {
        reportTemplatesList.push(parsedTemplate);
      }
    }

    // 3. Correlación de DataSources con Endpoints Descubiertos
    for (const tpl of reportTemplatesList) {
      for (const ds of tpl.dataSources) {
        const dsNameLower = ds.name.toLowerCase();
        for (const endpoint of discoveredEndpointsMap.keys()) {
          const epLower = endpoint.toLowerCase();
          if (epLower.includes(dsNameLower) || (dsNameLower.length > 4 && epLower.includes(dsNameLower.slice(0, -1)))) {
            if (!tpl.correlatedEndpoints.includes(endpoint)) {
              tpl.correlatedEndpoints.push(endpoint);
            }
          }
        }
      }
    }

    // 4. Clasificar endpoints de alto valor y determinar estado de ejecución en vivo
    const highValueEndpointsList: HighValueEndpoint[] = [];
    for (const [endpoint, meta] of discoveredEndpointsMap.entries()) {
      const normalizedEp = this.normalizeEndpointPath(endpoint).toLowerCase();
      const executedInLiveSession =
        normalizedLiveSet.has(normalizedEp) ||
        Array.from(normalizedLiveSet).some((live) => live.endsWith(normalizedEp) || normalizedEp.endsWith(live));

      // Buscar si coincide con alguna plantilla
      const matchedTemplates: string[] = [];
      for (const tpl of reportTemplatesList) {
        if (tpl.correlatedEndpoints.includes(endpoint)) {
          matchedTemplates.push(tpl.templateName);
        }
      }

      highValueEndpointsList.push({
        endpoint,
        category: meta.category,
        source: meta.source,
        executedInLiveSession,
        matchedTemplates: matchedTemplates.length > 0 ? matchedTemplates : undefined,
        suggestedBypass: this.generateBypassSnippet(endpoint, meta.category)
      });
    }

    // Ordenar: primero los de alto impacto (PDF_COMPILATION, EXPORT, DOCUMENTS) y latentes en código
    highValueEndpointsList.sort((a, b) => {
      const priorityOrder: Record<HighValueCategory, number> = {
        PDF_COMPILATION: 1,
        EXPORT: 2,
        DOCUMENTS: 3,
        OTHER: 4
      };
      const prioDiff = priorityOrder[a.category] - priorityOrder[b.category];
      if (prioDiff !== 0) return prioDiff;
      // Preferir los que no fueron ejecutados en vivo (latentes) para destacar la oportunidad de bypass
      if (!a.executedInLiveSession && b.executedInLiveSession) return -1;
      if (a.executedInLiveSession && !b.executedInLiveSession) return 1;
      return a.endpoint.localeCompare(b.endpoint);
    });

    const totalHighValue = highValueEndpointsList.filter((e) => e.category !== 'OTHER').length;

    // Si no se descubrió nada relevante, devolver null (cero ruido)
    if (
      this.scriptBundles.size === 0 &&
      satelliteServicesMap.size === 0 &&
      highValueEndpointsList.length === 0 &&
      reportTemplatesList.length === 0
    ) {
      return null;
    }

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalScriptsAnalyzed: this.scriptBundles.size,
        totalEndpointsDiscovered: highValueEndpointsList.length,
        totalHighValueEndpoints: totalHighValue,
        totalSatellitesFound: satelliteServicesMap.size,
        totalReportTemplatesFound: reportTemplatesList.length
      },
      satelliteServices: Array.from(satelliteServicesMap.values()),
      highValueEndpoints: highValueEndpointsList,
      reportTemplates: reportTemplatesList
    };
  }

  /**
   * Clasifica un endpoint según palabras clave de negocio.
   */
  private classifyEndpoint(endpoint: string): HighValueCategory {
    const lower = endpoint.toLowerCase();
    if (/(render|pdf|print|generar|download.*pdf|compil)/i.test(lower)) {
      return 'PDF_COMPILATION';
    }
    if (/(excel|xlsx|csv|export)/i.test(lower)) {
      return 'EXPORT';
    }
    if (/(attachment|document|file|upload|comprobante)/i.test(lower)) {
      return 'DOCUMENTS';
    }
    return 'OTHER';
  }

  /**
   * Infiere el rol funcional de un servicio satélite en base a su puerto y rutas.
   */
  private inferSatelliteRole(origin: string, port?: string, samplePath = ''): string {
    const combined = `${origin}${samplePath}`.toLowerCase();
    if (port === '5004' || /(report|pdf|print|jasper|stimulsoft)/i.test(combined)) {
      return 'Microservicio de Generación de Reportes / PDF';
    }
    if (/(doc|file|attachment|storage|upload)/i.test(combined)) {
      return 'Servicio de Almacenamiento y Documentos';
    }
    if (port === '8080' || port === '5000' || port === '3000' || /(api|gateway|v1|v2)/i.test(combined)) {
      return 'API Gateway / Backend Core';
    }
    if (port === '9000' || port === '9001') {
      return 'Servicio de Objetos / MinIO / S3';
    }
    return 'Servicio Satélite Frontend / Microservicio';
  }

  /**
   * Parsea una plantilla de reporte (Stimulsoft .mrt en JSON o DevExpress/Jasper en XML).
   */
  private parseReportTemplate(name: string, content: string, url?: string): ReportTemplateDefinition | null {
    const isJson = content.trim().startsWith('{');
    const isXml = content.trim().startsWith('<');

    let format: ReportTemplateDefinition['format'] = 'unknown';
    if (name.endsWith('.mrt') || content.includes('Stimulsoft')) format = 'mrt';
    else if (name.endsWith('.repx') || content.includes('XtraReport')) format = 'repx';
    else if (name.endsWith('.jasper') || name.endsWith('.jrxml') || content.includes('jasperReport')) format = 'jasper';
    else if (isJson) format = 'json';
    else if (isXml) format = 'xml';

    const dataSources: ReportTemplateDefinition['dataSources'] = [];

    // 1. Parsing Stimulsoft .mrt (JSON)
    if (isJson) {
      try {
        const json = JSON.parse(content);
        const dsObj =
          json.Dictionary?.DataSources ||
          json.dataSources ||
          json.DataSources ||
          {};

        const dsEntries = Array.isArray(dsObj)
          ? dsObj
          : typeof dsObj === 'object' && dsObj !== null
          ? Object.values(dsObj)
          : [];

        for (const entry of dsEntries) {
          if (entry && typeof entry === 'object') {
            const dsName = (entry as any).Name || (entry as any).name || (entry as any).Alias || 'DataSource';
            const rawColumns = (entry as any).Columns || (entry as any).columns || [];
            const columns: string[] = [];

            if (Array.isArray(rawColumns)) {
              for (const col of rawColumns) {
                if (typeof col === 'string') columns.push(col);
                else if (col && typeof col === 'object' && col.Name) columns.push(col.Name);
              }
            } else if (typeof rawColumns === 'object' && rawColumns !== null) {
              columns.push(...Object.keys(rawColumns));
            }

            const query = (entry as any).SqlCommand || (entry as any).sqlCommand || undefined;
            dataSources.push({
              name: String(dsName),
              columns,
              query
            });
          }
        }
      } catch {}
    }

    // 2. Parsing DevExpress .repx o Jasper .jrxml (XML)
    if (isXml) {
      // Regex para nombres de tablas / dataSources
      const tableMatches = content.matchAll(/<(?:Table|DataSource|table|dataset)\s+[^>]*Name=["']([^"']+)["']/gi);
      for (const m of tableMatches) {
        if (m[1]) {
          dataSources.push({
            name: m[1],
            columns: []
          });
        }
      }

      // Regex para campos / columnas (<field name="..." o <Column Name="...">)
      const fieldMatches = content.matchAll(/<(?:field|Column|column)\s+[^>]*[nN]ame=["']([^"']+)["']/gi);
      const extractedCols: string[] = [];
      for (const f of fieldMatches) {
        if (f[1] && !extractedCols.includes(f[1])) {
          extractedCols.push(f[1]);
        }
      }

      if (dataSources.length > 0 && extractedCols.length > 0) {
        dataSources[0].columns = extractedCols.slice(0, 30);
      } else if (extractedCols.length > 0) {
        dataSources.push({
          name: 'PrimaryDataSet',
          columns: extractedCols.slice(0, 30)
        });
      }
    }

    if (dataSources.length === 0 && format === 'unknown') {
      return null;
    }

    return {
      templateName: name,
      format,
      url,
      dataSources,
      correlatedEndpoints: []
    };
  }

  /**
   * Genera snippet de bypass con Playwright APIRequestContext.
   */
  private generateBypassSnippet(endpoint: string, category: HighValueCategory): string {
    const isPost = category === 'PDF_COMPILATION';
    const method = isPost ? 'post' : 'get';
    return `const res = await request.${method}('${endpoint}', {\n  headers: { 'Authorization': \`Bearer \${token}\` }\n});\nconst buffer = await res.body();`;
  }

  /**
   * Normaliza una URL o ruta a su pathname sin query params ni hash.
   */
  private normalizeEndpointPath(ep: string): string {
    try {
      if (ep.startsWith('http://') || ep.startsWith('https://')) {
        return new URL(ep).pathname;
      }
      return ep.split('?')[0].split('#')[0];
    } catch {
      return ep;
    }
  }

  /**
   * Guarda el reporte en disco si se especifica la ruta de salida.
   */
  public generateReport(outputPath?: string, reportData?: DiscoveredApiSurfaceReport): DiscoveredApiSurfaceReport | null {
    const report = reportData || this.mineDiscoveredSurface('');
    if (!report) return null;

    if (outputPath) {
      const resolved = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`[StaticSurfaceMiner] 🔍 Catálogo de APIs y satélites guardado en: ${resolved}`);
    }

    return report;
  }
}
