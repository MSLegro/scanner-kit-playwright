import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { BrandGraphicResource, BrandIdentityReport } from '../types';

export interface BrandExtractorOptions {
  /**
   * Si es true, descarga localmente los recursos gráficos primarios (logo, favicon, og-image)
   * a la subcarpeta ./brand-assets/ para uso offline e inserción directa en documentaciones.
   * Por defecto: true.
   */
  downloadAssets?: boolean;

  /**
   * Directorio base donde se exportan los artefactos del target.
   */
  outputDir?: string;
}

/**
 * BrandExtractor - Extractor proactivo de identidad visual y recursos gráficos web.
 *
 * Analiza el DOM del portal para extraer la identidad corporativa completa:
 * - Favicons y Apple Touch Icons.
 * - Logos de cabecera, barras de navegación e isotipos de marca.
 * - Metadatos de identidad (nombre de la app, colores de tema, descripción).
 * - Imágenes de redes sociales (OpenGraph / Twitter Cards).
 *
 * Permite que los Agentes de IA y equipos de automatización generen documentación técnica,
 * manuales de usuario y briefings ejecutivos conservando la identidad gráfica del portal auditado.
 */
export class BrandExtractor {
  private lastReport: BrandIdentityReport | null = null;

  /**
   * Retorna el último reporte de identidad generado.
   */
  public getReport(): BrandIdentityReport | null {
    return this.lastReport;
  }

  /**
   * Inspecciona proactivamente la página activa para extraer todos los recursos de marca e identidad gráfica.
   *
   * @param page Instancia activa de Page en Playwright.
   * @param options Opciones de análisis y descarga de recursos.
   */
  public async analyzePageBrand(
    page: Page,
    options: BrandExtractorOptions = {}
  ): Promise<BrandIdentityReport> {
    const targetUrl = page.url();
    const downloadAssets = options.downloadAssets !== false;
    const outputDir = options.outputDir;

    // 1. Extraer del DOM los metadatos y enlaces de recursos gráficos
    const rawData = await page.evaluate(() => {
      const clean = (s: string | null | undefined): string | undefined => {
        if (!s) return undefined;
        const trimmed = s.replace(/[\r\n\t]+/g, ' ').trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      const toAbs = (urlStr: string | null | undefined): string | null => {
        if (!urlStr) return null;
        try {
          return new URL(urlStr, window.location.href).href;
        } catch {
          return null;
        }
      };

      // A. Metadatos de Marca
      const meta = {
        pageTitle: clean(document.title),
        siteName:
          clean(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) ||
          clean(document.querySelector('meta[name="application-name"]')?.getAttribute('content')) ||
          clean(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')),
        description:
          clean(document.querySelector('meta[name="description"]')?.getAttribute('content')) ||
          clean(document.querySelector('meta[property="og:description"]')?.getAttribute('content')),
        themeColor:
          clean(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')) ||
          clean(document.querySelector('meta[name="msapplication-TileColor"]')?.getAttribute('content')),
        applicationName: clean(document.querySelector('meta[name="application-name"]')?.getAttribute('content'))
      };

      // B. Favicons e Iconos de Aplicación
      const rawIcons: Array<{
        type: 'favicon' | 'apple-touch-icon' | 'shortcut-icon';
        url: string;
        sizes?: string;
        mimeType?: string;
      }> = [];

      const iconLinks = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          'link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]'
        )
      );

      for (const link of iconLinks) {
        const href = link.href || link.getAttribute('href');
        const abs = toAbs(href);
        if (abs) {
          const rel = (link.getAttribute('rel') || '').toLowerCase();
          let iconType: 'favicon' | 'apple-touch-icon' | 'shortcut-icon' = 'favicon';
          if (rel.includes('apple-touch')) {
            iconType = 'apple-touch-icon';
          } else if (rel.includes('shortcut')) {
            iconType = 'shortcut-icon';
          }

          rawIcons.push({
            type: iconType,
            url: abs,
            sizes: clean(link.getAttribute('sizes')),
            mimeType: clean(link.getAttribute('type'))
          });
        }
      }

      // Si no se definió favicon explícito, sugerir el /favicon.ico estándar del dominio
      if (rawIcons.length === 0 && window.location.origin && window.location.origin.startsWith('http')) {
        rawIcons.push({
          type: 'favicon',
          url: `${window.location.origin}/favicon.ico`,
          mimeType: 'image/x-icon'
        });
      }

      // C. Metatags OpenGraph / Redes Sociales
      const rawSocial: Array<{
        type: 'og-image' | 'twitter-image';
        url: string;
      }> = [];

      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
      if (ogImage) {
        const abs = toAbs(ogImage);
        if (abs) rawSocial.push({ type: 'og-image', url: abs });
      }

      const twImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
      if (twImage) {
        const abs = toAbs(twImage);
        if (abs) rawSocial.push({ type: 'twitter-image', url: abs });
      }

      // D. Logos e Identidad en la Interfaz (Headers, Navbars, Branding)
      const rawLogos: Array<{
        type: 'logo' | 'brand-icon' | 'banner';
        url: string;
        alt?: string;
        title?: string;
        dimensions?: { width?: number; height?: number };
        suggestedSelector?: string;
        inHeaderOrNav: boolean;
        hasLogoKeyword: boolean;
        score: number;
      }> = [];

      const candidateImages = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          'header img, nav img, [class*="nav"] img, [class*="header"] img, [id*="header"] img, [class*="brand"] img, [id*="brand"] img, [class*="logo"] img, [id*="logo"] img, a[href="/"] img, a[href="#"] img, img'
        )
      );

      const seenUrls = new Set<string>();

      for (const img of candidateImages) {
        const src = img.currentSrc || img.src || img.getAttribute('src');
        const abs = toAbs(src);
        if (!abs || seenUrls.has(abs)) continue;

        // Descartar tracking pixels invisibles de 1x1
        const w = img.naturalWidth || img.width || img.clientWidth || undefined;
        const h = img.naturalHeight || img.height || img.clientHeight || undefined;
        if (w === 1 && h === 1) continue;

        const alt = clean(img.getAttribute('alt'));
        const title = clean(img.getAttribute('title'));
        const id = (img.id || '').toLowerCase();
        const cls = (typeof img.className === 'string' ? img.className : '').toLowerCase();
        const srcLower = abs.toLowerCase();

        const inHeaderOrNav = !!img.closest(
          'header, nav, [class*="header"], [class*="brand"], [class*="navbar"], a[href="/"]'
        );
        const hasLogoKeyword =
          srcLower.includes('logo') ||
          srcLower.includes('brand') ||
          id.includes('logo') ||
          id.includes('brand') ||
          cls.includes('logo') ||
          cls.includes('brand') ||
          (alt ? /logo|marca|emblema|brand/i.test(alt) : false);

        // Si es visible en header/nav o tiene palabra clave de logo/brand
        if (inHeaderOrNav || hasLogoKeyword) {
          seenUrls.add(abs);

          // Puntuación heurística para identificar el Logo Principal
          let score = 0;
          if (hasLogoKeyword) score += 50;
          if (inHeaderOrNav) score += 40;
          if (alt) score += 10;
          if (w && w >= 60 && w <= 400) score += 15; // Tamaño típico de logo web

          // Generar selector sugerido para Playwright
          let suggestedSelector: string;
          if (img.id) {
            suggestedSelector = `page.locator('#${img.id}')`;
          } else if (alt) {
            suggestedSelector = `page.getByAltText('${alt}')`;
          } else if (img.closest('header')) {
            suggestedSelector = `page.locator('header img')`;
          } else if (cls) {
            const firstClass = cls.split(' ').find((c) => c.includes('logo') || c.includes('brand')) || cls.split(' ')[0];
            suggestedSelector = `page.locator('img.${firstClass}')`;
          } else {
            const urlPath = new URL(abs).pathname;
            const filename = urlPath.split('/').pop() || 'logo';
            suggestedSelector = `page.locator('img[src*="${filename}"]')`;
          }

          rawLogos.push({
            type: hasLogoKeyword ? 'logo' : 'brand-icon',
            url: abs,
            alt,
            title,
            dimensions: w || h ? { width: w, height: h } : undefined,
            suggestedSelector,
            inHeaderOrNav,
            hasLogoKeyword,
            score
          });
        }
      }

      return { meta, rawIcons, rawSocial, rawLogos };
    });

    // 2. Ordenar logos por puntuación de relevancia para seleccionar el Logo Principal
    const sortedLogos = [...rawData.rawLogos].sort((a, b) => b.score - a.score);

    const resources: BrandGraphicResource[] = [];
    const seenFaviconUrls = new Set<string>();
    const seenLogoUrls = new Set<string>();
    const seenSocialUrls = new Set<string>();

    // Agregar Favicons
    for (let i = 0; i < rawData.rawIcons.length; i++) {
      const item = rawData.rawIcons[i];
      if (!seenFaviconUrls.has(item.url)) {
        seenFaviconUrls.add(item.url);
        resources.push({
          id: `favicon-${i + 1}`,
          type: item.type,
          url: item.url,
          mimeType: item.mimeType,
          isDataUrl: item.url.startsWith('data:')
        });
      }
    }

    // Agregar Logos (no bloqueados por favicon)
    for (let i = 0; i < sortedLogos.length; i++) {
      const item = sortedLogos[i];
      if (!seenLogoUrls.has(item.url)) {
        seenLogoUrls.add(item.url);
        resources.push({
          id: `logo-${i + 1}`,
          type: item.type,
          url: item.url,
          alt: item.alt,
          title: item.title,
          dimensions: item.dimensions,
          suggestedSelector: item.suggestedSelector,
          isDataUrl: item.url.startsWith('data:')
        });
      }
    }

    // Agregar Redes Sociales (OpenGraph)
    for (let i = 0; i < rawData.rawSocial.length; i++) {
      const item = rawData.rawSocial[i];
      if (!seenSocialUrls.has(item.url)) {
        seenSocialUrls.add(item.url);
        resources.push({
          id: `social-${i + 1}`,
          type: item.type,
          url: item.url,
          isDataUrl: item.url.startsWith('data:')
        });
      }
    }

    const primaryLogo = resources.find((r) => r.type === 'logo') || resources.find((r) => r.type === 'brand-icon');
    const primaryFavicon = resources.find((r) => r.type === 'favicon') || resources.find((r) => r.type === 'apple-touch-icon');

    // 3. Descarga local opcional de recursos clave (en ./brand-assets/)
    if (downloadAssets && outputDir) {
      const brandAssetsDir = path.join(outputDir, 'brand-assets');
      try {
        if (!fs.existsSync(brandAssetsDir)) {
          fs.mkdirSync(brandAssetsDir, { recursive: true });
        }

        // Descargar los recursos más relevantes (favicon principal, logo principal, y hasta 3 extras)
        const assetsToDownload = resources
          .filter((r) => r.id.startsWith('logo-') || r.id.startsWith('favicon-') || r.id.startsWith('social-'))
          .slice(0, 6);

        for (const asset of assetsToDownload) {
          try {
            const downloadedPath = await this.downloadResource(page, asset.url, asset.id, brandAssetsDir);
            if (downloadedPath) {
              asset.localPath = path.relative(outputDir, downloadedPath).replace(/\\/g, '/');
            }
          } catch {
            // Ignorar fallos de descarga individuales sin abortar
          }
        }
      } catch (err) {
        console.warn('[BrandExtractor] Advertencia al crear carpeta de assets de marca:', (err as Error).message);
      }
    }

    const report: BrandIdentityReport = {
      targetUrl,
      timestamp: new Date().toISOString(),
      meta: rawData.meta,
      primaryLogo,
      primaryFavicon,
      resources,
      totalResources: resources.length
    };

    this.lastReport = report;
    return report;
  }

  /**
   * Descarga un recurso gráfico a disco respetando la sesión del navegador o data URLs.
   */
  private async downloadResource(
    page: Page,
    url: string,
    id: string,
    destDir: string
  ): Promise<string | null> {
    // 1. Manejo de data URLs (base64)
    if (url.startsWith('data:image/')) {
      const matches = url.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1].replace('svg+xml', 'svg');
        const buffer = Buffer.from(matches[2], 'base64');
        const filePath = path.join(destDir, `${id}.${ext}`);
        fs.writeFileSync(filePath, buffer);
        return filePath;
      }
      return null;
    }

    // 2. Manejo de URLs HTTP/HTTPS mediante el contexto de red autenticado de Playwright
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const response = await page.request.get(url, { timeout: 6000 });
        if (response.ok()) {
          const buffer = await response.body();
          let ext = path.extname(new URL(url).pathname);
          if (!ext || ext.length > 5) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('svg')) ext = '.svg';
            else if (contentType.includes('png')) ext = '.png';
            else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg';
            else if (contentType.includes('webp')) ext = '.webp';
            else if (contentType.includes('icon') || contentType.includes('ico')) ext = '.ico';
            else ext = '.png';
          }

          const filePath = path.join(destDir, `${id}${ext}`);
          fs.writeFileSync(filePath, buffer);
          return filePath;
        }
      } catch {
        // Fallback si la petición HTTP falla o tiene timeout
        return null;
      }
    }

    return null;
  }

  /**
   * Guarda el informe de identidad en formato JSON en disco.
   *
   * @param outputPath Ruta destino para brand-identity.json.
   * @param report Estructura del reporte a guardar.
   */
  public saveBrandReport(outputPath: string, report: BrandIdentityReport): void {
    const resolvedPath = path.resolve(outputPath);
    const targetDir = path.dirname(resolvedPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[BrandExtractor] Identidad de marca y recursos gráficos guardados en: ${resolvedPath}`);
  }
}
