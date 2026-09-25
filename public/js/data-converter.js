/**
 * ============================================================================
 * NÚCLEO DEL CONVERSOR DE FORMATOS (data-converter.js)
 * ============================================================================
 * Lógica pura (sin DOM) del "Conversor de Formatos de Datos". Funciona en el
 * NAVEGADOR (window.DataConverter) y en NODE (require) para poder probarla.
 *
 *  1. SqlInsertParser  → analizador léxico + sintáctico de sentencias INSERT.
 *       · INSERT [IGNORE] INTO tabla (cols) VALUES (...), (...);
 *       · REPLACE INTO ..., INSERT ... VALUE ..., INSERT ... SET col = val
 *       · Identificadores con `backticks`, "comillas" o [corchetes], esquema.tabla
 *       · Cadenas con '' o \' escapadas, números, TRUE/FALSE, NULL
 *       · Comentarios (--, #, /* *\/) y otras sentencias (CREATE, SET, ...) se ignoran,
 *         así que acepta directamente un respaldo generado por mysqldump.
 *       · Errores con línea y columna exactas.
 *  2. Formateadores → JSON, CSV, filas para Excel y sentencias INSERT.
 *  3. Conversión de celdas de Excel (fechas seriales → 'YYYY-MM-DD HH:mm:ss').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DataConverter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /** Error de conversión con ubicación opcional (línea/columna) */
  class ConversionError extends Error {
    constructor(message, loc) {
      super(loc ? `Línea ${loc.line}, columna ${loc.col}: ${message}` : message);
      this.name = 'ConversionError';
      this.loc = loc || null;
    }
  }

  // ==========================================================================
  // 1. ANALIZADOR LÉXICO (TOKENIZER)
  // ==========================================================================
  // Tipos de token:
  //   word   → palabra clave o identificador sin comillas (INSERT, clientes, NOW)
  //   ident  → identificador entre `backticks` o [corchetes]
  //   string → cadena entre 'comillas simples' o "dobles" (valor ya desescapado)
  //   number → literal numérico (texto original en .raw)
  //   punct  → ( ) , ; . = y cualquier otro símbolo suelto
  const MYSQL_ESCAPES = { '0': '\0', 'b': '\b', 'n': '\n', 'r': '\r', 't': '\t', 'Z': '\x1A', '\\': '\\', "'": "'", '"': '"' };

  function tokenize(sql) {
    const tokens = [];
    const len = sql.length;
    let i = 0;

    const loc = (pos) => {
      // Calcula línea/columna de cualquier posición (solo se usa al reportar errores)
      let l = 1, start = 0;
      for (let k = 0; k < pos; k++) if (sql[k] === '\n') { l++; start = k + 1; }
      return { line: l, col: pos - start + 1 };
    };

    const push = (type, value, start, raw) => tokens.push({ type, value, start, end: i, raw: raw !== undefined ? raw : sql.slice(start, i) });

    while (i < len) {
      const ch = sql[i];

      // --- Espacios ---
      if (/\s/.test(ch)) { i++; continue; }

      // --- Comentarios ---
      if (ch === '#' || (ch === '-' && sql[i + 1] === '-' && (i + 2 >= len || /\s/.test(sql[i + 2])))) {
        while (i < len && sql[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && sql[i + 1] === '*') {
        const close = sql.indexOf('*/', i + 2);
        if (close === -1) throw new ConversionError('Comentario /* sin cerrar.', loc(i));
        i = close + 2;
        continue;
      }

      const start = i;

      // --- Cadenas '...' y "..." ---
      if (ch === "'" || ch === '"') {
        const quote = ch;
        let value = '';
        i++;
        let closed = false;
        while (i < len) {
          const c = sql[i];
          if (c === '\\' && i + 1 < len) {
            const next = sql[i + 1];
            value += Object.prototype.hasOwnProperty.call(MYSQL_ESCAPES, next) ? MYSQL_ESCAPES[next] : next;
            i += 2;
            continue;
          }
          if (c === quote) {
            if (sql[i + 1] === quote) { value += quote; i += 2; continue; } // '' o ""
            i++;
            closed = true;
            break;
          }
          value += c;
          i++;
        }
        if (!closed) throw new ConversionError(`Cadena de texto sin cerrar (falta ${quote}).`, loc(start));
        push('string', value, start);
        continue;
      }

      // --- Identificadores `...` y [...] ---
      if (ch === '`' || ch === '[') {
        const close = ch === '`' ? '`' : ']';
        let value = '';
        i++;
        let closed = false;
        while (i < len) {
          if (sql[i] === close) {
            if (close === '`' && sql[i + 1] === '`') { value += '`'; i += 2; continue; }
            i++;
            closed = true;
            break;
          }
          value += sql[i++];
        }
        if (!closed) throw new ConversionError(`Identificador sin cerrar (falta ${close}).`, loc(start));
        push('ident', value, start);
        continue;
      }

      // --- Literales hexadecimales / binarios: X'4F', 0x4F, b'1010' ---
      if (/[xXbB]/.test(ch) && sql[i + 1] === "'") {
        const close = sql.indexOf("'", i + 2);
        if (close === -1) throw new ConversionError('Literal hexadecimal/binario sin cerrar.', loc(start));
        i = close + 1;
        push('raw', sql.slice(start, i), start);
        continue;
      }
      if (ch === '0' && /[xX]/.test(sql[i + 1] || '') && /[0-9a-fA-F]/.test(sql[i + 2] || '')) {
        i += 2;
        while (i < len && /[0-9a-fA-F]/.test(sql[i])) i++;
        push('raw', sql.slice(start, i), start);
        continue;
      }

      // --- Números: 12, 3.1416, .5, 1e10, 2.5E-3 ---
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i, i + 400));
        i += m[0].length;
        // "123abc" sería un identificador en MySQL; se toma como palabra
        if (i < len && /[A-Za-z_$]/.test(sql[i])) {
          while (i < len && /[\w$]/.test(sql[i])) i++;
          push('word', sql.slice(start, i), start);
        } else {
          push('number', m[0], start);
        }
        continue;
      }

      // --- Palabras (keywords, identificadores, funciones, @variables) ---
      if (/[A-Za-z_$@À-￿]/.test(ch)) {
        i++;
        while (i < len && /[\w$@À-￿]/.test(sql[i])) i++;
        push('word', sql.slice(start, i), start);
        continue;
      }

      // --- Símbolos ---
      i++;
      push('punct', ch, start);
    }
    return { tokens, loc };
  }

  // ==========================================================================
  // 2. ANALIZADOR SINTÁCTICO DE INSERT
  // ==========================================================================
  const INSERT_MODIFIERS = ['LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'IGNORE'];
  const MAX_SAFE = Number.MAX_SAFE_INTEGER;

  /**
   * Analiza un script SQL y extrae los datos de todas sus sentencias INSERT.
   * @param {string} sql
   * @returns {{ tables: Array<{name, schema, columns, rows}>, statements: number,
   *             skipped: number, warnings: string[] }}
   *   rows es un arreglo de objetos { columna: valor } con tipos JS reales.
   */
  function parseInserts(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new ConversionError('No hay SQL para analizar.');

    const { tokens, loc } = tokenize(sql);
    let p = 0;
    const tablesByKey = new Map();
    const warnings = [];
    let statements = 0;
    let skipped = 0;

    const peek = (o = 0) => tokens[p + o];
    const isWord = (t, w) => t && t.type === 'word' && t.value.toUpperCase() === w;
    const isPunct = (t, c) => t && t.type === 'punct' && t.value === c;
    const where = (t) => loc(t ? t.start : sql.length);
    const describe = (t) => (t ? `"${t.raw.length > 30 ? t.raw.slice(0, 30) + '…' : t.raw}"` : 'el final del texto');
    const fail = (msg, t = peek()) => { throw new ConversionError(`${msg} Se encontró ${describe(t)}.`, where(t)); };
    const expectPunct = (c, context) => {
      const t = peek();
      if (!isPunct(t, c)) fail(`Se esperaba "${c}" ${context}.`, t);
      p++;
    };

    /** Nombre de identificador en cualquier forma: palabra, `ident`, [ident] o "ident" */
    function readIdentifier(context) {
      const t = peek();
      if (t && (t.type === 'word' || t.type === 'ident' || t.type === 'string')) { p++; return t.value; }
      fail(`Se esperaba un nombre ${context}.`, t);
    }

    /** Salta hasta el siguiente ';' de nivel superior (sentencias que no son INSERT) */
    function skipStatement() {
      let depth = 0;
      while (p < tokens.length) {
        const t = tokens[p++];
        if (isPunct(t, '(')) depth++;
        else if (isPunct(t, ')')) depth = Math.max(0, depth - 1);
        else if (isPunct(t, ';') && depth === 0) return;
      }
    }

    /** Convierte un literal numérico a Number, o lo conserva como texto si perdería precisión */
    function toNumber(raw, negative) {
      const text = (negative ? '-' : '') + raw;
      const n = Number(text);
      if (!Number.isFinite(n)) return text;
      if (/^-?\d+$/.test(text) && Math.abs(n) > MAX_SAFE) return text; // BIGINT enorme
      if (/^-?\d+\.\d{16,}$/.test(text)) return text;                   // DECIMAL de alta precisión
      return n;
    }

    /**
     * Lee un valor dentro de VALUES (...). Literales → tipo JS.
     * Expresiones (NOW(), 1+1, CONCAT(...)) → texto original para no perder información.
     */
    function readValue() {
      const t = peek();
      const n = peek(1);
      if (!t) fail('Se esperaba un valor.', t);

      const endsHere = (tok) => !tok || (tok.type === 'punct' && (tok.value === ',' || tok.value === ')' || tok.value === ';'));
      const isLiteral = (tok) => tok && (tok.type === 'string' || tok.type === 'number' || tok.type === 'raw');

      // Literales simples seguidos de "," o ")"
      if (t.type === 'string' && endsHere(n)) { p++; return t.value; }
      if (t.type === 'number' && endsHere(n)) { p++; return toNumber(t.value, false); }
      if (t.type === 'punct' && (t.value === '-' || t.value === '+') && n && n.type === 'number' && endsHere(peek(2))) {
        p += 2;
        return toNumber(n.value, t.value === '-');
      }
      if (t.type === 'word' && endsHere(n)) {
        const up = t.value.toUpperCase();
        if (up === 'NULL') { p++; return null; }
        if (up === 'TRUE') { p++; return true; }
        if (up === 'FALSE') { p++; return false; }
        if (up === 'DEFAULT') { p++; return null; }
      }

      // Expresión compleja: se captura el texto original hasta la coma/paréntesis de cierre
      const startTok = t;
      let depth = 0;
      let last = null;
      while (p < tokens.length) {
        const cur = peek();
        if (isPunct(cur, '(')) depth++;
        else if (isPunct(cur, ')')) { if (depth === 0) break; depth--; }
        else if (isPunct(cur, ',') && depth === 0) break;
        else if (isPunct(cur, ';') && depth === 0) break;
        // Dos valores seguidos sin operador: casi siempre es una coma olvidada
        if (last && isLiteral(cur) && (isLiteral(last) || isPunct(last, ')'))) {
          fail('Falta una coma entre dos valores.', cur);
        }
        last = cur;
        p++;
      }
      if (!last) fail('Se esperaba un valor.', startTok);
      return sql.slice(startTok.start, last.end).trim();
    }

    /** Registra (o reutiliza) la tabla destino y agrega columnas nuevas en orden */
    function tableFor(schema, name, columns) {
      const key = `${(schema || '').toLowerCase()}.${name.toLowerCase()}`;
      let table = tablesByKey.get(key);
      if (!table) {
        table = { name, schema: schema || null, columns: [], rows: [] };
        tablesByKey.set(key, table);
      }
      columns.forEach(c => { if (!table.columns.includes(c)) table.columns.push(c); });
      return table;
    }

    function parseInsertStatement() {
      const stmtTok = peek();
      p++; // INSERT | REPLACE
      while (peek() && peek().type === 'word' && INSERT_MODIFIERS.includes(peek().value.toUpperCase())) p++;
      if (isWord(peek(), 'INTO')) p++;

      // Nombre de la tabla: tabla | esquema.tabla
      let schema = null;
      let name = readIdentifier('de tabla después de INSERT INTO');
      if (isPunct(peek(), '.')) {
        p++;
        schema = name;
        name = readIdentifier('de tabla después del punto');
      }

      // Lista de columnas opcional
      let columns = null;
      if (isPunct(peek(), '(')) {
        // Distingue "(col1, col2)" de un subquery "(SELECT ...)"
        if (isWord(peek(1), 'SELECT')) fail('INSERT ... SELECT no se puede convertir: los datos vienen de otra consulta.', peek(1));
        p++;
        columns = [];
        if (!isPunct(peek(), ')')) {
          do {
            columns.push(readIdentifier('de columna'));
            if (isPunct(peek(), ',')) { p++; continue; }
            break;
          } while (true);
        }
        expectPunct(')', 'para cerrar la lista de columnas');
      }

      const rows = [];

      // Forma INSERT ... SET col = valor, col2 = valor2
      if (isWord(peek(), 'SET')) {
        p++;
        const row = {};
        columns = [];
        do {
          const col = readIdentifier('de columna en SET');
          expectPunct('=', `después de la columna "${col}"`);
          row[col] = readValue();
          columns.push(col);
          if (isPunct(peek(), ',')) { p++; continue; }
          break;
        } while (true);
        rows.push(row);
      } else {
        if (isWord(peek(), 'SELECT') || isWord(peek(), 'TABLE') || isPunct(peek(), '(') && isWord(peek(1), 'SELECT')) {
          fail('INSERT ... SELECT no se puede convertir: los datos vienen de otra consulta.');
        }
        if (!(isWord(peek(), 'VALUES') || isWord(peek(), 'VALUE'))) fail('Se esperaba la palabra VALUES.');
        p++;

        let tupleIndex = 0;
        do {
          tupleIndex++;
          if (isWord(peek(), 'ROW')) p++; // VALUES ROW(1, 2) (MySQL 8)
          const openTok = peek();
          expectPunct('(', `para abrir la fila #${tupleIndex}`);
          const values = [];
          if (!isPunct(peek(), ')')) {
            do {
              values.push(readValue());
              if (isPunct(peek(), ',')) { p++; continue; }
              break;
            } while (true);
          }
          expectPunct(')', `para cerrar la fila #${tupleIndex} (¿falta una coma entre valores?)`);

          if (!columns) {
            // Sin lista de columnas: se nombran columna_1, columna_2, ...
            columns = values.map((_, k) => `columna_${k + 1}`);
            warnings.push(`El INSERT en "${name}" no indica columnas; se nombraron columna_1, columna_2, …`);
          }
          if (values.length !== columns.length) {
            throw new ConversionError(
              `La fila #${tupleIndex} de "${name}" tiene ${values.length} valor(es) pero se declararon ${columns.length} columna(s).`,
              where(openTok));
          }
          const row = {};
          columns.forEach((c, k) => { row[c] = values[k]; });
          rows.push(row);

          if (isPunct(peek(), ',')) { p++; continue; }
          break;
        } while (true);
      }

      // Cláusulas finales opcionales (ON DUPLICATE KEY UPDATE, AS alias ...)
      if (peek() && !isPunct(peek(), ';')) {
        if (isWord(peek(), 'ON') || isWord(peek(), 'AS') || isWord(peek(), 'RETURNING')) {
          skipStatement();
        } else {
          fail('Se esperaba ";" o "," después de la fila de valores.');
        }
      } else if (isPunct(peek(), ';')) {
        p++;
      }

      const table = tableFor(schema, name, columns);
      rows.forEach(r => table.rows.push(r));
      statements++;
      return stmtTok;
    }

    while (p < tokens.length) {
      const t = peek();
      if (isPunct(t, ';')) { p++; continue; }
      if (isWord(t, 'INSERT') || isWord(t, 'REPLACE')) {
        parseInsertStatement();
      } else {
        skipped++;
        skipStatement();
      }
    }

    const tables = Array.from(tablesByKey.values());
    if (!tables.length) {
      throw new ConversionError(
        skipped
          ? 'No se encontró ninguna sentencia INSERT INTO en el texto. Solo se admiten sentencias de inserción de datos.'
          : 'El texto no contiene sentencias SQL reconocibles.');
    }
    // Filas con columnas "faltantes" (distintos INSERT a la misma tabla) → null
    tables.forEach(tb => tb.rows.forEach(r => tb.columns.forEach(c => { if (!(c in r)) r[c] = null; })));
    if (skipped) warnings.push(`Se ignoraron ${skipped} sentencia(s) que no son INSERT.`);

    return { tables, statements, skipped, warnings };
  }

  // ==========================================================================
  // 3. FORMATEADORES DE SALIDA
  // ==========================================================================

  /** Filas de una tabla como arreglo de objetos con columnas en orden */
  function tableToObjects(table) {
    return table.rows.map(r => {
      const o = {};
      table.columns.forEach(c => { o[c] = r[c] === undefined ? null : r[c]; });
      return o;
    });
  }

  /** SQL → JSON. Una tabla: arreglo de objetos. Varias: { tabla: [...] } */
  function toJson(parsed) {
    if (parsed.tables.length === 1) return JSON.stringify(tableToObjects(parsed.tables[0]), null, 2);
    const out = {};
    parsed.tables.forEach(t => { out[t.name] = tableToObjects(t); });
    return JSON.stringify(out, null, 2);
  }

  /** Escapa un valor para CSV (RFC 4180): comillas dobles, comas y saltos de línea */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** Tabla → texto CSV con encabezados en la primera línea */
  function toCsv(table, { eol = '\n' } = {}) {
    const lines = [table.columns.map(csvCell).join(',')];
    table.rows.forEach(r => lines.push(table.columns.map(c => csvCell(r[c])).join(',')));
    return lines.join(eol);
  }

  /**
   * Divide un texto CSV en filas respetando campos entre comillas
   * (comas, comillas dobles "" y saltos de línea dentro del campo).
   * Detecta automáticamente el separador: coma, punto y coma o tabulador.
   */
  function parseCsv(text) {
    const clean = text.replace(/^﻿/, '');
    const firstLine = clean.split(/\r?\n/, 1)[0];
    const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length - 1]);
    const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';

    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let i = 0;
    let wasQuoted = false;
    while (i < clean.length) {
      const c = clean[i];
      if (quoted) {
        if (c === '"') {
          if (clean[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { quoted = true; wasQuoted = true; i++; continue; }
      if (c === delim) { row.push({ v: field, q: wasQuoted }); field = ''; wasQuoted = false; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push({ v: field, q: wasQuoted }); field = ''; wasQuoted = false;
        rows.push(row); row = [];
        if (c === '\r' && clean[i + 1] === '\n') i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (quoted) throw new ConversionError('El CSV tiene un campo entre comillas sin cerrar.');
    if (field !== '' || row.length) { row.push({ v: field, q: wasQuoted }); rows.push(row); }
    return rows.filter(r => r.some(f => f.v.trim() !== ''));
  }

  // ---------- Generación de SQL ----------
  const quoteIdent = (name) => '`' + String(name).replace(/`/g, '``') + '`';

  /** Escapa texto para una cadena SQL de MySQL: \ → \\ y ' → '' */
  function sqlString(s) {
    return "'" + String(s)
      .replace(/\\/g, '\\\\')
      .replace(/\0/g, '\\0')
      .replace(/'/g, "''") + "'";
  }

  function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'bigint') return String(v);
    if (v instanceof Date) return sqlString(formatDate(v));
    if (typeof v === 'object') return sqlString(JSON.stringify(v));
    return sqlString(v);
  }

  /** Nombre de tabla seguro a partir de un texto libre (ej. nombre de archivo) */
  function safeTableName(text, fallback = 'tabla_importada') {
    const base = String(text || '')
      .replace(/\.[^.]+$/, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    if (!base) return fallback;
    return /^\d/.test(base) ? `t_${base}` : base.slice(0, 64);
  }

  /** Encabezados limpios y únicos: vacíos → columna_N, repetidos → nombre_2 */
  function uniqueHeaders(headers) {
    const seen = new Map();
    return headers.map((h, i) => {
      let name = String(h === null || h === undefined ? '' : h).trim().replace(/\s+/g, ' ');
      if (!name) name = `columna_${i + 1}`;
      const key = name.toLowerCase();
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return n > 1 ? `${name}_${n}` : name;
    });
  }

  /**
   * Genera sentencias INSERT (multi-fila, en bloques) para una tabla.
   * @param {string} tableName
   * @param {string[]} columns
   * @param {Array<Array<any>>} rows  arreglo de arreglos (mismo orden que columns)
   */
  function buildInserts(tableName, columns, rows, { chunkSize = 100 } = {}) {
    const header = `INSERT INTO ${quoteIdent(tableName)} (${columns.map(quoteIdent).join(', ')}) VALUES`;
    const blocks = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map(r => '  (' + r.map(sqlLiteral).join(', ') + ')');
      blocks.push(header + '\n' + chunk.join(',\n') + ';');
    }
    return blocks.join('\n\n');
  }

  // ==========================================================================
  // 4. CONVERSIÓN DE CELDAS DE EXCEL
  // ==========================================================================
  const pad = (n, w = 2) => String(n).padStart(w, '0');

  /** Date de JS → 'YYYY-MM-DD' o 'YYYY-MM-DD HH:mm:ss' (hora local) */
  function formatDate(d) {
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    return (h || m || s) ? `${date} ${pad(h)}:${pad(m)}:${pad(s)}` : date;
  }

  /**
   * Número serial de Excel → fecha SQL, SIN depender de la zona horaria.
   * Excel cuenta días desde 1899-12-30 (incluye el "29/02/1900" inexistente,
   * por eso el origen es el 30 y no el 31 de diciembre).
   * @param {number} serial
   * @param {boolean} date1904  libros creados en Mac antiguos usan base 1904
   */
  function excelSerialToSql(serial, date1904 = false) {
    const totalSeconds = Math.round(serial * 86400);
    const days = Math.floor(totalSeconds / 86400);
    const secs = totalSeconds - days * 86400;
    const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    const time = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;

    // Solo hora (formato h:mm) → HH:mm:ss
    if (days === 0 && !date1904) return time;

    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    // Antes del 01/03/1900 Excel va un día "adelantado" por el 29/02/1900 que no existió
    const fixedDays = !date1904 && days < 60 ? days + 1 : days;
    const d = new Date(base + fixedDays * 86400000);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return secs ? `${date} ${time}` : date;
  }

  return {
    ConversionError,
    tokenize,
    parseInserts,
    tableToObjects,
    toJson,
    toCsv,
    csvCell,
    parseCsv,
    quoteIdent,
    sqlString,
    sqlLiteral,
    safeTableName,
    uniqueHeaders,
    buildInserts,
    formatDate,
    excelSerialToSql
  };
});
