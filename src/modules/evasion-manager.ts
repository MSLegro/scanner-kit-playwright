import { BrowserContext, Dialog, Page } from 'playwright';

export interface EvasionOptions {
  /**
   * Acción por defecto ante diálogos nativos del navegador ('dismiss' | 'accept').
   * Por defecto: 'dismiss'.
   */
  dialogAction?: 'dismiss' | 'accept';

  /**
   * Respuesta personalizada a devolver en diálogos de tipo prompt.
   */
  promptText?: string;
}

/**
 * Gestor de Evasión de UI y Neutralización de Bloqueos Nativos.
 *
 * Resuelve problemas clásicos en portales corporativos y ERPs:
 * 1. window.print(): Muy común en facturación y reportes; si no se anula, congela
 *    el renderizador de Chromium esperando la interacción del usuario.
 * 2. beforeunload / onbeforeunload: Trampas de salida ("¿Está seguro de abandonar la página?")
 *    que impiden redirecciones programáticas y cierres de sesión limpios.
 * 3. alert(), confirm(), prompt(): Diálogos nativos que pausan la ejecución de JavaScript en el navegador.
 */
export class EvasionManager {
  private dialogAction: 'dismiss' | 'accept';
  private promptText: string;

  constructor(options?: EvasionOptions) {
    this.dialogAction = options?.dialogAction ?? 'dismiss';
    this.promptText = options?.promptText ?? '';
  }

  /**
   * Inyecta scripts de inicialización en el contexto del navegador.
   * Se ejecuta ANTES de cualquier script de la página destino en todos los frames y pestañas.
   */
  public async applyToContext(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      try {
        // 1. Neutralización de window.print()
        // Reemplazamos la función nativa por un mock silencioso que registra la llamada sin bloquear
        Object.defineProperty(window, 'print', {
          value: () => {
            console.debug('[ScannerKit Evasion] window.print() neutralizado exitosamente.');
          },
          configurable: true,
          writable: true
        });

        // 2. Anulación de trampas beforeunload directas
        Object.defineProperty(window, 'onbeforeunload', {
          get: () => null,
          set: () => {
            console.debug('[ScannerKit Evasion] Intento de asignación a window.onbeforeunload interceptado.');
          },
          configurable: true
        });

        // 3. Neutralización de escuchadores de eventos beforeunload mediante addEventListener
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions
        ) {
          if (type.toLowerCase() === 'beforeunload') {
            console.debug('[ScannerKit Evasion] EventListener beforeunload neutralizado.');
            return;
          }
          return originalAddEventListener.call(this, type, listener, options);
        };
      } catch (err) {
        console.warn('[ScannerKit Evasion] Error aplicando initScript de evasión:', err);
      }
    });
  }

  /**
   * Registra controladores automáticos en la instancia de Page para resolver diálogos nativos.
   */
  public attachToPage(page: Page): void {
    page.on('dialog', async (dialog: Dialog) => {
      try {
        const dialogType = dialog.type();
        const dialogMessage = dialog.message();

        console.debug(
          `[ScannerKit Evasion] Diálogo interceptado: tipo="${dialogType}", mensaje="${dialogMessage}". Acción: ${this.dialogAction}`
        );

        if (this.dialogAction === 'accept') {
          await dialog.accept(dialogType === 'prompt' ? this.promptText : undefined);
        } else {
          await dialog.dismiss();
        }
      } catch (err) {
        // Si el diálogo ya fue cerrado o la página navegó, evitamos excepciones huérfanas
        console.warn('[ScannerKit Evasion] No se pudo resolver diálogo nativo:', err);
      }
    });
  }
}
