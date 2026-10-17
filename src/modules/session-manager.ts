import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, Page } from 'playwright';
import { SessionBackup } from '../types';

/**
 * Gestor y Exportador de Sesión Completa.
 *
 * En sistemas ERP y portales bancarios o gubernamentales, la sesión del usuario
 * no se almacena exclusivamente en cookies: los tokens JWT y UUIDs de estado
 * frecuentemente residen en localStorage o sessionStorage.
 *
 * SessionManager consolida las 3 capas de persistencia en una sola estructura unificada
 * lista para respaldar o restaurar el estado de autenticación.
 */
export class SessionManager {
  /**
   * Cache en memoria del último almacenamiento local y de sesión válido por página.
   * Permite recuperar los datos íntegros incluso si el usuario cierra la ventana con la [X] del ratón.
   */
  private static _storageCache = new WeakMap<Page, { local: Record<string, string>; session: Record<string, string> }>();

  /**
   * Vincula escuchadores a la página para mantener actualizado el snapshot en memoria
   * de localStorage y sessionStorage de forma reactiva y sin bloquear la navegación.
   *
   * @param page Instancia de la página activa.
   */
  public static trackPageStorage(page: Page): void {
    const updateSnapshot = async () => {
      if (page.isClosed()) return;
      try {
        const snapshot = await page.evaluate(() => {
          const getStorageData = (storage: Storage): Record<string, string> => {
            const result: Record<string, string> = {};
            try {
              for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key !== null) {
                  result[key] = storage.getItem(key) ?? '';
                }
              }
            } catch {}
            return result;
          };
          return {
            local: getStorageData(window.localStorage),
            session: getStorageData(window.sessionStorage)
          };
        });
        SessionManager._storageCache.set(page, snapshot);
      } catch {}
    };

    page.on('framenavigated', () => {
      // Actualizar snapshot de storage al cambiar o cargar una vista
      setTimeout(updateSnapshot, 200);
    });

    page.on('load', () => {
      setTimeout(updateSnapshot, 300);
    });

    // Snapshot inicial
    setTimeout(updateSnapshot, 500);
  }

  /**
   * Extrae cookies, localStorage y sessionStorage de la página actual y opcionalmente
   * guarda el volcado en un archivo JSON en disco.
   *
   * @param page Instancia de la página activa.
   * @param outputPath Ruta opcional de destino para el archivo .json.
   * @returns Estructura SessionBackup con los datos extraídos.
   */
  public static async exportSession(page: Page, outputPath?: string): Promise<SessionBackup> {
    const context = page.context();

    // 1. Extracción de Cookies desde el BrowserContext (permanece vivo aún si la pestaña cerró)
    const rawCookies = await context.cookies();
    const cookies: SessionBackup['cookies'] = rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as 'Strict' | 'Lax' | 'None'
    }));

    // 2. Extracción de localStorage y sessionStorage
    // Si la página sigue abierta, intenta tomar un snapshot en caliente; si ya se cerró, usa la caché en memoria.
    const cached = SessionManager._storageCache.get(page) || { local: {}, session: {} };
    let storageSnapshot = { ...cached };

    if (!page.isClosed()) {
      try {
        const fresh = await page.evaluate(() => {
          const getStorageData = (storage: Storage): Record<string, string> => {
            const result: Record<string, string> = {};
            try {
              for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key !== null) {
                  result[key] = storage.getItem(key) ?? '';
                }
              }
            } catch {}
            return result;
          };

          return {
            local: getStorageData(window.localStorage),
            session: getStorageData(window.sessionStorage)
          };
        });
        storageSnapshot = fresh;
        SessionManager._storageCache.set(page, fresh);
      } catch {}
    }

    const sessionData: SessionBackup = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      originUrl: page.url(),
      cookies,
      localStorage: storageSnapshot.local,
      sessionStorage: storageSnapshot.session
    };

    // 3. Persistir en disco si se proporcionó una ruta
    if (outputPath) {
      const resolvedPath = path.resolve(outputPath);
      const targetDir = path.dirname(resolvedPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      console.log(`[SessionManager] Sesión exportada exitosamente a: ${resolvedPath}`);
    }

    return sessionData;
  }

  /**
   * Restaura cookies y almacena datos en localStorage y sessionStorage
   * para reanudar una sesión previamente respaldada.
   *
   * @param page Página activa en la cual inyectar la sesión.
   * @param sessionInput Ruta del archivo JSON o el objeto SessionBackup en memoria.
   */
  public static async restoreSession(page: Page, sessionInput: string | SessionBackup): Promise<void> {
    let sessionData: SessionBackup;

    if (typeof sessionInput === 'string') {
      const resolvedPath = path.resolve(sessionInput);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`[SessionManager] Archivo de sesión no encontrado en: ${resolvedPath}`);
      }
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      sessionData = JSON.parse(raw) as SessionBackup;
    } else {
      sessionData = sessionInput;
    }

    const context = page.context();

    // 1. Restaurar Cookies en el contexto
    if (sessionData.cookies && sessionData.cookies.length > 0) {
      await context.addCookies(sessionData.cookies);
    }

    // 2. Inyectar localStorage y sessionStorage
    await page.evaluate((data) => {
      if (data.localStorage) {
        for (const [key, value] of Object.entries(data.localStorage)) {
          window.localStorage.setItem(key, value);
        }
      }
      if (data.sessionStorage) {
        for (const [key, value] of Object.entries(data.sessionStorage)) {
          window.sessionStorage.setItem(key, value);
        }
      }
    }, sessionData);

    console.log(`[SessionManager] Sesión restaurada exitosamente para ${sessionData.originUrl}`);
  }
}
