# ODD Task: Captura de DOM Completo por Acción (dom-snapshots)

- **Objetivo:** Guardar un snapshot completo y limpio del DOM por cada acción ejecutada en `dom-snapshots/`, vinculándolo en `execution-sequence.json` y `prompt-context.md`.
- **Estrategia:** Serializador sigiloso en `TelemetryExtractor` sin mutar DOM real, redactando contraseñas, excluyendo scripts/estilos, integrando iframes same-origin y marcando el nodo interactuado con `data-sk-action-target="true"`.
- **Test Runner:** `pnpm run verify` + `pnpm run typecheck`

## Specs
- **S1:** "que por cada accion que se haga se tome un captura de todo el DOM, asi se tiene contexto completo"
- **S2:** DOM limpio para IA: sin scripts, estilos, SVGs gigantes ni base64, pero con estructura completa, valores de inputs e iframes same-origin.
- **S3:** Archivos guardados de manera determinista en `dom-snapshots/step-XXX-<action>-<slug>.html` y referenciados en `execution-sequence.json` vía `domSnapshotFile`.

## Tasks
- [x] **T1:** Extender tipos e interfaces en `src/types/index.ts` (`domSnapshotsMode`, `domSnapshotsDir`, `domSnapshotFile`, `totalDomSnapshotsSaved`). [inline]
- [x] **T2:** Implementar serializador de DOM limpio y guardado de snapshots en `src/modules/telemetry-extractor.ts`. [inline]
- [x] **T3:** Integrar opciones y exportación en `src/scanner-kit.ts` y reporte en `src/modules/agent-briefing.ts` y `src/cli.ts`. [inline]
- [x] **T4:** Actualizar `src/examples/verify-suite.ts` y validar ejecución completa (RED -> GREEN). [inline]

## Log
- **L1:** Requerimiento inicial verbatim: "que por cada accion que se haga se tome un captura de todo el DOM, asi se tiene contexto completo".
- **L2:** Implementado serializador limpio para IA (sin scripts/estilos/base64, con estados de inputs e iframes same-origin, y atributo `data-sk-action-target="true"`).
- **L3:** Pruebas automatizadas `pnpm run verify`, `pnpm run typecheck` y `pnpm run build` ejecutadas exitosamente (100% GREEN).
