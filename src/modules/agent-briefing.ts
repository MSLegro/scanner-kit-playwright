import * as fs from 'fs';
import * as path from 'path';
import {
  ApiContractsReport,
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
}

/**
 * Generador del Briefing Ejecutivo para Agentes de IA (prompt-context.md).
 *
 * Consolida toda la inteligencia técnica descubierta por los motores de ScannerKit
 * en un único documento Markdown estructurado y optimizado para ser consumido
 * como contexto de entrada (prompt) por modelos de lenguaje y agentes de programación
 * (Claude, Cursor, Copilot, Antigravity, etc.).
 *
 * Su propósito es eliminar las alucinaciones del agente, proveyéndole:
 * - El diccionario exacto de campos y opciones de formularios para aplicar reglas de negocio.
 * - Atajos directos por URL y API REST para evitar navegación lenta.
 * - Advertencias de WAFs, iframes y ventanas emergentes (popups).
 * - Snippets de código Playwright listos para ensamblar.
 */
export class AgentBriefing {
  /**
   * Genera el contenido Markdown estructurado del briefing para el agente.
   */
  public static generateMarkdown(data: AgentBriefingInput): string {
    const lines: string[] = [];

    lines.push(`# 🤖 Briefing Técnico para Agente de IA: Automatización RPA`);
    lines.push(`> Este documento fue generado automáticamente por **scanner-kit-playwright** tras auditar el portal objetivo.`);
    lines.push(`> Contiene la verdad técnica del sistema web (selectores certificados, endpoints, esquemas de formularios y sesión) para que programes el bot en Playwright nativo aplicando las reglas de negocio sin alucinaciones.`);
    lines.push(``);
    lines.push(`- **Target URL:** \`${data.targetUrl}\``);
    lines.push(`- **Directorio del Blueprint:** \`${data.outputDirectory}\``);
    lines.push(`- **Fecha de Auditoría:** ${new Date().toLocaleString()}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 1. ESTRATEGIA ANTI-BOT Y EJECUCIÓN
    lines.push(`## 🛡️ 1. Diagnóstico Anti-Bot y Recomendaciones de Ejecución`);
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

    // 2. SESIÓN Y BYPASS DE LOGIN
    lines.push(`## 🔑 2. Estado de Sesión y Autenticación (Bypass de Login)`);
    if (data.sessionBackup) {
      const cookieCount = data.sessionBackup.cookies?.length || 0;
      const localKeys = Object.keys(data.sessionBackup.localStorage || {}).length;
      const sessionKeys = Object.keys(data.sessionBackup.sessionStorage || {}).length;

      lines.push(`El escáner capturó la sesión activa en \`session-backup.json\` (**${cookieCount} cookies**, **${localKeys} llaves de localStorage**, **${sessionKeys} de sessionStorage**).`);
      lines.push(``);
      lines.push(`**Cómo precargar la sesión en tu bot Playwright para saltarte el login:**`);
      lines.push('```typescript');
      lines.push("import * as fs from 'fs';");
      lines.push('');
      lines.push("// Cargar cookies en el BrowserContext antes de navegar");
      lines.push("const session = JSON.parse(fs.readFileSync('./session-backup.json', 'utf-8'));");
      lines.push("await context.addCookies(session.cookies);");
      lines.push('');
      lines.push("// Si el portal utiliza tokens en localStorage, inyéctalos en page.addInitScript:");
      lines.push("await page.addInitScript((storage) => {");
      lines.push("  for (const [k, v] of Object.entries(storage.local)) {");
      lines.push("    localStorage.setItem(k, v);");
      lines.push("  }");
      lines.push("}, { local: session.localStorage });");
      lines.push('```');
    } else {
      lines.push(`- No se dispone de volcado previo de sesión.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 3. ATAJOS DE NAVEGACIÓN DIRECTA (ROUTE TRACKER)
    lines.push(`## 🚀 3. Atajos de Navegación Directa (Evitar navegación por menús)`);
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

    // 4. DICCIONARIO DE CAMPOS DE FORMULARIO (FORM SCHEMA)
    lines.push(`## 📋 4. Diccionario de Campos de Formulario y Reglas de Negocio`);
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

    // 5. ATAJO POR API REST DIRECTA (BYPASS DE UI)
    lines.push(`## 🌐 5. Atajo por API REST Directa (Bypass de Interfaz Gráfica)`);
    if (data.apiContracts && data.apiContracts.totalContractsDiscovered > 0) {
      lines.push(`Se descubrieron **${data.apiContracts.totalContractsDiscovered} endpoints REST** que alimentan los datos del portal.`);
      lines.push(`Si tu regla de negocio solo requiere consultar o descargar datos, **puedes llamar directamente a estos endpoints sin tocar la UI**:`);
      lines.push(``);

      data.apiContracts.contracts.forEach((ep, idx) => {
        lines.push(`### [${idx + 1}] \`${ep.method} ${ep.pathname}\``);
        lines.push(`- **URL Completa:** \`${ep.url}\``);
        lines.push(`- **Latencia observada:** ~${ep.averageLatencyMs} ms`);
        lines.push(`- **Consumo directo con Playwright APIRequestContext:**`);
        lines.push('```typescript');
        lines.push(`const response = await page.request.${ep.method.toLowerCase()}('${ep.url}', {`);
        if (ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH') {
          lines.push(`  data: ${JSON.stringify(ep.requestPayloadSample || {}, null, 2)}`);
        }
        lines.push(`});`);
        lines.push(`const data = await response.json();`);
        lines.push('```');
        lines.push(``);
      });
    } else {
      lines.push(`- No se observaron peticiones XHR/Fetch candidatas para bypass de API.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 6. VENTANAS EMERGENTES / POPUPS
    lines.push(`## 🪟 6. Detección de Ventanas Emergentes (Popups)`);
    const popups = data.executionSequence?.popupsDetected || [];
    if (popups.length > 0) {
      lines.push(`> ⚠️ **Atención Agente:** Se detectaron **${popups.length} ventanas emergentes** abiertas durante la sesión.`);
      lines.push(`Debes usar el patrón \`page.waitForEvent('popup')\` concurrentemente con el clic disparador:`);
      lines.push(``);
      popups.forEach((pop, idx) => {
        lines.push(`### Popup #${idx + 1}: "${pop.title || pop.url}"`);
        lines.push(`- **URL emergente:** \`${pop.url}\``);
        lines.push('```typescript');
        lines.push(`const [popup] = await Promise.all([`);
        lines.push(`  page.waitForEvent('popup'),`);
        lines.push(`  page.locator('SELECTOR_QUE_DISPARA_EL_POPUP').click()`);
        lines.push(`]);`);
        lines.push(`await popup.waitForLoadState('domcontentloaded');`);
        lines.push('```');
        lines.push(``);
      });
    } else {
      lines.push(`- No se abrieron popups ni pestañas secundarias durante el flujo auditado.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // 7. MATRIZ DE SELECTORES CERTIFICADOS
    lines.push(`## 🎯 7. Matriz de Selectores Certificados (Nivel EXCELLENT y HIGH)`);
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
