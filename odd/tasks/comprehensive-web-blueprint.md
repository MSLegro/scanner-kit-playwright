# ODD Task: Plano Integral de Reconocimiento Web Avanzado (5 Capacidades)

- **Objetivo:** Dotar a ScannerKit de las 5 capacidades maestras de radiografía web para que el blueprint capture el 100% de la verdad técnica de cualquier portal web (SPAs modernas y sistemas legacy ERP/JSF/ASP.NET).
- **Alcance de las 5 Capacidades:**
  1. *Action-to-Network Causal Linker:* Vincular en cada acción de usuario (`UserActionRecord`) las peticiones XHR/Fetch/Descargas disparadas causalmente en su ventana de reacción.
  2. *Token Lineage & Provenance Tracker:* Rastrear de dónde nacen los tokens y credenciales (body JSON previo, header Set-Cookie o storage) para que el bot conozca la cadena de autenticación.
  3. *Download, Binary & Blob Sniffer:* Interceptar eventos `download`, respuestas binarias (PDF, Excel, Zip), blobs en memoria (`URL.createObjectURL`) y base64 embebido (`JVBERi0...`).
  4. *Legacy Server State Analyzer (JSF/ASP.NET):* Detectar tokens de estado del servidor (`javax.faces.ViewState`, `__VIEWSTATE`, `Faces-Request`) y documentar la receta de consumo híbrido.
  5. *GraphQL Disaggregator & WebSocket/SSE Inspector:* Desagregar `/graphql` por `operationName` y auditar conexiones y mensajes de `page.on('websocket')`.
- **Test Runner:** `pnpm run verify` + `pnpm run typecheck` + `pnpm run build`

## Specs
- **S1 (Causal Linker):** Cada `UserActionRecord` en `execution-sequence.json` debe contener `triggeredRequests` con método, url, status y latencia de las peticiones HTTP disparadas tras la acción.
- **S2 (Token Lineage):** `ReconEngine` debe identificar el origen (`provenance`) de cada token detectado en headers/requests, cruzándolo con respuestas HTTP previas o cookies de sesión.
- **S3 (Download & Stream Sniffer):** Capturar descargas de archivos (`page.on('download')`), respuestas binarias (PDF, XLSX) y blobs en `URL.createObjectURL`, catalogándolos con receta para guardado en disco desde Node.js.
- **S4 (Legacy State Analyzer):** Identificar en `recon-report.json` si la aplicación usa `ViewState` (JSF o ASP.NET) u otros tokens ocultos en formularios, indicando el patrón de extracción con regex desde el HTML.
- **S5 (GraphQL & WebSocket):** Desagregar contratos GraphQL por `operationName` en `api-contracts.json` y registrar canales/mensajes de WebSocket observados en vivo.
- **S6 (Prompt Context & Blueprint):** Documentar todas las capacidades en `prompt-context.md` y exportar los nuevos datos en los artefactos correspondientes.

## Tasks
- [x] **T1:** Extender tipos e interfaces en `src/types/index.ts` (contratos causales, linaje de tokens, descargas binarias, estado JSF/ASP.NET, GraphQL y WebSockets). [inline]
- [x] **T2:** Implementar Causal Linker, GraphQL Disaggregator y WebSocket/Blob sniffer en `src/modules/telemetry-extractor.ts`. [inline]
- [x] **T3:** Implementar Token Lineage Tracker y Legacy State Analyzer (JSF/ASP.NET) en `src/modules/recon-engine.ts`. [inline]
- [x] **T4:** Integrar el sniffer de descargas nativas (`page.on('download')`) y orquestación en `src/scanner-kit.ts`, y enriquecer el briefing en `src/modules/agent-briefing.ts` y CLI en `src/cli.ts`. [inline]
- [x] **T5:** Extender `src/examples/test-server.ts` con descargas, ViewState JSF, GraphQL y WebSocket, y actualizar `src/examples/verify-suite.ts` para verificar todas las capacidades (RED -> GREEN). [inline]

## Log
- **L1:** Solicitud del usuario para implementar las 5 capacidades maestras de radiografía web integral.
- **L2:** Completadas T1, T2, T3, T4 y T5. Verificación verde (GREEN):
  - `pnpm run typecheck`: Exited 0 limpio (tsc --noEmit sin errores).
  - `pnpm run verify`: Exited 0 limpio con validaciones en suite:
    - Action-to-Network Causal Linker: 1 petición vinculada a btn-fetch-invoices (`/api/v1/invoices`).
    - Download & Binary Sniffer: `factura_enero_2026.pdf` (`application/pdf`) y `downloads/downloads-manifest.json` en disco.
    - GraphQL Disaggregator: `POST http://localhost:3987/api/graphql [GetFinancialSummary]` (query).
    - Token Lineage & Provenance: `authorization` provino de `/api/auth/login` (`response_body`).
    - Legacy Server State: `JSF (JavaServer Faces)` con campo `javax.faces.ViewState` y regex para DOM.
  - `pnpm run build`: Compilación exitosa de todos los artefactos a `dist/`.
