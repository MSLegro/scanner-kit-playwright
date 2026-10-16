import * as fs from 'fs';
import * as path from 'path';
import { ScannerKit } from '../scanner-kit';
import { SessionBackup, SessionRefresherOptions } from '../types';

/**
 * Cliente HTTP y Gestor de Sesión Resiliente Anti-401 / Anti-403.
 *
 * En automatizaciones RPA empresariales, los tokens JWT y sesiones de backend
 * suelen expirar o invalidarse durante procesos de larga duración.
 *
 * SessionRefresher envuelve las peticiones a la API y:
 * 1. Inyecta automáticamente el token JWT en las cabeceras (`Authorization: Bearer <token>`).
 * 2. Si detecta un código HTTP 401 (Unauthorized) o 403 (Forbidden):
 *    - Pausa las peticiones concurrentes mediante un mutex/lock de re-login.
 *    - Ejecuta un re-login silencioso en background.
 *    - Actualiza el archivo de respaldo (`session-backup.json` / `storageState.json`).
 *    - Reintenta la petición original de forma transparente para el consumidor.
 */
export class SessionRefresher {
  private currentToken: string | null = null;
  private options: Required<Omit<SessionRefresherOptions, 'baseUrl' | 'initialToken' | 'reloginHandler' | 'onSessionRefreshed'>> & {
    baseUrl?: string;
    reloginHandler?: () => Promise<string>;
    onSessionRefreshed?: (newToken: string) => void | Promise<void>;
  };
  private refreshPromise: Promise<string> | null = null;

  constructor(options: SessionRefresherOptions = {}) {
    this.options = {
      baseUrl: options.baseUrl,
      sessionBackupPath: path.resolve(options.sessionBackupPath || './session-backup.json'),
      tokenExtractor: options.tokenExtractor || SessionRefresher.defaultTokenExtractor,
      reloginHandler: options.reloginHandler,
      maxRetries: options.maxRetries ?? 2,
      retryDelayMs: options.retryDelayMs ?? 500,
      onSessionRefreshed: options.onSessionRefreshed
    };

    if (options.initialToken) {
      this.currentToken = options.initialToken;
    } else {
      this.loadTokenFromSessionFile();
    }
  }

  /**
   * Extrae el token JWT buscando en claves estándar de localStorage o cookies.
   */
  public static defaultTokenExtractor(session: SessionBackup): string | null {
    if (!session) return null;

    // 1. Buscar en localStorage de DG Web o SPAs comunes
    if (session.localStorage) {
      // Caso DG Web: dgsesioninfoNuevaPestana o dgsesioninfo
      for (const [key, rawVal] of Object.entries(session.localStorage)) {
        try {
          const parsed = JSON.parse(rawVal);
          if (parsed?.SessionInfo?.token) return parsed.SessionInfo.token;
          if (parsed?.token) return parsed.token;
          if (parsed?.accessToken) return parsed.accessToken;
          if (parsed?.jwt) return parsed.jwt;
        } catch {
          if (key.toLowerCase().includes('token') && rawVal.startsWith('eyJ')) {
            return rawVal;
          }
        }
      }
    }

    // 2. Buscar en cookies
    if (session.cookies && session.cookies.length > 0) {
      for (const c of session.cookies) {
        const name = c.name.toLowerCase();
        if ((name.includes('token') || name.includes('jwt') || name.includes('auth')) && c.value.length > 20) {
          return c.value;
        }
      }
    }

    return null;
  }

  /**
   * Carga el token más reciente desde el archivo session-backup.json.
   */
  public loadTokenFromSessionFile(): string | null {
    const filePath = this.options.sessionBackupPath;
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(raw) as SessionBackup;
      const extracted = this.options.tokenExtractor(session);
      if (extracted) {
        this.currentToken = extracted;
        return extracted;
      }
    } catch (e) {
      console.warn('[SessionRefresher] No se pudo leer el token del archivo de sesión:', (e as Error).message);
    }
    return null;
  }

  /**
   * Guarda o actualiza el token dentro del archivo session-backup.json.
   */
  public updateSessionFileWithToken(newToken: string): void {
    const filePath = this.options.sessionBackupPath;
    try {
      let sessionData: SessionBackup;
      if (fs.existsSync(filePath)) {
        sessionData = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionBackup;
      } else {
        sessionData = {
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          originUrl: this.options.baseUrl || '',
          cookies: [],
          localStorage: {},
          sessionStorage: {}
        };
      }

      sessionData.timestamp = new Date().toISOString();

      // Si existe dgsesioninfoNuevaPestana, actualizar su token interno
      if (sessionData.localStorage?.dgsesioninfoNuevaPestana) {
        try {
          const parsed = JSON.parse(sessionData.localStorage.dgsesioninfoNuevaPestana);
          if (parsed.SessionInfo) {
            parsed.SessionInfo.token = newToken;
            sessionData.localStorage.dgsesioninfoNuevaPestana = JSON.stringify(parsed);
          }
        } catch {}
      } else {
        if (!sessionData.localStorage) sessionData.localStorage = {};
        sessionData.localStorage.authToken = newToken;
      }

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
      console.log(`[SessionRefresher] Archivo de sesión actualizado con nuevo token en: ${filePath}`);
    } catch (e) {
      console.error('[SessionRefresher] Error guardando sesión actualizada:', (e as Error).message);
    }
  }

  /**
   * Obtiene el token actual o lo recarga del archivo de respaldo.
   */
  public getToken(): string | null {
    if (!this.currentToken) {
      this.loadTokenFromSessionFile();
    }
    return this.currentToken;
  }

  /**
   * Establece manualmente el token en memoria y en disco.
   */
  public setToken(token: string): void {
    this.currentToken = token;
    this.updateSessionFileWithToken(token);
  }

  /**
   * Ejecuta el re-login silencioso con control de concurrencia (Mutex Singleton).
   * Si varias peticiones detectan 401 a la vez, solo un re-login se lanza en paralelo.
   */
  public async refreshSession(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      console.warn('\n[SessionRefresher] 🔄 Iniciando re-login silencioso de sesión en background...');

      if (!this.options.reloginHandler) {
        throw new Error(
          '[SessionRefresher] No se definió un reloginHandler. Configura un callback para reautenticar automáticamente.'
        );
      }

      try {
        const newToken = await this.options.reloginHandler();
        this.currentToken = newToken;
        this.updateSessionFileWithToken(newToken);

        if (this.options.onSessionRefreshed) {
          await this.options.onSessionRefreshed(newToken);
        }

        console.log('[SessionRefresher] ✓ Re-login completado exitosamente. Token renovado.');
        return newToken;
      } catch (error) {
        console.error('[SessionRefresher] ❌ Error durante el re-login silencioso:', error);
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Wrapper inteligente de `fetch` con inyección de Bearer Token y reintento automático Anti-401/403.
   *
   * @param input URL relativa o absoluta.
   * @param init Opciones de fetch de Node.js.
   * @returns Respuesta HTTP nativa.
   */
  public async fetchWithRetry(input: string | URL, init: RequestInit = {}): Promise<globalThis.Response> {
    let targetUrl = input.toString();
    if (this.options.baseUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      const baseClean = this.options.baseUrl.replace(/\/$/, '');
      const pathClean = targetUrl.replace(/^\//, '');
      targetUrl = `${baseClean}/${pathClean}`;
    }

    let attempts = 0;
    const maxRetries = this.options.maxRetries;

    while (attempts <= maxRetries) {
      attempts++;

      // Inyectar Authorization Bearer si tenemos token y no fue provisto manualmente
      const headers = new Headers(init.headers || {});
      const token = this.getToken();
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }

      const requestInit: RequestInit = {
        ...init,
        headers
      };

      try {
        const response = await fetch(targetUrl, requestInit);

        // Si la petición fue exitosa o es un código regular de negocio, retornar
        if (response.status !== 401 && response.status !== 403) {
          return response;
        }

        // Si es 401 o 403 y aún nos quedan reintentos
        if (attempts <= maxRetries) {
          console.warn(
            `\n[SessionRefresher] ⚠️ Código ${response.status} detectado en: ${targetUrl}. Reintento ${attempts}/${maxRetries}...`
          );

          // Ejecutar re-login silencioso
          await this.refreshSession();

          // Breve delay con backoff exponencial
          const delay = this.options.retryDelayMs * attempts;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        return response;
      } catch (err) {
        if (attempts > maxRetries) throw err;
        const delay = this.options.retryDelayMs * attempts;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error(`[SessionRefresher] No se pudo completar la petición tras ${maxRetries} reintentos.`);
  }

  /**
   * Helper estático para crear un `reloginHandler` basado en ScannerKit en modo headless.
   * Automatiza el login UI tradicional sin interfaz gráfica para renovar la sesión en segundo plano.
   */
  public static createHeadlessRelogin(config: {
    loginUrl: string;
    username: string;
    password: string;
    userSelector?: string;
    passSelector?: string;
    submitSelector?: string;
    postLoginUrlRegex?: RegExp;
    sedeConfig?: {
      radioSelector?: string;
      searchSelector?: string;
      code: string;
      continueSelector?: string;
    };
  }): () => Promise<string> {
    return async () => {
      console.log('[SessionRefresher] Lanzando micro-navegador headless para re-login silencioso...');
      const scanner = await ScannerKit.create({
        headless: true,
        turboMode: true,
        evasionMode: true,
        reconMode: false,
        telemetryMode: false
      });

      try {
        const page = scanner.page;
        await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const userSel = config.userSelector || 'input[placeholder="Usuario"]';
        const passSel = config.passSelector || 'input[placeholder="Contraseña"]';
        const submitSel = config.submitSelector || 'dx-button[aria-label="Ingresar"], .dx-button:has-text("Ingresar")';

        await page.locator(userSel).first().fill(config.username);
        await page.locator(passSel).first().fill(config.password);
        await page.locator(submitSel).first().click();

        if (config.postLoginUrlRegex) {
          await page.waitForURL(config.postLoginUrlRegex, { timeout: 20000 });
        } else {
          await page.waitForTimeout(2000);
        }

        if (config.sedeConfig) {
          if (config.sedeConfig.radioSelector) {
            await page.locator(config.sedeConfig.radioSelector).first().click().catch(() => {});
          }
          if (config.sedeConfig.searchSelector) {
            const search = page.locator(config.sedeConfig.searchSelector).first();
            await search.fill(config.sedeConfig.code);
            await page.keyboard.press('Tab');
            await page.waitForTimeout(400);
          }
          if (config.sedeConfig.continueSelector) {
            await page.locator(config.sedeConfig.continueSelector).first().click().catch(() => {});
            await page.waitForTimeout(1500);
          }
        }

        // Exportar la sesión completa y extraer el token
        const session = await scanner.exportSession();
        const token = SessionRefresher.defaultTokenExtractor(session);
        if (!token) {
          throw new Error('[SessionRefresher] No se encontró el token JWT en el storage tras el login.');
        }

        return token;
      } finally {
        await scanner.close();
      }
    };
  }
}
