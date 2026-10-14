import { Frame, Locator, Page } from 'playwright';
import { MultiFrameElementResult } from '../types';

export interface FindFrameOptions {
  /**
   * Tiempo máximo en milisegundos para intentar localizar el elemento.
   * Por defecto: 5000 ms.
   */
  timeout?: number;

  /**
   * Si es true, exige que el elemento sea visible además de existir en el DOM.
   * Por defecto: true.
   */
  requireVisible?: boolean;

  /**
   * Intervalo de reintento en milisegundos durante la búsqueda en frames activos.
   * Por defecto: 250 ms.
   */
  pollingIntervalMs?: number;
}

/**
 * Explorador inteligente para arquitecturas pesadas con iframes anidados.
 *
 * En sistemas ERP tradicionales (como SAP WebGUI, Oracle PeopleSoft o Salesforce Classic),
 * la interfaz de usuario se fragmenta en múltiples niveles de iframes. Los métodos estándares
 * de automatización fallan silenciosamente al buscar en el DOM raíz.
 *
 * Este módulo recorre recursivamente el árbol de frames activos y devuelve el Locator
 * contextualizado en el frame exacto de ejecución.
 */
export class FrameExplorer {
  /**
   * Rastrea un elemento por selector tanto en el DOM principal como dentro de cualquier iframe anidado.
   *
   * @param page Instancia de la página activa de Playwright.
   * @param selector Selector CSS, XPath o selector de Playwright (ej. text=, role=, id=).
   * @param options Opciones de búsqueda y timeouts.
   * @returns MultiFrameElementResult con el Locator posicionado en el marco exacto.
   * @throws Error si el elemento no se localiza en ningún frame antes del timeout.
   */
  public static async findElementAcrossFrames(
    page: Page,
    selector: string,
    options?: FindFrameOptions
  ): Promise<MultiFrameElementResult> {
    const timeout = options?.timeout ?? 5000;
    const requireVisible = options?.requireVisible ?? true;
    const pollingInterval = options?.pollingIntervalMs ?? 250;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // 1. Intentar primero en el contexto de la página principal (DOM raíz)
      try {
        const rootLocator = page.locator(selector).first();
        const rootCount = await rootLocator.count();
        if (rootCount > 0) {
          if (!requireVisible || (await rootLocator.isVisible())) {
            return {
              locator: rootLocator,
              frame: page,
              frameName: 'main-frame',
              frameUrl: page.url(),
              isInIframe: false
            };
          }
        }
      } catch {
        // En caso de que el frame raíz esté en navegación momentánea, continuamos
      }

      // 2. Iterar sobre todos los iframes anidados registrados en el contexto
      const allFrames = page.frames();
      for (const frame of allFrames) {
        // Omitir el mainFrame porque ya fue evaluado arriba
        if (frame === page.mainFrame()) {
          continue;
        }

        // Evitar frames destruidos o desanclados
        if (frame.isDetached()) {
          continue;
        }

        try {
          const frameLocator = frame.locator(selector).first();
          const frameCount = await frameLocator.count();

          if (frameCount > 0) {
            if (!requireVisible || (await frameLocator.isVisible())) {
              return {
                locator: frameLocator,
                frame: frame,
                frameName: frame.name() || 'anonymous-iframe',
                frameUrl: frame.url(),
                isInIframe: true
              };
            }
          }
        } catch {
          // Ignorar frames que puedan haber cambiado de contexto durante la iteración
          continue;
        }
      }

      // Esperar brevemente antes del siguiente ciclo de sondeo
      await page.waitForTimeout(pollingInterval);
    }

    throw new Error(
      `[FrameExplorer] Elemento con selector "${selector}" no fue encontrado en el DOM principal ni en ninguno de los ${page.frames().length} iframes activos tras ${timeout}ms.`
    );
  }

  /**
   * Devuelve un resumen de todos los frames activos y sus URLs (útil para reconocimiento y debugging).
   */
  public static listActiveFrames(page: Page): Array<{ name: string; url: string; isDetached: boolean }> {
    return page.frames().map((f) => ({
      name: f.name() || '(sin nombre)',
      url: f.url(),
      isDetached: f.isDetached()
    }));
  }
}
