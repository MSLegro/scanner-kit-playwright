import * as http from 'http';

/**
 * Servidor HTTP local ligero para emular de forma determinista y offline
 * un portal ERP corporativo con:
 * - iframes anidados
 * - Endpoints REST con tokens de autorización (Bearer, CSRF)
 * - Trampas de navegación (window.print, beforeunload, alert)
 * - Cookies, localStorage y sessionStorage
 */
export class TestServer {
  private server: http.Server | null = null;
  private port: number;

  constructor(port = 3456) {
    this.port = port;
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

        // 1. Endpoint REST de prueba con respuesta JSON
        if (url.pathname === '/api/v1/invoices') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Custom-Server-Time': new Date().toISOString()
          });
          res.end(
            JSON.stringify({
              status: 'success',
              company: 'ERP Global Corporation',
              fiscalYear: 2026,
              records: [
                { id: 'INV-1001', amount: 12500.5, currency: 'USD', status: 'PAID' },
                { id: 'INV-1002', amount: 8400.0, currency: 'EUR', status: 'PENDING' },
                { id: 'INV-1003', amount: 32000.0, currency: 'USD', status: 'APPROVED' }
              ]
            })
          );
          return;
        }

        // 2. Contenido dentro del iframe anidado
        if (url.pathname === '/nested-frame') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html lang="es">
            <head><meta charset="utf-8"><title>ERP Iframe</title></head>
            <body style="background: #eef2f5; font-family: sans-serif; padding: 20px;">
              <h3>Módulo Anidado en iframe: Contabilidad</h3>
              <p>Este contenido reside dentro de un &lt;iframe&gt;.</p>
              <button id="iframe-action-btn" class="btn-action">Ejecutar Acción Interna en Iframe</button>
              <div id="iframe-result" style="margin-top: 10px; font-weight: bold; color: green;"></div>
              <script>
                document.getElementById('iframe-action-btn').addEventListener('click', () => {
                  document.getElementById('iframe-result').innerText = 'Acción procesada dentro del iframe!';
                });
              </script>
            </body>
            </html>
          `);
          return;
        }

        // 3. Página principal del portal ERP simulado
        if (url.pathname === '/' || url.pathname === '/portal') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Set-Cookie': ['session_erp_id=erp-auth-session-token-9988; Path=/; HttpOnly; SameSite=Lax']
          });
          res.end(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
              <meta charset="utf-8">
              <title>Portal ERP Corporativo - Simulación</title>
              <style>
                body { font-family: system-ui, sans-serif; margin: 30px; background-color: #f7f9fc; }
                .card { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
                button { background: #0066cc; color: white; border: none; padding: 10px 18px; border-radius: 4px; cursor: pointer; font-size: 14px; }
                button:hover { background: #0052a3; }
                iframe { width: 100%; height: 180px; border: 2px dashed #99aab5; border-radius: 6px; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>Sistema ERP Corporativo - Módulo de Tesorería</h1>
                <p>Simulación para pruebas de ingeniería inversa y automatización con ScannerKit.</p>

                <!-- Imagen pesada para prueba de Modo Turbo -->
                <img src="/heavy-banner.jpg" alt="Banner que será bloqueado por TurboMode" style="max-height: 40px; display: block; margin-bottom: 15px;" />

                <!-- Botón de consulta que dispara API con cabeceras de autorización -->
                <button id="btn-fetch-invoices">Consultar Facturas del Backend (API XHR)</button>
                <div id="api-output" style="margin-top: 15px; font-family: monospace; background: #eee; padding: 10px; display: none;"></div>
              </div>

              <!-- Iframe anidado para prueba de búsqueda multi-frame -->
              <div class="card">
                <h2>Submódulo Empresarial (Iframe)</h2>
                <iframe name="accounting-frame" src="/nested-frame"></iframe>
              </div>

              <script>
                // Simular datos de autenticación en localStorage y sessionStorage
                localStorage.setItem('erp_user_profile', JSON.stringify({ username: 'admin_audit', role: 'FINANCIAL_DIRECTOR' }));
                localStorage.setItem('erp_active_tenant', 'corp-latam-01');
                sessionStorage.setItem('temp_signing_key', 'session-temp-key-secret-999');

                // Trampas de salida y modales que ScannerKit debe neutralizar
                window.onbeforeunload = function() {
                  return "¿Desea salir de la aplicación ERP?";
                };
                window.addEventListener('beforeunload', function(e) {
                  e.returnValue = "No salga sin guardar";
                });

                // Clic del botón que consume el API de backend
                document.getElementById('btn-fetch-invoices').addEventListener('click', async () => {
                  try {
                    // Intento de llamar a window.print() (debe ser neutralizado sin bloquear)
                    window.print();

                    const response = await fetch('/api/v1/invoices?filter=fiscal_2026', {
                      method: 'GET',
                      headers: {
                        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.corp_secret_token_erp',
                        'X-CSRF-Token': 'csrf-token-corp-super-secure-456789',
                        'X-Client-App': 'ERP-Web-Scanner'
                      }
                    });
                    const json = await response.json();
                    const output = document.getElementById('api-output');
                    output.style.display = 'block';
                    output.innerText = JSON.stringify(json, null, 2);
                  } catch (e) {
                    console.error('Error fetching invoices:', e);
                  }
                });
              </script>
            </body>
            </html>
          `);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });

      this.server.listen(this.port, () => {
        resolve(`http://localhost:${this.port}`);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
