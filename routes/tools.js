/**
 * ============================================================================
 * RUTAS DE HERRAMIENTAS DEL STUDIO (routes/tools.js)
 * ============================================================================
 * 1. Diseñador visual: crear bases de datos, crear tablas y modificar tablas.
 * 2. Respaldo: exporta una base de datos completa (estructura + datos) a .sql
 * 3. Restauración: ejecuta un archivo .sql sentencia por sentencia.
 *
 * El SQL del diseñador se genera con el MISMO módulo que usa el navegador para
 * la vista previa (public/js/ddl-builder.js), así lo que el usuario ve es
 * exactamente lo que se ejecuta.
 */
const express = require('express');
const mysql = require('mysql2/promise');
const DDLBuilder = require('../public/js/ddl-builder');
const SqlUtils = require('../public/js/sql-utils');
const GridSql = require('../public/js/grid-sql');

const router = express.Router();

// ==========================================
// UTILIDADES
// ==========================================

/**
 * Abre una conexión con la configuración enviada por el cliente.
 * - dateStrings: las fechas se devuelven tal cual están guardadas (sin conversión de zona horaria)
 * - typeCast: las columnas JSON se devuelven como texto (necesario para el respaldo)
 */
function openConnection(config, database, extra = {}) {
  return mysql.createConnection({
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password || '',
    database: database || undefined,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    typeCast(field, next) {
      if (field.type === 'JSON' || field.extendedFormat === 'json') return field.string('utf8');
      if (field.type === 'GEOMETRY') return field.buffer();
      return next();
    },
    ...extra
  });
}

/** Middleware: valida que llegue la configuración de conexión */
function requireConnection(req, res, next) {
  if (!req.body || !req.body.connectionConfig) {
    return res.status(400).json({ error: 'Falta la configuración de conexión. Conecta un servidor primero.' });
  }
  next();
}

/** Ejecuta una lista de sentencias en orden; si una falla, indica cuál */
async function runStatements(connection, statements) {
  const executed = [];
  for (let i = 0; i < statements.length; i++) {
    try {
      await connection.query(statements[i]);
      executed.push(statements[i]);
    } catch (error) {
      error.failedIndex = i;
      error.executed = executed;
      throw error;
    }
  }
  return executed;
}

function builderError(res, result) {
  return res.status(400).json({ error: result.errors.join('\n'), errors: result.errors, warnings: result.warnings });
}

// ==========================================
// 1. DISEÑADOR VISUAL
// ==========================================

// Juegos de caracteres y collations disponibles en el servidor (para el modal "Nueva base de datos")
router.post('/designer/charsets', requireConnection, async (req, res) => {
  let connection;
  try {
    connection = await openConnection(req.body.connectionConfig);
    const [charsets] = await connection.query(
      'SELECT CHARACTER_SET_NAME AS name, DEFAULT_COLLATE_NAME AS defaultCollation, DESCRIPTION AS description FROM information_schema.CHARACTER_SETS ORDER BY CHARACTER_SET_NAME'
    );
    const [collations] = await connection.query(
      'SELECT COLLATION_NAME AS name, CHARACTER_SET_NAME AS charset FROM information_schema.COLLATIONS ORDER BY COLLATION_NAME'
    );
    res.json({ charsets, collations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// Crear una base de datos nueva
router.post('/designer/create-database', requireConnection, async (req, res) => {
  const result = DDLBuilder.buildCreateDatabase(req.body.definition || {});
  if (result.errors.length) return builderError(res, result);

  let connection;
  try {
    connection = await openConnection(req.body.connectionConfig);
    await runStatements(connection, result.statements);
    res.json({ status: 'success', statements: result.statements });
  } catch (error) {
    res.status(500).json({ error: error.message, sql: result.statements.join(';\n') });
  } finally {
    if (connection) await connection.end();
  }
});

// Crear una tabla nueva
router.post('/designer/create-table', requireConnection, async (req, res) => {
  const definition = req.body.definition || {};
  const result = DDLBuilder.buildCreateTable(definition);
  if (result.errors.length) return builderError(res, result);

  let connection;
  try {
    connection = await openConnection(req.body.connectionConfig, definition.database);
    await runStatements(connection, result.statements);
    res.json({ status: 'success', statements: result.statements, warnings: result.warnings });
  } catch (error) {
    res.status(500).json({ error: error.message, sql: result.statements.join(';\n') });
  } finally {
    if (connection) await connection.end();
  }
});

// Aplicar cambios a una tabla existente (ALTER TABLE)
router.post('/designer/alter-table', requireConnection, async (req, res) => {
  const { original, edited } = req.body;
  if (!original || !edited) return res.status(400).json({ error: 'Faltan los datos de la tabla.' });
  if (SqlUtils.isSystemSchema(original.database)) {
    return res.status(403).json({ error: 'No se permite modificar tablas de las bases de datos del sistema.' });
  }
  const result = DDLBuilder.buildAlterTable(original, edited);
  if (result.errors.length) return builderError(res, result);
  if (!result.statements.length) return res.status(400).json({ error: 'No hay cambios que aplicar.' });

  let connection;
  try {
    connection = await openConnection(req.body.connectionConfig, original.database);
    await runStatements(connection, result.statements);
    res.json({ status: 'success', statements: result.statements, warnings: result.warnings });
  } catch (error) {
    const step = error.failedIndex !== undefined ? ` (paso ${error.failedIndex + 1} de ${result.statements.length})` : '';
    const partial = error.executed && error.executed.length
      ? '\nAtención: los pasos anteriores sí se aplicaron. Recarga la estructura antes de reintentar.'
      : '';
    res.status(500).json({ error: error.message + step + partial, sql: result.statements.join(';\n\n') });
  } finally {
    if (connection) await connection.end();
  }
});

/**
 * Normaliza el valor DEFAULT que reporta information_schema para que el diseñador
 * lo muestre igual que como lo escribiría el usuario.
 * MySQL 8 devuelve el texto sin comillas; MariaDB lo devuelve como expresión SQL ('texto', NULL, current_timestamp()).
 */
function normalizeDefault(rawDefault, extra, isMaria) {
  if (rawDefault === null || rawDefault === undefined) return '';
  let value = String(rawDefault);
  if (isMaria) {
    if (value === 'NULL') return '';
    if (/^'.*'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'").replace(/\\\\/g, '\\');
    if (/^current_timestamp(\(\d*\))?$/i.test(value)) return 'CURRENT_TIMESTAMP' + (value.match(/\(\d+\)/) || [''])[0];
    if (/^-?\d+(\.\d+)?$/.test(value)) return value;
    return `(${value})`;
  }
  if (/DEFAULT_GENERATED/i.test(extra || '')) {
    if (/^current_timestamp(\(\d*\))?$/i.test(value)) return value.toUpperCase();
    return `(${value})`;
  }
  return value;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Lee la estructura completa de una tabla (columnas, llave primaria, UNIQUE,
 * llaves foráneas) en el formato que usan el diseñador y el editor del grid.
 * Lanza un error con .status si la tabla no existe o es una vista.
 */
async function loadTableStructure(connection, database, table) {
  const [[versionRow]] = await connection.query('SELECT VERSION() AS v');
  const isMaria = /mariadb/i.test(versionRow.v);

  const [[tableInfo]] = await connection.query(
    'SELECT ENGINE, TABLE_COMMENT, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [database, table]
  );
if (!tableInfo) throw httpError(404, `La tabla ${table} no existe en ${database}.`);
if (tableInfo.TABLE_TYPE !== 'BASE TABLE') throw httpError(400, `${table} es una vista, no una tabla.`);

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, GENERATION_EXPRESSION
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [database, table]
  );
  const [indexRows] = await connection.query(
    `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [database, table]
  );
  const [fkRows] = await connection.query(
    `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [database, table]
  );

  // Índices: llave primaria (en orden) y UNIQUE de una sola columna
  const indexes = {};
  indexRows.forEach(r => {
    if (!indexes[r.INDEX_NAME]) indexes[r.INDEX_NAME] = { unique: Number(r.NON_UNIQUE) === 0, columns: [] };
    indexes[r.INDEX_NAME].columns.push(r.COLUMN_NAME);
  });
  const pkColumns = indexes.PRIMARY ? indexes.PRIMARY.columns : [];
  const singleUnique = {};
  let compositeIndexes = 0;
  Object.entries(indexes).forEach(([name, idx]) => {
    if (name === 'PRIMARY') return;
    if (idx.unique && idx.columns.length === 1 && !singleUnique[idx.columns[0]]) singleUnique[idx.columns[0]] = name;
    else if (idx.columns.length > 1) compositeIndexes++;
  });

  // Columnas en el formato del diseñador. El orden de la PK se respeta ordenando por su posición.
  const columns = cols.map((c, i) => {
    const m = String(c.COLUMN_TYPE).match(/^(\w+)(?:\((.*)\))?\s*(unsigned)?/i) || [];
    const extra = c.EXTRA || '';
    const isGenerated = /\b(VIRTUAL|STORED|PERSISTENT)\b/i.test(extra) && c.GENERATION_EXPRESSION;
    return {
      id: 'c' + i,
      origName: c.COLUMN_NAME,
      name: c.COLUMN_NAME,
      type: (m[1] || c.COLUMN_TYPE).toUpperCase(),
      length: m[2] || '',
      unsigned: !!m[3],
      pk: pkColumns.includes(c.COLUMN_NAME),
      nn: c.IS_NULLABLE === 'NO',
      uq: !!singleUnique[c.COLUMN_NAME],
      uqIndex: singleUnique[c.COLUMN_NAME] || null,
      ai: /auto_increment/i.test(extra),
      def: isGenerated ? '' : normalizeDefault(c.COLUMN_DEFAULT, extra, isMaria),
      onUpdateNow: /on update current_timestamp/i.test(extra),
      comment: c.COLUMN_COMMENT || '',
      locked: !DDLBuilder.TYPES[(m[1] || c.COLUMN_TYPE).toUpperCase()],
      generated: isGenerated ? { expr: c.GENERATION_EXPRESSION, kind: /STORED|PERSISTENT/i.test(extra) ? 'STORED' : 'VIRTUAL' } : null
    };
  });
  // La PK compuesta debe conservar su orden original
  const pkOrdered = pkColumns.map(name => columns.find(c => c.name === name)).filter(Boolean);
  const pkOrderMismatch = pkOrdered.some((c, i) => columns.filter(x => x.pk)[i] !== c);

  // Llaves foráneas agrupadas por nombre de constraint
  const fkMap = {};
  fkRows.forEach(r => {
    if (!fkMap[r.CONSTRAINT_NAME]) {
      fkMap[r.CONSTRAINT_NAME] = {
        name: r.CONSTRAINT_NAME, columns: [], refTable: r.REFERENCED_TABLE_NAME, refColumns: [],
        onDelete: r.DELETE_RULE, onUpdate: r.UPDATE_RULE
      };
    }
    fkMap[r.CONSTRAINT_NAME].columns.push(r.COLUMN_NAME);
    fkMap[r.CONSTRAINT_NAME].refColumns.push(r.REFERENCED_COLUMN_NAME);
  });
  const foreignKeys = Object.values(fkMap).map((fk, i) => {
    const col = columns.find(c => c.name === fk.columns[0]);
    return {
      id: 'f' + i,
      origName: fk.name,
      name: fk.name,
      columnId: col ? col.id : null,
      refTable: fk.refTable,
      refColumn: fk.refColumns[0],
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
      multi: fk.columns.length > 1,
      multiLabel: fk.columns.length > 1 ? `(${fk.columns.join(', ')}) → ${fk.refTable}(${fk.refColumns.join(', ')})` : null
    };
  });

  const notes = [];
  if (compositeIndexes) notes.push(`La tabla tiene ${compositeIndexes} índice(s) de varias columnas; se conservan sin cambios.`);
  if (pkOrderMismatch) notes.push('La llave primaria compuesta tiene un orden distinto al de las columnas; si la modificas se reordenará.');

  return {
    table: {
      database,
      name: table,
      engine: tableInfo.ENGINE,
      comment: tableInfo.TABLE_COMMENT || '',
      columns,
      foreignKeys
    },
    notes,
    isSystem: SqlUtils.isSystemSchema(database)
  };
}

// Leer la estructura de una tabla en el formato que usa el diseñador
router.post('/designer/table-structure', requireConnection, async (req, res) => {
  const { database, table } = req.body;
  if (!database || !table) return res.status(400).json({ error: 'Falta la base de datos o la tabla.' });

  let connection;
  try {
    connection = await openConnection(req.body.connectionConfig);
    res.json(await loadTableStructure(connection, database, table));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ==========================================
// 1-B. EDICIÓN DE DATOS DESDE EL GRID
// ==========================================
/**
 * Aplica los cambios hechos en el grid (UPDATE / INSERT / DELETE) dentro de
 * una TRANSACCIÓN: si una sentencia falla, o un UPDATE/DELETE no encuentra
 * su fila (porque alguien más la cambió), se deshace todo con ROLLBACK.
 * El SQL se genera aquí con GridSql usando la estructura REAL de la tabla.
 */
router.post('/grid/apply', requireConnection, async (req, res) => {
  const { database, table, changes } = req.body;
  if (!database || !table || !changes) return res.status(400).json({ error: 'Faltan datos para aplicar los cambios.' });
  if (SqlUtils.isSystemSchema(database)) {
    return res.status(403).json({ error: 'No se permite editar datos de las bases de datos del sistema.' });
  }

  let connection;
  let inTransaction = false;
  try {
    connection = await openConnection(req.body.connectionConfig, database);
    const { table: structure } = await loadTableStructure(connection, database, table);
    const built = GridSql.buildChanges(structure, changes);
    if (built.errors.length) return res.status(400).json({ error: built.errors.join('\n'), errors: built.errors });
    if (!built.statements.length) return res.status(400).json({ error: 'No hay cambios que aplicar.' });

    await connection.beginTransaction();
    inTransaction = true;
    const results = [];
    for (let i = 0; i < built.statements.length; i++) {
      const stmt = built.statements[i];
      let result;
      try {
        [result] = await connection.query(stmt.sql);
      } catch (error) {
        await connection.rollback();
        inTransaction = false;
        return res.status(500).json({
          error: `${error.message}\n(sentencia ${i + 1} de ${built.statements.length}; se deshicieron todos los cambios)`,
          failedAt: i + 1,
          sql: stmt.sql
        });
      }
      if (stmt.expectOne && result.affectedRows !== 1) {
        await connection.rollback();
        inTransaction = false;
        return res.status(409).json({
          error: `La sentencia ${i + 1} no encontró la fila (quizá otra persona la modificó o eliminó). Se deshicieron todos los cambios; vuelve a ejecutar la consulta.`,
          failedAt: i + 1,
          sql: stmt.sql
        });
      }
      results.push({ type: stmt.type, sql: stmt.sql, affectedRows: result.affectedRows, insertId: result.insertId || null });
    }
    await connection.commit();
    inTransaction = false;
    res.json({ status: 'success', results });
  } catch (error) {
    if (inTransaction) { try { await connection.rollback(); } catch (e) { /* conexión perdida */ } }
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ==========================================
// 2. RESPALDO (.sql)
// ==========================================

/** Quita la cláusula DEFINER=`usuario`@`host` para que el respaldo funcione en otro servidor */
function stripDefiner(sql) {
  return String(sql).replace(/\s+DEFINER\s*=\s*(`[^`]*`|'[^']*'|[^\s@]+)@(`[^`]*`|'[^']*'|\S+)/i, '');
}

router.post('/backup', requireConnection, async (req, res) => {
  const { database } = req.body;
  const options = Object.assign(
    { structure: true, data: true, dropTables: true, createDatabase: false, routines: true },
    req.body.options || {}
  );
  if (!database) return res.status(400).json({ error: 'Selecciona la base de datos a respaldar.' });
  if (!options.structure && !options.data) return res.status(400).json({ error: 'Elige al menos estructura o datos.' });

  let connection;
  try {
    connection = await openConnection(req.body.connectionConfig, database);
    const q = DDLBuilder.q;
    await connection.query("SET time_zone = '+00:00'"); // TIMESTAMP en UTC, igual que mysqldump

    const [[info]] = await connection.query('SELECT VERSION() AS version, @@character_set_database AS charset, @@collation_database AS collation');
    const [fullTables] = await connection.query('SHOW FULL TABLES');
    const nameKey = Object.keys(fullTables[0] || {}).find(k => k.startsWith('Tables_in_'));
    const baseTables = fullTables.filter(r => r.Table_type === 'BASE TABLE').map(r => r[nameKey]);
    const views = fullTables.filter(r => r.Table_type === 'VIEW').map(r => r[nameKey]);

    const out = [];
    const cfg = req.body.connectionConfig;
    out.push('-- ------------------------------------------------------');
    out.push('-- My Best DataBase - Respaldo SQL');
    out.push(`-- Base de datos: ${database}`);
    out.push(`-- Servidor: ${cfg.host}:${cfg.port || 3306} (MySQL ${info.version})`);
    out.push(`-- Fecha: ${new Date().toLocaleString('es-MX')}`);
    out.push(`-- Contenido: ${[options.structure && 'estructura', options.data && 'datos', options.structure && options.routines && 'vistas/triggers/rutinas'].filter(Boolean).join(', ')}`);
    out.push('-- ------------------------------------------------------', '');
    out.push('SET NAMES utf8mb4;');
    out.push('SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;');
    out.push("SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';");
    out.push("SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='+00:00';", '');

    if (options.createDatabase) {
      out.push(`CREATE DATABASE IF NOT EXISTS ${q(database)} CHARACTER SET ${info.charset} COLLATE ${info.collation};`);
      out.push(`USE ${q(database)};`, '');
    }

    let totalRows = 0;
    for (const table of baseTables) {
      if (options.structure) {
        const [[create]] = await connection.query(`SHOW CREATE TABLE ${q(table)}`);
        out.push('--', `-- Estructura de la tabla ${q(table)}`, '--');
        if (options.dropTables) out.push(`DROP TABLE IF EXISTS ${q(table)};`);
        out.push(create['Create Table'] + ';', '');
      }

      if (options.data) {
        // Las columnas calculadas (GENERATED) no se pueden insertar: se omiten
        const [colRows] = await connection.query(
          'SELECT COLUMN_NAME, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
          [database, table]
        );
        const insertable = colRows
          .filter(c => !/\b(VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(c.EXTRA || ''))
          .map(c => c.COLUMN_NAME);
        if (!insertable.length) continue;

        const [rows] = await connection.query(`SELECT ${insertable.map(q).join(', ')} FROM ${q(table)}`);
        if (!rows.length) continue;
        totalRows += rows.length;

        out.push('--', `-- Datos de la tabla ${q(table)} (${rows.length} filas)`, '--');
        const header = `INSERT INTO ${q(table)} (${insertable.map(q).join(', ')}) VALUES`;
        let batch = [];
        let batchSize = 0;
        const flush = () => {
          if (batch.length) out.push(header + '\n' + batch.join(',\n') + ';');
          batch = [];
          batchSize = 0;
        };
        for (const row of rows) {
          const values = '(' + insertable.map(col => connection.escape(row[col])).join(', ') + ')';
          batch.push(values);
          batchSize += values.length;
          if (batch.length >= 100 || batchSize > 512 * 1024) flush();
        }
        flush();
        out.push('');
      }
    }

    if (options.structure && options.routines) {
      // Vistas: se ordenan para que una vista que usa otra se cree después
      const viewDefs = [];
      for (const view of views) {
        const [[create]] = await connection.query(`SHOW CREATE VIEW ${q(view)}`);
        viewDefs.push({ name: view, sql: stripDefiner(create['Create View']) });
      }
      const ordered = [];
      const pending = [...viewDefs];
      let guard = pending.length * pending.length + 1;
      while (pending.length && guard-- > 0) {
        const v = pending.shift();
        const dependsOnPending = pending.some(p => v.sql.includes('`' + p.name + '`'));
        if (dependsOnPending) pending.push(v); else ordered.push(v);
      }
      ordered.push(...pending);
      ordered.forEach(v => {
        out.push('--', `-- Vista ${q(v.name)}`, '--');
        out.push(`DROP VIEW IF EXISTS ${q(v.name)};`);
        out.push(v.sql + ';', '');
      });

      // Triggers (después de los datos para que no se disparen al restaurar los INSERT)
      const [triggers] = await connection.query('SHOW TRIGGERS');
      for (const trg of triggers) {
        // Se reconstruye el encabezado sin el nombre de la base de datos, para poder
        // restaurar el respaldo en una base de datos con otro nombre.
        const body = `CREATE TRIGGER ${q(trg.Trigger)} ${trg.Timing} ${trg.Event} ON ${q(trg.Table)} FOR EACH ROW ${trg.Statement}`;
        out.push('--', `-- Trigger ${q(trg.Trigger)}`, '--');
        out.push(`DROP TRIGGER IF EXISTS ${q(trg.Trigger)};`);
        out.push('DELIMITER ;;', body + ';;', 'DELIMITER ;', '');
      }

      // Procedimientos y funciones almacenadas
      const [routines] = await connection.query(
        'SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME',
        [database]
      );
      for (const r of routines) {
        const kind = r.ROUTINE_TYPE === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
        const [[create]] = await connection.query(`SHOW CREATE ${kind} ${q(r.ROUTINE_NAME)}`);
        const body = create && create[kind === 'FUNCTION' ? 'Create Function' : 'Create Procedure'];
        if (!body) continue;
        out.push('--', `-- ${kind === 'FUNCTION' ? 'Función' : 'Procedimiento'} ${q(r.ROUTINE_NAME)}`, '--');
        out.push(`DROP ${kind} IF EXISTS ${q(r.ROUTINE_NAME)};`);
        out.push('DELIMITER ;;', stripDefiner(body) + ';;', 'DELIMITER ;', '');
      }
    }

    out.push('SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;');
    out.push('SET SQL_MODE=@OLD_SQL_MODE;');
    out.push('SET TIME_ZONE=@OLD_TIME_ZONE;', '');
    out.push(`-- Respaldo completado: ${baseTables.length} tablas, ${views.length} vistas, ${totalRows} filas`);

    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
    const fileName = `${database}_${stamp}.sql`;
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('X-Backup-Summary', encodeURIComponent(JSON.stringify({
      fileName, tables: baseTables.length, views: views.length, rows: totalRows
    })));
    res.send(out.join('\n'));
  } catch (error) {
    console.error('Error al generar respaldo:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ==========================================
// 3. RESTAURACIÓN (.sql)
// ==========================================
router.post('/restore', requireConnection, async (req, res) => {
  const { database, createIfMissing, sql } = req.body;
  if (!sql || !String(sql).trim()) return res.status(400).json({ error: 'El archivo .sql está vacío.' });
  if (!database) return res.status(400).json({ error: 'Elige la base de datos destino.' });
  const nameError = DDLBuilder.validateName(database, 'la base de datos destino');
  if (nameError) return res.status(400).json({ error: nameError });
  if (SqlUtils.isSystemSchema(database)) {
    return res.status(403).json({ error: 'No se permite restaurar sobre una base de datos del sistema.' });
  }
  const blocked = SqlUtils.findBlockedStatement(sql);
  if (blocked) return res.status(403).json({ error: blocked });

  const statements = SqlUtils.splitStatements(sql);
  if (!statements.length) return res.status(400).json({ error: 'No se encontraron sentencias SQL en el archivo.' });

  let connection;
  const startTime = Date.now();
  try {
    connection = await openConnection(req.body.connectionConfig);
    if (createIfMissing) {
      await connection.query(`CREATE DATABASE IF NOT EXISTS ${DDLBuilder.q(database)} CHARACTER SET utf8mb4`);
    }
    await connection.query(`USE ${DDLBuilder.q(database)}`);

    let executed = 0;
    for (const stmt of statements) {
      try {
        await connection.query(stmt.sql);
        executed++;
      } catch (error) {
        return res.status(500).json({
          error: error.message,
          failedAt: executed + 1,
          total: statements.length,
          line: stmt.line,
          snippet: stmt.sql.slice(0, 300),
          executed
        });
      }
    }
    res.json({ status: 'success', executed, total: statements.length, timeMs: Date.now() - startTime });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;
