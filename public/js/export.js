/**
 * ============================================================================
 * EXPORTACIÓN DE RESULTADOS (export.js)
 * ============================================================================
 * Exporta lo que se ve en el "Resultados Grid" a:
 *   - CSV   (se abre en Excel, Google Sheets, etc.)
 *   - JSON  (arreglo de objetos)
 *   - Excel (.xlsx real, generado en el navegador sin librerías externas)
 *   - SQL   (sentencias INSERT para llevar los datos a otra tabla)
 *   - Copiar al portapapeles (se puede pegar directo en Excel)
 *
 * Nota: el "Conversor de Datos" convierte texto pegado (JSON/CSV → SQL);
 * este módulo exporta el RESULTADO de una consulta a un archivo.
 */
const ResultExporter = (() => {

  /** Resultado actual (lo publica app.js cada vez que dibuja el grid) */
  function current() {
    const r = window.lastQueryResult;
    if (!r || !r.columns || !r.columns.length) {
      UI.toast('No hay resultados para exportar. Ejecuta primero una consulta SELECT.', 'warning');
      return null;
    }
    return r;
  }

  /** Nombre base del archivo: la tabla del FROM de la consulta, o "resultado" */
  function baseName(result) {
    const m = String(result.sql || '').match(/\bFROM\s+`?([\w$]+)`?(?:\.`?([\w$]+)`?)?/i);
    const table = m ? (m[2] || m[1]) : 'resultado';
    return `${table}_${UI.stamp()}`;
  }

  function textValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  // ---------------------------- CSV ----------------------------
  function toCsv(result) {
    const esc = v => {
      const s = textValue(v);
      return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [result.columns.map(esc).join(',')];
    result.rows.forEach(row => lines.push(result.columns.map(c => esc(row[c])).join(',')));
    return '﻿' + lines.join('\r\n'); // BOM: Excel reconoce acentos y ñ
  }

  // ---------------------------- JSON ----------------------------
  function toJson(result) {
    const rows = result.rows.map(row => {
      const obj = {};
      result.columns.forEach(c => { obj[c] = row[c] === undefined ? null : row[c]; });
      return obj;
    });
    return JSON.stringify(rows, null, 2);
  }

  // ---------------------------- SQL ----------------------------
  function toSqlInserts(result, tableName) {
    const q = DDLBuilder.q;
    const lit = v => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      if (typeof v === 'boolean') return v ? '1' : '0';
      return DDLBuilder.str(textValue(v));
    };
    const header = `INSERT INTO ${q(tableName)} (${result.columns.map(q).join(', ')}) VALUES`;
    const out = [`-- ${result.rows.length} fila(s) exportadas desde My Best DataBase`];
    for (let i = 0; i < result.rows.length; i += 100) {
      const chunk = result.rows.slice(i, i + 100)
        .map(row => '(' + result.columns.map(c => lit(row[c])).join(', ') + ')');
      out.push(header + '\n' + chunk.join(',\n') + ';');
    }
    return out.join('\n\n') + '\n';
  }

  // ---------------------------- EXCEL (.xlsx) ----------------------------
  // Un .xlsx es un ZIP con archivos XML. Se construye aquí mismo:
  // 1) se generan los XML de la hoja, 2) se empaquetan en un ZIP sin compresión.
  const xmlEsc = s => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function colLetter(n) {
    let s = '';
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  function isNumeric(v) {
    if (typeof v === 'number') return Number.isFinite(v);
    // DECIMAL llega como texto ("99.50"); se convierte a número salvo si tiene ceros a la izquierda (ej. teléfonos)
    return typeof v === 'string' && /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v);
  }

  function sheetXml(result) {
    const widths = result.columns.map(c => Math.min(Math.max(String(c).length + 2, 8), 60));
    const rowsXml = [];
    const cell = (v, r, c, style) => {
      const ref = colLetter(c) + r;
      if (v === null || v === undefined || v === '') return '';
      widths[c] = Math.min(Math.max(widths[c], textValue(v).length + 2), 60);
      if (isNumeric(v)) return `<c r="${ref}"${style}><v>${Number(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(textValue(v))}</t></is></c>`;
    };
    rowsXml.push(`<row r="1">${result.columns.map((c, i) => cell(c, 1, i, ' s="1"')).join('')}</row>`);
    result.rows.forEach((row, idx) => {
      const r = idx + 2;
      rowsXml.push(`<row r="${r}">${result.columns.map((c, i) => cell(row[c], r, i, '')).join('')}</row>`);
    });
    const lastRef = colLetter(result.columns.length - 1) + (result.rows.length + 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
</worksheet>`;
  }

  function xlsxFiles(result, sheetName) {
    const name = xmlEsc(sheetName.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Resultado');
    return {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${colLetter(result.columns.length - 1)}$${result.rows.length + 1}</definedName></definedNames>
</workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF007ACC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
      'xl/worksheets/sheet1.xml': sheetXml(result)
    };
  }

  // CRC-32 (requerido por el formato ZIP)
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** Empaqueta archivos en un ZIP sin compresión (método "store") */
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

    Object.entries(files).forEach(([name, content]) => {
      const nameBytes = enc.encode(name);
      const data = enc.encode(content);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nombres en UTF-8
      local.setUint16(8, 0, true);
      local.setUint16(10, 0, true);
      local.setUint16(12, DOS_DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, 0, true);
      cen.setUint16(14, DOS_DATE, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    });

    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function toXlsx(result, sheetName) {
    return zip(xlsxFiles(result, sheetName));
  }

  // ---------------------------- Acciones de los botones ----------------------------
  function exportAs(format) {
    const result = current();
    if (!result) return;
    const base = baseName(result);
    const table = base.replace(/_\d{8}_\d{6}$/, '');
    const n = result.rows.length;

    if (format === 'csv') UI.download(toCsv(result), `${base}.csv`, 'text/csv;charset=utf-8');
    if (format === 'json') UI.download(toJson(result), `${base}.json`, 'application/json;charset=utf-8');
    if (format === 'xlsx') UI.download(toXlsx(result, table), `${base}.xlsx`);
    if (format === 'sql') UI.download(toSqlInserts(result, table), `${base}.sql`, 'application/sql;charset=utf-8');

    logConsole(`Resultado exportado a ${format.toUpperCase()}: ${base}.${format} (${n} filas)`, 'success');
    UI.toast(`Exportadas ${n} fila(s) a ${format.toUpperCase()}`, 'success');
  }

  /** Copia como texto separado por tabulaciones: se pega directo en Excel */
  async function copyToClipboard() {
    const result = current();
    if (!result) return;
    const clean = v => textValue(v).replace(/[\t\r\n]+/g, ' ');
    const tsv = [result.columns.join('\t'), ...result.rows.map(r => result.columns.map(c => clean(r[c])).join('\t'))].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    UI.toast(`${result.rows.length} fila(s) copiadas. Pégalas en Excel con Ctrl+V`, 'success');
  }

  return { exportAs, copyToClipboard, toCsv, toJson, toXlsx, toSqlInserts };
})();
