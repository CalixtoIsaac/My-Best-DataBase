require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const toolsRoutes = require('./routes/tools');        // Diseñador visual, respaldo y restauración
const SqlUtils = require('./public/js/sql-utils');    // Análisis de sentencias (compartido con el navegador)
const { Types: MYSQL_TYPES } = require('mysql2');

/**
 * Describe cada columna del resultado: de qué tabla/columna REAL proviene y de
 * qué tipo es. El navegador lo usa para los filtros por columna y para saber
 * si el resultado se puede editar (todas las columnas vienen de una sola tabla).
 */
function describeFields(fields) {
  const kindOf = (typeName, charset) => {
    if (['TINY', 'SHORT', 'LONG', 'LONGLONG', 'INT24', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NEWDECIMAL', 'YEAR'].includes(typeName)) return 'number';
    if (['DATE', 'NEWDATE', 'DATETIME', 'DATETIME2', 'TIMESTAMP', 'TIMESTAMP2', 'TIME', 'TIME2'].includes(typeName)) return 'date';
    if (['VARCHAR', 'VAR_STRING', 'STRING', 'ENUM', 'SET', 'JSON'].includes(typeName)) return charset === 63 ? 'binary' : 'text';
    if (['TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB'].includes(typeName)) return charset === 63 ? 'binary' : 'text';
    return 'other';
  };
  return (fields || []).map(f => {
    const typeName = MYSQL_TYPES[f.columnType] || String(f.columnType);
    return {
      name: f.name,
      orgName: f.orgName || '',
      table: f.table || '',
      orgTable: f.orgTable || '',
      db: f.schema || f.db || '',
      mysqlType: typeName,
      kind: kindOf(typeName, f.characterSet)
    };
  });
}
const mysql = require('mysql2/promise');
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARES DE LA APLICACIÓN
// ==========================================
app.use(cors());
// Límite de 60 MB para poder restaurar archivos .sql grandes
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Servir archivos estáticos (CSS, JS, imágenes) desde /public
app.use(express.static(path.join(__dirname, 'public')));

// Librería SheetJS (lectura/escritura de Excel) para el Conversor de Datos.
// Se sirve desde node_modules para que funcione sin internet (npm install).
app.use('/vendor/xlsx', express.static(path.join(__dirname, 'node_modules', 'xlsx', 'dist')));

// ==========================================
// RUTAS DE LA API
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api', toolsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'SQL Database Studio Engine',
    timestamp: new Date() 
  });
});

app.post('/api/query', async (req, res) => {
  const { sql, connectionConfig } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'Debes proporcionar una consulta SQL para ejecutar.' });
  }

  if (!connectionConfig) {
    return res.status(400).json({ error: 'Falta la configuración de conexión. Por favor configura tu conexión a la base de datos primero.' });
  }

  // Segunda capa de seguridad: aunque el navegador ya pidió confirmación,
  // nunca se permite eliminar las bases de datos internas de MySQL.
  const blocked = SqlUtils.findBlockedStatement(sql);
  if (blocked) {
    return res.status(403).json({ error: blocked });
  }

  let connection;
  try {
    const startTime = performance.now();
    // Crear la conexión usando los parámetros proporcionados por el cliente
    connection = await mysql.createConnection({
      host: connectionConfig.host,
      port: connectionConfig.port || 3306,
      user: connectionConfig.user,
      password: connectionConfig.password || '',
      database: connectionConfig.database || undefined,
      multipleStatements: true, // Permite ejecutar scripts con múltiples consultas separadas por ;
      dateStrings: true,        // Muestra fechas tal como están guardadas (sin desfase de zona horaria)
      typeCast(field, next) {   // Las columnas JSON se muestran/exportan como texto
        if (field.type === 'JSON' || field.extendedFormat === 'json') return field.string('utf8');
        return next();
      }
    });

    // Ejecutar la consulta
    const [rows, fields] = await connection.query(sql);
    const executionTimeMs = Math.round(performance.now() - startTime);

    // Normalizar la respuesta. Con varias sentencias (multipleStatements) mysql2 devuelve
    // un arreglo de resultados; mostramos el ÚLTIMO resultado que tenga filas (como Workbench)
    // y sumamos las filas afectadas de las sentencias INSERT/UPDATE/DELETE.
    let columns = [];
    let actualRows = [];
    let resultFields = [];
    let affectedRows = 0;
    const isMulti = Array.isArray(fields) && (fields.length === 0 || fields.some(f => f === undefined || Array.isArray(f)));

    if (isMulti) {
      rows.forEach((result, idx) => {
        if (Array.isArray(result) && Array.isArray(fields[idx])) {
          actualRows = result;
          columns = fields[idx].map(field => field.name);
          resultFields = fields[idx];
        } else if (result && typeof result.affectedRows === 'number') {
          affectedRows += result.affectedRows;
        }
      });
    } else if (Array.isArray(rows)) {
      actualRows = rows;
      columns = (fields || []).map(field => field.name);
      resultFields = fields || [];
    } else {
      affectedRows = rows.affectedRows || 0;
    }

    return res.json({
      status: 'success',
      columns: columns,
      rows: actualRows,
      fields: describeFields(resultFields),
      affectedRows,
      executionTimeMs
    });
  } catch (error) {
    console.error('Error SQL:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// Obtener lista de bases de datos (esquemas)
app.post('/api/databases', async (req, res) => {
  const { connectionConfig } = req.body;
  if (!connectionConfig) {
    return res.status(400).json({ error: 'Configuración de conexión no proporcionada.' });
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: connectionConfig.host,
      port: connectionConfig.port || 3306,
      user: connectionConfig.user,
      password: connectionConfig.password || ''
    });

    const [rows] = await connection.query('SHOW DATABASES;');
    // Filtramos las bases de datos de sistema opcionalmente o las devolvemos todas
    const databases = rows.map(r => Object.values(r)[0]);
    return res.json({ databases });
  } catch (error) {
    console.error('Error al listar bases de datos:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// Eliminar una base de datos después de la confirmación del cliente
app.delete('/api/databases', async (req, res) => {
  const { connectionConfig, database } = req.body;
  if (!connectionConfig || !database) {
    return res.status(400).json({ error: 'Configuración o base de datos no proporcionada.' });
  }
  if (SqlUtils.isSystemSchema(database)) {
    return res.status(403).json({ error: `La base de datos "${database}" es del sistema y está protegida.` });
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: connectionConfig.host,
      port: connectionConfig.port || 3306,
      user: connectionConfig.user,
      password: connectionConfig.password || ''
    });

    await connection.query('DROP DATABASE ??', [database]);
    return res.json({ status: 'success', database });
  } catch (error) {
    console.error('Error al eliminar base de datos:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// Obtener tablas de una base de datos específica
app.post('/api/tables', async (req, res) => {
  const { connectionConfig, database } = req.body;
  if (!connectionConfig || !database) {
    return res.status(400).json({ error: 'Configuración o base de datos no proporcionada.' });
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: connectionConfig.host,
      port: connectionConfig.port || 3306,
      user: connectionConfig.user,
      password: connectionConfig.password || '',
      database: database
    });

    const [rows] = await connection.query('SHOW TABLES;');
    const tables = rows.map(r => Object.values(r)[0]);
    return res.json({ tables });
  } catch (error) {
    console.error('Error al listar tablas:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// Obtener estructura completa de la base de datos (columnas, tipos, claves foráneas) para el diagrama ER
app.post('/api/schema', async (req, res) => {
  const { connectionConfig, database } = req.body;
  if (!connectionConfig || !database) {
    return res.status(400).json({ error: 'Configuración o base de datos no proporcionada.' });
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: connectionConfig.host,
      port: connectionConfig.port || 3306,
      user: connectionConfig.user,
      password: connectionConfig.password || '',
      database: database
    });

    // 1. Obtener todas las columnas
    const [columnsRows] = await connection.query(`
      SELECT 
        TABLE_NAME, 
        COLUMN_NAME, 
        COLUMN_TYPE, 
        IS_NULLABLE, 
        COLUMN_KEY, 
        EXTRA 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `, [database]);

    // 2. Obtener todas las relaciones (Foreign Keys)
    const [relationsRows] = await connection.query(`
      SELECT 
        TABLE_NAME, 
        COLUMN_NAME, 
        REFERENCED_TABLE_NAME, 
        REFERENCED_COLUMN_NAME,
        CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? 
        AND REFERENCED_TABLE_NAME IS NOT NULL;
    `, [database]);

    // Organizar en un mapa de tablas
    const tablesMap = {};
    columnsRows.forEach(col => {
      if (!tablesMap[col.TABLE_NAME]) {
        tablesMap[col.TABLE_NAME] = {
          name: col.TABLE_NAME,
          columns: []
        };
      }
      tablesMap[col.TABLE_NAME].columns.push({
        name: col.COLUMN_NAME,
        type: col.COLUMN_TYPE,
        isNullable: col.IS_NULLABLE === 'YES',
        isPrimary: col.COLUMN_KEY === 'PRI',
        isForeign: false,
        extra: col.EXTRA
      });
    });

    const relations = relationsRows.map(rel => {
      // Marcar columna como foránea
      if (tablesMap[rel.TABLE_NAME]) {
        const col = tablesMap[rel.TABLE_NAME].columns.find(c => c.name === rel.COLUMN_NAME);
        if (col) col.isForeign = true;
      }
      return {
        fromTable: rel.TABLE_NAME,
        fromColumn: rel.COLUMN_NAME,
        toTable: rel.REFERENCED_TABLE_NAME,
        toColumn: rel.REFERENCED_COLUMN_NAME,
        constraint: rel.CONSTRAINT_NAME
      };
    });

    return res.json({
      database,
      tables: Object.values(tablesMap),
      relations
    });
  } catch (error) {
    console.error('Error al generar el esquema ER:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// ==========================================
// RUTAS DE NAVEGACIÓN WEB (HTML)
// ==========================================

// Ruta raíz: Redirige automáticamente al Login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la pantalla de Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la pantalla del Studio
app.get('/studio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'studio.html'));
});

// Redirección por defecto: Cualquier ruta no encontrada vuelve al login
app.get('*', (req, res) => {
  res.redirect('/login');
});

// ==========================================
// ARRANQUE DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 SQL Database Studio iniciado correctamente`);
  console.log(`🌐 Acceso Web: http://localhost:${PORT}`);
  console.log(`===============================================`);
});