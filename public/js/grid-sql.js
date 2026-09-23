/**
 * ============================================================================
 * GENERADOR DE SQL PARA EL GRID DE RESULTADOS (grid-sql.js)
 * ============================================================================
 * Compartido entre el NAVEGADOR (window.GridSql) y el SERVIDOR (require).
 *
 * 1. FILTROS: a partir de la consulta original y de los filtros que el usuario
 *    eligió en los encabezados, genera la nueva consulta con WHERE / ORDER BY.
 *      SELECT * FROM empleados LIMIT 100
 *        + id entre 100 y 200 + nombre empieza con "n"
 *      = SELECT * FROM empleados
 *        WHERE `id` BETWEEN 100 AND 200 AND `nombre` LIKE 'n%'
 *        LIMIT 100
 *
 * 2. EDICIÓN: convierte los cambios hechos en el grid (celdas editadas, filas
 *    nuevas, filas eliminadas) en sentencias UPDATE / INSERT / DELETE que
 *    identifican cada fila por su LLAVE PRIMARIA.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sql-utils'), require('./ddl-builder'));
  } else {
    root.GridSql = factory(root.SqlUtils, root.DDLBuilder);
  }
})(typeof self !== 'undefined' ? self : this, function (SqlUtils, DDLBuilder) {
  const q = DDLBuilder.q;
  const str = DDLBuilder.str;

  // ==========================================================================
  // 1. FILTROS
  // ==========================================================================

  /** Operadores disponibles según el tipo de dato de la columna */
  const FILTER_OPS = {
    number: [
      ['eq', '= igual a'], ['ne', '≠ distinto de'], ['gt', '> mayor que'], ['gte', '≥ mayor o igual'],
      ['lt', '< menor que'], ['lte', '≤ menor o igual'], ['between', 'entre ... y ...'], ['in', 'en la lista (1, 5, 9)'],
      ['null', 'es NULL'], ['notnull', 'no es NULL']
    ],
    text: [
      ['contains', 'contiene'], ['starts', 'empieza con'], ['ends', 'termina con'], ['eq', 'es igual a'],
      ['ne', 'es distinto de'], ['notcontains', 'no contiene'], ['in', 'en la lista (a, b, c)'],
      ['empty', 'está vacío'], ['null', 'es NULL'], ['notnull', 'no es NULL']
    ],
    date: [
      ['eq', 'es el día / igual a'], ['lt', 'antes de'], ['gt', 'después de'], ['between', 'entre ... y ...'],
      ['null', 'es NULL'], ['notnull', 'no es NULL']
    ],
    other: [
      ['eq', 'es igual a'], ['ne', 'es distinto de'], ['null', 'es NULL'], ['notnull', 'no es NULL']
    ]
  };

  const OP_LABEL = {};
  Object.values(FILTER_OPS).forEach(list => list.forEach(([k, label]) => { OP_LABEL[k] = OP_LABEL[k] || label; }));
  const NO_VALUE_OPS = ['null', 'notnull', 'empty'];

  const isNumberText = v => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(String(v).trim());
  const isDateOnly = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());

  /** Escapa los comodines de LIKE (% y _) para buscar el texto literal */
  function likeEscape(value) {
    return String(value).replace(/[\\%_]/g, m => '\\' + m);
  }

  function literal(value, kind) {
    const v = String(value).trim();
    if (kind === 'number') return v;
    return str(kind === 'date' ? v : value);
  }

  /**
   * Convierte un filtro en condición SQL.
   * @param {{column, op, value, value2}} f
   * @param {string} ref - referencia a la columna ya escapada (ej. `nombre`)
   * @param {{kind: string, mysqlType?: string}} meta
   * @returns {{sql?: string, error?: string}}
   */
  function conditionSql(f, ref, meta) {
    const kind = meta.kind || 'other';
    const op = f.op;
    const label = f.column;
    if (NO_VALUE_OPS.includes(op)) {
      if (op === 'null') return { sql: `${ref} IS NULL` };
      if (op === 'notnull') return { sql: `${ref} IS NOT NULL` };
      return { sql: `${ref} = ''` };
    }
    const value = f.value === undefined || f.value === null ? '' : String(f.value);
    if (!value.trim() && op !== 'eq' && op !== 'ne') return { error: `Escribe un valor para filtrar "${label}".` };

    if (kind === 'number') {
      const values = op === 'in' ? value.split(',').map(x => x.trim()).filter(Boolean) : [value, ...(op === 'between' ? [f.value2 || ''] : [])];
      const bad = values.find(x => !isNumberText(x));
      if (bad !== undefined) return { error: `"${bad || '(vacío)'}" no es un número válido para la columna "${label}".` };
    }
    if (kind === 'date') {
      const values = [value, ...(op === 'between' ? [f.value2 || ''] : [])];
      const bad = values.find(x => !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(String(x).trim()));
      if (bad !== undefined) return { error: `Usa el formato AAAA-MM-DD (o AAAA-MM-DD HH:MM) en "${label}".` };
    }

    // Si la columna tiene hora pero el usuario escribió solo la fecha, se compara con DATE(columna)
    const hasTime = /DATETIME|TIMESTAMP/i.test(meta.mysqlType || '');
    const dateRef = (a, b) => (kind === 'date' && hasTime && isDateOnly(a) && (b === undefined || isDateOnly(b))) ? `DATE(${ref})` : ref;

    switch (op) {
      case 'eq': return { sql: `${dateRef(value)} = ${literal(value, kind)}` };
      case 'ne': return { sql: `${ref} <> ${literal(value, kind)}` };
      case 'gt': return { sql: `${dateRef(value)} > ${literal(value, kind)}` };
      case 'gte': return { sql: `${ref} >= ${literal(value, kind)}` };
      case 'lt': return { sql: `${dateRef(value)} < ${literal(value, kind)}` };
      case 'lte': return { sql: `${ref} <= ${literal(value, kind)}` };
      case 'between': {
        const v2 = String(f.value2 || '').trim();
        if (!v2) return { error: `Escribe los dos valores del rango para "${label}".` };
        return { sql: `${dateRef(value, v2)} BETWEEN ${literal(value, kind)} AND ${literal(v2, kind)}` };
      }
      case 'in': {
        const items = value.split(',').map(x => x.trim()).filter(Boolean);
        return { sql: `${ref} IN (${items.map(x => literal(x, kind)).join(', ')})` };
      }
      case 'contains': return { sql: `${ref} LIKE ${str('%' + likeEscape(value) + '%')}` };
      case 'notcontains': return { sql: `${ref} NOT LIKE ${str('%' + likeEscape(value) + '%')}` };
      case 'starts': return { sql: `${ref} LIKE ${str(likeEscape(value) + '%')}` };
      case 'ends': return { sql: `${ref} LIKE ${str('%' + likeEscape(value))}` };
      default: return { error: `Operador desconocido: ${op}` };
    }
  }

  /** Descripción legible de un filtro para las etiquetas ("chips") */
  function describeFilter(f) {
    const label = OP_LABEL[f.op] || f.op;
    if (NO_VALUE_OPS.includes(f.op)) return `${f.column} ${label}`;
    if (f.op === 'between') return `${f.column} entre ${f.value} y ${f.value2}`;
    return `${f.column} ${label.replace(/ \(.*\)$/, '')} ${f.value}`;
  }

  /**
   * Genera la consulta filtrada/ordenada.
   * @param {string} baseSql - la consulta SELECT original
   * @param {Array} fields - metadatos de las columnas del resultado [{name, orgName, orgTable, kind, mysqlType}]
   * @param {Array} filters - [{column, op, value, value2}]
   * @param {{column, dir}|null} sort
   * @returns {{sql: string, errors: string[], mode: 'simple'|'subquery'}}
   */
  function buildFilteredSql(baseSql, fields, filters, sort) {
    const errors = [];
    let sql = String(baseSql || '').trim().replace(/;+\s*$/, '').trim();
    const byName = {};
    (fields || []).forEach(f => { byName[f.name] = f; });
    const { clauses, fromCommas } = SqlUtils.topLevelClauses(sql);
    const has = kw => clauses.some(c => c.kw === kw);
    const get = kw => clauses.find(c => c.kw === kw);
    const nextAfter = c => {
      const later = clauses.filter(x => x.start > c.start);
      return later.length ? later[0].start : sql.length;
    };

    const used = [...filters.map(f => f.column), ...(sort ? [sort.column] : [])];
    const allReal = used.every(name => byName[name] && byName[name].orgName && byName[name].orgTable);

    const select = get('SELECT');
    const from = get('FROM');
    const fromText = from ? sql.slice(from.end, nextAfter(from)).trim() : '';
    const singleTable = /^(`[^`]+`|[\w$]+)(\s*\.\s*(`[^`]+`|[\w$]+))?(\s+(AS\s+)?(`[^`]+`|[\w$]+))?$/i.test(fromText);

    const simple = select && select.start === 0 && from && singleTable && !fromCommas.length && allReal &&
      !['UNION', 'JOIN', 'GROUP BY', 'HAVING', 'WINDOW', 'INTO', 'EXCEPT', 'INTERSECT'].some(has) &&
      clauses.filter(c => c.kw === 'SELECT').length === 1;

    // ---------- Modo simple: se agrega al WHERE / ORDER BY de la misma consulta ----------
    if (simple) {
      const where = get('WHERE');
      const order = get('ORDER BY');
      const limit = get('LIMIT');
      const forClause = get('FOR');
      const conds = [];
      filters.forEach(f => {
        const meta = byName[f.column];
        const r = conditionSql(f, q(meta.orgName), meta);
        if (r.error) errors.push(r.error); else conds.push(r.sql);
      });
      const selectText = sql.slice(select.end, from.start).trim();
      const whereText = where ? sql.slice(where.end, nextAfter(where)).trim() : '';
      const orderText = order ? sql.slice(order.end, nextAfter(order)).trim() : '';
      const limitText = limit ? sql.slice(limit.end, forClause && forClause.start > limit.start ? forClause.start : sql.length).trim() : '';

      const allWhere = [...(whereText ? [conds.length ? `(${whereText})` : whereText] : []), ...conds];
      let out = `SELECT ${selectText}\nFROM ${fromText}`;
      if (allWhere.length) out += `\nWHERE ${allWhere.join('\n  AND ')}`;
      if (sort) out += `\nORDER BY ${q(byName[sort.column].orgName)} ${sort.dir === 'DESC' ? 'DESC' : 'ASC'}`;
      else if (orderText) out += `\nORDER BY ${orderText}`;
      if (limitText) out += `\nLIMIT ${limitText}`;
      return { sql: out + ';', errors, mode: 'simple' };
    }

    // ---------- Modo general: la consulta original se usa como subconsulta ----------
    // (funciona con JOIN, GROUP BY, columnas calculadas, etc.)
    let limitText = '';
    const limit = clauses.filter(c => c.kw === 'LIMIT').pop();
    if (limit && limit === clauses[clauses.length - 1]) {
      limitText = sql.slice(limit.end).trim();
      sql = sql.slice(0, limit.start).trim();
    }
    const conds = [];
    filters.forEach(f => {
      const meta = byName[f.column] || { kind: 'other' };
      const r = conditionSql(f, q(f.column), meta);
      if (r.error) errors.push(r.error); else conds.push(r.sql);
    });
    let out = `SELECT *\nFROM (\n  ${sql.replace(/\n/g, '\n  ')}\n) AS resultado`;
    if (conds.length) out += `\nWHERE ${conds.join('\n  AND ')}`;
    if (sort) out += `\nORDER BY ${q(sort.column)} ${sort.dir === 'DESC' ? 'DESC' : 'ASC'}`;
    if (limitText) out += `\nLIMIT ${limitText}`;
    return { sql: out + ';', errors, mode: 'subquery' };
  }

  // ==========================================================================
  // 2. EDICIÓN DE DATOS
  // ==========================================================================

  /** Tipo general de una columna a partir de su tipo MySQL (según la estructura) */
  function kindOfColumn(col) {
    if (col.generated) return 'generated';
    const meta = DDLBuilder.TYPES[String(col.type || '').toUpperCase()];
    if (!meta || meta.group === 'bit') return 'binary'; // BIT llega como datos binarios: solo lectura
    if (['int', 'num', 'bool'].includes(meta.group)) return 'number';
    if (meta.group === 'date') return 'date';
    if (meta.group === 'bin' || String(col.type).toUpperCase() === 'GEOMETRY' || String(col.type).toUpperCase() === 'POINT') return 'binary';
    return 'text';
  }

  function valueSql(value, col) {
    if (value === null || value === undefined) return { sql: 'NULL' };
    const kind = kindOfColumn(col);
    const v = String(value);
    if (kind === 'number') {
      if (!isNumberText(v)) return { error: `"${v}" no es un número válido para la columna "${col.name}" (${col.type}).` };
      return { sql: v.trim() };
    }
    return { sql: str(v) };
  }

  /**
   * Construye las sentencias para aplicar los cambios del grid.
   * @param {object} structure - estructura de la tabla (de /designer/table-structure)
   * @param {object} changes - {
   *     updates: [{ key: {col: valorOriginal}, set: {col: valorNuevo} }],
   *     deletes: [{ key: {col: valorOriginal} }],
   *     inserts: [{ values: {col: valor} }]
   *   }  (los nombres son los nombres REALES de las columnas)
   * @returns {{statements: Array<{sql, type, expectOne}>, errors: string[]}}
   */
  function buildChanges(structure, changes) {
    const errors = [];
    const statements = [];
    const target = `${q(structure.database)}.${q(structure.name)}`;
    const colMap = {};
    structure.columns.forEach(c => { colMap[c.name] = c; });
    const pk = structure.columns.filter(c => c.pk).map(c => c.name);
    if (!pk.length) {
      return { statements, errors: ['La tabla no tiene llave primaria: no se puede saber qué fila modificar.'] };
    }

    const whereSql = (key, label) => {
      const parts = [];
      for (const name of pk) {
        if (!(name in key)) { errors.push(`${label}: falta el valor de la llave primaria "${name}".`); return null; }
        const v = valueSql(key[name], colMap[name]);
        if (v.error) { errors.push(v.error); return null; }
        parts.push(`${q(name)} = ${v.sql}`);
      }
      return parts.join(' AND ');
    };

    const checkColumn = (name, value, label) => {
      const col = colMap[name];
      if (!col) { errors.push(`${label}: la columna "${name}" no existe en ${structure.name}.`); return null; }
      if (col.generated) { errors.push(`${label}: "${name}" es una columna calculada y no se puede modificar.`); return null; }
      if (value === null && (col.nn || col.pk)) { errors.push(`${label}: la columna "${name}" no permite NULL.`); return null; }
      const v = valueSql(value, col);
      if (v.error) { errors.push(`${label}: ${v.error}`); return null; }
      return v.sql;
    };

    // 1) DELETE primero (así se puede volver a insertar una fila con la misma llave)
    (changes.deletes || []).forEach((d, i) => {
      const where = whereSql(d.key || {}, `Eliminación #${i + 1}`);
      if (where) statements.push({ type: 'delete', expectOne: true, sql: `DELETE FROM ${target}\nWHERE ${where}\nLIMIT 1` });
    });

    // 2) UPDATE
    (changes.updates || []).forEach((u, i) => {
      const label = `Fila editada #${i + 1}`;
      const where = whereSql(u.key || {}, label);
      const sets = [];
      Object.entries(u.set || {}).forEach(([name, value]) => {
        const v = checkColumn(name, value, label);
        if (v !== null) sets.push(`${q(name)} = ${v}`);
      });
      if (where && sets.length) {
        statements.push({ type: 'update', expectOne: true, sql: `UPDATE ${target}\nSET ${sets.join(',\n    ')}\nWHERE ${where}\nLIMIT 1` });
      }
    });

    // 3) INSERT
    (changes.inserts || []).forEach((ins, i) => {
      const label = `Fila nueva #${i + 1}`;
      const values = ins.values || {};
      const names = Object.keys(values).filter(n => values[n] !== undefined);
      // Columnas obligatorias: NOT NULL, sin valor por defecto y sin AUTO_INCREMENT
      structure.columns.forEach(c => {
        const required = (c.nn || c.pk) && !c.ai && !c.generated && !String(c.def || '').trim();
        if (required && (!names.includes(c.name) || values[c.name] === null)) {
          errors.push(`${label}: la columna "${c.name}" es obligatoria (NOT NULL sin valor por defecto).`);
        }
      });
      const cols = [];
      const vals = [];
      names.forEach(name => {
        const v = checkColumn(name, values[name], label);
        if (v !== null) { cols.push(q(name)); vals.push(v); }
      });
      statements.push({
        type: 'insert',
        expectOne: false,
        sql: cols.length
          ? `INSERT INTO ${target} (${cols.join(', ')})\nVALUES (${vals.join(', ')})`
          : `INSERT INTO ${target} () VALUES ()`
      });
    });

    return { statements, errors };
  }

  return {
    FILTER_OPS,
    NO_VALUE_OPS,
    conditionSql,
    describeFilter,
    buildFilteredSql,
    kindOfColumn,
    buildChanges
  };
});
