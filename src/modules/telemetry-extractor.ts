import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, Page, Request, Response } from 'playwright';
import {
  ApiContractEndpoint,
  ApiContractsReport,
  ExecutionSequenceReport,
  PopupEvent,
  RouteTrackerRecord,
  SelectorCandidate,
  SelectorMapEntry,
  SelectorsMapReport,
  UserActionRecord
} from '../types';

/**
 * Extractor de Telemetría Avanzada para Automatización RPA e Ingeniería Inversa.
 *
 * Responsabilidades:
 * 1. Secuencia de Ejecución (execution-sequence.json): Orden cronológico de clics, inputs y cambios de vista.
 * 2. Mapa de Selectores (selectors-map.json): Evaluación de robustez, resiliencia y recomendación de Locators de Playwright.
 * 3. Contratos de API (api-contracts.json): Interceptación pasiva de endpoints XHR/Fetch con esquemas inferidos y payloads.
 * 4. Rastreo de Rutas Directas (Route Tracker): Detección de navegación SPA por URL directa para evitar clics en menús anidados.
 */
export class TelemetryExtractor {
  private actions: UserActionRecord[] = [];
  private selectorsMap: Map<string, SelectorMapEntry> = new Map();
  private apiContractsMap: Map<string, ApiContractEndpoint> = new Map();
  private routesMap: Map<string, RouteTrackerRecord> = new Map();
  private requestStartTimes: Map<string, number> = new Map();
  private popupsDetected: PopupEvent[] = [];
  private attachedPages = new WeakSet<Page>();
  private static readonly TELEMETRY_PREFIX = '__SK_TELEMETRY__:';

  /**
   * Conecta los escuchadores pasivos y la inyección sigilosa de telemetría a la página/contexto.
   * No expone propiedades globales en `window` (evita Runtime.addBinding) para ser 100% invisible
   * ante sistemas anti-bot como Cloudflare Turnstile, DataDome o Imperva.
   */
  public async attach(page: Page, _context?: BrowserContext): Promise<void> {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);

    // Escuchar si la página actual dispara un popup
    page.on('popup', async (popup) => {
      await this.handlePopupInstance(popup, page, _context);
    });

    if (_context) {
      _context.on('page', async (newPage) => {
        if (newPage !== page) {
          await this.handlePopupInstance(newPage, page, _context);
        }
      });
    }

    // 1. Escuchar eventos de telemetría vía canal pasivo de consola (cero polución en window)
    page.on('console', (msg) => {
      try {
        if (msg.type() === 'debug') {
          const text = msg.text();
          if (text.startsWith(TelemetryExtractor.TELEMETRY_PREFIX)) {
            const rawPayload = text.slice(TelemetryExtractor.TELEMETRY_PREFIX.length);
            this.handleInPageAction(rawPayload);
          }
        }
      } catch {
        // Ignorar errores de parseo
      }
    });

    // 2. Inyectar script sigiloso en el navegador (sin dejar variables globales en window)
    await page.addInitScript((prefix: string) => {
      // No ejecutar ni registrar listeners dentro de iframes de verificación Anti-Bot / Captcha
      const isChallengeFrame = (): boolean => {
        try {
          const host = (window.location.hostname || '').toLowerCase();
          const href = (window.location.href || '').toLowerCase();
          return (
            host.includes('cloudflare.com') ||
            host.includes('challenges.cloudflare.com') ||
            href.includes('cdn-cgi/challenge-platform') ||
            host.includes('recaptcha') ||
            host.includes('hcaptcha') ||
            host.includes('datadome') ||
            host.includes('imperva')
          );
        } catch {
          return false;
        }
      };

      if (isChallengeFrame()) return;

      function emitTelemetry(payload: Record<string, unknown>): void {
        if (isChallengeFrame()) return;
        try {
          console.debug(prefix + JSON.stringify(payload));
        } catch {}
      }

      function sanitizeText(txt: string | null | undefined): string | undefined {
        if (!txt) return undefined;
        const clean = txt.replace(/\s+/g, ' ').trim();
        return clean.length > 80 ? `${clean.slice(0, 80)}...` : clean;
      }

      function getCssPath(el: Element): string {
        if (!(el instanceof Element)) return '';
        const pathArr: string[] = [];
        let curr: Element | null = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.body) {
          let selector = curr.nodeName.toLowerCase();
          if (curr.id && !curr.id.startsWith('dx-') && !curr.id.match(/\d{5,}/)) {
            selector += `#${curr.id}`;
            pathArr.unshift(selector);
            break;
          } else {
            let sib = curr;
            let nth = 1;
            while ((sib = sib.previousElementSibling as Element)) {
              if (sib.nodeName.toLowerCase() === selector) nth++;
            }
            if (nth !== 1) selector += `:nth-of-type(${nth})`;
          }
          pathArr.unshift(selector);
          curr = curr.parentElement;
        }
        return pathArr.join(' > ');
      }

      function getXPath(el: Element): string {
        if (!(el instanceof Element)) return '';
        if (el.id && !el.id.startsWith('dx-')) return `//*[@id="${el.id}"]`;
        const parts: string[] = [];
        let curr: Element | null = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE) {
          let count = 0;
          let sibling = curr.previousSibling;
          while (sibling) {
            if (sibling.nodeType === Node.DOCUMENT_TYPE_NODE) break;
            if (sibling.nodeType === Node.ELEMENT_NODE && (sibling as Element).nodeName === curr.nodeName) {
              count++;
            }
            sibling = sibling.previousSibling;
          }
          const tagName = curr.nodeName.toLowerCase();
          const pathIndex = count > 0 ? `[${count + 1}]` : '';
          parts.unshift(`${tagName}${pathIndex}`);
          curr = curr.parentElement;
        }
        return parts.length ? `/${parts.join('/')}` : '';
      }

      function extractElementMeta(target: EventTarget | null) {
        if (!target || !(target instanceof Element)) return null;

        // Si es un icono interno de un botón, preferir el botón padre interactivo
        let el = target;
        const clickableParent = el.closest('button, a, .dx-button, [role="button"], [role="menuitem"], input, select');
        if (clickableParent && clickableParent !== el) {
          el = clickableParent;
        }

        const rawClasses = Array.from(el.classList || []).filter((c) => !c.startsWith('dx-state-'));
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          name: el.getAttribute('name') || undefined,
          text: sanitizeText(el.textContent),
          ariaLabel: el.getAttribute('aria-label') || undefined,
          role: el.getAttribute('role') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          title: el.getAttribute('title') || undefined,
          dataTestId:
            el.getAttribute('data-testid') ||
            el.getAttribute('data-cy') ||
            el.getAttribute('data-test') ||
            undefined,
          classes: rawClasses.slice(0, 8),
          cssPath: getCssPath(el),
          xpath: getXPath(el)
        };
      }

      // Escuchador de clics del usuario
      document.addEventListener(
        'click',
        (event) => {
          try {
            if (isChallengeFrame()) return;
            const meta = extractElementMeta(event.target);
            if (!meta) return;
            emitTelemetry({
              actionType: 'click',
              url: window.location.href,
              target: meta,
              timestamp: new Date().toISOString()
            });
          } catch {}
        },
        true
      );

      // Escuchador de entradas en formularios (inputs y textareas)
      document.addEventListener(
        'change',
        (event) => {
          try {
            if (isChallengeFrame()) return;
            const target = event.target;
            if (
              !target ||
              !(
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement
              )
            ) {
              return;
            }
            const meta = extractElementMeta(target);
            if (!meta) return;

            let valPreview = (target.value || '').trim();
            if (target instanceof HTMLInputElement && target.type === 'password') {
              valPreview = '***REDACTED***';
            } else if (valPreview.length > 25) {
              valPreview = `${valPreview.slice(0, 25)}...`;
            }

            emitTelemetry({
              actionType: 'input',
              url: window.location.href,
              target: meta,
              valuePreview: valPreview,
              timestamp: new Date().toISOString()
            });
          } catch {}
        },
        true
      );

      // Escuchadores de navegación SPA en el cliente
      window.addEventListener('hashchange', () => {
        if (isChallengeFrame()) return;
        emitTelemetry({
          actionType: 'url_change',
          url: window.location.href,
          navType: 'hashchange',
          timestamp: new Date().toISOString()
        });
      });
    }, TelemetryExtractor.TELEMETRY_PREFIX);

    // 3. Escuchar navegación del marco principal (Route Tracker por frame)
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const currentUrl = frame.url();
        this.trackRoute(currentUrl, 'framenavigated');
      }
    });

    // 4. Escuchar peticiones de red para latencia y contratos de API
    page.on('request', (request: Request) => {
      this.handleRequest(request);
    });

    // 5. Escuchar respuestas de red para completar el contrato de API
    page.on('response', (response: Response) => {
      this.handleResponse(response);
    });
  }

  /**
   * Procesa la apertura de una pestaña emergente o ventana popup.
   */
  private async handlePopupInstance(popup: Page, parentPage: Page, context?: BrowserContext): Promise<void> {
    if (this.attachedPages.has(popup)) return;
    this.attachedPages.add(popup);

    try {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const popupUrl = popup.url();
      const popupTitle = await popup.title().catch(() => '');
      const parentUrl = parentPage.url();
      const snippet = `const [popup] = await Promise.all([\n  page.waitForEvent('popup'),\n  /* locator.click() */\n]);\nawait popup.waitForLoadState('domcontentloaded');`;

      const popupEvt: PopupEvent = {
        url: popupUrl,
        title: popupTitle,
        parentUrl,
        timestamp: new Date().toISOString(),
        recommendedSnippet: snippet
      };

      this.popupsDetected.push(popupEvt);

      if (this.actions.length > 0) {
        const lastAction = this.actions[this.actions.length - 1];
        if (lastAction.actionType === 'click') {
          lastAction.triggersPopup = true;
          lastAction.popupDetails = popupEvt;
        }
      }

      this.actions.push({
        id: `popup_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actionType: 'popup_opened',
        url: popupUrl,
        target: {
          tag: 'window',
          text: `Ventana emergente / Popup: "${popupTitle || popupUrl}"`
        },
        suggestedLocator: snippet,
        stabilityScore: 100
      });

      console.log(`\n🪟 [TelemetryExtractor] Pestaña emergente / Popup detectado: "${popupTitle || popupUrl}"`);
      console.log(`   👉 Sugerencia RPA: Usa page.waitForEvent('popup') antes del clic que lo abre.`);

      if (context) {
        await this.attach(popup, context);
      }
    } catch {}
  }

  public getPopupsDetected(): PopupEvent[] {
    return this.popupsDetected;
  }

  /**
   * Procesa acciones interceptadas desde el navegador y evalúa su robustez.
   */
  private handleInPageAction(rawJson: string): void {
    try {
      const data = JSON.parse(rawJson);
      const actionType = data.actionType;
      const url = data.url;
      const target = data.target;

      let suggestedLocator: string | undefined;
      let stabilityScore: number | undefined;

      if (target) {
        const evaluation = this.evaluateSelectorRobustness(target, url);
        suggestedLocator = evaluation.recommendedLocator;
        stabilityScore = evaluation.stabilityScore;
      }

      // Si es un cambio de URL en SPA, evaluarlo con el Route Tracker
      let routeSuggestion: UserActionRecord['routeSuggestion'];
      if (actionType === 'url_change') {
        const routeRecord = this.trackRoute(url, data.navType || 'hashchange');
        if (routeRecord) {
          routeSuggestion = {
            route: routeRecord.route,
            directRoutable: routeRecord.directRoutable,
            recommendedGoto: routeRecord.recommendedGoto,
            reason: 'Permite abrir directamente la vista objetivo sin clics previos'
          };
        }
      }

      const actionRecord: UserActionRecord = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: data.timestamp || new Date().toISOString(),
        actionType,
        url,
        target,
        valuePreview: data.valuePreview,
        suggestedLocator,
        stabilityScore,
        routeSuggestion
      };

      this.actions.push(actionRecord);
    } catch {}
  }

  /**
   * Evalúa la robustez de un selector tocado por el usuario y genera alternativas ordenadas por fiabilidad.
   */
  private evaluateSelectorRobustness(target: NonNullable<UserActionRecord['target']>, url: string): SelectorMapEntry {
    const candidates: SelectorCandidate[] = [];
    const isGeneratedId = (id: string) => id.startsWith('dx-') || /^[a-z0-9]{8}-[a-z0-9]{4}/i.test(id) || /\d{6,}/.test(id);

    // 1. data-testid (Nivel Excelente - Máxima Resiliencia)
    if (target.dataTestId) {
      candidates.push({
        type: 'data-testid',
        selector: `page.getByTestId('${target.dataTestId}')`,
        score: 98,
        reason: 'Atributo de testing dedicado. Inmune a rediseños de CSS y jerarquías DOM.'
      });
    }

    // 2. Roles semánticos y aria-label / texto visible
    if (target.role && (target.ariaLabel || target.text)) {
      const name = target.ariaLabel || target.text;
      candidates.push({
        type: 'role',
        selector: `page.getByRole('${target.role}', { name: '${name}' })`,
        score: 92,
        reason: 'Localizador semántico accesible estándar de Playwright. Muy resistente a cambios de maquetación.'
      });
    } else if (target.ariaLabel) {
      candidates.push({
        type: 'aria',
        selector: `page.locator('[aria-label="${target.ariaLabel}"]')`,
        score: 87,
        reason: 'Atributo ARIA explícito para accesibilidad de usuario.'
      });
    }

    // 3. ID único estático (si no es dinámico generado por DevExtreme o frameworks)
    if (target.id && !isGeneratedId(target.id)) {
      candidates.push({
        type: 'id',
        selector: `page.locator('#${target.id}')`,
        score: 88,
        reason: 'Identificador único en el documento sin patrones de generación dinámica.'
      });
    }

    // 4. Placeholder en campos de texto
    if (target.placeholder) {
      candidates.push({
        type: 'placeholder',
        selector: `page.getByPlaceholder('${target.placeholder}')`,
        score: 84,
        reason: 'Guía visible del campo de formulario. Intuitiva y poco volátil.'
      });
    }

    // 5. Atributo title o name
    if (target.name) {
      candidates.push({
        type: 'placeholder',
        selector: `page.locator('[name="${target.name}"]')`,
        score: 80,
        reason: 'Atributo estándar de nombre de formulario.'
      });
    }

    // 6. Texto exacto visible
    if (target.text && target.text.length >= 3 && target.text.length <= 40) {
      candidates.push({
        type: 'text',
        selector: `page.getByText('${target.text}', { exact: true })`,
        score: 74,
        reason: 'Contenido textual visualizado por el usuario.'
      });
    }

    // 7. Clases semánticas limpias
    if (target.classes && target.classes.length > 0) {
      const cleanClasses = target.classes.filter((c) => !c.startsWith('ng-') && !c.includes('active') && !c.includes('hover'));
      if (cleanClasses.length > 0) {
        candidates.push({
          type: 'css',
          selector: `page.locator('${target.tag}.${cleanClasses.join('.')}')`,
          score: 62,
          reason: 'Selector CSS basado en clases semánticas identificadas.'
        });
      }
    }

    // 8. Rutas CSS o XPath jerárquicos (Frágiles)
    if (target.cssPath) {
      candidates.push({
        type: 'css',
        selector: `page.locator('${target.cssPath}')`,
        score: 45,
        reason: 'Ruta jerárquica CSS calculada. Puede romperse si se inserta un contenedor intermedio.'
      });
    }

    if (target.xpath) {
      candidates.push({
        type: 'xpath',
        selector: `page.locator('xpath=${target.xpath}')`,
        score: 35,
        reason: 'Ruta XPath absoluta o relativa. Muy vulnerable a cambios estructurales del DOM.'
      });
    }

    // Ordenar candidatos por puntuación descendente
    candidates.sort((a, b) => b.score - a.score);
    const bestCandidate = candidates[0] || {
      type: 'css',
      selector: `page.locator('${target.tag}')`,
      score: 30,
      reason: 'Selector genérico de respaldo.'
    };

    let reliabilityTier: SelectorMapEntry['reliabilityTier'] = 'FRAGILE';
    if (bestCandidate.score >= 90) reliabilityTier = 'EXCELLENT';
    else if (bestCandidate.score >= 80) reliabilityTier = 'HIGH';
    else if (bestCandidate.score >= 60) reliabilityTier = 'MEDIUM';

    const selectorKey = `${target.tag}::${target.id || ''}::${target.name || ''}::${target.ariaLabel || ''}::${target.text || ''}`;
    let existing = this.selectorsMap.get(selectorKey);

    if (existing) {
      existing.interactionCount++;
      existing.lastObservedUrl = url;
      return existing;
    }

    const description = target.text
      ? `<${target.tag}> "${target.text}"`
      : target.ariaLabel
      ? `<${target.tag}> [aria-label="${target.ariaLabel}"]`
      : target.placeholder
      ? `<${target.tag}> [placeholder="${target.placeholder}"]`
      : `<${target.tag}> (${target.classes?.join(' ') || 'sin clases'})`;

    const entry: SelectorMapEntry = {
      selectorKey,
      elementDescription: description,
      tagName: target.tag,
      recommendedLocator: bestCandidate.selector,
      stabilityScore: bestCandidate.score,
      reliabilityTier,
      candidates,
      interactionCount: 1,
      lastObservedUrl: url
    };

    this.selectorsMap.set(selectorKey, entry);
    return entry;
  }

  /**
   * Route Tracker: Evalúa si una URL o hash route soporta acceso directo (page.goto).
   */
  public trackRoute(fullUrl: string, detectedVia: RouteTrackerRecord['detectedVia']): RouteTrackerRecord | null {
    try {
      const parsed = new URL(fullUrl);
      const hash = parsed.hash;
      const pathname = parsed.pathname;

      // En SPAs como Angular o React, la ruta relevante suele ser el hash o el pathname
      const routePath = hash ? hash.replace(/^#/, '') : pathname;
      if (!routePath || routePath === '/' || routePath === '') return null;

      const directRoutable = true; // La gran mayoría de SPA hash routes soportan carga directa si la sesión existe
      const cleanUrl = fullUrl;

      let existing = this.routesMap.get(routePath);
      if (!existing) {
        existing = {
          route: routePath,
          fullUrl: cleanUrl,
          directRoutable,
          recommendedGoto: `await page.goto('${cleanUrl}');`,
          detectedVia,
          firstObservedAt: new Date().toISOString()
        };

        this.routesMap.set(routePath, existing);

        // Emitir sugerencia en consola si es una subruta de negocio
        if (routePath.includes('/') && routePath.length > 3) {
          console.log(
            `\n💡 [RouteTracker] Vista detectada: "${routePath}"\n   👉 Sugerencia RPA: Usa direct goto para saltarte los menús: ${existing.recommendedGoto}\n`
          );
        }
      }

      return existing;
    } catch {
      return null;
    }
  }

  /**
   * Registra el inicio de una petición HTTP para medir latencia precisa de backend.
   */
  private handleRequest(request: Request): void {
    const resourceType = request.resourceType();
    if (resourceType === 'xhr' || resourceType === 'fetch') {
      this.requestStartTimes.set(request.url(), Date.now());
    }
  }

  /**
   * Intercepta la respuesta XHR/Fetch y extrae el contrato de API con payloads y esquemas.
   */
  private async handleResponse(response: Response): Promise<void> {
    const request = response.request();
    const resourceType = request.resourceType();

    // Solo auditar APIs REST, XHR y Fetch
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

    const urlString = response.url();
    const method = request.method().toUpperCase();

    try {
      const parsedUrl = new URL(urlString);
      const endpointKey = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;

      const startTime = this.requestStartTimes.get(urlString);
      const latency = startTime ? Date.now() - startTime : 0;
      this.requestStartTimes.delete(urlString);

      // Query params
      const queryParams: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        queryParams[key] = val;
      });

      // Headers de petición sanitizados
      const rawReqHeaders = request.headers();
      const requestHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawReqHeaders)) {
        const lk = k.toLowerCase();
        if (lk === 'content-type' || lk === 'accept' || lk === 'authorization') {
          requestHeaders[k] = lk === 'authorization' ? `${v.slice(0, 15)}... [redacted]` : v;
        }
      }

      // Payload de petición
      let requestPayloadSample: unknown = undefined;
      let requestSchema: Record<string, string> | undefined = undefined;
      const postData = request.postData();
      if (postData) {
        try {
          const parsedPost = JSON.parse(postData);
          requestPayloadSample = this.truncateObject(parsedPost);
          requestSchema = this.inferObjectSchema(parsedPost);
        } catch {
          requestPayloadSample = postData.length > 200 ? `${postData.slice(0, 200)}...` : postData;
        }
      }

      // Payload de respuesta
      let responsePayloadSample: unknown = undefined;
      let responseSchema: Record<string, string> | undefined = undefined;
      try {
        const bodyText = await response.text().catch(() => '');
        if (bodyText) {
          try {
            const bodyJson = JSON.parse(bodyText);
            responsePayloadSample = this.truncateObject(bodyJson);
            responseSchema = this.inferObjectSchema(bodyJson);
          } catch {
            responsePayloadSample = bodyText.length > 300 ? `${bodyText.slice(0, 300)}... [texto]` : bodyText;
          }
        }
      } catch {}

      // Headers de respuesta sanitizados
      const rawResHeaders = response.headers();
      const responseHeaders: Record<string, string> = {};
      if (rawResHeaders['content-type']) responseHeaders['content-type'] = rawResHeaders['content-type'];
      if (rawResHeaders['cache-control']) responseHeaders['cache-control'] = rawResHeaders['cache-control'];

      let contract = this.apiContractsMap.get(endpointKey);
      if (!contract) {
        contract = {
          endpointKey,
          method,
          url: urlString,
          pathname: parsedUrl.pathname,
          origin: parsedUrl.origin,
          queryParams,
          requestHeaders,
          requestPayloadSample,
          requestSchema,
          responseStatus: response.status(),
          responseHeaders,
          responsePayloadSample,
          responseSchema,
          averageLatencyMs: latency,
          callCount: 1
        };
        this.apiContractsMap.set(endpointKey, contract);
      } else {
        contract.callCount++;
        contract.averageLatencyMs = Math.round((contract.averageLatencyMs * (contract.callCount - 1) + latency) / contract.callCount);
        if (!contract.responsePayloadSample && responsePayloadSample) {
          contract.responsePayloadSample = responsePayloadSample;
          contract.responseSchema = responseSchema;
        }
      }
    } catch {}
  }

  /**
   * Deduce un esquema tipado simplificado de un objeto JSON ({ id: "number", nombre: "string" }).
   */
  private inferObjectSchema(obj: unknown): Record<string, string> {
    const schema: Record<string, string> = {};
    if (!obj || typeof obj !== 'object') return schema;

    const source = Array.isArray(obj) ? (obj[0] && typeof obj[0] === 'object' ? obj[0] : {}) : obj;
    for (const [key, val] of Object.entries(source as Record<string, unknown>)) {
      if (val === null) schema[key] = 'null';
      else if (Array.isArray(val)) {
        const subType = val.length > 0 ? typeof val[0] : 'any';
        schema[key] = `Array<${subType}>`;
      } else {
        schema[key] = typeof val;
      }
    }
    return schema;
  }

  /**
   * Trunca arrays u objetos grandes para mantener los contratos concisos y legibles.
   */
  private truncateObject(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.slice(0, 3).map((item) => this.truncateObject(item));
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      const entries = Object.entries(obj as Record<string, unknown>);
      for (const [k, v] of entries.slice(0, 15)) {
        if (typeof v === 'string' && v.length > 150) {
          result[k] = `${v.slice(0, 150)}... [truncado]`;
        } else if (typeof v === 'object' && v !== null) {
          result[k] = this.truncateObject(v);
        } else {
          result[k] = v;
        }
      }
      return result;
    }
    return obj;
  }

  // ============================================================================
  // MÉTODOS DE EXPORTACIÓN DE ARTEFACTOS
  // ============================================================================

  /**
   * Genera el reporte de secuencia de ejecución cronológica (execution-sequence.json).
   */
  public generateExecutionSequence(outputPath?: string): ExecutionSequenceReport {
    const report: ExecutionSequenceReport = {
      generatedAt: new Date().toISOString(),
      totalActionsCaptured: this.actions.length,
      uniqueRoutesDiscovered: this.routesMap.size,
      popupsDetected: this.popupsDetected,
      actions: this.actions,
      routeDirectNavigations: Array.from(this.routesMap.values())
    };

    if (outputPath) {
      this.writeFileSafe(outputPath, report);
      console.log(`[TelemetryExtractor] Secuencia de ejecución guardada en: ${outputPath}`);
    }
    return report;
  }

  /**
   * Genera el mapa de robustez de selectores (selectors-map.json).
   */
  public generateSelectorsMap(outputPath?: string): SelectorsMapReport {
    const selectorsObj: Record<string, SelectorMapEntry> = {};
    let excellentCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let fragileCount = 0;

    for (const [key, entry] of this.selectorsMap.entries()) {
      selectorsObj[key] = entry;
      if (entry.reliabilityTier === 'EXCELLENT') excellentCount++;
      else if (entry.reliabilityTier === 'HIGH') highCount++;
      else if (entry.reliabilityTier === 'MEDIUM') mediumCount++;
      else fragileCount++;
    }

    const report: SelectorsMapReport = {
      generatedAt: new Date().toISOString(),
      totalSelectorsAnalyzed: this.selectorsMap.size,
      robustnessSummary: {
        excellentCount,
        highCount,
        mediumCount,
        fragileCount
      },
      selectors: selectorsObj
    };

    if (outputPath) {
      this.writeFileSafe(outputPath, report);
      console.log(`[TelemetryExtractor] Mapa de robustez de selectores guardado en: ${outputPath}`);
    }
    return report;
  }

  /**
   * Genera el catálogo estructurado de contratos de API XHR/Fetch (api-contracts.json).
   */
  public generateApiContracts(outputPath?: string): ApiContractsReport {
    const report: ApiContractsReport = {
      generatedAt: new Date().toISOString(),
      totalContractsDiscovered: this.apiContractsMap.size,
      contracts: Array.from(this.apiContractsMap.values())
    };

    if (outputPath) {
      this.writeFileSafe(outputPath, report);
      console.log(`[TelemetryExtractor] Contratos de API guardados en: ${outputPath}`);
    }
    return report;
  }

  /**
   * Exporta simultáneamente todos los artefactos de telemetría en el directorio de salida.
   */
  public exportAll(outputDir: string = './'): {
    sequenceReport: ExecutionSequenceReport;
    selectorsReport: SelectorsMapReport;
    contractsReport: ApiContractsReport;
  } {
    const resolvedDir = path.resolve(outputDir);
    const sequenceFile = path.join(resolvedDir, 'execution-sequence.json');
    const selectorsFile = path.join(resolvedDir, 'selectors-map.json');
    const contractsFile = path.join(resolvedDir, 'api-contracts.json');

    return {
      sequenceReport: this.generateExecutionSequence(sequenceFile),
      selectorsReport: this.generateSelectorsMap(selectorsFile),
      contractsReport: this.generateApiContracts(contractsFile)
    };
  }

  private writeFileSafe(filePath: string, data: unknown): void {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf-8');
  }
}
