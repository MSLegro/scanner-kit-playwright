import { Locator, Page, Response } from 'playwright';
import { ClickAndSpyOptions, SpyResult } from '../types';

/**
 * El Espía de Botones Híbrido (ApiSpy).
 *
 * En arquitecturas empresariales modernas (SPAs, React, Angular, Vue, SAP Fiori),
 * hacer un clic en un botón (ej. "Consultar Factura", "Generar Saldo", "Exportar")
 * dispara inmediatamente una petición XHR o Fetch hacia el backend.
 *
 * En lugar de raspar el DOM visual mediante selectores frágiles propensos a cambios de CSS,
 * ApiSpy intercepta la respuesta en el canal de red de forma reactiva y concurrente,
 * capturando la estructura pura JSON antes de que la interfaz la transforme.
 */
export class ApiSpy {
  /**
   * Ejecuta el clic sobre el elemento objetivo y captura en paralelo la respuesta HTTP correspondiente.
   *
   * @param page Instancia de la página de Playwright.
   * @param target Locator o selector CSS del elemento sobre el cual hacer clic.
   * @param options Opciones de filtrado, método HTTP, predicate y timeouts.
   * @returns Estructura SpyResult con los datos JSON, código HTTP, cabeceras y métricas de latencia.
   */
  public static async clickAndSpyApi<T = unknown>(
    page: Page,
    target: Locator | string,
    options?: ClickAndSpyOptions
  ): Promise<SpyResult<T>> {
    const timeout = options?.timeout ?? 15000;
    const methodFilter = options?.method?.toUpperCase();
    const startTime = Date.now();

    // Obtener el locator correspondiente
    const locator = typeof target === 'string' ? page.locator(target).first() : target;

    // Predicado para identificar la respuesta correcta
    const responsePredicate = async (response: Response): Promise<boolean> => {
      // 1. Filtrar por método HTTP si se indicó
      if (methodFilter && response.request().method().toUpperCase() !== methodFilter) {
        return false;
      }

      const resUrl = response.url();

      // 2. Filtrar por patrón de URL si se indicó
      if (options?.urlPattern) {
        if (typeof options.urlPattern === 'string') {
          if (!resUrl.includes(options.urlPattern)) {
            return false;
          }
        } else if (options.urlPattern instanceof RegExp) {
          if (!options.urlPattern.test(resUrl)) {
            return false;
          }
        } else if (typeof options.urlPattern === 'function') {
          try {
            const parsedUrl = new URL(resUrl);
            if (!options.urlPattern(parsedUrl)) {
              return false;
            }
          } catch {
            return false;
          }
        }
      }

      // 3. Filtrar por tipo de recurso (debe ser XHR o Fetch para llamadas API)
      const resourceType = response.request().resourceType();
      const isApiCall = resourceType === 'fetch' || resourceType === 'xhr';

      // 4. Ejecutar predicado personalizado si fue provisto
      if (options?.predicate) {
        try {
          return await options.predicate(response);
        } catch {
          return false;
        }
      }

      // Por defecto, si no hay patrón específico, consideramos cualquier fetch/xhr con status < 400
      return isApiCall;
    };

    try {
      // Ejecución concurrente y reactiva:
      // Esperamos la respuesta MIENTRAS se produce el clic para no perder eventos efímeros
      const [response] = await Promise.all([
        page.waitForResponse(responsePredicate, { timeout }),
        locator.click(options?.clickOptions)
      ]);

      const endTime = Date.now();
      const timingMs = endTime - startTime;

      const status = response.status();
      const headers = response.headers();
      const url = response.url();
      const method = response.request().method();

      // Intentar extraer el payload en formato JSON
      let data: T;
      const textBody = await response.text();

      try {
        data = JSON.parse(textBody) as T;
      } catch (parseError) {
        throw new Error(
          `[ApiSpy] La respuesta desde ${url} (Status: ${status}) no es un JSON válido. Contenido recibido:\n${textBody.slice(0, 500)}`
        );
      }

      return {
        data,
        status,
        headers,
        url,
        method,
        timingMs
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[ApiSpy] Falló clickAndSpyApi: ${errorMessage}. ` +
          `(Timeout configurado: ${timeout}ms, URL Pattern: ${options?.urlPattern ?? 'auto-detect'})`
      );
    }
  }
}
