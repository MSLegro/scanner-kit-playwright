<div align="center">

# 🛡️⚡ scanner-kit-playwright

**Universal Web Reconnaissance, Reverse Engineering & RPA Blueprint Engine for Playwright & TypeScript**

*CLI autónomo y agnóstico para auditoría e ingeniería inversa de portales corporativos complejos. Genera planos técnicos (blueprints) estructurados para crear bots RPA rápidos, precisos y desacoplados.*

[![CI](https://github.com/MSLegro/scanner-kit-playwright/actions/workflows/ci.yml/badge.svg)](https://github.com/MSLegro/scanner-kit-playwright/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v1.1.0-blue?logo=github)](https://github.com/MSLegro/scanner-kit-playwright/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.49+-orange.svg)](https://playwright.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 📖 Filosofía y Propósito

El propósito de **`scanner-kit-playwright`** no es servir de runtime para ejecutar bots, sino ser una **herramienta autónoma de profiling e ingeniería inversa**. Su función es observar cómo un humano interactúa con un portal web y **generar automáticamente el plano técnico (Blueprint)** con todo lo necesario para automatizarlo:

- **100% Desacoplado y Listo para Agentes de IA:** Genera un briefing ejecutivo (`prompt-context.md`) diseñado específicamente para que un modelo de lenguaje o Agente de Programación (Cursor, Claude, Antigravity, Copilot) ensamble el bot Playwright aplicando tus reglas de negocio sin alucinaciones ni inventar selectores.
- **Mapeo Proactivo de Formularios (`form-schema.json`):** Cataloga inputs, áreas de texto y diccionarios completos de opciones en `<select>` (`[{ value, text }]`) con sus `<label>` humanos asociados.
- **Rastreo Multi-Pestaña y Popups:** Intercepta `context.on('page')` y `page.on('popup')` generando snippets con `page.waitForEvent('popup')`.
- **Observador Pasivo Sigiloso (Stealth Anti-WAF):** Utiliza Google Chrome oficial con huella TLS genuina, sin bloquear imágenes ni alterar prototipos nativos (`addEventListener`), permitiendo superar **Cloudflare Turnstile, DataDome, Imperva y captchas** de forma natural.
- **Finalización Cómoda sin Pérdida de Datos:** Puedes explorar libremente y, al terminar, **simplemente cierras la ventana con la `[X]` del ratón** (o presionas `[ENTER]`). El escáner preserva cookies `HttpOnly`, `localStorage` y `sessionStorage` automáticamente.

---

## 🚀 Configuración y Uso Rápido (En Casa o en el Trabajo) 🏆

### Método Recomendado: Enlace Global en Vivo (`npm link`)

La forma más rápida y cómoda de tener el comando `scanner-kit` disponible en cualquier terminal de tu PC (tanto en el trabajo como en tu casa) sin fricción:

```bash
# 1. Compilar el proyecto (genera dist/ y asigna permisos ejecutables automáticamente)
pnpm build

# 2. Vincular el comando globalmente al sistema (solo una vez por equipo)
npm link
```

> 💡 **¿Por qué `npm link`?**  
> Crea un acceso directo en vivo entre tu código local y tu sistema operativo. Si en el futuro agregas nuevas funciones o mejoras un módulo y corres `pnpm build`, **tu comando global `scanner-kit` se actualiza al instante sin tener que reinstalar nada**.

#### 🔄 Sincronización entre varios dispositivos (Casa ↔ Trabajo)
Cuando mejores el escáner en un equipo y quieras usarlo en el otro:
```bash
# En el PC donde hiciste los cambios:
git commit -am "feat: nueva capacidad" && git push

# En tu otro PC:
git pull && pnpm build
# ¡Listo! Tu comando scanner-kit ya tiene las últimas mejoras en esa máquina.
```

---

### Uso del CLI en Cualquier Terminal y Carpeta

Una vez enlazado, puedes usar el comando rápido **`sk`** (o `scanner-kit`) en cualquier terminal y proyecto:

```bash
# Iniciar escaneo visual directo con el alias rápido 'sk'
sk --u=https://portal.nuevaeps.com.co/Portal/home.jspx

# Con subcarpeta o categoría de clasificación para el blueprint
sk --u=https://portal.nuevaeps.com.co/Portal/home.jspx -c autorizaciones

# Ver todas las opciones y ayuda
sk --help
```

---

### Método Alternativo: Instalación desde Release (.tgz)

Si estás en una máquina donde no quieres clonar el código fuente, descarga el archivo `scanner-kit-playwright-*.tgz` desde la pestaña [Releases](https://github.com/MSLegro/scanner-kit-playwright/releases) de tu repositorio y ejecuta:

```bash
npm install -g ./scanner-kit-playwright-1.1.0.tgz
```

---

### Opción 3: Script Alias en el `package.json` de tu Bot

En el proyecto donde estés programando tu bot RPA, puedes añadir en su `package.json`:

```json
"scripts": {
  "blueprint": "pnpm dlx github:MSLegro/scanner-kit-playwright"
}
```

Y correr directamente:
```bash
pnpm blueprint --u=https://portal.nuevaeps.com.co/Portal/home.jspx
```

---

## 📁 El Resultado: Carpeta `blueprint/` (8 Artefactos)

Al terminar tu exploración y cerrar la ventana con la **`[X]`** o presionar **`[ENTER]`**, se genera automáticamente la carpeta `./blueprint/<target>/[categoria]/` con **8 archivos de ingeniería inversa**:

```text
mi-nuevo-bot/
├── package.json
└── blueprint/
    └── portal.nuevaeps.com.co/
        ├── prompt-context.md          # 🤖 Briefing ejecutivo en Markdown para Agentes de IA
        ├── form-schema.json           # 📋 Esquema de formularios y diccionario de opciones <select>
        ├── accessibility-tree.json    # ♿ Árbol de accesibilidad y roles ARIA nativos
        ├── execution-sequence.json    # ⏱️ Acciones cronológicas, popups y atajos directos page.goto()
        ├── selectors-map.json         # 🎯 Matriz de estabilidad de locators (EXCELLENT a FRAGILE)
        ├── api-contracts.json         # 🌐 Contratos XHR/Fetch con payloads y esquemas JSON tipados
        ├── recon-report.json          # 🛡️ Diagnóstico de WAFs, potencial de ahorro Turbo y red
        └── session-backup.json        # 🔑 Respaldo de cookies HttpOnly, localStorage y sessionStorage
```

---

## 🤖 Cómo Usar el Blueprint para Crear Bots con tu Agente de IA

El archivo **`prompt-context.md`** está redactado y formateado como una orden de trabajo lista para que se la pegues directamente a tu Agente de IA (Cursor, Claude, Antigravity, ChatGPT, Copilot). 

El archivo ya le explica al agente:
1. Las precauciones anti-bot a tomar.
2. Cómo saltarse menús lentos usando las rutas descubiertas (`page.goto`).
3. El diccionario exacto de opciones para selects y campos de formulario.
4. Cómo hacer bypass de la interfaz usando llamadas REST directas (`page.request.post()`).
5. Los selectores Playwright con fiabilidad `HIGH` y `EXCELLENT`.

En tu proyecto final, solo instalas Playwright nativo:

```bash
pnpm add -D @playwright/test
```

Y programas tu bot utilizando la inteligencia descubierta en los JSONs:

```typescript
import { test } from '@playwright/test';
import * as fs from 'fs';

test('Extracción Directa sin Tocar la Interfaz', async ({ page }) => {
  // 1. Cargar las cookies descubiertas en session-backup.json
  const session = JSON.parse(fs.readFileSync('./blueprint/portal.nuevaeps.com.co/session-backup.json', 'utf8'));
  await page.context().addCookies(session.cookies);

  // 2. Extraer sessionId y consumir directamente la API JSON descubierta en api-contracts.json
  // ¡Sin hacer clics en calendarios ni scraping de tablas lentas!
  const response = await page.request.post('https://portal.nuevaeps.com.co/report_portal/v1/api/autorizaciones/reporteAutorizacinesXIPS', {
    data: { page: 1, itemsPerPage: 100, filter: '' }
  });

  const autorizaciones = await response.json();
  console.log('Autorizaciones extraídas en 200ms:', autorizaciones);
});
```

---

## 🛠️ Referencia del CLI

```text
Uso:
  scanner-kit [opciones]
  scanner-kit scan [opciones]

Opciones principales:
  -u, --url <url>                URL objetivo a auditar (ej. https://portal.com/home)
                                 (Acepta alias: --u=..., -u=..., --url=..., o URL directa)
  -c, --category <nombre>        Subcarpeta para clasificar el blueprint
                                 (Acepta alias: -c=..., --cat=..., --category=...)
  -o, --out, --blueprint <ruta>  Directorio base de salida
                                 (Por defecto: ./blueprint en el directorio actual)
  --headless                     Ejecutar sin ventana visual (servidores / CI)
  --headed                       Forzar ventana visual interactiva
  --slowmo <ms>                  Pausa visual en ms entre acciones (por defecto: 0)

Opciones de optimización activa (para pruebas):
  --active-turbo                 Fuerza el bloqueo de recursos (imágenes/fuentes/trackers)
  --active-evasion               Fuerza neutralización de window.print() y diálogos UI

Información y ayuda:
  -h, --help                     Muestra este manual de ayuda y opciones
  -v, --version                  Muestra la versión instalada de scanner-kit
```

---

## 🔄 Integración Continua & Releases

El repositorio cuenta con dos workflows automatizados de **GitHub Actions**:
- **CI (`.github/workflows/ci.yml`):** En cada `push` o `PR` a `main`, verifica los tipos TypeScript (`pnpm typecheck`), compila (`pnpm build`) y corre la suite completa de pruebas E2E con Playwright (`pnpm verify`).
- **Release (`.github/workflows/release.yml`):** Al hacer push de un tag de versión (`git tag v1.1.0 && git push origin v1.1.0`), genera automáticamente un **GitHub Release oficial** empaquetando el tarball precompilado listo para consumo global.

---

## 🔒 Privacidad y Seguridad

El archivo [`.gitignore`](.gitignore) bloquea estrictamente la subida de:
- `blueprint/` y `output/` (sesiones, cookies, tokens de autenticación o datos de negocio).
- `.env` y `.env.*` (credenciales o configuraciones locales).

---

## 📄 Licencia

Distribuido bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para más detalles.
