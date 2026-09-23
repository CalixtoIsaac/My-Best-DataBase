/**
 * ============================================================================
 * GENERADOR DE SQL DDL (ddl-builder.js)
 * ============================================================================
 * Convierte lo que el usuario diseña en la interfaz gráfica (nombre de tabla,
 * columnas, tipos, llaves) en sentencias SQL reales:
 *   - CREATE DATABASE
 *   - CREATE TABLE
 *   - ALTER TABLE (comparando la estructura original contra la editada)
 *
 * Se comparte entre el NAVEGADOR (window.DDLBuilder, para la vista previa en vivo)
 * y el SERVIDOR (require, para validar y ejecutar exactamente el mismo SQL).
 *
 * Modelo de una columna:
 *   { id, origName, name, type, length, unsigned, pk, nn, uq, ai, def,
 *     onUpdateNow, comment, uqIndex }
 * Modelo de una llave foránea:
 *   { id, origName, name, columnId, refTable, refColumn, onDelete, onUpdate }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DDLBuilder = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // ------------------------------------------------------------------
  // Catálogo de tipos de datos soportados por el diseñador
  //   len: 'none' | 'opt-int' | 'req-int' | 'opt-prec' | 'req-list'
  //   group: 'int' | 'num' | 'str' | 'bin' | 'date' | 'other'
  // ------------------------------------------------------------------
  const TYPES = {
    INT:        { group: 'int',  len: 'opt-int',  hint: 'Número entero (-2,147 millones a 2,147 millones)' },
    TINYINT:    { group: 'int',  len: 'opt-int',  hint: 'Entero pequeño (-128 a 127)' },
    SMALLINT:   { group: 'int',  len: 'opt-int',  hint: 'Entero (-32,768 a 32,767)' },
    MEDIUMINT:  { group: 'int',  len: 'opt-int',  hint: 'Entero mediano' },
    BIGINT:     { group: 'int',  len: 'opt-int',  hint: 'Entero muy grande' },
    DECIMAL:    { group: 'num',  len: 'opt-prec', hint: 'Número exacto, ej. 10,2 para dinero' },
    FLOAT:      { group: 'num',  len: 'opt-prec', hint: 'Número con decimales (aproximado)' },
    DOUBLE:     { group: 'num',  len: 'opt-prec', hint: 'Número con decimales de doble precisión' },
    BOOLEAN:    { group: 'bool', len: 'none',     hint: 'Verdadero / Falso (se guarda como TINYINT(1))' },
    BIT:        { group: 'bit',  len: 'opt-int',  hint: 'Valor de bits' },
    VARCHAR:    { group: 'str',  len: 'req-int',  hint: 'Texto de longitud variable, ej. 100' },
    CHAR:       { group: 'str',  len: 'opt-int',  hint: 'Texto de longitud fija' },
    TINYTEXT:   { group: 'str',  len: 'none',     hint: 'Texto hasta 255 caracteres' },
    TEXT:       { group: 'str',  len: 'none',     hint: 'Texto largo (hasta 65 KB)' },
    MEDIUMTEXT: { group: 'str',  len: 'none',     hint: 'Texto muy largo (hasta 16 MB)' },
    LONGTEXT:   { group: 'str',  len: 'none',     hint: 'Texto enorme (hasta 4 GB)' },
    ENUM:       { group: 'str',  len: 'req-list', hint: "Lista de opciones, ej. 'activo','inactivo'" },
    SET:        { group: 'str',  len: 'req-list', hint: "Varias opciones, ej. 'a','b','c'" },
    DATE:       { group: 'date', len: 'none',     hint: 'Fecha (AAAA-MM-DD)' },
    DATETIME:   { group: 'date', len: 'opt-int',  hint: 'Fecha y hora' },
    TIMESTAMP:  { group: 'date', len: 'opt-int',  hint: 'Fecha y hora (UTC), útil con CURRENT_TIMESTAMP' },
    TIME:       { group: 'date', len: 'opt-int',  hint: 'Hora (HH:MM:SS)' },
    YEAR:       { group: 'date', len: 'none',     hint: 'Año (AAAA)' },
    JSON:       { group: 'other', len: 'none',    hint: 'Documento JSON' },
    BINARY:     { group: 'bin',  len: 'opt-int',  hint: 'Binario de longitud fija' },
    VARBINARY:  { group: 'bin',  len: 'req-int',  hint: 'Binario de longitud variable' },
    TINYBLOB:   { group: 'bin',  len: 'none',     hint: 'Binario pequeño' },
    BLOB:       { group: 'bin',  len: 'none',     hint: 'Archivo / datos binarios' },
    MEDIUMBLOB: { group: 'bin',  len: 'none',     hint: 'Archivo binario mediano' },
    LONGBLOB:   { group: 'bin',  len: 'none',     hint: 'Archivo binario enorme' },
    GEOMETRY:   { group: 'other', len: 'none',    hint: 'Dato geográfico', hidden: true },
    POINT:      { group: 'other', len: 'none',    hint: 'Punto geográfico', hidden: true }
  };

  const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];
  const ENGINES = ['InnoDB', 'MyISAM'];

  // ------------------------------------------------------------------
  // Utilidades de escape
  // ------------------------------------------------------------------
  /** Encierra un identificador entre backticks escapando los backticks internos */
  function q(name) {
    return '`' + String(name).replace(/`/g, '``') + '`';
  }

  /** Convierte un texto en literal SQL: O'Brien -> 'O''Brien' */
  function str(value) {
    return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  }

  /** Nombre válido para bases de datos, tablas y columnas */
  function validateName(name, what) {
    const value = String(name || '');
    if (!value.trim()) return `El nombre de ${what} es obligatorio.`;
    if (value !== value.trim()) return `El nombre de ${what} "${value}" no puede empezar ni terminar con espacios.`;
    if (value.length > 64) return `El nombre de ${what} "${value}" supera los 64 caracteres permitidos por MySQL.`;
    if (!/^[\p{L}\p{N}_$]+$/u.test(value)) {
      return `El nombre de ${what} "${value}" solo puede contener letras, números, _ y $ (sin espacios ni guiones).`;
    }
    if (/^\d+$/.test(value)) return `El nombre de ${what} "${value}" no puede ser solo números.`;
    return null;
  }

  /** Recorta un nombre generado automáticamente al máximo de 64 caracteres */
  function autoName(prefix, ...parts) {
    return (prefix + '_' + parts.join('_')).slice(0, 64);
  }

  // ------------------------------------------------------------------
  // CREATE DATABASE
  // ------------------------------------------------------------------
  function buildCreateDatabase(def) {
    const errors = [];
    const nameError = validateName(def.name, 'la base de datos');
    if (nameError) errors.push(nameError);
    const charset = def.charset || 'utf8mb4';
    const collation = def.collation || '';
    if (!/^[a-z0-9_]+$/i.test(charset)) errors.push('Juego de caracteres inválido.');
    if (collation && !/^[a-z0-9_]+$/i.test(collation)) errors.push('Collation inválida.');

    let sql = `CREATE DATABASE ${def.ifNotExists ? 'IF NOT EXISTS ' : ''}${q(def.name || '')}\n  CHARACTER SET ${charset}`;
    if (collation) sql += `\n  COLLATE ${collation}`;
    return { statements: [sql], errors, warnings: [] };
  }

  // ------------------------------------------------------------------
  // Definición de una columna
  // ------------------------------------------------------------------
  function typeSql(col) {
    const type = String(col.type || '').toUpperCase();
    const len = String(col.length || '').trim();
    let sql = type;
    if (len) sql += `(${len})`;
    const meta = TYPES[type];
    if (col.unsigned && meta && (meta.group === 'int' || meta.group === 'num')) sql += ' UNSIGNED';
    return sql;
  }

  function defaultSql(col) {
    const raw = col.def === undefined || col.def === null ? '' : String(col.def);
    const value = raw.trim();
    if (!value || col.ai) return '';
    const meta = TYPES[String(col.type || '').toUpperCase()] || {};

    if (/^NULL$/i.test(value)) return ' DEFAULT NULL';
    if (meta.group === 'date' && /^(CURRENT_TIMESTAMP|NOW)(\(\d?\))?$/i.test(value)) {
      return ' DEFAULT ' + value.toUpperCase().replace(/^NOW/, 'CURRENT_TIMESTAMP');
    }
    // Expresiones entre paréntesis, ej. (UUID()) — soportado desde MySQL 8.0.13
    if (/^\(.*\)$/s.test(value)) return ' DEFAULT ' + value;
    if ((meta.group === 'int' || meta.group === 'num') && /^-?\d+(\.\d+)?$/.test(value)) return ' DEFAULT ' + value;
    if (meta.group === 'bool') {
      if (/^(TRUE|1)$/i.test(value)) return ' DEFAULT 1';
      if (/^(FALSE|0)$/i.test(value)) return ' DEFAULT 0';
    }
    if (meta.group === 'bit' && (/^b'[01]+'$/i.test(value) || /^\d+$/.test(value))) return ' DEFAULT ' + value;
    return ' DEFAULT ' + str(raw);
  }

  function columnSql(col) {
    let sql = `${q(col.name)} ${typeSql(col)}`;
    // Columnas calculadas (GENERATED): se conservan tal como están en la base de datos
    if (col.generated) {
      sql += ` GENERATED ALWAYS AS (${col.generated.expr}) ${col.generated.kind === 'STORED' ? 'STORED' : 'VIRTUAL'}`;
      if (col.nn) sql += ' NOT NULL';
      if (col.comment) sql += ' COMMENT ' + str(col.comment);
      return sql;
    }
    sql += (col.nn || col.pk) ? ' NOT NULL' : ' NULL';
    sql += defaultSql(col);
    if (col.onUpdateNow) sql += ' ON UPDATE CURRENT_TIMESTAMP';
    if (col.ai) sql += ' AUTO_INCREMENT';
    if (col.comment) sql += ' COMMENT ' + str(col.comment);
    return sql;
  }

  function validateColumns(columns, errors, warnings) {
    if (!columns.length) errors.push('La tabla necesita al menos una columna.');
    const seen = new Set();
    let aiCount = 0;
    columns.forEach((col, idx) => {
      const label = col.name ? `"${col.name}"` : `#${idx + 1}`;
      const nameError = validateName(col.name, `la columna ${idx + 1}`);
      if (nameError) errors.push(nameError);
      const lower = String(col.name || '').toLowerCase();
      if (lower && seen.has(lower)) errors.push(`La columna ${label} está repetida.`);
      seen.add(lower);

      const type = String(col.type || '').toUpperCase();
      const meta = TYPES[type];
      if (col.locked || col.generated) return; // columnas existentes con tipo especial: se conservan tal cual
      if (!meta) { errors.push(`La columna ${label} tiene un tipo de dato no soportado (${col.type}).`); return; }

      const len = String(col.length || '').trim();
      if (meta.len === 'none' && len) errors.push(`El tipo ${type} de la columna ${label} no lleva longitud.`);
      if (meta.len === 'req-int' && !len) errors.push(`La columna ${label} (${type}) necesita una longitud, ej. 100.`);
      if ((meta.len === 'req-int' || meta.len === 'opt-int') && len && !/^\d+$/.test(len)) {
        errors.push(`La longitud de ${label} debe ser un número entero.`);
      }
      if (meta.len === 'opt-prec' && len && !/^\d+(\s*,\s*\d+)?$/.test(len)) {
        errors.push(`La precisión de ${label} debe tener el formato M o M,D (ej. 10,2).`);
      }
      // Límites de MySQL para las longitudes más comunes
      if (/^\d+$/.test(len)) {
        const n = Number(len);
        if (meta.group === 'date' && n > 6) errors.push(`${type} solo admite de 0 a 6 decimales de segundo (${label}); deja la longitud vacía.`);
        if (type === 'VARCHAR' && (n < 1 || n > 16383)) errors.push(`La longitud de VARCHAR (${label}) debe estar entre 1 y 16383 con utf8mb4.`);
        if ((type === 'CHAR' || type === 'BINARY') && n > 255) errors.push(`${type} admite como máximo 255 (${label}); usa VARCHAR o TEXT.`);
        if (meta.group === 'int' && n > 255) errors.push(`El ancho de ${type} (${label}) no puede ser mayor a 255; normalmente se deja vacío.`);
      }
      if (meta.len === 'opt-prec' && /^\d+(\s*,\s*\d+)?$/.test(len)) {
        const [m, d = 0] = len.split(',').map(x => Number(x.trim()));
        if (type === 'DECIMAL' && (m < 1 || m > 65)) errors.push(`DECIMAL admite de 1 a 65 dígitos en total (${label}).`);
        if (d > 30 || d > m) errors.push(`Los decimales de ${label} no pueden ser más que el total de dígitos (máx. 30).`);
      }
      if (meta.len === 'req-list') {
        const listRe = /^'(?:[^'\\]|''|\\.)*'(?:\s*,\s*'(?:[^'\\]|''|\\.)*')*$/;
        if (!len) errors.push(`La columna ${label} (${type}) necesita sus opciones, ej. 'activo','inactivo'.`);
        else if (!listRe.test(len)) errors.push(`Las opciones de ${label} deben ir entre comillas simples y separadas por comas.`);
      }

      if (col.ai) {
        aiCount++;
        if (meta.group !== 'int') errors.push(`AUTO_INCREMENT (AI) solo se permite en columnas enteras; ${label} es ${type}.`);
        if (!col.pk && !col.uq) errors.push(`La columna ${label} con AUTO_INCREMENT debe ser PK o UNIQUE.`);
        if (String(col.def || '').trim()) warnings.push(`El valor por defecto de ${label} se ignora porque es AUTO_INCREMENT.`);
      }
      if (col.nn && /^NULL$/i.test(String(col.def || '').trim())) {
        errors.push(`La columna ${label} es NOT NULL y no puede tener DEFAULT NULL.`);
      }
      if (['str', 'bin', 'other'].includes(meta.group) && ['TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BLOB', 'LONGBLOB', 'JSON'].includes(type)
        && String(col.def || '').trim() && !/^\(.*\)$/s.test(String(col.def).trim()) && !/^NULL$/i.test(String(col.def).trim())) {
        warnings.push(`MySQL no permite DEFAULT literal en ${type} (${label}); usa una expresión entre paréntesis, ej. ('texto').`);
      }
      if (col.pk && col.uq) warnings.push(`${label} ya es PK; marcar UQ crea un índice duplicado.`);
    });
    if (aiCount > 1) errors.push('Solo puede haber una columna AUTO_INCREMENT por tabla.');
    if (!columns.some(c => c.pk)) warnings.push('La tabla no tiene llave primaria (PK). Es recomendable definir una.');
  }

  function resolveFk(fk, columns) {
    const col = columns.find(c => c.id === fk.columnId);
    return col ? col.name : null;
  }

  function fkSql(fk, columnName, tableName) {
    const name = fk.name || autoName('fk', tableName, columnName, fk.refTable);
    let sql = `CONSTRAINT ${q(name)} FOREIGN KEY (${q(columnName)}) REFERENCES ${q(fk.refTable)} (${q(fk.refColumn)})`;
    if (fk.onDelete && fk.onDelete !== 'RESTRICT') sql += ` ON DELETE ${fk.onDelete}`;
    if (fk.onUpdate && fk.onUpdate !== 'RESTRICT') sql += ` ON UPDATE ${fk.onUpdate}`;
    return sql;
  }

  function validateFks(fks, columns, errors) {
    fks.forEach((fk, idx) => {
      if (fk.multi) return; // llaves compuestas existentes: se conservan sin cambios
      const label = `Llave foránea #${idx + 1}`;
      const colName = resolveFk(fk, columns);
      if (!colName) errors.push(`${label}: elige la columna de esta tabla.`);
      if (!fk.refTable) errors.push(`${label}: elige la tabla referenciada.`);
      if (!fk.refColumn) errors.push(`${label}: elige la columna referenciada.`);
      if (fk.name) {
        const e = validateName(fk.name, 'la llave foránea');
        if (e) errors.push(e);
      }
      [fk.onDelete, fk.onUpdate].forEach(a => {
        if (a && !FK_ACTIONS.includes(a)) errors.push(`${label}: acción no válida (${a}).`);
      });
      const col = columns.find(c => c.id === fk.columnId);
      if (col && (fk.onDelete === 'SET NULL' || fk.onUpdate === 'SET NULL') && (col.nn || col.pk)) {
        errors.push(`${label}: SET NULL requiere que la columna "${col.name}" permita NULL (desmarca NN).`);
      }
    });
  }

  function tableOptionsSql(def) {
    let sql = '';
    if (def.engine) sql += ` ENGINE=${def.engine}`;
    if (def.comment) sql += ` COMMENT=${str(def.comment)}`;
    return sql;
  }

  // ------------------------------------------------------------------
  // CREATE TABLE
  // ------------------------------------------------------------------
  function buildCreateTable(def) {
    const errors = [];
    const warnings = [];
    const columns = def.columns || [];
    const fks = def.foreignKeys || [];

    if (!def.database) errors.push('Selecciona la base de datos donde se creará la tabla.');
    const tErr = validateName(def.name, 'la tabla');
    if (tErr) errors.push(tErr);
    if (def.engine && !ENGINES.includes(def.engine)) errors.push('Motor de almacenamiento no válido.');
    validateColumns(columns, errors, warnings);
    validateFks(fks, columns, errors);
    if (fks.length && def.engine === 'MyISAM') warnings.push('MyISAM ignora las llaves foráneas. Usa InnoDB.');

    const lines = columns.map(c => '  ' + columnSql(c));
    const pkCols = columns.filter(c => c.pk).map(c => q(c.name));
    if (pkCols.length) lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    columns.filter(c => c.uq && !c.pk).forEach(c => {
      lines.push(`  UNIQUE KEY ${q(autoName('uq', c.name))} (${q(c.name)})`);
    });
    fks.forEach(fk => {
      const colName = resolveFk(fk, columns) || '?';
      lines.push('  ' + fkSql(fk, colName, def.name || 'tabla'));
    });

    const target = def.database ? `${q(def.database)}.${q(def.name || '')}` : q(def.name || '');
    const sql = `CREATE TABLE ${target} (\n${lines.join(',\n')}\n)${tableOptionsSql(def)}`;
    return { statements: [sql], errors, warnings };
  }

  // ------------------------------------------------------------------
  // ALTER TABLE (comparación original vs editado)
  // ------------------------------------------------------------------
  function buildAlterTable(original, edited) {
    const errors = [];
    const warnings = [];
    const columns = edited.columns || [];
    const fks = edited.foreignKeys || [];
    const origColumns = original.columns || [];
    const origFks = original.foreignKeys || [];

    const tErr = validateName(edited.name, 'la tabla');
    if (tErr) errors.push(tErr);
    if (edited.engine && !ENGINES.includes(edited.engine)) errors.push('Motor de almacenamiento no válido.');
    validateColumns(columns, errors, warnings);
    validateFks(fks, columns, errors);

    const oldTarget = `${q(original.database)}.${q(original.name)}`;
    const newTarget = `${q(original.database)}.${q(edited.name)}`;
    const statements = [];

    // --- Llaves foráneas: cuáles se eliminan y cuáles se agregan ---
    const fkKey = (fk, cols) => fk.multi ? 'multi:' + fk.origName : [resolveFk(fk, cols), fk.refTable, fk.refColumn, fk.onDelete || 'RESTRICT', fk.onUpdate || 'RESTRICT'].join('|');
    const editedFkByOrig = new Map(fks.filter(f => f.origName).map(f => [f.origName, f]));
    const fkDrops = [];
    const fkAdds = [];
    origFks.forEach(ofk => {
      const efk = editedFkByOrig.get(ofk.origName);
      if (!efk || fkKey(efk, columns) !== fkKey(ofk, origColumns)) fkDrops.push(ofk.origName);
    });
    fks.forEach(efk => {
      const ofk = efk.origName ? origFks.find(o => o.origName === efk.origName) : null;
      if (!ofk || fkKey(efk, columns) !== fkKey(ofk, origColumns)) fkAdds.push(efk);
    });

    // --- Columnas ---
    const clauses = [];
    const editedOrigNames = new Set(columns.filter(c => c.origName).map(c => c.origName));
    origColumns.forEach(oc => {
      if (!editedOrigNames.has(oc.name)) clauses.push(`DROP COLUMN ${q(oc.name)}`);
    });

    columns.forEach((col, idx) => {
      const prev = idx === 0 ? null : columns[idx - 1];
      const position = prev ? ` AFTER ${q(prev.name)}` : ' FIRST';
      if (!col.origName) {
        clauses.push(`ADD COLUMN ${columnSql(col)}${position}`);
        return;
      }
      const oc = origColumns.find(o => o.name === col.origName);
      if (!oc) return;
      // ¿Cambió de posición? Se compara contra la columna ORIGINAL anterior que sigue existiendo
      // (las columnas nuevas o eliminadas no cuentan como movimiento).
      const survivors = origColumns.filter(o => editedOrigNames.has(o.name));
      const sIdx = survivors.indexOf(oc);
      const origPrevName = sIdx <= 0 ? null : survivors[sIdx - 1].name;
      const prevExisting = columns.slice(0, idx).filter(c => c.origName).pop();
      const prevOrigName = prevExisting ? prevExisting.origName : null;
      const moved = prevOrigName !== origPrevName;
      const changed = columnSql(col) !== columnSql({ ...oc, name: oc.name });
      if (changed || moved) {
        clauses.push(`CHANGE COLUMN ${q(oc.name)} ${columnSql(col)}${moved ? position : ''}`);
      }
    });

    // --- Llave primaria ---
    const origPk = origColumns.filter(c => c.pk).map(c => c.name);
    const newPk = columns.filter(c => c.pk);
    const pkChanged = origPk.length !== newPk.length || newPk.some((c, i) => c.origName !== origPk[i]);
    if (pkChanged) {
      if (origPk.length) clauses.push('DROP PRIMARY KEY');
      if (newPk.length) clauses.push(`ADD PRIMARY KEY (${newPk.map(c => q(c.name)).join(', ')})`);
    }

    // --- Índices UNIQUE de una columna ---
    columns.forEach(col => {
      const oc = col.origName ? origColumns.find(o => o.name === col.origName) : null;
      const wasUnique = !!(oc && oc.uq && oc.uqIndex);
      const isUnique = col.uq && !col.pk;
      if (isUnique && !wasUnique) clauses.push(`ADD UNIQUE KEY ${q(autoName('uq', col.name))} (${q(col.name)})`);
      if (!isUnique && wasUnique) clauses.push(`DROP INDEX ${q(oc.uqIndex)}`);
    });

    // --- Opciones de tabla ---
    if ((edited.engine || '') !== (original.engine || '') && edited.engine) clauses.push(`ENGINE=${edited.engine}`);
    if ((edited.comment || '') !== (original.comment || '')) clauses.push(`COMMENT=${str(edited.comment || '')}`);
    if (edited.name !== original.name) clauses.push(`RENAME TO ${newTarget}`);

    // Orden seguro: 1) quitar FKs  2) cambios de columnas/llaves  3) agregar FKs
    if (fkDrops.length) {
      statements.push(`ALTER TABLE ${oldTarget}\n  ${fkDrops.map(n => `DROP FOREIGN KEY ${q(n)}`).join(',\n  ')}`);
    }
    if (clauses.length) {
      statements.push(`ALTER TABLE ${oldTarget}\n  ${clauses.join(',\n  ')}`);
    }
    if (fkAdds.length) {
      statements.push(`ALTER TABLE ${newTarget}\n  ${fkAdds.map(fk => 'ADD ' + fkSql(fk, resolveFk(fk, columns) || '?', edited.name)).join(',\n  ')}`);
    }

    if (!statements.length) warnings.push('No hay cambios que aplicar.');
    if (origColumns.some(oc => !editedOrigNames.has(oc.name))) {
      warnings.push('Eliminar columnas borra permanentemente los datos que contienen.');
    }
    return { statements, errors, warnings };
  }

  return {
    TYPES,
    FK_ACTIONS,
    ENGINES,
    q,
    str,
    validateName,
    columnSql,
    typeSql,
    buildCreateDatabase,
    buildCreateTable,
    buildAlterTable
  };
});
