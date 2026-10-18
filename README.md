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

- **100% Desacoplado:** Tus proyectos RPA finales se programan con **Playwright nativo** (o cualquier lenguaje/herramienta) leyendo los archivos JSON del blueprint, sin acoplarse a esta librería.
- **Observador Pasivo Sigiloso (Stealth Anti-WAF):** Utiliza Google Chrome oficial con huella TLS genuina, sin bloquear imágenes ni alterar prototipos nativos (`addEventListener`), permitiendo superar **Cloudflare Turnstile, DataDome, Imperva y captchas** de forma natural.
- **Finalización Cómoda sin Pérdida de Datos:** Puedes explorar libremente y, al terminar, **simplemente cierras la ventana con la `[X]` del ratón** (o presionas `[ENTER]`). El escáner preserva cookies `HttpOnly`, `localStorage` y `sessionStorage` automáticamente.

---

## 🚀 Uso Rápido en Cualquier PC (Comandos Ultracortos)

### Opción 1: Instalación Global en la Máquina (Recomendado) 🏆

Instala el CLI globalmente **una única vez**:

```bash
pnpm add -g github:MSLegro/scanner-kit-playwright
# o: npm install -g github:MSLegro/scanner-kit-playwright
```

A partir de ese momento, en **cualquier terminal y dentro de la carpeta de cualquier proyecto**:

```bash
# Comando ultracorto (inicia el profiling visual inmediatamente)
scanner-kit --u=https://portal.nuevaeps.com.co/Portal/home.jspx

# Con subcarpeta o categoría de clasificación
scanner-kit --u=https://portal.nuevaeps.com.co/Portal/home.jspx -c autorizaciones

# Ver opciones y ayuda
scanner-kit --help
```

---

### Opción 2: Sin Instalar Nada (Vía `pnpm dlx` / `npx`)

En cualquier PC con Node.js, ejecuta directamente en la terminal de tu bot:

```bash
pnpm dlx github:MSLegro/scanner-kit-playwright --u=https://portal.nuevaeps.com.co/Portal/home.jspx
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

## 📁 El Resultado: Carpeta `blueprint/`

Al terminar tu exploración y cerrar la ventana con la **`[X]`** o presionar **`[ENTER]`**, se genera automáticamente la carpeta `./blueprint/` en la raíz de donde ejecutaste el comando:

```text
mi-nuevo-bot/
├── package.json
└── blueprint/
    └── portal.nuevaeps.com.co/
        ├── recon-report.json       # WAFs detectados, potencial de ahorro Turbo y radiografía de red
        ├── api-contracts.json      # Contratos XHR/Fetch con payloads y esquemas JSON tipados
        ├── selectors-map.json      # Matriz de estabilidad de locators (EXCELLENT a FRAGILE)
        ├── execution-sequence.json # Paso a paso cronológico y sugerencias de rutas page.goto()
        └── session-backup.json     # Respaldo unificado de cookies HttpOnly, localStorage y sessionStorage
```

---

## 🤖 Cómo Usar el Blueprint en tu Bot Final (Cero Acoplamiento)

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
