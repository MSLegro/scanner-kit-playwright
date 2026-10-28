# ODD Task: Static Surface & API Bypass Miner (Bundle & Report Schema Mining)

- **Objetivo:** Minar estáticamente bundles JS y plantillas de reportes post-sesión para descubrir endpoints no ejecutados, servicios satélites y esquemas de reportes, exportando `discovered-api-surface.json` y la sección de bypass API-First en `prompt-context.md`.
- **Estrategia:** Recolección asíncrona de scripts y plantillas en vivo (cero impacto de latencia), seguida de análisis estático post-sesión cruzando endpoints latentes contra tráfico en vivo y correlacionando DataSources de reportes.
- **Test Runner:** `pnpm run verify` + `pnpm run typecheck`

## Specs
- **S1:** Registrar archivos JavaScript cargados (`app*.js`, `main*.js`, `bundle*.js`, `chunk-*.js`) y analizar su contenido en memoria post-sesión con regex y tokens.
- **S2:** Extraer endpoints relativos y absolutos (`/api/`, `/v1/`, `/reports/`, `/documents/`, `/service/`, `/results/`).
- **S3:** Detectar URLs base satélites o puertos distintos al origin del navegador (ej. `:5004`, `:8080`, `https://api.*`) con rol inferido.
- **S4:** Clasificar endpoints de alto valor: `PDF_COMPILATION` (render/pdf/print/generar/download), `EXPORT` (excel/xlsx/csv/export), `DOCUMENTS` (attachment/document/file/upload), y cruzar si fueron ejecutados en vivo o están latentes en código.
- **S5:** Sniffer de plantillas de reporte (`.mrt`, `.repx`, `.jasper`): extraer `DataSources` (tablas y columnas) y cruzarlos contra endpoints descubiertos.
- **S6:** Generar artefacto `discovered-api-surface.json` y la sección `## 🎯 Oportunidades de Bypass API-First Detectadas` en `prompt-context.md`.
- **S7:** No bloquear ni ralentizar la captura en vivo. Omitir archivo si no hay scripts grandes ni endpoints adicionales. Pruebas unitarias/E2E sobre bundle y plantilla de muestra.

## Tasks
- [x] **T1:** Extender tipos en `src/types/index.ts` (`DiscoveredApiSurfaceReport`, `SatelliteService`, `HighValueEndpoint`, `ReportTemplateDefinition`, `staticSurfaceMining`, `discoveredApiSurfaceFile`). [inline]
- [x] **T2:** Implementar módulo `src/modules/static-surface-miner.ts` (recolección pasiva, scanner de endpoints/satélites, parser de plantillas Stimulsoft/DevExpress/Jasper y correlación). [inline]
- [x] **T3:** Integrar `StaticSurfaceMiner` en `src/scanner-kit.ts`, `src/modules/agent-briefing.ts` y `src/cli.ts`. [inline]
- [x] **T4:** Extender `src/examples/test-server.ts` con bundle JS y plantilla `.mrt`, y añadir validaciones en `src/examples/verify-suite.ts` (RED -> GREEN). [inline]

## Log
- **L1:** Aprobado plan de implementación de Static Surface & API Bypass Miner.
- **L2:** Implementados tipos, `StaticSurfaceMiner`, sección en `AgentBriefing`, exportación en `ScannerKit` y CLI.
- **L3:** Pruebas E2E y unitarias en `src/examples/verify-suite.ts` ejecutadas exitosamente (100% GREEN).
- **L4:** Compilación de producción `pnpm run build` y `pnpm run typecheck` completadas con éxito.
