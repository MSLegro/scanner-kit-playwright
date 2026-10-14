# Guía de Contribución a scanner-kit-playwright 🤝

¡Gracias por tu interés en contribuir a `scanner-kit-playwright`!

Este proyecto tiene como objetivo ser el kit de referencia en automatización RPA e ingeniería inversa web sobre Playwright y TypeScript.

---

## 🛠️ Entorno de Desarrollo

1. Asegúrate de tener instalado:
   - **Node.js** >= 18
   - **pnpm** >= 9 (o npm / yarn)
   - **Chromium** instalado a través de Playwright (`npx playwright install chromium`)

2. Clona el repositorio e instala las dependencias:
   ```bash
   git clone https://github.com/tu-usuario/scanner-kit-playwright.git
   cd scanner-kit-playwright
   pnpm install
   ```

3. Comprueba que el proyecto compila correctamente:
   ```bash
   pnpm build
   ```

4. Ejecuta el escáner de prueba local:
   ```bash
   pnpm scan
   ```

---

## 📐 Estándares de Código

- **TypeScript Estricto:** No utilices `any` innecesarios. Implementa interfaces o tipos descriptivos en `src/types/index.ts`.
- **Preservación de Layout:** Al añadir o modificar reglas de intercepción de red, asegúrate de no bloquear hojas de estilo CSS o scripts necesarios para los selectores `:visible` de Playwright.
- **Manejo de Errores Asíncronos:** Toda llamada de red, evento de frame o timeout debe estar protegido con bloques `try / catch` claros que no dejen promesas huérfanas.
- **Documentación JSDoc:** Añade comentarios explicativos a métodos y módulos detallando el "por qué" técnico de cada interceptor o evasión.

---

## 🚀 Proceso de Pull Request

1. Crea una rama descriptiva para tu cambio:
   ```bash
   git checkout -b feature/mi-nueva-caracteristica
   # o
   git checkout -b fix/solucion-a-bug-x
   ```
2. Realiza tus cambios y verifica la compilación:
   ```bash
   pnpm typecheck
   pnpm build
   ```
3. Realiza commits con mensajes claros siguiendo la convención de [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: nueva capacidad o módulo`
   - `fix: corrección de un bug`
   - `docs: actualización de documentación`
   - `refactor: optimización de código sin cambio de comportamiento`
4. Sube tu rama y abre el Pull Request en GitHub.
