/**
 * ============================================================================
 * UTILIDADES SQL COMPARTIDAS (sql-utils.js)
 * ============================================================================
 * Este archivo se usa tanto en el NAVEGADOR (window.SqlUtils) como en el
 * SERVIDOR (require('./public/js/sql-utils')). Contiene:
 *
 * 1. splitStatements(): divide un script en sentencias individuales respetando
 *    cadenas, comentarios, identificadores con `backticks` y la directiva
 *    DELIMITER (necesaria para triggers y procedimientos almacenados).
 * 2. stripForAnalysis(): elimina comentarios y el contenido de las cadenas para
 *    poder analizar una sentencia con expresiones regulares sin falsos positivos.
 * 3. analyzeRisk(): detecta sentencias peligrosas (DROP, TRUNCATE, DELETE/UPDATE
 *    sin WHERE, cambios en esquemas del sistema, etc.).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SqlUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // Bases de datos internas de MySQL que nunca deben modificarse desde el Studio
  const SYSTEM_SCHEMAS = ['mysql', 'sys', 'information_schema', 'performance_schema'];

  function isSystemSchema(name) {
    return !!name && SYSTEM_SCHEMAS.includes(String(name).toLowerCase());
  }

  /**
   * Divide un script SQL en sentencias.
   * Soporta: 'cadenas', "cadenas", `identificadores`, -- comentarios,
   * # comentarios, /* comentarios *\/ y la directiva DELIMITER del cliente mysql.
   * @param {string} script
   * @returns {Array<{sql: string, line: number}>} sentencias con su línea inicial
   */
  function splitStatements(script) {
    const text = String(script || '');
    const statements = [];
    let delimiter = ';';
    let current = '';
    let hasContent = false; // true cuando la sentencia actual ya tiene algo más que espacios/comentarios
    let startLine = 1;
    let line = 1;
    let i = 0;
    const n = text.length;
    const delimiterRe = /DELIMITER[ \t]+(\S+)[^\n]*(\n|$)/iy; // 'y' = búsqueda anclada en lastIndex

    const pushCurrent = () => {
      if (hasContent) {
        statements.push({ sql: current.trim(), line: startLine });
      }
      current = '';
      hasContent = false;
    };

    while (i < n) {
      const ch = text[i];
      const next = text[i + 1];

      // Directiva DELIMITER: solo cuenta al inicio de una sentencia (cuando lo acumulado son espacios/comentarios)
      if (!hasContent) {
        if ((ch === 'D' || ch === 'd') && (i === 0 || /\s/.test(text[i - 1]))) {
          delimiterRe.lastIndex = i;
          const m = delimiterRe.exec(text);
          if (m) {
            delimiter = m[1];
            current = '';
            i += m[0].length;
            if (m[2] === '\n') line++;
            startLine = line;
            continue;
          }
        }
      }

      // Comentario de línea: -- (seguido de espacio) o #
      if ((ch === '-' && next === '-' && (i + 2 >= n || /\s/.test(text[i + 2]))) || ch === '#') {
        const end = text.indexOf('\n', i);
        const stop = end === -1 ? n : end;
        current += text.slice(i, stop);
        i = stop;
        continue;
      }

      // Comentario de bloque /* ... */ (incluye los condicionales /*! ... */)
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        const chunk = text.slice(i, stop);
        // /*! ... */ es código ejecutable para MySQL (lo usa mysqldump), no un comentario real
        if (text[i + 2] === '!' && !hasContent) { hasContent = true; startLine = line; }
        line += (chunk.match(/\n/g) || []).length;
        current += chunk;
        i = stop;
        continue;
      }

      // Cadenas e identificadores entre comillas
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < n) {
          if (text[j] === '\\' && ch !== '`') { j += 2; continue; }
          if (text[j] === ch) {
            if (text[j + 1] === ch) { j += 2; continue; } // comilla duplicada ('' o ``)
            break;
          }
          j++;
        }
        const chunk = text.slice(i, Math.min(j + 1, n));
        if (!hasContent) { hasContent = true; startLine = line; }
        line += (chunk.match(/\n/g) || []).length;
        current += chunk;
        i = j + 1;
        continue;
      }

      // Fin de sentencia
      if (text.startsWith(delimiter, i)) {
        pushCurrent();
        i += delimiter.length;
        continue;
      }

      if (ch === '\n') line++;
      else if (!hasContent && !/\s/.test(ch)) { hasContent = true; startLine = line; }
      current += ch;
      i++;
    }

    pushCurrent();
    return statements;
  }

  /**
   * Quita comentarios y reemplaza el contenido de las cadenas por '' para que
   * palabras como WHERE dentro de un texto no confundan al analizador.
   * Los identificadores `entre backticks` se conservan sin los backticks.
   */
  function stripForAnalysis(sql) {
    const text = String(sql || '');
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      const next = text[i + 1];
      if ((ch === '-' && next === '-' && (i + 2 >= n || /\s/.test(text[i + 2]))) || ch === '#') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? n : end;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        // Los comentarios condicionales /*! ... */ sí se ejecutan en MySQL: se conserva su contenido
        if (text[i + 2] === '!') {
          const inner = text.slice(i + 3, end === -1 ? n : end).replace(/^\d{5}/, '');
          out += ' ' + inner + ' ';
        } else {
          out += ' ';
        }
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        let content = '';
        while (j < n) {
          if (text[j] === '\\' && ch !== '`') { content += text.slice(j, j + 2); j += 2; continue; }
          if (text[j] === ch) {
            if (text[j + 1] === ch) { content += ch; j += 2; continue; }
            break;
          }
          content += text[j];
          j++;
        }
        out += ch === '`' ? content : "''";
        i = j + 1;
        continue;
      }
      out += ch;
      i++;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  // Busca referencias a esquemas del sistema tipo "mysql.user" o "USE mysql"
  function touchesSystemSchema(clean) {
    const re = new RegExp(`(^|[\\s,(])(${SYSTEM_SCHEMAS.join('|')})\\s*\\.`, 'i');
    return re.test(clean);
  }

  /**
   * Analiza un script completo y devuelve la lista de sentencias riesgosas.
   * Nivel 'high' = destruye estructura/datos de forma masiva (requiere escribir CONFIRMAR).
   * Nivel 'medium' = modifica muchas filas o columnas (requiere confirmar con un clic).
   * @param {string} script
   * @returns {Array<{level: 'high'|'medium', reason: string, sql: string, line: number}>}
   */
  function analyzeRisk(script) {
    const findings = [];
    splitStatements(script).forEach(({ sql, line }) => {
      const clean = stripForAnalysis(sql);
      const upper = clean.toUpperCase();
      const add = (level, reason) => findings.push({ level, reason, sql, line });

      let m;
      if ((m = upper.match(/^DROP\s+(DATABASE|SCHEMA)\s+(IF\s+EXISTS\s+)?(\S+)/))) {
        const name = clean.split(/\s+/).pop().replace(/;$/, '');
        if (isSystemSchema(name)) {
          add('high', `Intenta eliminar la base de datos del sistema "${name}" (bloqueado)`);
        } else {
          add('high', `Elimina la base de datos completa "${name}" con todas sus tablas`);
        }
        return;
      }
      if (/^DROP\s+(TEMPORARY\s+)?TABLE\b/.test(upper)) { add('high', 'Elimina una o más tablas y todos sus datos'); return; }
      if (/^DROP\s+(VIEW|TRIGGER|PROCEDURE|FUNCTION|EVENT|INDEX|USER)\b/.test(upper)) { add('medium', 'Elimina un objeto de la base de datos'); return; }
      if (/^TRUNCATE\b/.test(upper)) { add('high', 'Vacía la tabla completa (TRUNCATE no se puede deshacer)'); return; }
      if (/^DELETE\b/.test(upper) && !/\bWHERE\b/.test(upper)) { add('high', 'DELETE sin WHERE: borrará TODAS las filas de la tabla'); return; }
      if (/^UPDATE\b/.test(upper) && !/\bWHERE\b/.test(upper)) { add('high', 'UPDATE sin WHERE: modificará TODAS las filas de la tabla'); return; }
      if (/^ALTER\s+TABLE\b/.test(upper) && /\bDROP\b/.test(upper)) { add('medium', 'ALTER TABLE con DROP: elimina columnas, índices o llaves'); return; }
      if (/^(RENAME\s+TABLE|ALTER\s+TABLE\b.*\bRENAME\b)/.test(upper)) { add('medium', 'Renombra una tabla: las consultas que la usen dejarán de funcionar'); return; }
      if (/^(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/.test(upper) && touchesSystemSchema(clean)) {
        add('high', 'Modifica una base de datos interna del sistema MySQL');
      }
    });
    return findings;
  }

  /**
   * Devuelve un mensaje de error si el script intenta destruir un esquema del sistema.
   * Se usa en el servidor como segunda capa de protección.
   */
  function findBlockedStatement(script) {
    for (const { sql } of splitStatements(script)) {
      const clean = stripForAnalysis(sql);
      const m = clean.match(/^DROP\s+(DATABASE|SCHEMA)\s+(IF\s+EXISTS\s+)?(\S+)/i);
      if (m && isSystemSchema(m[3].replace(/;$/, ''))) {
        return `Operación bloqueada: no se permite eliminar la base de datos del sistema "${m[3]}".`;
      }
    }
    return null;
  }

  /**
   * Localiza las cláusulas principales de UNA consulta SELECT a nivel superior
   * (ignorando lo que esté dentro de paréntesis, cadenas o comentarios).
   * Se usa para agregar filtros WHERE / ORDER BY a una consulta existente.
   * @returns {{clauses: Array<{kw: string, start: number, end: number}>, fromCommas: number[]}}
   *   kw: SELECT | FROM | WHERE | GROUP BY | HAVING | ORDER BY | LIMIT | UNION | JOIN | WINDOW | INTO | FOR
   *   start/end: posición de la palabra clave dentro del texto original
   */
  function topLevelClauses(sql) {
    const text = String(sql || '');
    const clauses = [];
    const commas = [];
    let depth = 0;
    let i = 0;
    const n = text.length;
    const JOIN_WORDS = ['JOIN', 'STRAIGHT_JOIN'];
    const SIMPLE = ['SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'UNION', 'WINDOW', 'INTO', 'FOR', 'EXCEPT', 'INTERSECT'];

    while (i < n) {
      const ch = text[i];
      const next = text[i + 1];
      if ((ch === '-' && next === '-' && (i + 2 >= n || /\s/.test(text[i + 2]))) || ch === '#') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? n : end;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < n) {
          if (text[j] === '\\' && ch !== '`') { j += 2; continue; }
          if (text[j] === ch) { if (text[j + 1] === ch) { j += 2; continue; } break; }
          j++;
        }
        i = j + 1;
        continue;
      }
      if (ch === '(') { depth++; i++; continue; }
      if (ch === ')') { depth--; i++; continue; }
      if (depth === 0 && ch === ',') { commas.push(i); i++; continue; }
      if (depth === 0 && /[A-Za-z_]/.test(ch) && (i === 0 || !/[\w$]/.test(text[i - 1]))) {
        let j = i;
        while (j < n && /[\w$]/.test(text[j])) j++;
        const word = text.slice(i, j).toUpperCase();
        if (word === 'GROUP' || word === 'ORDER') {
          const m = /^\s+BY\b/i.exec(text.slice(j, j + 20));
          if (m) { clauses.push({ kw: word + ' BY', start: i, end: j + m[0].length }); i = j + m[0].length; continue; }
        } else if (SIMPLE.includes(word)) {
          clauses.push({ kw: word, start: i, end: j });
        } else if (JOIN_WORDS.includes(word)) {
          clauses.push({ kw: 'JOIN', start: i, end: j });
        }
        i = j;
        continue;
      }
      i++;
    }
    const from = clauses.find(c => c.kw === 'FROM');
    const afterFrom = from ? clauses.find(c => c.start > from.start && c.kw !== 'FROM') : null;
    const fromCommas = from ? commas.filter(c => c > from.end && (!afterFrom || c < afterFrom.start)) : [];
    return { clauses, fromCommas };
  }

  /** ¿La sentencia es una consulta de lectura (SELECT / WITH / (SELECT ...))? */
  function isSelectStatement(sql) {
    return /^\(*\s*(SELECT|WITH)\b/i.test(stripForAnalysis(sql));
  }

  return {
    SYSTEM_SCHEMAS,
    isSystemSchema,
    splitStatements,
    stripForAnalysis,
    analyzeRisk,
    findBlockedStatement,
    topLevelClauses,
    isSelectStatement
  };
});