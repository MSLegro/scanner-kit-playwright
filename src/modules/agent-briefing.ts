import * as fs from 'fs';
import * as path from 'path';
import {
  ApiContractsReport,
  BrandIdentityReport,
  ExecutionSequenceReport,
  FormSchemaReport,
  ReconReport,
  SelectorsMapReport,
  SessionBackup
} from '../types';

export interface AgentBriefingInput {
  targetUrl: string;
  outputDirectory: string;
  reconReport?: ReconReport | null;
  sessionBackup?: SessionBackup | null;
  executionSequence?: ExecutionSequenceReport | null;
  selectorsMap?: SelectorsMapReport | null;
  apiContracts?: ApiContractsReport | null;
  formSchema?: FormSchemaReport | null;
  accessibilityTree?: unknown | null;
  brandIdentity?: BrandIdentityReport | null;
}

/**
 * Generador del Briefing Ejecutivo para Agentes de IA (prompt-context.md).
 *
 * Consolida toda la inteligencia técnica descubierta por los motores de ScannerKit
 * en un único documento Markdown estructurado y optimizado para ser consumido
 * como contexto de entrada (prompt) por modelos de lenguaje y agentes de programación
 * (Claude, Cursor, Copilot, Antigravity, etc.).
 *
 * Directiva: BLUEPRINT-FIRST & FORENSIC-ONLY
 * - Es una radiografía técnica forense offline, NUNCA una dependencia de runtime.
 * - Prohíbe el re-scraping innecesario ya que toda la verdad está capturada.
 * - Evita el hardcoding de sesiones o tokens estáticos.
 * - Enmascara datos sensibles y promueve clientes tipados parametrizados.
 */
export class AgentBriefing {
  /**
   * Comprueba si una clave de payload o querystring representa información confidencial.
   */
  private static isSensitiveKey(key: string): boolean {
    return /(password|passwd|pass|pwd|token|secret|bearer|apikey|api_key|credential|authorization|auth_token)/i.test(key);
  }

  /**
   * Enmascara valores sensibles en payloads de prueba (JSON).
   */
  private static redactPayload(payload: unknown, depth = 0): unknown {
    if (depth > 8 || payload === null || typeof payload !== 'object') {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.slice(0, 10).map((item) => AgentBriefing.redactPayload(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (AgentBriefing.isSensitiveKey(k)) {
        result[k] = '[REDACTED_SECRET - Configurar en .env]';
      } else if (typeof v === 'string' && /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(v)) {
        result[k] = '[REDACTED_JWT_TOKEN]';
      } else if (v !== null && typeof v === 'object') {
        result[k] = AgentBriefing.redactPayload(v, depth + 1);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Enmascara parámetros de consulta sensibles en URLs observadas.
   */
  private static redactUrl(urlString: string): string {
    try {
      const parsed = new URL(urlString);
      const sensitiveParamRegex = /(token|auth|key|pass|secret|credential|session|jwt)/i;
      let mutated = false;

      for (const [key] of parsed.searchParams.entries()) {
        if (sensitiveParamRegex.test(key)) {
          parsed.searchParams.set(key, '[REDACTED]');
          mutated = true;
        }
      }

      if (parsed.password) {
        parsed.password = '[REDACTED]';
        mutated = true;
      }

      return mutated ? parsed.toString() : urlString;
    } catch {
      return urlString;
    }
  }

  /**
   * Genera el contenido Markdown estructurado del briefing para el agente.
   */
  public static generateMarkdown(data: AgentBriefingInput): string {
    const lines: string[] = [];

    lines.push(`# 🤖 Briefing Técnico para Agente de IA: Automatización RPA (Directiva Blueprint-First)`);
    lines.push(`> **DIRECTIVA CRÍTICA: BLUEPRINT-FIRST CON VÁLVULA DE ESCAPE QUIRÚRGICA**`);
    lines.push(`> `);
    lines.push(`> 🏛️ **Este directorio (\`${data.outputDirectory}\`) es una Radiografía Forense Offline (Plano Arquitectónico)** generada automáticamente por **scanner-kit-playwright** tras auditar el portal objetivo.`);
    lines.push(`> **NUNCA debe ser una dependencia de runtime de tu bot en producción.**`);
    lines.push(`> `);
    lines.push(`> 🎯 **JERARQUÍA DE DECISIÓN OBLIGATORIA PARA EL AGENTE:**`);
    lines.push(`> 1. **Prioridad Absoluta al Blueprint (95% de los casos):** Para todos los flujos cubiertos durante la auditoría, **NO abras navegadores para re-explorar ni adivines selectores**. Toda la verdad de red, DOM, formularios y secuencia ya está capturada con rigor forense en \`api-contracts.json\`, \`execution-sequence.json\`, \`selectors-map.json\` y \`form-schema.json\`.`);
    lines.push(`> 2. **Detección Explícita de Brechas (Gap Analysis):** Si tus reglas de negocio requieren interactuar con un elemento, modal o endpoint que **NO fue registrado en este blueprint**, **NUNCA alucines ni inventes selectores**. Declara la brecha con precisión técnica al desarrollador.`);
    lines.push(`> 3. **Válvula de Escape Quirúrgica:** Si dispones de herramientas de navegación asistida (browser tools / MCP) y requieres resolver la brecha puntual, puedes explorar **únicamente ese elemento específico en modo quirúrgico de solo lectura**, o solicitar al usuario una sub-auditoría (\`sk --u <url_especifica>\`) sin descartar los contratos ya descubiertos.`);
    lines.push(``);
    lines.push(`- **Target URL Auditada:** \`${data.targetUrl}\``);
    lines.push(`- **Directorio del Blueprint Forense:** \`${data.outputDirectory}\``);
    lines.push(`- **Fecha de Auditoría:** ${new Date().toLocaleString()}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 1. IDENTIDAD VISUAL Y RECURSOS DE MARCA (BRANDING)
    if (data.brandIdentity) {
      lines.push(`## 🎨 1. Identidad Visual y Recursos de Marca (Branding)`);
      lines.push(`> Recursos gráficos extraídos para ilustrar la documentación y reconocer la identidad corporativa de la página analizada:`);
      lines.push(``);

      const meta = data.brandIdentity.meta;
      if (meta.pageTitle) lines.push(`- **Título de la Página:** ${meta.pageTitle}`);
      if (meta.siteName) lines.push(`- **Nombre del Sitio / App:** ${meta.siteName}`);
      if (meta.description) lines.push(`- **Descripción:** *${meta.description}*`);
      if (meta.themeColor) lines.push(`- **Color de Tema:** \`${meta.themeColor}\``);

      lines.push(``);
      lines.push(`### 🖼️ Recursos Gráficos Destacados (URLs Listas para Documentación)`);

      if (data.brandIdentity.primaryFavicon) {
        const fav = data.brandIdentity.primaryFavicon;
        lines.push(`- **Favicon Principal:** [${fav.url}](${fav.url})${fav.localPath ? ` (Local: \`${fav.localPath}\`)` : ''}`);
      }

      if (data.brandIdentity.primaryLogo) {
        const logo = data.brandIdentity.primaryLogo;
        const imgMarkdown = logo.url.startsWith('http') ? `![Logo](${logo.url}) ` : '';
        lines.push(`- **Logo Principal:** ${imgMarkdown}\`${logo.url}\`${logo.alt ? ` (Alt: *"${logo.alt}"*)` : ''}${logo.localPath ? ` - Descargado en \`${logo.localPath}\`` : ''}`);
        if (logo.suggestedSelector) {
          lines.push(`  - *Selector Playwright:* \`${logo.suggestedSelector}\``);
        }
      }

      const extraResources = data.brandIdentity.resources.filter(
        (r) => r !== data.brandIdentity?.primaryLogo && r !== data.brandIdentity?.primaryFavicon
      );

      if (extraResources.length > 0) {
        lines.push(``);
        lines.push(`**Otros Recursos de Identidad Descubiertos (${extraResources.length}):**`);
        for (const res of extraResources.slice(0, 8)) {
          lines.push(`- [${res.type}] \`${res.url}\`${res.alt ? ` (Alt: *"${res.alt}"*)` : ''}${res.localPath ? ` (Local: \`${res.localPath}\`)` : ''}`);
        }
      }

      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    // 2. ESTRATEGIA ANTI-BOT Y EJECUCIÓN
    lines.push(`## 🛡️ 2. Diagnóstico Anti-Bot y Recomendaciones de Ejecución`);
    if (data.reconReport?.optimizationBlueprint) {
      const bp = data.reconReport.optimizationBlueprint;
      if (bp.antiBotWafDetected.length > 0) {
        lines.push(`> ⚠️ **Sistemas de Protección Detectados:**`);
        bp.antiBotWafDetected.forEach((waf) => {
          lines.push(`- **Proveedor:** \`${waf.provider}\``);
          lines.push(`  - **Estrategia Bot:** ${waf.rpaStrategy}`);
        });
      } else {
        lines.push(`- **Protecciones WAF:** No se detectaron retos agresivos de Cloudflare Turnstile o WAF estricto.`);
      }

      lines.push(``);
      lines.push(`- **Rendimiento / Modo Turbo:**`);
      lines.push(`  - Peticiones prescindibles identificadas: **${bp.turboPotential.totalBlockableRequests}** (${bp.turboPotential.imagesCount} imágenes, ${bp.turboPotential.fontsCount} fuentes).`);
      lines.push(`  - Ahorro estimado de ancho de banda: **${bp.turboPotential.estimatedRequestSavingsPercent}%**.`);
      lines.push(`  - ¿Recomendado bloquear en producción?: **${bp.turboPotential.recommendedForBot ? 'SÍ' : 'NO'}** (${bp.turboPotential.recommendationReason}).`);

      if (bp.uiTrapsDetected.length > 0) {
        lines.push(``);
        lines.push(`> ⚠️ **Trampas de UI Detectadas:**`);
        bp.uiTrapsDetected.forEach((trap) => {
          lines.push(`- Tipo [${trap.type}]: *"${trap.message}"* -> Debes anular o aceptar el diálogo antes de navegar.`);
        });
      }
    } else {
      lines.push(`- Sin protecciones WAF detectadas.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 3. SESIÓN Y AUTENTICACIÓN DINÁMICA (MOLDE FORENSE)
    lines.push(`## 🔑 3. Estado de Sesión y Autenticación (Molde Forense de Persistencia)`);
    if (data.sessionBackup) {
      const cookies = data.sessionBackup.cookies || [];
      const cookieCount = cookies.length;
      const localKeys = Object.keys(data.sessionBackup.localStorage || {});
      const sessionKeys = Object.keys(data.sessionBackup.sessionStorage || {});

      lines.push(`> ⚠️ **REGLA ARQUITECTÓNICA OBLIGATORIA (CERO DEPENDENCIAS ESTÁTICAS DE SESIÓN):**`);
      lines.push(`> **PROHIBIDO leer \`session-backup.json\` con \`fs.readFileSync\` en tu bot de producción o reutilizar tokens efímeros capturados.**`);
      lines.push(`> El archivo \`session-backup.json\` es una **muestra forense estática** de la estructura de estado exigida por el portal tras autenticarse.`);
      lines.push(`> `);
      lines.push(`> **Tu flujo de implementación como Agente debe ser:**`);
      lines.push(`> 1. **Identificar el login real:** Busca el endpoint de autenticación en \`api-contracts.json\` (o los selectores del login en \`form-schema.json\`).`);
      lines.push(`> 2. **Construir un \`SessionManager\` dinámico:** Escribe un módulo que obtenga credenciales seguras de variables de entorno (\`process.env.PORTAL_USER\`, \`process.env.PORTAL_PASS\`) y gestione el ciclo de vida del token renovándolo ante errores HTTP 401.`);
      lines.push(`> 3. **Usar estas llaves como molde de hidratación:** Si requieres saltarte la UI e inyectar el estado directamente en un \`BrowserContext\`, usa la lista forense a continuación como el contrato de llaves que tu \`SessionManager\` debe poblar.`);
      lines.push(``);
      lines.push(`### 🧬 Molde de Persistencia Capturado en Auditoría:`);
      lines.push(`- **Cookies Requeridas (${cookieCount}):** ${cookies.map((c) => `\`${c.name}\` (Domain: \`${c.domain}\`, HttpOnly: ${c.httpOnly})`).join(', ') || '*Ninguna*'}`);
      lines.push(`- **Llaves de \`localStorage\` (${localKeys.length}):** ${localKeys.map((k) => `\`${k}\``).join(', ') || '*Ninguna*'}`);
      lines.push(`- **Llaves de \`sessionStorage\` (${sessionKeys.length}):** ${sessionKeys.map((k) => `\`${k}\``).join(', ') || '*Ninguna*'}`);
      lines.push(``);
      lines.push(`**Ejemplo de implementación arquitectónica limpia (\`SessionManager\` dinámico sin leer JSONs estáticos):**`);
      lines.push('```typescript');
      lines.push("import { Browser, BrowserContext } from 'playwright';");
      lines.push('');
      lines.push("export class PortalSessionManager {");
      lines.push("  /**");
      lines.push("   * Autentica dinámicamente y prepara el BrowserContext con las credenciales del entorno.");
      lines.push("   * NUNCA lee archivos JSON estáticos en producción.");
      lines.push("   */");
      lines.push("  public static async createAuthenticatedContext(browser: Browser): Promise<BrowserContext> {");
      lines.push("    const context = await browser.newContext();");
      lines.push("    const username = process.env.PORTAL_USERNAME;");
      lines.push("    const password = process.env.PORTAL_PASSWORD;");
      lines.push("    if (!username || !password) {");
      lines.push("      throw new Error('Credenciales PORTAL_USERNAME y PORTAL_PASSWORD no configuradas en .env');");
      lines.push("    }");
      lines.push('');
      lines.push("    // Opción 1: Autenticación rápida por API (identificada en api-contracts.json)");
      lines.push("    // const loginRes = await context.request.post('https://portal.../api/auth/login', {");
      lines.push("    //   data: { username, password }");
      lines.push("    // });");
      lines.push("    // const { token } = await loginRes.json();");
      lines.push("    // await context.addCookies([{ name: 'AUTH_COOKIE', value: token, domain: '...', path: '/' }]);");
      lines.push('');
      lines.push("    // Opción 2: Autenticación por UI (usando selectores catalogados en form-schema.json)");
      lines.push("    // const page = await context.newPage();");
      lines.push("    // await page.goto('https://portal.../login');");
      lines.push("    // await page.locator('#txtUser').fill(username);");
      lines.push("    // await page.locator('#txtPassword').fill(password);");
      lines.push("    // await page.locator('#btnSubmit').click();");
      lines.push('');
      lines.push("    return context;");
      lines.push("  }");
      lines.push("}");
      lines.push('```');
    } else {
      lines.push(`- No se dispone de volcado previo de sesión.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 4. ATAJOS DE NAVEGACIÓN DIRECTA (ROUTE TRACKER)
    lines.push(`## 🚀 4. Atajos de Navegación Directa (Evitar navegación por menús)`);
    if (data.executionSequence?.routeDirectNavigations && data.executionSequence.routeDirectNavigations.length > 0) {
      lines.push(`El RouteTracker descubrió que las siguientes vistas SPA se pueden abrir directamente con \`page.goto()\`:`);
      lines.push(``);
      lines.push(`| Ruta SPA Detectada | Snippet Playwright Recomendado | Método de Detección |`);
      lines.push(`| :--- | :--- | :--- |`);
      data.executionSequence.routeDirectNavigations.forEach((r) => {
        lines.push(`| \`${r.route}\` | \`${r.recommendedGoto}\` | \`${r.detectedVia}\` |`);
      });
    } else {
      lines.push(`- Navegación estándar mediante la URL base.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 5. DICCIONARIO DE CAMPOS DE FORMULARIO (FORM SCHEMA)
    lines.push(`## 📋 5. Diccionario de Campos de Formulario y Reglas de Negocio`);
    lines.push(`> Utiliza esta tabla para relacionar tus **reglas de negocio** con los campos reales del formulario.`);
    if (data.formSchema && data.formSchema.totalFields > 0) {
      lines.push(`Se catalogaron un total de **${data.formSchema.totalFields} campos interactivos** en **${data.formSchema.totalForms} formulario(s)**:`);
      lines.push(``);

      for (const [formName, fields] of Object.entries(data.formSchema.forms)) {
        lines.push(`### Formulario: \`${formName}\``);
        lines.push(`| Etiqueta Humana | Tipo | Selector Sugerido | Opciones Válidas / Restricciones | Snippet Playwright |`);
        lines.push(`| :--- | :--- | :--- | :--- | :--- |`);

        fields.forEach((f) => {
          let optsOrConstraints = '';
          if (f.options && f.options.length > 0) {
            const sampleOpts = f.options.slice(0, 5).map((o) => `"${o.value}" (${o.text})`).join(', ');
            optsOrConstraints = `**Opciones (${f.options.length}):** ${sampleOpts}${f.options.length > 5 ? '...' : ''}`;
          } else {
            const constraints: string[] = [];
            if (f.required) constraints.push('obligatorio');
            if (f.maxLength) constraints.push(`max: ${f.maxLength}`);
            if (f.pattern) constraints.push(`regex: ${f.pattern}`);
            optsOrConstraints = constraints.join(', ') || 'sin restricciones';
          }

          lines.push(
            `| **${f.label}** | \`${f.type}\` | \`${f.suggestedSelector}\` | ${optsOrConstraints} | \`${f.suggestedSnippet}\` |`
          );
        });
        lines.push(``);
      }
    } else {
      lines.push(`- No se detectaron formularios explícitos en la página evaluada.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 6. ATAJO POR API REST DIRECTA (BYPASS DE UI Y PARAMETRIZACIÓN)
    lines.push(`## 🌐 6. Atajo por API REST Directa (Bypass de Interfaz Gráfica)`);
    if (data.apiContracts && data.apiContracts.totalContractsDiscovered > 0) {
      lines.push(`Se descubrieron **${data.apiContracts.totalContractsDiscovered} endpoints REST** que alimentan los datos del portal.`);
      lines.push(``);
      lines.push(`> 💡 **NOTA DE INGENIERÍA: PARAMETRIZACIÓN Y SEGURIDAD OBLIGATORIA:**`);
      lines.push(`> Todos los valores en querystrings, headers y payloads observados abajo (IDs, consecutivos, fechas de corte, tokens o filtros) son **MUESTRAS FORENSES capturadas durante la auditoría**.`);
      lines.push(`> **PROHIBIDO hardcodear estos IDs o fechas de muestra en tu código.**`);
      lines.push(`> Debes convertir cada endpoint en una función modular y fuertemente tipada (usando interfaces TypeScript / DTOs), parametrizando las variables de negocio y leyendo credenciales o tokens desde \`process.env\`. Los campos sensibles fueron redactados automáticamente.`);
      lines.push(``);

      data.apiContracts.contracts.forEach((ep, idx) => {
        const safeUrl = AgentBriefing.redactUrl(ep.url);
        const safePayload = AgentBriefing.redactPayload(ep.requestPayloadSample);

        lines.push(`### [${idx + 1}] \`${ep.method} ${ep.pathname}\``);
        lines.push(`- **URL Base / Endpoint:** \`${safeUrl}\``);
        lines.push(`- **Latencia observada:** ~${ep.averageLatencyMs} ms`);
        lines.push(`- **Consumo directo parametrizado con Playwright APIRequestContext:**`);
        lines.push('```typescript');
        lines.push("import { APIRequestContext } from 'playwright';");
        lines.push('');
        lines.push(`// DTO para parametrizar las reglas de negocio`);
        lines.push(`export interface ${ep.method === 'GET' ? 'Get' : 'Post'}${idx + 1}QueryParams {`);
        lines.push(`  // Parametriza aquí los filtros reales requeridos por tu caso de uso`);
        lines.push(`  [key: string]: unknown;`);
        lines.push(`}`);
        lines.push('');
        lines.push(`export async function callEndpoint${idx + 1}(request: APIRequestContext, params: ${ep.method === 'GET' ? 'Get' : 'Post'}${idx + 1}QueryParams = {}) {`);
        lines.push(`  const response = await request.${ep.method.toLowerCase()}('${safeUrl}', {`);
        if (ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH') {
          lines.push(`    headers: {`);
          lines.push(`      'Authorization': \`Bearer \${process.env.PORTAL_API_TOKEN}\``);
          lines.push(`    },`);
          lines.push(`    data: {`);
          lines.push(`      // Muestra forense redactada como referencia de estructura:`);
          const payloadFormatted = JSON.stringify(safePayload || {}, null, 6)
            .split('\n')
            .map((line, i) => (i === 0 ? line : `    ${line}`))
            .join('\n');
          lines.push(`      ...${payloadFormatted},`);
          lines.push(`      ...params`);
          lines.push(`    }`);
        } else {
          lines.push(`    headers: {`);
          lines.push(`      'Authorization': \`Bearer \${process.env.PORTAL_API_TOKEN}\``);
          lines.push(`    },`);
          lines.push(`    params: params as Record<string, string>`);
        }
        lines.push(`  });`);
        lines.push(`  return await response.json();`);
        lines.push(`}`);
        lines.push('```');
        lines.push(``);
      });
    } else {
      lines.push(`- No se observaron peticiones XHR/Fetch candidatas para bypass de API.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 7. VENTANAS EMERGENTES / POPUPS
    lines.push(`## 🪟 7. Detección de Ventanas Emergentes (Popups) y Visores`);
    const popups = data.executionSequence?.popupsDetected || [];
    if (popups.length > 0) {
      lines.push(`> ⚠️ **REGLA ARQUITECTÓNICA CRÍTICA: PROHIBIDO NAVEGAR EN FRÍO A POPUPS/VISORES**`);
      lines.push(`> **NUNCA intentes abrir un popup o visor de reportes directamente con \`page.goto(popupUrl)\` en un navegador en blanco.**`);
      lines.push(`> Muchos portales empresariales y visores de documentos (ej. visores PDF como \`viewreport.html\`, JasperReports, Crystal Reports o rutas como \`/DXXRDV\`) **fallan catastróficamente en frío** porque dependen estrictamente de:`);
      lines.push(`> 1. El estado previo almacenado en \`sessionStorage\` o cookies de la ventana padre.`);
      lines.push(`> 2. Una llamada POST/GET preparatoria (observable en \`execution-sequence.json\` y \`api-contracts.json\`) que genera el token o ticket efímero del documento.`);
      lines.push(`> `);
      lines.push(`> **Acción requerida para el Agente:**`);
      lines.push(`> 1. **Revisa \`execution-sequence.json\`:** Reproduce la secuencia cronológica de acciones previas y clics disparadores.`);
      lines.push(`> 2. **Captura concurrente con \`page.waitForEvent('popup')\`:** Dispara el evento siempre en concurrencia con la acción que lo origina para conservar el contexto y estado.`);
      lines.push(``);

      popups.forEach((pop, idx) => {
        const safePopupUrl = AgentBriefing.redactUrl(pop.url);
        lines.push(`### Popup #${idx + 1}: "${pop.title || safePopupUrl}"`);
        lines.push(`- **URL emergente observada:** \`${safePopupUrl}\``);
        lines.push('```typescript');
        lines.push(`// Patrón de intercepción concurrente en ventana padre:`);
        lines.push(`const [popup] = await Promise.all([`);
        lines.push(`  page.waitForEvent('popup', { timeout: 15000 }),`);
        lines.push(`  // Localiza el selector exacto del botón disparador en execution-sequence.json / selectors-map.json:`);
        lines.push(`  page.locator('SELECTOR_DISPARADOR_DEL_REPORTE').click()`);
        lines.push(`]);`);
        lines.push(`await popup.waitForLoadState('domcontentloaded');`);
        lines.push(`// Interactuar con el popup ya hidratado con la sesión padre`);
        lines.push('```');
        lines.push(``);
      });
    } else {
      lines.push(`- No se abrieron popups ni pestañas secundarias durante el flujo auditado.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 8. MATRIZ DE SELECTORES CERTIFICADOS
    lines.push(`## 🎯 8. Matriz de Selectores Certificados (Nivel EXCELLENT y HIGH)`);
    if (data.selectorsMap && data.selectorsMap.totalSelectorsAnalyzed > 0) {
      lines.push(`A continuación los selectores con mayor estabilidad evaluados en la página:`);
      lines.push(``);
      lines.push(`| Elemento / Rol | Nivel de Robustez | Locator Playwright Recomendado |`);
      lines.push(`| :--- | :--- | :--- |`);

      for (const entry of Object.values(data.selectorsMap.selectors)) {
        if (entry.reliabilityTier === 'EXCELLENT' || entry.reliabilityTier === 'HIGH') {
          lines.push(
            `| \`${entry.tagName} ("${entry.elementDescription.slice(0, 30)}")\` | **${entry.reliabilityTier}** (${entry.stabilityScore}/100) | \`${entry.recommendedLocator}\` |`
          );
        }
      }
    } else {
      lines.push(`- Sin selectores adicionales registrados.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generado con 🛡️⚡ scanner-kit-playwright v1.1.0*`);

    return lines.join('\n');
  }

  /**
   * Guarda el archivo prompt-context.md en disco.
   */
  public static savePromptContext(outputPath: string, data: AgentBriefingInput): string {
    const resolvedPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const content = AgentBriefing.generateMarkdown(data);
    fs.writeFileSync(resolvedPath, content, 'utf-8');
    console.log(`[AgentBriefing] 🤖 Briefing para Agente de IA generado en: ${resolvedPath}`);
    return resolvedPath;
  }
}
