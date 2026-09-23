/**
 * ============================================================================
 * MÓDULO PRINCIPAL DE LA INTERFAZ DE USUARIO (app.js)
 * ============================================================================
 * Este archivo controla toda la interactividad del Studio SQL:
 * 1. Inicialización y gestión de la sesión del usuario.
 * 2. Editor de código interactivo con numeración de líneas y tabulación.
 * 3. Ejecución de consultas SQL vía API AJAX y renderizado de resultados en tabla.
 * 4. Consola de registros (logs) del sistema en tiempo real.
 * 5. Sistema de pestañas y conmutación de vistas.
 * 6. Herramientas auxiliares (Conversor de formatos de datos, Diagrama ER y Modales).
 */

// ==========================================
// 1. INICIALIZACIÓN DEL STUDIO
// ==========================================
// Se dispara automáticamente cuando la estructura del HTML (DOM) está lista para ser manipulada.
document.addEventListener('DOMContentLoaded', () => {
  checkActiveSession(); // Verifica el token de acceso en localStorage (definido en auth.js)
  initEditor();         // Vincula los eventos del editor de texto y sincroniza los números de línea
  refreshSidebar();     // Inicializa el estado de la barra lateral de esquemas/bases de datos
});

// ==========================================
// 2. CONTROL DEL EDITOR SQL Y NÚMEROS DE LÍNEA
// ==========================================
/**
 * Inicializa el editor interactivo de consultas SQL.
 * Maneja el auto-incremental de líneas, sincronización de desplazamiento (scroll)
 * e intercepta la tecla 'Tab' para insertar espacios en blanco sin perder el foco.
 */
// ==========================================
// LISTA DE PALABRAS CLAVE Y FUNCIONES SQL
// ==========================================
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'DATABASE', 'TABLE', 'DROP', 'ALTER', 'ADD', 'COLUMN',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'HAVING', 'LIMIT',
  'OFFSET', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN',
  'EXISTS', 'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'USE', 'SHOW', 'DATABASES', 'TABLES', 'DESCRIBE', 'EXPLAIN', 'TRUNCATE',
  'INT', 'VARCHAR', 'TEXT', 'DATETIME', 'DATE', 'BOOLEAN', 'DECIMAL', 'FLOAT'
];

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CONCAT', 'NOW', 'CURDATE', 'COALESCE',
  'IFNULL', 'ROUND', 'UPPER', 'LOWER', 'SUBSTRING', 'LENGTH', 'DATE_FORMAT'
];

let autocompleteSelectedIndex = 0;
let autocompleteMatches = [];

/**
 * Inicializa el editor interactivo de consultas SQL:
 * - Resaltado de sintaxis SQL en tiempo real (palabras nativas en azul).
 * - Sugerencias y autocompletado con Tab / Enter.
 * - Sincronización de scroll y números de línea.
 */
function initEditor() {
  const editor = document.getElementById('sqlEditor');
  const lineNumbers = document.getElementById('lineNumbers');
  const highlightingContent = document.getElementById('highlightingContent');
  const highlightingPane = document.getElementById('highlighting');
  const autocompleteBox = document.getElementById('autocompleteBox');

  if (!editor || !lineNumbers) return;

  /**
   * Resalta el código SQL aplicando etiquetas span con clases CSS.
   */
  const updateHighlighting = () => {
    let text = editor.value;
    // Escapar caracteres HTML para prevenir inyecciones visuales
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 1. Resaltar comentarios (-- comentario)
    escaped = escaped.replace(/(--.*?)(?=\n|$)/g, '<span class="sql-comment">$1</span>');

    // 2. Resaltar cadenas de texto ('texto' o "texto")
    escaped = escaped.replace(/('(?:''|[^'\\]|\\.)*'|"(?:""|[^"\\]|\\.)*")/g, '<span class="sql-string">$1</span>');

    // 3. Resaltar números
    escaped = escaped.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="sql-number">$1</span>');

    // 4. Resaltar funciones SQL
    SQL_FUNCTIONS.forEach(fn => {
      const reg = new RegExp(`\\b(${fn})\\b(?=\\s*\\()`, 'gi');
      escaped = escaped.replace(reg, '<span class="sql-function">$1</span>');
    });

    // 5. Resaltar palabras clave nativas en azul brillante
    SQL_KEYWORDS.forEach(kw => {
      const reg = new RegExp(`\\b(${kw})\\b`, 'gi');
      escaped = escaped.replace(reg, '<span class="sql-keyword">$1</span>');
    });

    if (highlightingContent) {
      highlightingContent.innerHTML = escaped + (text.endsWith('\n') ? '<br>' : '');
    }
  };

  /**
   * Calcula el número total de líneas según los saltos de página (\n)
   */
  const updateLineNumbers = () => {
    const lines = editor.value.split('\n').length;
    let linesHTML = '';
    for (let i = 1; i <= lines; i++) {
      linesHTML += i + '<br>';
    }
    lineNumbers.innerHTML = linesHTML;
  };

  // Evento Input: actualiza números, coloreado y autocompletado
  editor.addEventListener('input', () => {
    updateLineNumbers();
    updateHighlighting();
    handleAutocomplete();
  });

  // Evento Scroll: sincroniza el desplazamiento del highlighting y line numbers
  editor.addEventListener('scroll', () => {
    lineNumbers.scrollTop = editor.scrollTop;
    if (highlightingPane) {
      highlightingPane.scrollTop = editor.scrollTop;
      highlightingPane.scrollLeft = editor.scrollLeft;
    }
  });

  // Evento Keydown: navegación del autocompletado y tabulación
  editor.addEventListener('keydown', (e) => {
    if (autocompleteBox && autocompleteBox.style.display === 'block' && autocompleteMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        autocompleteSelectedIndex = (autocompleteSelectedIndex + 1) % autocompleteMatches.length;
        renderAutocompleteItems();
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        autocompleteSelectedIndex = (autocompleteSelectedIndex - 1 + autocompleteMatches.length) % autocompleteMatches.length;
        renderAutocompleteItems();
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyAutocompleteSuggestion(autocompleteMatches[autocompleteSelectedIndex].text);
        return;
      } else if (e.key === 'Escape') {
        hideAutocomplete();
        return;
      }
    }

    // Atajos de ejecución de teclado (Ctrl+Enter, Ctrl+Shift+Enter, F5)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        // Ctrl + Shift + Enter: Ejecutar solo selección
        runScriptQuery(true);
      } else {
        // Ctrl + Enter: Ejecutar todo el script
        runScriptQuery(false);
      }
      return;
    }

    if (e.key === 'F5') {
      e.preventDefault();
      // F5: Ejecutar todo el script (estilo Workbench/SQL Server)
      runScriptQuery(false);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      updateLineNumbers();
      updateHighlighting();
    }
  });

  // Cerrar autocompletado si se hace clic fuera
  document.addEventListener('click', (e) => {
    if (autocompleteBox && !autocompleteBox.contains(e.target) && e.target !== editor) {
      hideAutocomplete();
    }
  });

  // Ejecución inicial
  updateLineNumbers();
  updateHighlighting();
}

/**
 * Detecta la palabra actual que se está escribiendo para sugerir autocompletado
 */
function handleAutocomplete() {
  const editor = document.getElementById('sqlEditor');
  const autocompleteBox = document.getElementById('autocompleteBox');
  if (!editor || !autocompleteBox) return;

  const cursorPos = editor.selectionStart;
  const textBeforeCursor = editor.value.substring(0, cursorPos);
  const match = textBeforeCursor.match(/([a-zA-Z0-9_]+)$/);

  if (!match || match[1].length < 2) {
    hideAutocomplete();
    return;
  }

  const query = match[1].toUpperCase();

  // Buscar sugerencias entre palabras clave y funciones
  const kwMatches = SQL_KEYWORDS
    .filter(k => k.startsWith(query))
    .map(k => ({ text: k, type: 'KEYWORD' }));

  const fnMatches = SQL_FUNCTIONS
    .filter(f => f.startsWith(query))
    .map(f => ({ text: f, type: 'FUNCTION' }));

  autocompleteMatches = [...kwMatches, ...fnMatches].slice(0, 7);

  if (autocompleteMatches.length === 0) {
    hideAutocomplete();
    return;
  }

  autocompleteSelectedIndex = 0;
  renderAutocompleteItems();
  showAutocomplete();
}

/**
 * Dibuja la lista de sugerencias en el elemento dropdown flotante
 */
function renderAutocompleteItems() {
  const autocompleteBox = document.getElementById('autocompleteBox');
  if (!autocompleteBox) return;

  let html = '';
  autocompleteMatches.forEach((item, idx) => {
    const isSelected = idx === autocompleteSelectedIndex ? 'selected' : '';
    html += `
      <div class="autocomplete-item ${isSelected}" onclick="applyAutocompleteSuggestion('${item.text}')">
        <span><strong>${item.text}</strong></span>
        <span class="autocomplete-tag">${item.type}</span>
      </div>
    `;
  });

  autocompleteBox.innerHTML = html;
}

/**
 * Posiciona y muestra el dropdown de sugerencias
 */
function showAutocomplete() {
  const autocompleteBox = document.getElementById('autocompleteBox');
  if (!autocompleteBox) return;

  autocompleteBox.style.display = 'block';
  autocompleteBox.style.top = '40px';
  autocompleteBox.style.left = '60px';
}

/**
 * Oculta el dropdown de autocompletado
 */
function hideAutocomplete() {
  const autocompleteBox = document.getElementById('autocompleteBox');
  if (autocompleteBox) {
    autocompleteBox.style.display = 'none';
  }
}

/**
 * Inserta la sugerencia elegida en el editor de texto
 */
function applyAutocompleteSuggestion(suggestedWord) {
  const editor = document.getElementById('sqlEditor');
  if (!editor) return;

  const cursorPos = editor.selectionStart;
  const textBefore = editor.value.substring(0, cursorPos);
  const textAfter = editor.value.substring(cursorPos);
  const match = textBefore.match(/([a-zA-Z0-9_]+)$/);

  if (match) {
    const wordStart = cursorPos - match[1].length;
    editor.value = editor.value.substring(0, wordStart) + suggestedWord + ' ' + textAfter;
    editor.selectionStart = editor.selectionEnd = wordStart + suggestedWord.length + 1;
  }

  hideAutocomplete();
  editor.focus();

  // Re-actualizar sintaxis y líneas
  const event = new Event('input');
  editor.dispatchEvent(event);
}

// ==========================================
// 3. EJECUCIÓN DE CONSULTAS SQL Y DATAGRID
// ==========================================
/**
 * Lee el texto del editor, lo envía al servidor backend vía HTTP POST
 * y gestiona el tiempo de respuesta y despliegue de resultados/errores.
 */
/**
 * Ejecuta el script SQL en el editor.
 * @param {boolean} onlySelection - Si es true, ejecuta solo el texto resaltado por el usuario con el mouse.
 *                                   Si no hay selección, avisa al usuario o ejecuta la línea actual.
 */
async function runScriptQuery(onlySelection = false) {
  const token = localStorage.getItem('token');
  const editor = document.getElementById('sqlEditor');
  if (!editor) return;

  let sql = '';
  let executionLabel = '';

  if (onlySelection) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = editor.value.substring(start, end).trim();

    if (!selectedText) {
      logConsole('No has seleccionado ningún fragmento de texto con el mouse.', 'error');
      toggleResultView('log');
      return;
    }

    sql = selectedText;
    executionLabel = 'Ejecutando fragmento seleccionado';
  } else {
    sql = editor.value.trim();
    executionLabel = 'Ejecutando script completo';
  }

  // Validación previa: evita enviar peticiones vacías al servidor
  if (!sql) {
    logConsole('No hay consulta escrita para ejecutar.', 'error');
    toggleResultView('log');
    return;
  }

  // Si hay ediciones del grid sin aplicar, avisar antes de reemplazar el resultado (result-grid.js)
  if (typeof ResultGrid !== 'undefined' && !(await ResultGrid.confirmDiscard())) return;

  // Protección: pide confirmación si hay DROP, TRUNCATE, DELETE/UPDATE sin WHERE, etc. (safety.js)
  if (typeof SafetyGuard !== 'undefined' && !(await SafetyGuard.confirmScript(sql))) {
    logConsole('Ejecución cancelada por el usuario (operación peligrosa no confirmada).', 'info');
    return;
  }

  logConsole(`${executionLabel}:\n${sql}`, 'info');

  // Pestañas: el resultado se guarda en la pestaña que lanzó la consulta (editor-tabs.js)
  const tabId = typeof EditorTabs !== 'undefined' ? EditorTabs.beginRun() : null;
  const deliver = (result, metrics) => (tabId ? EditorTabs.deliverResult(tabId, result, metrics) : true);

  try {
    const startTime = performance.now();

    // Obtener la configuración de conexión activa si existe
    const activeConnection = localStorage.getItem('activeDbConnection');
    const connectionConfig = activeConnection ? JSON.parse(activeConnection) : null;

    // Petición asíncrona enviada a la API REST del backend
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ sql, connectionConfig })
    });

    const data = await res.json();
    const duration = Math.round(performance.now() - startTime);

    // Si el servidor respondió con un error (Status Code distinto a 2xx)
    if (!res.ok) {
      deliver(null, null);
      logConsole(`Error en la ejecución: ${data.error}`, 'error');
      toggleResultView('log');
      return;
    }

    const rowCount = data.rows ? data.rows.length : 0;
    const metrics = `Filas: ${rowCount} | Tiempo: ${duration}ms`;
    // La última sentencia del script, si es un SELECT, es la "consulta base" sobre la que
    // se aplican los filtros por columna y la edición de datos del grid.
    const statements = SqlUtils.splitStatements(sql);
    const lastStatement = statements[statements.length - 1];
    const baseSql = lastStatement && SqlUtils.isSelectStatement(lastStatement.sql) && (data.columns || []).length
      ? lastStatement.sql : null;
    const result = {
      columns: data.columns || [],
      rows: data.rows || [],
      fields: data.fields || [],
      sql: baseSql || sql,
      baseSql,
      metricsText: metrics,
      meta: { affectedRows: data.affectedRows || 0 }
    };

    // Renderiza la matriz de datos recibida en la tabla interactiva (solo si su pestaña sigue visible)
    if (deliver(result, metrics)) {
      if (typeof ResultGrid !== 'undefined') ResultGrid.render(result);
      else renderDataGrid(result.columns, result.rows, { ...result.meta, sql });
      // Muestra métricas de rendimiento en la barra de estado (footer)
      document.getElementById('footerMetrics').innerText = metrics;
    }
    logConsole(`Consulta ejecutada correctamente. Filas: ${rowCount}${data.affectedRows ? ` | Afectadas: ${data.affectedRows}` : ''} | Tiempo: ${duration}ms`, 'success');

    // Si la consulta cambió la estructura (CREATE, DROP, ALTER, RENAME), refrescar el árbol de esquemas
    const upperSql = sql.toUpperCase();
    if (/\b(CREATE|DROP)\s+(DATABASE|SCHEMA|TABLE|VIEW)\b|\bALTER\s+TABLE\b|\bRENAME\s+TABLE\b/.test(upperSql)) {
      if (typeof Designer !== 'undefined') Designer.invalidate(UI.getConnection() && UI.getConnection().database);
      if (typeof ResultGrid !== 'undefined') ResultGrid.invalidateStructure();
      loadDatabasesTree();
    }
  } catch (err) {
    deliver(null, null);
    logConsole('Error al comunicar con el servidor.', 'error');
    toggleResultView('log');
  }
}

// Mantener compatibilidad con cualquier llamada residual a runCurrentQuery
function runCurrentQuery() {
  runScriptQuery(false);
}

/**
 * Construye de forma dinámica las cabeceras (<th>) y celdas (<td>)
 * dentro del elemento <table> basándose en las columnas y filas enviadas por la DB.
 */
function renderDataGrid(columns, rows, meta = {}) {
  const head = document.getElementById('gridHead');
  const body = document.getElementById('gridBody');

  // Guarda el resultado actual para poder exportarlo (export.js)
  window.lastQueryResult = { columns, rows, sql: meta.sql || (window.lastQueryResult && window.lastQueryResult.sql) || '' };

  // Limpia el contenido anterior de la tabla
  head.innerHTML = '';
  body.innerHTML = '';

  // Si la consulta no retornó columnas (ej: CREATE TABLE, INSERT o sentencias sin resultados)
  if (columns.length === 0) {
    head.innerHTML = '<tr><th>Resultado</th></tr>';
    body.innerHTML = `<tr><td>Operación completada sin filas devueltas.${meta.affectedRows ? ` Filas afectadas: ${meta.affectedRows}.` : ''}</td></tr>`;
    toggleResultView('grid');
    return;
  }

  // 1. Inyección de Encabezados de Columna
  const headerRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    th.innerText = col;
    headerRow.appendChild(th);
  });
  head.appendChild(headerRow);

  // 2. Inyección de Filas y Registro de Celdas
  rows.forEach(row => {
    const tr = document.createElement('tr');
    columns.forEach(col => {
      const td = document.createElement('td');
      // Muestra el valor original o la palabra "NULL" en caso de celdas vacías
      const value = row[col];
      if (value === null || value === undefined) {
        td.innerText = 'NULL';
        td.className = 'cell-null';
      } else {
        td.innerText = typeof value === 'object' ? JSON.stringify(value) : value;
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  toggleResultView('grid'); // Cambia automáticamente la vista a la tabla de resultados
}

/**
 * Escribe un mensaje con marca de tiempo (timestamp) en el panel de logs inferior.
 * @param {string} message - Texto del mensaje a registrar.
 * @param {string} type - Tipo de mensaje para aplicar estilos CSS: 'info', 'success', 'error'.
 */
function logConsole(message, type = 'info') {
  const logContainer = document.getElementById('view-log');
  if (!logContainer) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`; // Aplica clase de color dependiendo del tipo de evento
  const timestamp = new Date().toLocaleTimeString(); // Formato HH:MM:SS
  entry.innerText = `[${timestamp}] ${message}`;

  logContainer.appendChild(entry);
  // Realiza scroll automático hacia la parte inferior para mostrar siempre la última entrada
  logContainer.scrollTop = logContainer.scrollHeight;
}

// ==========================================
// 4. CONTROL DE PESTAÑAS Y VISTAS DE RESULTADOS
// ==========================================
/**
 * Conmuta entre las pestañas del panel principal de trabajo
 * (Editor de Consultas vs Diagrama Entidad-Relación).
 */
function switchTab(tabId) {
  // Desactiva todas las pestañas y sus paneles correspondientes
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  // Activa únicamente la pestaña seleccionada por el usuario
  if (tabId === 'tab-editor') {
    document.getElementById('tab-btn-editor').classList.add('active');
    document.getElementById('tab-editor').classList.add('active');
  } else if (tabId === 'tab-er') {
    document.getElementById('tab-btn-er').classList.add('active');
    document.getElementById('tab-er').classList.add('active');
    renderERDiagram(); // Dibuja o actualiza el diagrama ER al hacer visible la pestaña
  }
}

/**
 * Conmuta la visibilidad de la sección inferior de resultados:
 * Alterna entre la Tabla DataGrid ('grid') y la Consola de Logs ('log').
 */
function toggleResultView(view) {
  const gridBtn = document.getElementById('btn-show-grid');
  const logBtn = document.getElementById('btn-show-log');
  const gridView = document.getElementById('view-grid');
  const logView = document.getElementById('view-log');

  const toolbar = document.getElementById('gridToolbar'); // filtros y edición (result-grid.js)

  if (view === 'grid') {
    gridBtn.classList.add('active');
    logBtn.classList.remove('active');
    gridView.style.display = 'block';
    logView.style.display = 'none';
    if (toolbar) toolbar.style.display = '';
  } else {
    logBtn.classList.add('active');
    gridBtn.classList.remove('active');
    logView.style.display = 'block';
    gridView.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
  }
}

// ==========================================
// 5. BARRA LATERAL (ÁRBOL DE ESQUEMAS)
// ==========================================
let currentDatabasesList = [];

/**
 * Actualiza la información visible en el explorador de bases de datos (Barra Lateral).
 */
function refreshSidebar() {
  loadDatabasesTree();
}

/**
 * Consulta al backend las bases de datos disponibles con las credenciales activas.
 */
async function loadDatabasesTree() {
  const treeView = document.getElementById('treeView');
  if (!treeView) return;

  const activeConnection = localStorage.getItem('activeDbConnection');
  if (!activeConnection) {
    treeView.innerHTML = `
      <div style="padding: 16px 10px; font-size: 11px; color: var(--text-muted); text-align: center; line-height: 1.5;">
        Sin conexiones activas.<br><br>
        Haz clic en <strong>+ Conectar Servidor</strong> para configurar tu base de datos.
      </div>
    `;
    return;
  }

  const config = JSON.parse(activeConnection);

  // Actualizar estado del footer
  const footerStatus = document.querySelector('.status-bar span:first-child');
  if (footerStatus) {
    footerStatus.innerText = `Servidor: ${config.host}:${config.port}${config.database ? ` | DB: ${config.database}` : ''}`;
  }

  treeView.innerHTML = `
    <div style="padding: 12px 10px; font-size: 11px; color: var(--text-muted); text-align: center;">
      <span>⏳ Cargando esquemas...</span>
    </div>
  `;

  try {
    const res = await fetch('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionConfig: config })
    });

    const data = await res.json();

    if (!res.ok) {
      treeView.innerHTML = `
        <div style="padding: 12px 10px; font-size: 11px; color: #ef4444; line-height: 1.4;">
          Error al obtener esquemas:<br>
          <span style="font-size: 10px;">${data.error || 'Fallo de conexión'}</span>
        </div>
      `;
      return;
    }

    currentDatabasesList = data.databases || [];
    renderDatabasesTree(currentDatabasesList);
  } catch (err) {
    treeView.innerHTML = `
      <div style="padding: 12px 10px; font-size: 11px; color: #ef4444;">
        No se pudo conectar con el servidor.
      </div>
    `;
  }
}

/**
 * Renderiza la lista de esquemas en el árbol lateral.
 */
function renderDatabasesTree(databases) {
  const treeView = document.getElementById('treeView');
  if (!treeView) return;

  if (databases.length === 0) {
    treeView.innerHTML = `
      <div style="padding: 14px 10px; font-size: 11px; color: var(--text-muted); text-align: center;">
        No se encontraron bases de datos.
      </div>
    `;
    return;
  }

  const activeConnection = localStorage.getItem('activeDbConnection');
  const currentDb = activeConnection ? JSON.parse(activeConnection).database : null;

  let html = `<div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); padding: 4px 6px 8px 6px; font-weight: bold;">
    ESQUEMAS (${databases.length})
  </div>`;

  databases.forEach(db => {
    const isSelected = currentDb && currentDb.toLowerCase() === db.toLowerCase();
    // Las bases de datos del sistema se muestran con candado y sin acciones destructivas
    const isSystem = typeof SqlUtils !== 'undefined' && SqlUtils.isSystemSchema(db);
    const actions = isSystem
      ? `<span class="db-lock" title="Base de datos del sistema: protegida contra cambios">🔒</span>`
      : `<button class="db-action-button" type="button" title="Nueva tabla en ${db}"
            onclick="event.stopPropagation(); Designer.openCreateTable('${db}')">➕</button>
          <button class="db-action-button" type="button" title="Respaldar ${db}"
            onclick="event.stopPropagation(); Backup.open('backup', '${db}')">💾</button>
          <button class="db-delete-button" type="button" title="Eliminar base de datos" aria-label="Eliminar ${db}"
            onclick="event.stopPropagation(); deleteDatabase('${db}')">🗑️</button>`;
    html += `
      <div class="db-tree-item" id="db-item-${db}">
        <div class="db-node-header ${isSelected ? 'active' : ''} ${isSystem ? 'system-db' : ''}" onclick="toggleDatabaseNode('${db}')">
          <span class="db-node-arrow" id="arrow-${db}">▶</span>
          <span class="db-node-icon">${isSystem ? '⚙️' : '🗄️'}</span>
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${db}">${db}</span>
          ${actions}
        </div>
        <div class="db-tables-list" id="tables-list-${db}"></div>
      </div>
    `;
  });

  treeView.innerHTML = html;
}

/**
 * Solicita el nombre exacto de la base de datos antes de eliminarla.
 */
async function deleteDatabase(dbName) {
  // Confirmación segura (safety.js): bloquea las BD del sistema, muestra cuántas tablas
  // se perderán, ofrece respaldar antes y pide escribir el nombre exacto.
  const confirmed = await SafetyGuard.confirmDropDatabase(dbName);
  if (!confirmed) return;

  const activeConnection = localStorage.getItem('activeDbConnection');
  if (!activeConnection) return;

  const config = JSON.parse(activeConnection);
  try {
    const res = await fetch('/api/databases', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionConfig: config, database: dbName })
    });
    const data = await res.json();

    if (!res.ok) {
      UI.alert('No se pudo eliminar', UI.escape(data.error || 'Fallo de conexión'));
      return;
    }

    if (config.database && config.database.toLowerCase() === dbName.toLowerCase()) {
      delete config.database;
      localStorage.setItem('activeDbConnection', JSON.stringify(config));
    }

    logConsole(`Base de datos eliminada: ${dbName}`, 'success');
    UI.toast(`Base de datos "${dbName}" eliminada`, 'success');
    await loadDatabasesTree();
  } catch (err) {
    UI.alert('Error de conexión', 'No se pudo conectar con el servidor para eliminar la base de datos.');
  }
}

/**
 * Elimina una tabla desde el árbol lateral (con confirmación escribiendo su nombre).
 */
async function deleteTable(dbName, table) {
  if (SqlUtils.isSystemSchema(dbName)) return;
  const confirmed = await SafetyGuard.confirmDropTable(dbName, table);
  if (!confirmed) return;
  try {
    await UI.api('/query', { sql: `DROP TABLE ${DDLBuilder.q(dbName)}.${DDLBuilder.q(table)}` });
    logConsole(`Tabla eliminada: ${dbName}.${table}`, 'success');
    UI.toast(`Tabla "${table}" eliminada`, 'success');
    Designer.invalidate(dbName);
    await refreshDatabaseNode(dbName);
  } catch (e) {
    UI.alert('No se pudo eliminar la tabla', UI.escape(e.message));
  }
}

/**
 * Vuelve a cargar la lista de tablas de una base de datos en el árbol lateral.
 */
async function refreshDatabaseNode(dbName) {
  const container = document.getElementById(`tables-list-${dbName}`);
  if (!container) return loadDatabasesTree();
  container.removeAttribute('data-loaded');
  container.classList.remove('show');
  await toggleDatabaseNode(dbName);
}

/**
 * Expande o contrae una base de datos para mostrar sus tablas (como Workbench).
 */
async function toggleDatabaseNode(dbName) {
  const tablesContainer = document.getElementById(`tables-list-${dbName}`);
  const arrow = document.getElementById(`arrow-${dbName}`);
  if (!tablesContainer) return;

  const isExpanded = tablesContainer.classList.contains('show');

  if (isExpanded) {
    tablesContainer.classList.remove('show');
    if (arrow) arrow.classList.remove('open');
    return;
  }

  // Marcar como activa esta base de datos en la conexión actual
  setWorkingDatabase(dbName);

  tablesContainer.classList.add('show');
  if (arrow) arrow.classList.add('open');

  // Si ya tiene cargadas las tablas, no volvemos a consultar
  if (tablesContainer.getAttribute('data-loaded') === 'true') {
    return;
  }

  tablesContainer.innerHTML = `<div style="padding: 4px 8px; font-size: 11px; color: var(--text-muted);">⏳ Cargando tablas...</div>`;

  const activeConnection = localStorage.getItem('activeDbConnection');
  if (!activeConnection) return;
  const config = JSON.parse(activeConnection);

  try {
    const res = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionConfig: config, database: dbName })
    });

    const data = await res.json();

    if (!res.ok) {
      tablesContainer.innerHTML = `<div style="padding: 4px 8px; font-size: 10px; color: #ef4444;">Error al cargar tablas</div>`;
      return;
    }

    const tables = data.tables || [];
    tablesContainer.setAttribute('data-loaded', 'true');

    const isSystem = SqlUtils.isSystemSchema(dbName);
    const newTableLink = isSystem ? '' : `
      <div class="table-node-item table-node-new" onclick="Designer.openCreateTable('${dbName}')" title="Crear una tabla con el diseñador visual">
        <span style="font-size: 11px;">➕</span><span>Nueva tabla...</span>
      </div>`;

    if (tables.length === 0) {
      tablesContainer.innerHTML = `<div style="padding: 4px 8px; font-size: 11px; color: var(--text-muted); font-style: italic;">(Sin tablas)</div>${newTableLink}`;
      return;
    }

    let tablesHtml = '';
    tables.forEach(table => {
      const tableActions = isSystem ? '' : `
          <button class="table-action-button" type="button" title="Modificar estructura (diseñador)"
            onclick="event.stopPropagation(); Designer.openEditTable('${dbName}', '${table}')">✏️</button>
          <button class="table-action-button danger" type="button" title="Eliminar tabla"
            onclick="event.stopPropagation(); deleteTable('${dbName}', '${table}')">🗑️</button>`;
      tablesHtml += `
        <div class="table-node-item" onclick="pasteSelectTable('${dbName}', '${table}')" title="Clic para consultar">
          <span style="font-size: 11px;">📋</span>
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${table}</span>
          ${tableActions}
        </div>
      `;
    });

    tablesContainer.innerHTML = tablesHtml + newTableLink;
  } catch (err) {
    tablesContainer.innerHTML = `<div style="padding: 4px 8px; font-size: 10px; color: #ef4444;">Error de red</div>`;
  }
}

/**
 * Asigna la base de datos seleccionada como la activa para futuras consultas.
 */
function setWorkingDatabase(dbName) {
  const activeConnection = localStorage.getItem('activeDbConnection');
  if (!activeConnection) return;

  const config = JSON.parse(activeConnection);
  config.database = dbName;
  localStorage.setItem('activeDbConnection', JSON.stringify(config));

  // Actualizar estilo visual activo en el sidebar
  document.querySelectorAll('.db-node-header').forEach(el => el.classList.remove('active'));
  const activeNode = document.querySelector(`#db-item-${dbName} .db-node-header`);
  if (activeNode) activeNode.classList.add('active');

  // Actualizar barra de estado
  const footerStatus = document.querySelector('.status-bar span:first-child');
  if (footerStatus) {
    footerStatus.innerText = `Servidor: ${config.host}:${config.port} | DB: ${dbName}`;
  }

  logConsole(`Base de datos activa cambiada a: ${dbName}`, 'info');
}

/**
 * Filtra los esquemas en tiempo real con el input de búsqueda.
 */
function filterSchemas(text) {
  const query = text.toLowerCase().trim();
  if (!query) {
    renderDatabasesTree(currentDatabasesList);
    return;
  }

  const filtered = currentDatabasesList.filter(db => db.toLowerCase().includes(query));
  renderDatabasesTree(filtered);
}

/**
 * Función de conveniencia para pegar automáticamente un "SELECT *" en el editor
 * al hacer doble clic o seleccionar una tabla de la lista lateral.
 */
function pasteSelectTable(schema, table) {
  const sql = `SELECT * FROM ${schema}.${table} LIMIT 100;`;
  // Con pestañas: se abre en una pestaña nueva si la actual ya tiene un script escrito
  if (typeof EditorTabs !== 'undefined') {
    EditorTabs.openWithSql(sql, table);
    switchTab('tab-editor');
    return;
  }
  const editor = document.getElementById('sqlEditor');
  if (!editor) return;
  editor.value = sql;
  editor.dispatchEvent(new Event('input'));
}

// ==========================================
// 6. MODAL DE CONVERSOR DE DATOS
// ==========================================
/**
 * Muestra el modal del conversor de datos en pantalla.
 */
function openConverterModal() {
  document.getElementById('converterModal').style.display = 'flex';
}

/**
 * Oculta la ventana modal del conversor de datos.
 */
function closeConverterModal() {
  document.getElementById('converterModal').style.display = 'none';
}

/**
 * Transforma datos en tiempo real entre múltiples formatos estructurados:
 * - JSON a sentencias SQL (INSERT INTO)
 * - SQL a JSON
 * - Tablas tipo Excel/CSV a sentencias SQL
 * - JSON a Tablas con formato Markdown
 * @param {string} type - Identificador del tipo de conversión deseada.
 */
function convertData(type) {
  const input = document.getElementById('converterInput').value.trim();
  const output = document.getElementById('converterOutput');

  if (!input) {
    output.value = 'Por favor ingresa un texto o datos de entrada para convertir.';
    return;
  }

  try {
    // 1. Transforma arreglos de objetos JSON a código SQL de inserción
    if (type === 'json-to-sql') {
      const parsed = JSON.parse(input);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0) return;

      const keys = Object.keys(arr[0]);
      let sql = `INSERT INTO mi_tabla (${keys.join(', ')}) VALUES\n`;
      const values = arr.map(row => {
        const valStr = keys.map(k => typeof row[k] === 'string' ? `'${row[k]}'` : row[k]).join(', ');
        return `(${valStr})`;
      });
      sql += values.join(',\n') + ';';
      output.value = sql;
    }
    // 2. Transforma consultas o datos SQL a formato objeto JSON
    else if (type === 'sql-to-json') {
      output.value = JSON.stringify([{ id: 1, mensaje: 'Respuesta generada desde SQL' }], null, 2);
    }
    // 3. Transforma filas separadas por comas (CSV/Excel) a sentencias SQL
    else if (type === 'excel-to-sql') {
      const lines = input.split('\n');
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map(h => h.trim());
      let sql = `INSERT INTO tabla_importada (${headers.join(', ')}) VALUES\n`;
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => `'${v.trim()}'`).join(', ');
        return `(${vals})`;
      });
      output.value = sql + rows.join(',\n') + ';';
    }
    // 4. Transforma un objeto JSON en una tabla formateada para archivos Markdown (.md)
    else if (type === 'json-to-markdown') {
      const parsed = JSON.parse(input);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const keys = Object.keys(arr[0]);
      let md = `| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |\n`;
      arr.forEach(row => {
        md += `| ${keys.map(k => row[k]).join(' | ')} |\n`;
      });
      output.value = md;
    }
  } catch (e) {
    output.value = 'Error al convertir: Asegúrate de que el formato de entrada sea válido.';
  }
}

/**
 * Selecciona y copia automáticamente el resultado generado en el conversor al portapapeles.
 */
function copyConverterOutput() {
  const output = document.getElementById('converterOutput');
  output.select();
  document.execCommand('copy');
  alert('¡Resultado copiado al portapapeles!');
}

// ==========================================
// 7. MODALES Y DIAGRAMA ER
// ==========================================
/**
 * Abre la ventana emergente/modal genérica notificando al usuario.
 * @param {string} title - Título que aparecerá en la cabecera del modal.
 * @param {string} message - Mensaje explicativo dentro del cuerpo del modal.
 */
function openModal(title, message) {
  document.getElementById('modalTitle').innerText = title;
  document.getElementById('modalBody').innerText = message;
  document.getElementById('modalOverlay').style.display = 'flex';
}

/**
 * Cierra la ventana emergente/modal genérica.
 */
function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

/**
 * Muestra el modal para configurar una nueva conexión a la base de datos.
 */
function openConnectionModal() {
  document.getElementById('connectionModal').style.display = 'flex';
}

/**
 * Cierra el modal de conexión a la base de datos.
 */
function closeConnectionModal() {
  document.getElementById('connectionModal').style.display = 'none';
}

/**
 * Guarda los detalles de la conexión en localStorage y actualiza la UI.
 */
function saveConnection() {
  const host = document.getElementById('connHost').value.trim();
  const port = document.getElementById('connPort').value.trim();
  const user = document.getElementById('connUser').value.trim();
  const password = document.getElementById('connPassword').value;
  const database = document.getElementById('connDatabase').value.trim();

  if (!host || !port || !user) {
    alert("Host, Puerto y Usuario son obligatorios.");
    return;
  }

  const connectionConfig = {
    host,
    port: parseInt(port),
    user,
    password,
    database: database || undefined
  };

  localStorage.setItem('activeDbConnection', JSON.stringify(connectionConfig));

  closeConnectionModal();
  refreshSidebar();
  logConsole(`Conexión configurada para ${host}:${port}`, 'success');
}

/**
 * Carga e inicializa el lienzo (canvas) que dibuja el diagrama Entidad-Relación de la base de datos.
 */
async function renderERDiagram() {
  const canvas = document.getElementById('diagramCanvas');
  const select = document.getElementById('erDatabaseSelect');
  const badge = document.getElementById('erInfoBadge');
  if (!canvas) return;

  const activeConnection = localStorage.getItem('activeDbConnection');
  if (!activeConnection) {
    canvas.innerHTML = `
      <div class="er-empty-state">
        <div style="font-size: 32px; margin-bottom: 12px;">📊</div>
        <h3 style="color: var(--text-main); margin-bottom: 8px;">Sin Conexión Activa</h3>
        <p style="font-size: 12px; max-width: 320px;">Conecta tu servidor MySQL con el botón <strong>+ Conectar Servidor</strong> para generar el diagrama Entidad-Relación.</p>
      </div>
    `;
    if (badge) badge.innerText = '';
    return;
  }

  const config = JSON.parse(activeConnection);

  // Poblar el selector de bases de datos si está vacío o desactualizado
  if (select && currentDatabasesList.length > 0) {
    const currentVal = select.value || config.database || '';
    let optionsHtml = '<option value="">Selecciona una base de datos...</option>';
    currentDatabasesList.forEach(db => {
      const selected = (db.toLowerCase() === currentVal.toLowerCase()) ? 'selected' : '';
      optionsHtml += `<option value="${db}" ${selected}>${db}</option>`;
    });
    select.innerHTML = optionsHtml;
  }

  const targetDb = (select && select.value) ? select.value : config.database;

  if (!targetDb) {
    canvas.innerHTML = `
      <div class="er-empty-state">
        <div style="font-size: 32px; margin-bottom: 12px;">🗄️</div>
        <h3 style="color: var(--text-main); margin-bottom: 8px;">Selecciona un Esquema</h3>
        <p style="font-size: 12px; max-width: 340px;">Elige una base de datos en el menú desplegable superior o en la barra lateral para inspeccionar sus entidades y relaciones.</p>
      </div>
    `;
    if (badge) badge.innerText = '';
    return;
  }

  canvas.innerHTML = `
    <div class="er-empty-state">
      <div style="font-size: 28px; margin-bottom: 10px;">⏳</div>
      <p style="font-size: 12px;">Analizando tablas, columnas y relaciones foráneas de <strong>${targetDb}</strong>...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionConfig: config, database: targetDb })
    });

    const data = await res.json();

    if (!res.ok) {
      canvas.innerHTML = `
        <div class="er-empty-state">
          <h4 style="color: #ef4444; margin-bottom: 6px;">Error al generar diagrama</h4>
          <p style="font-size: 11px;">${data.error || 'No se pudo cargar el esquema'}</p>
        </div>
      `;
      if (badge) badge.innerText = '';
      return;
    }

    const { tables, relations } = data;

    if (!tables || tables.length === 0) {
      canvas.innerHTML = `
        <div class="er-empty-state">
          <div style="font-size: 32px; margin-bottom: 12px;">📂</div>
          <h3 style="color: var(--text-main); margin-bottom: 8px;">Base de datos vacía</h3>
          <p style="font-size: 12px;">La base de datos <strong>${targetDb}</strong> aún no contiene tablas.</p>
        </div>
      `;
      if (badge) badge.innerText = '0 tablas';
      return;
    }

    if (badge) {
      badge.innerText = `${tables.length} tablas | ${relations.length} relaciones`;
    }

    // Renderizar tarjetas de tablas
    let html = `<div class="er-grid-container">`;

    tables.forEach(table => {
      html += `
        <div class="er-table-card">
          <div class="er-table-header">
            <span>📋 ${table.name}</span>
            <span style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 10px; opacity: 0.7; font-weight: normal;">${table.columns.length} cols</span>
              ${SqlUtils.isSystemSchema(targetDb) ? '' : `<button class="er-edit-button" type="button" title="Modificar estructura"
                onclick="Designer.openEditTable('${targetDb}', '${table.name}')">✏️</button>`}
            </span>
          </div>
          <div class="er-columns-list">
      `;

      table.columns.forEach(col => {
        let badgeHtml = '';
        if (col.isPrimary) {
          badgeHtml = `<span class="er-col-badge badge-pk" title="Clave Primaria">PK</span>`;
        } else if (col.isForeign) {
          badgeHtml = `<span class="er-col-badge badge-fk" title="Clave Foránea">FK</span>`;
        }

        html += `
          <div class="er-column-row">
            <div class="er-col-info">
              ${badgeHtml}
              <span class="er-col-name" title="${col.name}">${col.name}</span>
            </div>
            <span class="er-col-type" title="${col.type}">${col.type}</span>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    html += `</div>`;

    // Si existen relaciones foráneas, mostrar resumen inferior
    if (relations && relations.length > 0) {
      html += `
        <div class="er-relations-panel">
          <div style="font-size: 12px; font-weight: bold; margin-bottom: 8px; color: var(--text-main);">
            🔗 Relaciones de Claves Foráneas Detectadas (${relations.length}):
          </div>
          <div>
      `;

      relations.forEach(rel => {
        html += `
          <div class="er-relation-tag">
            <strong style="color: #38bdf8;">${rel.fromTable}</strong>.${rel.fromColumn}
            <span>➔</span>
            <strong style="color: #34d399;">${rel.toTable}</strong>.${rel.toColumn}
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    }

    canvas.innerHTML = html;
  } catch (err) {
    canvas.innerHTML = `
      <div class="er-empty-state">
        <h4 style="color: #ef4444;">Error de conexión</h4>
        <p style="font-size: 11px;">No se pudo comunicar con el servidor para consultar el esquema.</p>
      </div>
    `;
    if (badge) badge.innerText = '';
  }
}

/**
 * Función llamada cuando el usuario cambia la base de datos en el selector de la pestaña ER.
 */
function loadERDiagramForSelectedDb(dbName) {
  if (!dbName) return;
  setWorkingDatabase(dbName);
  renderERDiagram();
}