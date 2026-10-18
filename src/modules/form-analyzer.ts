import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { FormFieldSchema, FormSchemaReport } from '../types';

/**
 * Analizador y extractor proactivo de esquemas de formularios web.
 *
 * En portales empresariales y sistemas ERP, los formularios contienen decenas de campos
 * con reglas de negocio implícitas (restricciones de longitud, campos obligatorios,
 * formatos de fecha y desplegables con claves específicas del backend).
 *
 * FormAnalyzer realiza un barrido proactivo de todos los formularios y controles de la página
 * (hayan sido tocados o no por el usuario) y genera un diccionario estructurado listo
 * para que un Agente de IA conozca los nombres humanos, tipos y opciones válidas sin alucinar.
 */
export class FormAnalyzer {
  private lastReport: FormSchemaReport | null = null;

  /**
   * Inspecciona proactivamente todos los formularios y campos interactivos presentes en la página.
   *
   * @param page Instancia de la página de Playwright activa.
   */
  public async analyzePageForms(page: Page): Promise<FormSchemaReport> {
    const targetUrl = page.url();

    const rawResult = await page.evaluate(() => {
      const formsRecord: Record<string, FormFieldSchema[]> = {};

      const cleanText = (str: string | null | undefined): string => {
        if (!str) return '';
        return str
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/[:*]+$/, '')
          .trim();
      };

      const resolveLabel = (el: HTMLElement): string => {
        // 1. Etiqueta vinculada explícita por id: <label for="id">
        if (el.id) {
          try {
            const explicitLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (explicitLabel && explicitLabel.textContent) {
              const cleaned = cleanText(explicitLabel.textContent);
              if (cleaned) return cleaned;
            }
          } catch {}
        }

        // 2. Elemento envuelto dentro de un <label>
        const parentLabel = el.closest('label');
        if (parentLabel && parentLabel.textContent) {
          const cleaned = cleanText(parentLabel.textContent);
          if (cleaned) return cleaned;
        }

        // 3. Atributo aria-label o aria-labelledby
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && cleanText(ariaLabel)) {
          return cleanText(ariaLabel);
        }

        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        if (ariaLabelledBy) {
          try {
            const labelledEl = document.getElementById(ariaLabelledBy);
            if (labelledEl && labelledEl.textContent) {
              const cleaned = cleanText(labelledEl.textContent);
              if (cleaned) return cleaned;
            }
          } catch {}
        }

        // 4. Placeholder
        const placeholder = el.getAttribute('placeholder');
        if (placeholder && cleanText(placeholder)) {
          return cleanText(placeholder);
        }

        // 5. Hermano anterior o contenedor padre con texto descriptivo
        let prev = el.previousElementSibling;
        while (prev) {
          if (
            ['label', 'span', 'p', 'strong', 'b', 'th', 'td', 'div'].includes(
              prev.tagName.toLowerCase()
            )
          ) {
            const txt = cleanText(prev.textContent);
            if (txt && txt.length < 60) return txt;
          }
          prev = prev.previousElementSibling;
        }

        // 6. Fallback basado en name o id
        const nameAttr = el.getAttribute('name');
        if (nameAttr) return nameAttr;
        if (el.id) return el.id;

        return 'Campo sin etiqueta';
      };

      const buildSelector = (el: HTMLElement, label: string): { selector: string; snippetTemplate: string } => {
        const tag = el.tagName.toLowerCase();
        const typeAttr = el.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'text');
        const id = el.id && !el.id.match(/\d{5,}/) ? el.id : null;
        const name = el.getAttribute('name');
        const dataTestId =
          el.getAttribute('data-testid') ||
          el.getAttribute('data-cy') ||
          el.getAttribute('data-test');

        let selector = '';

        if (id) {
          selector = `#${id}`;
        } else if (dataTestId) {
          selector = `[data-testid="${dataTestId}"]`;
        } else if (name) {
          selector = `${tag}[name="${name}"]`;
        } else {
          selector = tag;
          if (typeAttr && tag === 'input') {
            selector += `[type="${typeAttr}"]`;
          }
        }

        let snippetTemplate = '';
        if (tag === 'select') {
          snippetTemplate = `await page.selectOption('${selector}', 'VALOR_AQUI');`;
        } else if (typeAttr === 'checkbox') {
          snippetTemplate = `await page.check('${selector}');`;
        } else if (typeAttr === 'radio') {
          snippetTemplate = `await page.check('${selector}');`;
        } else if (typeAttr === 'date') {
          snippetTemplate = `await page.fill('${selector}', 'YYYY-MM-DD');`;
        } else {
          snippetTemplate = `await page.fill('${selector}', 'VALOR_AQUI');`;
        }

        return { selector, snippetTemplate };
      };

      // Buscar todos los formularios
      const formElements = Array.from(document.querySelectorAll('form'));
      const processedInputs = new Set<HTMLElement>();

      const processField = (el: HTMLElement, formName: string) => {
        processedInputs.add(el);
        const tag = el.tagName.toLowerCase() as 'input' | 'select' | 'textarea';
        const type = el.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'text');

        // Ignorar botones o inputs de envío en el diccionario de datos
        if (['submit', 'button', 'reset', 'image'].includes(type)) return;

        const label = resolveLabel(el);
        const { selector, snippetTemplate } = buildSelector(el, label);

        const field: FormFieldSchema = {
          label,
          formName,
          tag,
          type,
          fieldId: el.id || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
          disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
          readOnly: el.hasAttribute('readonly'),
          suggestedSelector: selector,
          suggestedSnippet: snippetTemplate
        };

        const maxLengthAttr = el.getAttribute('maxlength');
        if (maxLengthAttr) {
          const parsed = parseInt(maxLengthAttr, 10);
          if (!isNaN(parsed) && parsed > 0) field.maxLength = parsed;
        }

        const patternAttr = el.getAttribute('pattern');
        if (patternAttr) {
          field.pattern = patternAttr;
        }

        // Si es un <select>, extraer todas sus opciones íntegras
        if (el instanceof HTMLSelectElement) {
          const optionsList = Array.from(el.options).map((opt) => ({
            value: opt.value,
            text: cleanText(opt.text),
            selected: opt.selected
          }));
          field.options = optionsList;

          // Si hay opciones, colocar una de muestra en el snippet sugerido
          const sampleOption = optionsList.find((o) => o.value !== '' && o.value !== '-1') || optionsList[0];
          if (sampleOption) {
            field.suggestedSnippet = `await page.selectOption('${selector}', '${sampleOption.value}'); // "${sampleOption.text}"`;
          }
        }

        if (!formsRecord[formName]) {
          formsRecord[formName] = [];
        }
        formsRecord[formName].push(field);
      };

      // 1. Procesar campos dentro de formularios <form>
      formElements.forEach((form, idx) => {
        const formName =
          form.getAttribute('id') ||
          form.getAttribute('name') ||
          form.getAttribute('aria-label') ||
          `formulario_${idx + 1}`;

        const inputs = Array.from(form.querySelectorAll<HTMLElement>('input, select, textarea'));
        inputs.forEach((input) => processField(input, formName));
      });

      // 2. Procesar controles independientes que no estén dentro de un <form> (comunes en SPAs modernas)
      const standaloneInputs = Array.from(
        document.querySelectorAll<HTMLElement>('input, select, textarea')
      ).filter((el) => !processedInputs.has(el));

      standaloneInputs.forEach((input) => processField(input, 'campos_independientes'));

      return formsRecord;
    });

    let totalFields = 0;
    for (const formKey of Object.keys(rawResult)) {
      totalFields += rawResult[formKey].length;
    }

    const report: FormSchemaReport = {
      targetUrl,
      totalForms: Object.keys(rawResult).length,
      totalFields,
      forms: rawResult,
      timestamp: new Date().toISOString()
    };

    this.lastReport = report;
    return report;
  }

  /**
   * Guarda el reporte consolidado de formularios en disco en formato JSON.
   *
   * @param outputPath Ruta destino del archivo (por defecto form-schema.json).
   * @param report Reporte opcional (si no se suministra, usa el último analizado).
   */
  public generateFormSchema(outputPath: string, report?: FormSchemaReport): FormSchemaReport | null {
    const targetReport = report || this.lastReport;
    if (!targetReport) return null;

    try {
      const resolvedPath = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, JSON.stringify(targetReport, null, 2), 'utf-8');
      console.log(`[FormAnalyzer] Esquema de formularios guardado en: ${resolvedPath}`);
    } catch (err) {
      console.warn('[FormAnalyzer] Error al escribir form-schema.json:', (err as Error).message);
    }

    return targetReport;
  }

  public getReport(): FormSchemaReport | null {
    return this.lastReport;
  }
}
