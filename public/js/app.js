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
function initEditor() {
  const editor = document.getElementById('sqlEditor');
  const lineNumbers = document.getElementById('lineNumbers');

  // Si los elementos HTML del editor no existen en la página actual, finaliza la ejecución
  if (!editor || !lineNumbers) return;

  /**
   * Calcula el número total de líneas según los saltos de página (\n)
   * y reescribe la barra lateral de numeración en formato HTML.
   */
  const updateLineNumbers = () => {
    const lines = editor.value.split('\n').length; // Cuenta cuántas líneas existen
    let linesHTML = '';
    for (let i = 1; i <= lines; i++) {
      linesHTML += i + '<br>'; // Construye la lista vertical de números
    }
    lineNumbers.innerHTML = linesHTML;
  };

  // Evento: Actualiza el conteo de líneas cada vez que el usuario escribe o borra texto
  editor.addEventListener('input', updateLineNumbers);

  // Evento: Sincroniza el desplazamiento vertical del número de línea con el área de texto del editor
  editor.addEventListener('scroll', () => {
    lineNumbers.scrollTop = editor.scrollTop;
  });

  // Evento: Permite indentar con espacios al presionar la tecla Tab (sin saltar a otros botones de la web)
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault(); // Cancela la acción predeterminada de navegación del navegador
      const start = editor.selectionStart; // Posición inicial del cursor
      const end = editor.selectionEnd;     // Posición final del texto seleccionado

      // Inserta dos espacios en blanco exactamente en la posición donde se encuentra el cursor
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      
      // Reposiciona el cursor inmediatamente después de los dos espacios agregados
      editor.selectionStart = editor.selectionEnd = start + 2;
    }
  });

  // Ejecución inicial para dibujar el número 1 al cargar la pantalla
  updateLineNumbers();
}

// ==========================================
// 3. EJECUCIÓN DE CONSULTAS SQL Y DATAGRID
// ==========================================
/**
 * Lee el texto del editor, lo envía al servidor backend vía HTTP POST
 * y gestiona el tiempo de respuesta y despliegue de resultados/errores.
 */
async function runCurrentQuery() {
  const token = localStorage.getItem('token');

  const editor = document.getElementById('sqlEditor');
  const sql = editor.value.trim();

  // Validación previa: evita enviar peticiones vacías al servidor
  if (!sql) {
    logConsole('No hay consulta escrita para ejecutar.', 'error');
    return;
  }

  logConsole(`Ejecutando consulta:\n${sql}`, 'info');

  try {
    const startTime = performance.now(); // Cronómetro para medir latencia de la consulta
    
    // Petición asíncrona enviada a la API REST del backend
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // <--- Añadir este encabezado
      },
      body: JSON.stringify({ sql })
    });

    const data = await res.json();
    const duration = Math.round(performance.now() - startTime); // Tiempo de respuesta en milisegundos

    // Si el servidor respondió con un error (Status Code distinto a 2xx)
    if (!res.ok) {
      logConsole(`Error en la ejecución: ${data.error}`, 'error');
      toggleResultView('log'); // Muestra la pestaña de la consola de error automáticamente
      return;
    }

    // Renderiza la matriz de datos recibida en la tabla interactiva
    renderDataGrid(data.columns || [], data.rows || []);
    logConsole(`Consulta ejecutada correctamente. Filas: ${data.rows ? data.rows.length : 0} | Tiempo: ${duration}ms`, 'success');
    
    // Muestra métricas de rendimiento en la barra de estado (footer)
    document.getElementById('footerMetrics').innerText = `Filas: ${data.rows ? data.rows.length : 0} | Tiempo: ${duration}ms`;
  } catch (err) {
    // Captura fallos críticos de red o desconexión del servidor
    logConsole('Error al comunicar con el servidor.', 'error');
    toggleResultView('log');
  }
}

/**
 * Construye de forma dinámica las cabeceras (<th>) y celdas (<td>)
 * dentro del elemento <table> basándose en las columnas y filas enviadas por la DB.
 */
function renderDataGrid(columns, rows) {
  const head = document.getElementById('gridHead');
  const body = document.getElementById('gridBody');

  // Limpia el contenido anterior de la tabla
  head.innerHTML = '';
  body.innerHTML = '';

  // Si la consulta no retornó columnas (ej: CREATE TABLE, INSERT o sentencias sin resultados)
  if (columns.length === 0) {
    head.innerHTML = '<tr><th>Resultado</th></tr>';
    body.innerHTML = '<tr><td>Operación completada sin filas devueltas.</td></tr>';
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
      td.innerText = row[col] !== undefined ? row[col] : 'NULL';
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

  if (view === 'grid') {
    gridBtn.classList.add('active');
    logBtn.classList.remove('active');
    gridView.style.display = 'block';
    logView.style.display = 'none';
  } else {
    logBtn.classList.add('active');
    gridBtn.classList.remove('active');
    logView.style.display = 'block';
    gridView.style.display = 'none';
  }
}

// ==========================================
// 5. BARRA LATERAL (ÁRBOL DE ESQUEMAS)
// ==========================================
/**
 * Actualiza la información visible en el explorador de bases de datos (Barra Lateral).
 * Actualmente muestra un estado por defecto solicitando conectar un servidor.
 */
function refreshSidebar() {
  const treeView = document.getElementById('treeView');
  if (!treeView) return;

  // Estado limpio: Sin bases de datos simuladas
  treeView.innerHTML = `
    <div style="padding: 16px 10px; font-size: 11px; color: var(--text-muted); text-align: center; line-height: 1.5;">
      Sin conexiones activas.<br><br>
      Haz clic en <strong>+ Nueva DB</strong> para conectar tu servidor de base de datos.
    </div>
  `;
}

/**
 * Función de conveniencia para pegar automáticamente un "SELECT *" en el editor
 * al hacer doble clic o seleccionar una tabla de la lista lateral.
 */
function pasteSelectTable(schema, table) {
  const editor = document.getElementById('sqlEditor');
  editor.value = `SELECT * FROM ${schema}.${table} LIMIT 100;`;
  initEditor(); // Re-calcula los números de línea del editor
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
 * Carga e inicializa el lienzo (canvas) que dibuja el diagrama Entidad-Relación de la base de datos.
 */
function renderERDiagram() {
  const canvas = document.getElementById('diagramCanvas');
  if (!canvas) return;
  canvas.innerHTML = `
    <div style="padding: 20px; color: var(--text-muted); text-align: center;">
      <h3>📊 Generador de Diagrama Entidad-Relación</h3>
      <p style="margin-top: 10px; font-size: 12px;">Conéctate a un servidor para visualizar el modelo de bases de datos de forma interactiva.</p>
    </div>
  `;
}