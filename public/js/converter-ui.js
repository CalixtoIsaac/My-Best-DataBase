/**
 * ============================================================================
 * CONVERSOR DE FORMATOS DE DATOS — INTERFAZ (converter-ui.js)
 * ============================================================================
 * Controla el modal "🔄 Conversor de Datos". La lógica de parsing/formateo
 * vive en data-converter.js (window.DataConverter); aquí solo hay DOM.
 *
 * Flujos (Entrada → Salida):
 *   JSON  → SQL · Markdown
 *   CSV   → SQL
 *   SQL   → JSON · CSV · Excel (.xlsx, descarga binaria)
 *   Excel → SQL                (lee .xlsx / .xls con SheetJS)
 *
 * SheetJS (xlsx.full.min.js) se carga bajo demanda la primera vez que se usa
 * una conversión con Excel: primero desde el servidor local (node_modules) y,
 * si no está instalado, desde el CDN oficial de SheetJS.
 */
const DataConverterUI = (() => {
  const DC = window.DataConverter;
  const OUTPUT_XLSX_NAME = 'resultado_conversion.xlsx';
  const MAX_FILE_BYTES = 30 * 1024 * 1024;

  // --------------------------------------------------------------------------
  // Definición de los flujos
  // --------------------------------------------------------------------------
  const SOURCES = [
    { id: 'json', label: 'JSON', icon: '{ }', targets: ['json-to-sql', 'json-to-markdown'] },
    { id: 'csv', label: 'CSV', icon: '≡', targets: ['csv-to-sql'] },
    { id: 'sql', label: 'SQL', icon: '⛁', targets: ['sql-to-json', 'sql-to-csv', 'sql-to-xlsx'] },
    { id: 'xlsx', label: 'Excel', icon: '▦', targets: ['xlsx-to-sql'] }
  ];

  const MODES = {
    'json-to-sql': {
      target: 'SQL', input: 'text', needsTable: true,
      placeholder: '[\n  { "id": 1, "nombre": "Ana", "activo": true },\n  { "id": 2, "nombre": "Luis", "activo": false }\n]'
    },
    'json-to-markdown': {
      target: 'Markdown', input: 'text',
      placeholder: '[\n  { "id": 1, "nombre": "Ana" },\n  { "id": 2, "nombre": "Luis" }\n]'
    },
    'csv-to-sql': {
      target: 'SQL', input: 'text', needsTable: true,
      placeholder: 'id,nombre,email\n1,Ana,ana@correo.com\n2,"López, Luis",luis@correo.com'
    },
    'sql-to-json': {
      target: 'JSON', input: 'text',
      placeholder: "INSERT INTO clientes (id, nombre, activo) VALUES\n  (1, 'Ana', TRUE),\n  (2, 'O''Brien', FALSE);"
    },
    'sql-to-csv': {
      target: 'CSV', input: 'text',
      placeholder: "INSERT INTO clientes (id, nombre, email) VALUES\n  (1, 'Ana', 'ana@correo.com'),\n  (2, 'López, Luis', NULL);"
    },
    'sql-to-xlsx': {
      target: 'Excel', input: 'text', binary: true,
      placeholder: "INSERT INTO ventas (folio, fecha, total) VALUES\n  (1001, '2025-01-15', 1520.50),\n  (1002, '2025-01-16 10:30:00', 980);"
    },
    'xlsx-to-sql': { target: 'SQL', input: 'file', needsTable: true }
  };

  // Compatibilidad con los identificadores anteriores de convertData()
  const LEGACY_IDS = { 'excel-to-sql': 'csv-to-sql' };

  const state = {
    mode: 'json-to-sql',
    file: null,            // { name, size, buffer }
    xlsxBlob: null,        // resultado binario de SQL → Excel
    tableTouched: false,   // el usuario escribió el nombre de tabla a mano
    bound: false
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (window.UI ? UI.escape(s) : String(s));
  const toast = (msg, type) => (window.UI ? UI.toast(msg, type) : null);

  // --------------------------------------------------------------------------
  // Carga perezosa de SheetJS
  // --------------------------------------------------------------------------
  const SHEETJS_SOURCES = [
    'vendor/xlsx/xlsx.full.min.js',
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
  ];
  let sheetJsPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('sin XLSX')));
      s.onerror = () => { s.remove(); reject(new Error('no disponible')); };
      document.head.appendChild(s);
    });
  }

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!sheetJsPromise) {
      sheetJsPromise = SHEETJS_SOURCES.reduce(
        (chain, src) => chain.catch(() => loadScript(src)),
        Promise.reject(new Error('inicio'))
      ).catch(() => {
        sheetJsPromise = null; // permite reintentar
        throw new DC.ConversionError(
          'No se pudo cargar la librería de Excel (SheetJS). Ejecuta "npm install" en la carpeta del proyecto ' +
          'y reinicia el servidor, o verifica tu conexión a internet.');
      });
    }
    return sheetJsPromise;
  }

  // --------------------------------------------------------------------------
  // Construcción de la interfaz
  // --------------------------------------------------------------------------
  function renderFlows() {
    $('convFlows').innerHTML = SOURCES.map(src => `
      <div class="conv-flow" data-source="${src.id}">
        <div class="conv-flow-source"><span class="conv-flow-icon">${src.icon}</span>${src.label}</div>
        <span class="conv-flow-arrow">→</span>
        <div class="conv-flow-targets">
          ${src.targets.map(id => `
            <button type="button" class="conv-chip" data-mode="${id}"
              title="${src.label} a ${MODES[id].target}">${MODES[id].target}${MODES[id].binary ? ' <small>.xlsx</small>' : ''}</button>`).join('')}
        </div>
      </div>`).join('');
    $('convFlows').querySelectorAll('.conv-chip').forEach(btn => {
      btn.addEventListener('click', () => selectMode(btn.dataset.mode, { run: true }));
    });
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    renderFlows();

    const input = $('converterInput');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    });
    input.addEventListener('input', () => { clearMessage(); });

    $('convTableName').addEventListener('input', () => { state.tableTouched = true; });

    // Selector de archivo y zona de arrastre
    const fileInput = $('convFile');
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
      fileInput.value = '';
    });

    const zone = $('convInputWrap');
    let depth = 0;
    zone.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      zone.classList.add('dragging');
    });
    zone.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('dragging'); });
    zone.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    // Esc cierra el modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('converterModal').style.display === 'flex') close();
    });
  }

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  /** Cambia el flujo activo y adapta la interfaz */
  function selectMode(mode, { run: autoRun = false } = {}) {
    mode = LEGACY_IDS[mode] || mode;
    if (!MODES[mode]) return;
    const prev = state.mode;
    state.mode = mode;
    const cfg = MODES[mode];

    $('convFlows').querySelectorAll('.conv-chip').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('convFlows').querySelectorAll('.conv-flow').forEach(f =>
      f.classList.toggle('active', !!f.querySelector(`.conv-chip[data-mode="${mode}"]`)));

    const isFile = cfg.input === 'file';
    $('converterInput').hidden = isFile;
    $('convDropZone').hidden = !isFile || !!state.file;
    $('convFileInfo').hidden = !isFile || !state.file;
    $('converterInput').placeholder = cfg.placeholder || '';
    $('convTableField').hidden = !cfg.needsTable;
    $('convInputLabel').textContent = isFile ? 'Archivo de Excel:' : `Entrada (${sourceOf(mode).label}):`;

    if (prev !== mode) {
      resetOutput();
      clearMessage();
    }
    updateResultButton();

    if (autoRun) {
      const hasInput = isFile ? !!state.file : !!$('converterInput').value.trim();
      if (hasInput) run();
      else if (isFile) $('convFile').click();
      else $('converterInput').focus();
    }
  }

  const sourceOf = (mode) => SOURCES.find(s => s.targets.includes(mode));

  // --------------------------------------------------------------------------
  // Mensajes, resultado y botón dinámico
  // --------------------------------------------------------------------------
  function showMessage(type, html) {
    const box = $('convMessage');
    const icon = { error: '⛔', warning: '⚠️', success: '✅', info: 'ℹ️' }[type] || '';
    box.className = `conv-message conv-${type}`;
    box.innerHTML = `<span class="conv-message-icon">${icon}</span><div>${html}</div>`;
    box.hidden = false;
  }

  function clearMessage() {
    const box = $('convMessage');
    box.hidden = true;
    box.innerHTML = '';
  }

  function resetOutput() {
    $('converterOutput').value = '';
    $('convStats').textContent = '';
    state.xlsxBlob = null;
    updateResultButton();
  }

  function setOutput(text, stats) {
    $('converterOutput').value = text;
    $('convStats').textContent = stats || '';
    updateResultButton();
  }

  function updateResultButton() {
    const btn = $('convResultBtn');
    const binary = !!MODES[state.mode].binary;
    btn.innerHTML = binary ? '⬇ Descargar Excel (.xlsx)' : '📋 Copiar Resultado';
    btn.classList.toggle('conv-download', binary);
    btn.disabled = binary ? !state.xlsxBlob : !$('converterOutput').value;
  }

  function resultAction() {
    if (MODES[state.mode].binary) {
      if (!state.xlsxBlob) return;
      UI.download(state.xlsxBlob, OUTPUT_XLSX_NAME);
      toast(`Descargando ${OUTPUT_XLSX_NAME}`, 'success');
    } else {
      copyOutput();
    }
  }

  async function copyOutput() {
    const output = $('converterOutput');
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (e) {
      output.select();
      document.execCommand('copy');
    }
    toast('¡Resultado copiado al portapapeles!', 'success');
  }

  function handleError(err) {
    const known = err instanceof DC.ConversionError;
    const message = known ? err.message : `Formato de entrada no válido: ${err.message}`;
    resetOutput();
    showMessage('error', `<strong>No se pudo convertir.</strong><br>${esc(message)}`);
    if (err.loc) highlightErrorLocation(err.loc);
    if (!known) console.error('[Conversor]', err);
  }

  /** Coloca el cursor del textarea de entrada en la línea/columna del error */
  function highlightErrorLocation({ line, col }) {
    const ta = $('converterInput');
    if (ta.hidden) return;
    const lines = ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    pos += col - 1;
    ta.focus();
    ta.setSelectionRange(pos, Math.min(pos + 1, ta.value.length));
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 16;
    ta.scrollTop = Math.max(0, (line - 3) * lineHeight);
  }

  // --------------------------------------------------------------------------
  // Utilidades de conversión
  // --------------------------------------------------------------------------
  function tableName(fallback) {
    const typed = $('convTableName').value.trim();
    return typed ? DC.safeTableName(typed, fallback) : fallback;
  }

  function parseJsonInput(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Ubica la posición que reporta el motor ("... at position 42")
      const m = /position (\d+)/i.exec(e.message);
      let loc = null;
      if (m) {
        const pos = Number(m[1]);
        const before = text.slice(0, pos).split('\n');
        loc = { line: before.length, col: before[before.length - 1].length + 1 };
      }
      throw new DC.ConversionError('El texto no es un JSON válido. Revisa comas, llaves y comillas dobles.', loc);
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (!arr.length) throw new DC.ConversionError('El arreglo JSON está vacío.');
    if (!arr.every(o => o && typeof o === 'object' && !Array.isArray(o))) {
      throw new DC.ConversionError('Se esperaba un objeto o un arreglo de objetos, ej. [{"id": 1, "nombre": "Ana"}].');
    }
    // Unión de columnas de todos los objetos (no solo del primero)
    const columns = [];
    arr.forEach(o => Object.keys(o).forEach(k => { if (!columns.includes(k)) columns.push(k); }));
    return { rows: arr, columns };
  }

  const plural = (n, one, many) => `${n.toLocaleString('es-MX')} ${n === 1 ? one : many}`;

  function parseSql(text) {
    const parsed = DC.parseInserts(text);
    const warnings = parsed.warnings.map(esc);
    return { parsed, warnings };
  }

  function sqlStats(parsed) {
    const rows = parsed.tables.reduce((s, t) => s + t.rows.length, 0);
    const names = parsed.tables.map(t => t.name).join(', ');
    return `${plural(rows, 'fila', 'filas')} · ${plural(parsed.tables.length, 'tabla', 'tablas')} (${names})`;
  }

  // --------------------------------------------------------------------------
  // Conversores
  // --------------------------------------------------------------------------
  const converters = {
    'json-to-sql'(text) {
      const { rows, columns } = parseJsonInput(text);
      const table = tableName('mi_tabla');
      const values = rows.map(o => columns.map(c => (o[c] === undefined ? null : o[c])));
      return {
        output: DC.buildInserts(table, columns, values),
        stats: `${plural(rows.length, 'fila', 'filas')} · ${plural(columns.length, 'columna', 'columnas')} → ${table}`
      };
    },

    'json-to-markdown'(text) {
      const { rows, columns } = parseJsonInput(text);
      const cell = v => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
        .replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
      let md = `| ${columns.map(cell).join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
      rows.forEach(r => { md += `| ${columns.map(c => cell(r[c])).join(' | ')} |\n`; });
      return { output: md, stats: `${plural(rows.length, 'fila', 'filas')} · ${plural(columns.length, 'columna', 'columnas')}` };
    },

    'csv-to-sql'(text) {
      const rows = DC.parseCsv(text);
      if (rows.length < 2) throw new DC.ConversionError('El CSV necesita una fila de encabezados y al menos una fila de datos.');
      const columns = DC.uniqueHeaders(rows[0].map(f => f.v));
      const warnings = [];
      const data = rows.slice(1).map((r, i) => {
        if (r.length !== columns.length) warnings.push(i + 2);
        return columns.map((_, k) => {
          const f = r[k];
          if (!f) return null;
          const v = f.v.trim();
          if (!f.q && v === '') return null;
          if (!f.q && /^null$/i.test(v)) return null;
          // Números sin ceros a la izquierda (teléfonos, códigos postales se quedan como texto)
          if (!f.q && /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v)) return Number(v);
          return f.q ? f.v : v;
        });
      });
      const table = tableName('tabla_importada');
      return {
        output: DC.buildInserts(table, columns, data),
        stats: `${plural(data.length, 'fila', 'filas')} · ${plural(columns.length, 'columna', 'columnas')} → ${table}`,
        warnings: warnings.length
          ? [`${plural(warnings.length, 'fila tiene', 'filas tienen')} un número de columnas distinto al encabezado (línea${warnings.length > 1 ? 's' : ''} ${warnings.slice(0, 8).join(', ')}${warnings.length > 8 ? '…' : ''}); se completaron con NULL o se recortaron.`]
          : []
      };
    },

    'sql-to-json'(text) {
      const { parsed, warnings } = parseSql(text);
      if (parsed.tables.length > 1) warnings.push('Se encontraron varias tablas: el JSON se agrupó como { "tabla": [ ... ] }.');
      return { output: DC.toJson(parsed), stats: sqlStats(parsed), warnings };
    },

    'sql-to-csv'(text) {
      const { parsed, warnings } = parseSql(text);
      const [first, ...rest] = parsed.tables;
      if (rest.length) {
        warnings.push(`El SQL tiene ${parsed.tables.length} tablas; el CSV contiene solo "${esc(first.name)}". ` +
          'Usa <strong>SQL → Excel</strong> para obtener una hoja por tabla.');
      }
      return {
        output: DC.toCsv(first),
        stats: `${plural(first.rows.length, 'fila', 'filas')} · ${plural(first.columns.length, 'columna', 'columnas')} (${first.name})`,
        warnings
      };
    },

    async 'sql-to-xlsx'(text) {
      const { parsed, warnings } = parseSql(text);
      const XLSX = await loadSheetJS();
      const blob = buildWorkbook(XLSX, parsed);
      state.xlsxBlob = blob;
      UI.download(blob, OUTPUT_XLSX_NAME);

      const summary = parsed.tables.map(t =>
        `  • Hoja "${t.name}": ${plural(t.rows.length, 'fila', 'filas')} × ${plural(t.columns.length, 'columna', 'columnas')}`);
      const first = parsed.tables[0];
      const preview = DC.toCsv({ columns: first.columns, rows: first.rows.slice(0, 15) });
      return {
        output: [
          `Archivo generado: ${OUTPUT_XLSX_NAME} (${UI.formatBytes(blob.size)})`,
          ...summary,
          '',
          `Vista previa de "${first.name}"${first.rows.length > 15 ? ' (primeras 15 filas)' : ''}:`,
          preview
        ].join('\n'),
        stats: sqlStats(parsed),
        warnings,
        success: `Se descargó <strong>${OUTPUT_XLSX_NAME}</strong>. Usa el botón "Descargar Excel" si necesitas otra copia.`
      };
    },

    async 'xlsx-to-sql'() {
      if (!state.file) throw new DC.ConversionError('Primero selecciona o arrastra un archivo de Excel (.xlsx o .xls).');
      const XLSX = await loadSheetJS();
      const sheet = readFirstSheet(XLSX, state.file);
      const table = tableName(DC.safeTableName(state.file.name));
      const warnings = [];
      if (sheet.sheetCount > 1) warnings.push(`El libro tiene ${sheet.sheetCount} hojas; se convirtió solo la primera ("${esc(sheet.sheetName)}").`);
      if (sheet.dateCount) warnings.push(`${plural(sheet.dateCount, 'celda de fecha convertida', 'celdas de fecha convertidas')} a formato SQL (YYYY-MM-DD).`);
      return {
        output: DC.buildInserts(table, sheet.columns, sheet.rows),
        stats: `${plural(sheet.rows.length, 'fila', 'filas')} · ${plural(sheet.columns.length, 'columna', 'columnas')} → ${table}`,
        warnings,
        warningType: 'info'
      };
    }
  };

  // --------------------------------------------------------------------------
  // Excel: lectura
  // --------------------------------------------------------------------------
  /** Verifica la firma binaria del archivo antes de dárselo a SheetJS */
  function detectSpreadsheet(buffer, name) {
    const b = new Uint8Array(buffer.slice(0, 8));
    const isZip = b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;               // .xlsx / .xlsm
    const isOle = b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;               // .xls (o .xlsx cifrado)
    const head = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 256))).trimStart().toLowerCase();
    const isXmlXls = /\.xls$/i.test(name) && (head.startsWith('<?xml') || head.startsWith('<html') || head.startsWith('<table'));
    return isZip || isOle || isXmlXls;
  }

  function readFirstSheet(XLSX, file) {
    if (!detectSpreadsheet(file.buffer, file.name)) {
      throw new DC.ConversionError(`"${file.name}" no es un libro de Excel válido. Solo se aceptan archivos .xlsx o .xls.`);
    }

    let wb;
    try {
      wb = XLSX.read(file.buffer, { type: 'array', cellDates: false, cellNF: true, cellText: false });
    } catch (e) {
      if (/password|encrypt/i.test(e.message)) {
        throw new DC.ConversionError('El archivo está protegido con contraseña. Quítale la protección en Excel y vuelve a intentarlo.');
      }
      throw new DC.ConversionError(`No se pudo leer "${file.name}": el archivo está dañado o no es un Excel válido.`);
    }

    const sheetName = wb.SheetNames && wb.SheetNames[0];
    const ws = sheetName && wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) throw new DC.ConversionError(`La primera hoja${sheetName ? ` ("${sheetName}")` : ''} está vacía.`);

    const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    const range = XLSX.utils.decode_range(ws['!ref']);
    const dense = Array.isArray(ws['!data']);
    const getCell = (r, c) => (dense ? (ws['!data'][r] || [])[c] : ws[XLSX.utils.encode_cell({ r, c })]);
    let dateCount = 0;

    /** Valor de una celda → tipo JS listo para SQL */
    const cellValue = (cell) => {
      if (!cell || cell.v === undefined || cell.v === null) return null;
      switch (cell.t) {
        case 'b': return !!cell.v;
        case 'e': return null;                               // #N/A, #DIV/0!, ...
        case 'd': {                                          // fecha ya interpretada por SheetJS
          dateCount++;
          return cell.v instanceof Date ? DC.formatDate(cell.v) : String(cell.v);
        }
        case 'n': {
          if (cell.z && XLSX.SSF.is_date(cell.z)) {
            dateCount++;
            return DC.excelSerialToSql(cell.v, date1904);
          }
          return cell.v;
        }
        default: {
          const s = String(cell.v);
          return s.trim() === '' ? null : s;
        }
      }
    };

    // Encabezados = primera fila del rango usado
    const rawHeaders = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = getCell(range.s.r, c);
      rawHeaders.push(cell ? (cell.w !== undefined && cell.t !== 's' ? cell.w : cell.v) : null);
    }
    if (rawHeaders.every(h => h === null || String(h).trim() === '')) {
      throw new DC.ConversionError('La primera fila de la hoja debe contener los nombres de las columnas.');
    }

    const rows = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) row.push(cellValue(getCell(r, c)));
      if (row.some(v => v !== null)) rows.push(row);           // omite filas vacías
    }

    // Omite columnas sin encabezado y sin datos (bordes o formato residual)
    const keep = rawHeaders.map((h, i) => (h !== null && String(h).trim() !== '') || rows.some(r => r[i] !== null));
    const columns = DC.uniqueHeaders(rawHeaders.filter((_, i) => keep[i]));
    const data = rows.map(r => r.filter((_, i) => keep[i]));

    if (!data.length) throw new DC.ConversionError(`La hoja "${sheetName}" solo tiene encabezados, no hay filas de datos.`);
    return { sheetName, sheetCount: wb.SheetNames.length, columns, rows: data, dateCount };
  }

  // --------------------------------------------------------------------------
  // Excel: escritura (SQL → .xlsx)
  // --------------------------------------------------------------------------
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

  /** 'YYYY-MM-DD[ HH:mm:ss]' → número serial de Excel (sin zona horaria) */
  function dateStringToSerial(s) {
    const m = DATE_RE.exec(s);
    if (!m) return null;
    const [, y, mo, d, h = 0, mi = 0, se = 0] = m.map(x => (x === undefined ? undefined : Number(x)));
    const ms = Date.UTC(y, mo - 1, d, h, mi, se);
    const check = new Date(ms);
    if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;  // 2025-02-31
    const serial = (ms - Date.UTC(1899, 11, 30)) / 86400000;
    return serial >= 61 ? { serial, hasTime: !!(h || mi || se) } : null;
  }

  function sheetNameFor(name, used) {
    let base = String(name).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Hoja';
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base.slice(0, 28)}_${n}`;
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function buildWorkbook(XLSX, parsed) {
    const wb = XLSX.utils.book_new();
    const used = new Set();

    parsed.tables.forEach(table => {
      const aoa = [table.columns, ...table.rows.map(r => table.columns.map(c => (r[c] === undefined ? null : r[c])))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Fechas en texto → celdas de fecha reales de Excel; anchos de columna automáticos
      const widths = table.columns.map(c => Math.min(Math.max(String(c).length + 2, 8), 60));
      table.rows.forEach((r, i) => {
        table.columns.forEach((c, k) => {
          const v = r[c];
          if (v === null || v === undefined) return;
          const addr = XLSX.utils.encode_cell({ r: i + 1, c: k });
          if (typeof v === 'string') {
            const d = dateStringToSerial(v);
            if (d && ws[addr]) {
              ws[addr] = { t: 'n', v: d.serial, z: d.hasTime ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd' };
            }
          }
          widths[k] = Math.min(Math.max(widths[k], String(v).length + 2), 60);
        });
      });
      ws['!cols'] = widths.map(wch => ({ wch }));
      if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };

      XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(table.name, used));
    });

    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // --------------------------------------------------------------------------
  // Archivos subidos
  // --------------------------------------------------------------------------
  async function handleFile(file) {
    clearMessage();
    const isExcelName = /\.(xlsx|xlsm|xls)$/i.test(file.name);

    // Un .sql, .json o .csv soltado aquí se carga como texto en el flujo correspondiente
    if (!isExcelName) {
      const textMode = { sql: 'sql-to-json', json: 'json-to-sql', csv: 'csv-to-sql', txt: null }[(file.name.split('.').pop() || '').toLowerCase()];
      if (textMode !== undefined && file.size < 20 * 1024 * 1024) {
        const text = await file.text();
        const mode = textMode || (MODES[state.mode].input === 'text' ? state.mode : 'sql-to-json');
        $('converterInput').value = text;
        if (MODES[state.mode].input === 'file' || textMode && sourceOf(state.mode).id !== sourceOf(textMode).id) selectMode(mode);
        toast(`"${file.name}" cargado como texto`, 'info');
        return;
      }
      showMessage('error', `<strong>Archivo no compatible.</strong><br>"${esc(file.name)}" no es un libro de Excel. ` +
        'Solo se aceptan archivos <code>.xlsx</code> o <code>.xls</code>.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showMessage('error', `<strong>Archivo demasiado grande.</strong><br>El límite es ${UI.formatBytes(MAX_FILE_BYTES)} ` +
        `y "${esc(file.name)}" pesa ${UI.formatBytes(file.size)}.`);
      return;
    }

    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      showMessage('error', `No se pudo leer "${esc(file.name)}".`);
      return;
    }
    if (!detectSpreadsheet(buffer, file.name)) {
      showMessage('error', `<strong>Archivo no válido.</strong><br>"${esc(file.name)}" tiene extensión de Excel, ` +
        'pero su contenido no corresponde a un libro .xlsx / .xls (¿se renombró otro tipo de archivo?).');
      return;
    }

    state.file = { name: file.name, size: file.size, buffer };
    if (!state.tableTouched) $('convTableName').value = DC.safeTableName(file.name);
    renderFileInfo();
    selectMode('xlsx-to-sql');
    run();
  }

  function renderFileInfo() {
    const box = $('convFileInfo');
    if (!state.file) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <span class="conv-file-icon">📊</span>
      <div class="conv-file-meta">
        <strong>${esc(state.file.name)}</strong>
        <small>${UI.formatBytes(state.file.size)} · se leerá la primera hoja</small>
      </div>
      <button type="button" class="btn btn-small" onclick="document.getElementById('convFile').click()">Cambiar</button>
      <button type="button" class="icon-btn" title="Quitar archivo" onclick="DataConverterUI.removeFile()">✕</button>`;
  }

  function removeFile() {
    state.file = null;
    if (!state.tableTouched) $('convTableName').value = '';
    renderFileInfo();
    resetOutput();
    clearMessage();
    selectMode(state.mode);
  }

  // --------------------------------------------------------------------------
  // Ejecución
  // --------------------------------------------------------------------------
  let running = false;

  async function run() {
    if (running) return;
    const cfg = MODES[state.mode];
    const text = $('converterInput').value.trim();
    clearMessage();

    if (cfg.input === 'text' && !text) {
      resetOutput();
      showMessage('warning', 'Pega o escribe los datos de entrada. También puedes arrastrar un archivo .sql, .json, .csv o .xlsx.');
      $('converterInput').focus();
      return;
    }

    running = true;
    const btn = $('convRunBtn');
    btn.disabled = true;
    btn.textContent = 'Convirtiendo…';
    state.xlsxBlob = null;
    try {
      const res = await converters[state.mode](text);
      setOutput(res.output, res.stats);
      const notes = res.warnings || [];
      if (res.success) {
        showMessage('success', res.success + (notes.length ? '<ul>' + notes.map(w => `<li>${w}</li>`).join('') + '</ul>' : ''));
      } else if (notes.length) {
        showMessage(res.warningType || 'warning', notes.length === 1 ? notes[0] : '<ul>' + notes.map(w => `<li>${w}</li>`).join('') + '</ul>');
      }
    } catch (err) {
      handleError(err);
    } finally {
      running = false;
      btn.disabled = false;
      btn.textContent = '▶ Convertir';
      updateResultButton();
    }
  }

  function clearAll() {
    $('converterInput').value = '';
    $('convTableName').value = '';
    state.tableTouched = false;
    state.file = null;
    renderFileInfo();
    resetOutput();
    clearMessage();
    selectMode(state.mode);
  }

  function open() {
    bindOnce();
    $('converterModal').style.display = 'flex';
    selectMode(state.mode);
    if (MODES[state.mode].input === 'text') setTimeout(() => $('converterInput').focus(), 30);
  }

  function close() {
    $('converterModal').style.display = 'none';
  }

  return { open, close, run, selectMode, resultAction, copyOutput, removeFile, clear: clearAll, loadSheetJS };
})();

// --------------------------------------------------------------------------
// Funciones globales (usadas por los onclick del HTML y código existente)
// --------------------------------------------------------------------------
function openConverterModal() { DataConverterUI.open(); }
function closeConverterModal() { DataConverterUI.close(); }
function convertData(type) { DataConverterUI.selectMode(type, { run: true }); }
function copyConverterOutput() { DataConverterUI.resultAction(); }
