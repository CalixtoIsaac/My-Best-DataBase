/**
 * ============================================================================
 * DISEÑADOR VISUAL DE BASES DE DATOS Y TABLAS (designer.js)
 * ============================================================================
 * Permite crear bases de datos, crear tablas y modificar tablas existentes
 * sin escribir SQL. Mientras el usuario llena el formulario se muestra en
 * vivo el SQL que se va a ejecutar (CREATE DATABASE / CREATE TABLE / ALTER TABLE).
 *
 * El SQL lo genera DDLBuilder (ddl-builder.js), el mismo módulo que usa el
 * servidor para validar y ejecutar.
 */
const Designer = (() => {
  const T = DDLBuilder.TYPES;
  const schemaCache = {};   // base de datos -> tablas/columnas (para las llaves foráneas)
  let charsetCache = null;  // juegos de caracteres del servidor
  let state = null;         // { mode: 'create' | 'alter', original, table, initialJson }
  let idSeq = 0;
  const newId = prefix => `${prefix}${Date.now().toString(36)}${++idSeq}`;
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const $ = id => document.getElementById(id);

  const TYPE_GROUPS = [
    ['Números', ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BOOLEAN', 'BIT']],
    ['Texto', ['VARCHAR', 'CHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET']],
    ['Fecha y hora', ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR']],
    ['Otros', ['JSON', 'BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB']]
  ];

  // Valores sugeridos cuando el usuario cambia el tipo de dato
  const DEFAULT_LENGTH = { VARCHAR: '100', VARBINARY: '255', DECIMAL: '10,2', ENUM: "'opcion1','opcion2'", SET: "'a','b'" };

  function userDatabases() {
    const list = (typeof currentDatabasesList !== 'undefined' ? currentDatabasesList : []) || [];
    return list.filter(db => !SqlUtils.isSystemSchema(db));
  }

  function ensureConnected() {
    if (!UI.getConnection()) {
      UI.alert('Sin conexión', 'Primero conecta un servidor con el botón <strong>+ Conectar Servidor</strong>.');
      return false;
    }
    return true;
  }

  async function getSchema(db, force = false) {
    if (!db) return { tables: [] };
    if (!force && schemaCache[db]) return schemaCache[db];
    try {
      const data = await UI.api('/schema', { database: db });
      schemaCache[db] = data;
    } catch (e) {
      schemaCache[db] = { tables: [] };
    }
    return schemaCache[db];
  }

  /** Olvida la estructura guardada en memoria (también la del editor del grid) */
  function invalidate(db) {
    delete schemaCache[db];
    if (typeof ResultGrid !== 'undefined' && db) ResultGrid.invalidateStructure(db);
  }

  /** Después de crear o modificar algo: refrescar árbol lateral y diagrama ER */
  async function refreshAfterChange(db) {
    invalidate(db);
    if (typeof loadDatabasesTree === 'function') await loadDatabasesTree();
    const container = document.getElementById(`tables-list-${db}`);
    if (container && !container.classList.contains('show') && typeof toggleDatabaseNode === 'function') {
      await toggleDatabaseNode(db);
    }
    const erTab = $('tab-er');
    if (erTab && erTab.classList.contains('active') && typeof renderERDiagram === 'function') renderERDiagram();
  }

  function sendToEditor(sql, title) {
    if (typeof EditorTabs !== 'undefined') {
      EditorTabs.openWithSql(sql, title);
    } else {
      const editor = $('sqlEditor');
      editor.value = sql;
      editor.dispatchEvent(new Event('input'));
    }
    if (typeof switchTab === 'function') switchTab('tab-editor');
    UI.toast('SQL copiado al editor. Puedes revisarlo y ejecutarlo tú mismo.', 'info');
  }

  function renderMessages(el, errors = [], warnings = [], extraHtml = '') {
    el.innerHTML =
      errors.map(e => `<div class="designer-msg error">✖ ${UI.escape(e)}</div>`).join('') +
      warnings.map(w => `<div class="designer-msg warning">⚠ ${UI.escape(w)}</div>`).join('') +
      extraHtml;
  }

  // =====================================================================
  // A) NUEVA BASE DE DATOS
  // =====================================================================
  async function openCreateDatabase() {
    if (!ensureConnected()) return;
    $('dbDesignerName').value = '';
    $('dbDesignerOpenTable').checked = true;
    $('dbDesignerModal').style.display = 'flex';
    setTimeout(() => $('dbDesignerName').focus(), 30);

    if (!charsetCache) {
      try {
        charsetCache = await UI.api('/designer/charsets');
      } catch (e) {
        charsetCache = {
          charsets: [{ name: 'utf8mb4', defaultCollation: 'utf8mb4_general_ci', description: 'UTF-8 Unicode' }],
          collations: [{ name: 'utf8mb4_general_ci', charset: 'utf8mb4' }, { name: 'utf8mb4_unicode_ci', charset: 'utf8mb4' }]
        };
      }
    }
    const cs = $('dbDesignerCharset');
    cs.innerHTML = charsetCache.charsets
      .map(c => `<option value="${UI.escape(c.name)}">${UI.escape(c.name)} — ${UI.escape(c.description || '')}</option>`)
      .join('');
    cs.value = charsetCache.charsets.some(c => c.name === 'utf8mb4') ? 'utf8mb4' : (charsetCache.charsets[0] || {}).name;
    fillCollations();
    updateDatabasePreview();
  }

  function fillCollations() {
    const charset = $('dbDesignerCharset').value;
    const info = charsetCache.charsets.find(c => c.name === charset) || {};
    const list = charsetCache.collations.filter(c => c.charset === charset);
    const preferred = ['utf8mb4_0900_ai_ci', 'utf8mb4_unicode_ci'].find(p => list.some(c => c.name === p)) || info.defaultCollation;
    $('dbDesignerCollation').innerHTML = list
      .map(c => `<option value="${UI.escape(c.name)}">${UI.escape(c.name)}${c.name === info.defaultCollation ? ' (predeterminada)' : ''}</option>`)
      .join('');
    $('dbDesignerCollation').value = preferred || '';
  }

  function databaseDefinition() {
    return {
      name: $('dbDesignerName').value,
      charset: $('dbDesignerCharset').value,
      collation: $('dbDesignerCollation').value
    };
  }

  function updateDatabasePreview() {
    const def = databaseDefinition();
    const result = DDLBuilder.buildCreateDatabase(def);
    const warnings = [];
    if (def.name && (typeof currentDatabasesList !== 'undefined') &&
      currentDatabasesList.some(db => db.toLowerCase() === def.name.toLowerCase())) {
      result.errors.push(`Ya existe una base de datos llamada "${def.name}".`);
    }
    if (def.name && /[A-Z]/.test(def.name)) warnings.push('Consejo: usa minúsculas; en Linux los nombres distinguen mayúsculas.');
    $('dbDesignerPreview').innerHTML = UI.highlightSql(result.statements.join(';\n') + ';');
    renderMessages($('dbDesignerMessages'), def.name ? result.errors : [], warnings);
    $('dbDesignerSubmit').disabled = !def.name || result.errors.length > 0;
  }

  async function submitDatabase() {
    const def = databaseDefinition();
    const btn = $('dbDesignerSubmit');
    btn.disabled = true;
    btn.textContent = 'Creando...';
    try {
      const data = await UI.api('/designer/create-database', { definition: def });
      data.statements.forEach(s => logConsole(`[Diseñador] ${s};`, 'success'));
      UI.toast(`Base de datos "${def.name}" creada`, 'success');
      closeDatabaseModal();
      await refreshAfterChange(def.name);
      if ($('dbDesignerOpenTable').checked) openCreateTable(def.name);
    } catch (e) {
      renderMessages($('dbDesignerMessages'), [e.message]);
    } finally {
      btn.textContent = 'Crear base de datos';
      updateDatabasePreview();
    }
  }

  function closeDatabaseModal() {
    $('dbDesignerModal').style.display = 'none';
  }

  // =====================================================================
  // B) NUEVA TABLA / MODIFICAR TABLA
  // =====================================================================
  function newColumn(overrides = {}) {
    return Object.assign({
      id: newId('c'), origName: null, name: '', type: 'VARCHAR', length: '100',
      unsigned: false, pk: false, nn: false, uq: false, ai: false, def: '', comment: '', onUpdateNow: false
    }, overrides);
  }

  function openModal() {
    $('tableDesignerModal').style.display = 'flex';
  }

  async function openCreateTable(database) {
    if (!ensureConnected()) return;
    const conn = UI.getConnection();
    const dbs = userDatabases();
    let db = database || (conn.database && !SqlUtils.isSystemSchema(conn.database) ? conn.database : '');
    if (!db && dbs.length === 1) db = dbs[0];

    state = {
      mode: 'create',
      original: null,
      notes: [],
      table: {
        database: db,
        name: '',
        engine: 'InnoDB',
        comment: '',
        columns: [newColumn({ name: 'id', type: 'INT', length: '', unsigned: true, pk: true, nn: true, ai: true })],
        foreignKeys: []
      }
    };
    state.initialJson = JSON.stringify(state.table);
    renderTableDesigner();
    openModal();
    setTimeout(() => $('tdName').focus(), 30);
    if (db) {
      await getSchema(db);
      renderForeignKeys();
      updateTablePreview();
    }
  }

  async function openEditTable(database, table) {
    if (!ensureConnected()) return;
    if (SqlUtils.isSystemSchema(database)) {
      UI.alert('Tabla protegida', `Las tablas de <strong>${UI.escape(database)}</strong> pertenecen al sistema MySQL y no se pueden modificar desde el diseñador.`);
      return;
    }
    try {
      const [data] = await Promise.all([
        UI.api('/designer/table-structure', { database, table }),
        getSchema(database, true)
      ]);
      state = {
        mode: 'alter',
        original: clone(data.table),
        table: clone(data.table),
        notes: data.notes || []
      };
      state.initialJson = JSON.stringify(state.table);
      renderTableDesigner();
      openModal();
    } catch (e) {
      UI.alert('No se pudo abrir la tabla', UI.escape(e.message));
    }
  }

  async function closeTableDesigner(force = false) {
    if (!force && state && JSON.stringify(state.table) !== state.initialJson) {
      const ok = await UI.confirm({
        title: 'Descartar cambios',
        html: 'Tienes cambios sin guardar en el diseñador. ¿Deseas cerrarlo de todas formas?',
        confirmLabel: 'Descartar',
        danger: true
      });
      if (!ok) return;
    }
    $('tableDesignerModal').style.display = 'none';
    state = null;
  }

  function renderTableDesigner() {
    const t = state.table;
    const isAlter = state.mode === 'alter';
    $('tdTitle').textContent = isAlter ? `Modificar tabla: ${state.original.database}.${state.original.name}` : 'Nueva tabla';
    $('tdSubmit').textContent = isAlter ? 'Aplicar cambios' : 'Crear tabla';

    const dbSelect = $('tdDatabase');
    const dbs = userDatabases();
    if (t.database && !dbs.includes(t.database)) dbs.unshift(t.database);
    dbSelect.innerHTML = '<option value="">Selecciona...</option>' +
      dbs.map(db => `<option value="${UI.escape(db)}">${UI.escape(db)}</option>`).join('');
    dbSelect.value = t.database || '';
    dbSelect.disabled = isAlter;

    $('tdName').value = t.name;
    $('tdEngine').innerHTML = DDLBuilder.ENGINES.map(e => `<option>${e}</option>`).join('');
    $('tdEngine').value = t.engine || 'InnoDB';
    $('tdComment').value = t.comment || '';
    $('tdNotes').innerHTML = (state.notes || []).map(n => `<div class="designer-msg info">ℹ ${UI.escape(n)}</div>`).join('');

    renderColumns();
    renderForeignKeys();
    updateTablePreview();
  }

  function typeOptions(current) {
    let html = '';
    TYPE_GROUPS.forEach(([label, types]) => {
      html += `<optgroup label="${label}">` +
        types.map(ty => `<option value="${ty}" title="${UI.escape(T[ty].hint)}">${ty}</option>`).join('') +
        '</optgroup>';
    });
    const known = TYPE_GROUPS.some(([, types]) => types.includes(current));
    if (current && !known) html = `<option value="${UI.escape(current)}">${UI.escape(current)}</option>` + html;
    return html;
  }

  function renderColumns() {
    const body = $('tdColumns');
    body.innerHTML = state.table.columns.map((c, idx) => {
      const meta = T[c.type] || { group: 'other', len: 'none', hint: 'Tipo especial (se conserva sin cambios)' };
      const locked = !!(c.locked || c.generated);
      const lenDisabled = locked || meta.len === 'none';
      const isNum = meta.group === 'int' || meta.group === 'num';
      const isInt = meta.group === 'int';
      const lenPlaceholder = { 'req-int': 'obligatorio', 'opt-int': 'opcional', 'opt-prec': 'ej. 10,2', 'req-list': "'a','b'" }[meta.len] || '—';
      const isNew = !c.origName && state.mode === 'alter';
      const cb = (field, title, disabled = false) =>
        `<td class="td-check"><input type="checkbox" data-field="${field}" title="${title}" ${c[field] ? 'checked' : ''} ${disabled || locked ? 'disabled' : ''}></td>`;
      const defCell = c.generated
        ? `<td><span class="designer-badge" title="${UI.escape(c.generated.expr)}">calculada: ${UI.escape(c.generated.expr)}</span></td>`
        : `<td><input type="text" class="designer-input" data-field="def" value="${UI.escape(c.def)}" placeholder="${c.ai ? 'automático' : '(sin valor)'}" ${c.ai || locked ? 'disabled' : ''} title="Texto, número, NULL o CURRENT_TIMESTAMP"></td>`;

      return `
        <tr data-id="${c.id}" class="${isNew ? 'row-new' : ''}">
          <td class="td-move">
            <button type="button" class="icon-btn" data-act="up" title="Subir" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="icon-btn" data-act="down" title="Bajar" ${idx === state.table.columns.length - 1 ? 'disabled' : ''}>▼</button>
          </td>
          <td><input type="text" class="designer-input" data-field="name" value="${UI.escape(c.name)}" placeholder="nombre_columna" spellcheck="false"></td>
          <td><select class="designer-input" data-field="type" title="${UI.escape(meta.hint)}" ${locked ? 'disabled' : ''}>${typeOptions(c.type)}</select></td>
          <td><input type="text" class="designer-input input-len" data-field="length" value="${UI.escape(c.length)}" placeholder="${lenPlaceholder}" ${lenDisabled ? 'disabled' : ''} spellcheck="false"></td>
          ${cb('pk', 'Llave primaria (PRIMARY KEY)')}
          ${cb('nn', 'No nulo (NOT NULL)', c.pk)}
          ${cb('uq', 'Valor único (UNIQUE)', c.pk)}
          ${cb('ai', 'Auto incremento (AUTO_INCREMENT)', !isInt)}
          ${cb('unsigned', 'Sin signo (UNSIGNED): solo positivos', !isNum)}
          ${defCell}
          <td class="td-move"><button type="button" class="icon-btn danger" data-act="remove" title="Eliminar columna">🗑️</button></td>
        </tr>`;
    }).join('');
    body.querySelectorAll('select[data-field="type"]').forEach((sel, i) => { sel.value = state.table.columns[i].type; });
  }

  // ---------- Llaves foráneas ----------
  function refTableOptions() {
    const schema = schemaCache[state.table.database] || { tables: [] };
    const names = schema.tables.map(t => t.name);
    const current = state.table.name;
    const originalName = state.original ? state.original.name : null;
    const list = names.filter(n => n !== originalName);
    if (current) list.unshift(current); // referencia a sí misma (ej. empleado → jefe)
    return [...new Set(list)];
  }

  function refColumnsFor(refTable) {
    if (!refTable) return [];
    if (refTable === state.table.name || (state.original && refTable === state.original.name)) {
      return state.table.columns.filter(c => c.name).map(c => ({ name: c.name, type: DDLBuilder.typeSql(c), isPrimary: c.pk }));
    }
    const schema = schemaCache[state.table.database] || { tables: [] };
    const table = schema.tables.find(t => t.name === refTable);
    return table ? table.columns : [];
  }

  function renderForeignKeys() {
    if (!state) return;
    const wrap = $('tdForeignKeys');
    const fks = state.table.foreignKeys;
    if (!fks.length) {
      wrap.innerHTML = '<div class="designer-empty">Sin relaciones. Usa <strong>+ Agregar relación</strong> para conectar esta tabla con otra (llave foránea).</div>';
      return;
    }
    const tables = refTableOptions();
    const actions = DDLBuilder.FK_ACTIONS.map(a => `<option>${a}</option>`).join('');
    wrap.innerHTML = fks.map(fk => {
      if (fk.multi) {
        return `<div class="fk-row" data-id="${fk.id}">
          <span class="designer-badge">🔗 ${UI.escape(fk.name)}: ${UI.escape(fk.multiLabel)}</span>
          <span class="designer-hint">Llave compuesta (se conserva)</span>
          <button type="button" class="icon-btn danger" data-act="remove-fk" title="Eliminar relación">🗑️</button>
        </div>`;
      }
      const colOptions = state.table.columns.filter(c => c.name)
        .map(c => `<option value="${c.id}">${UI.escape(c.name)}</option>`).join('');
      const tableOpts = tables.map(t => `<option value="${UI.escape(t)}">${UI.escape(t)}${t === state.table.name ? ' (esta tabla)' : ''}</option>`).join('');
      const refCols = refColumnsFor(fk.refTable)
        .map(c => `<option value="${UI.escape(c.name)}">${UI.escape(c.name)}${c.isPrimary ? ' 🔑' : ''} — ${UI.escape(c.type)}</option>`).join('');
      return `<div class="fk-row" data-id="${fk.id}">
        <label>Columna<select class="designer-input" data-fk="columnId"><option value="">—</option>${colOptions}</select></label>
        <span class="fk-arrow">➔</span>
        <label>Tabla referenciada<select class="designer-input" data-fk="refTable"><option value="">—</option>${tableOpts}</select></label>
        <label>Columna referenciada<select class="designer-input" data-fk="refColumn"><option value="">—</option>${refCols}</select></label>
        <label>ON DELETE<select class="designer-input" data-fk="onDelete">${actions}</select></label>
        <label>ON UPDATE<select class="designer-input" data-fk="onUpdate">${actions}</select></label>
        <button type="button" class="icon-btn danger" data-act="remove-fk" title="Eliminar relación">🗑️</button>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.fk-row').forEach(row => {
      const fk = fks.find(f => f.id === row.dataset.id);
      row.querySelectorAll('select[data-fk]').forEach(sel => { sel.value = fk[sel.dataset.fk] || (sel.dataset.fk.startsWith('on') ? 'RESTRICT' : ''); });
    });
  }

  function addForeignKey() {
    const cols = state.table.columns;
    const candidate = cols.find(c => !c.pk && /_id$/i.test(c.name)) || cols.find(c => !c.pk) || cols[0];
    const tables = refTableOptions().filter(t => t !== state.table.name);
    const guess = candidate && tables.find(t => candidate.name.toLowerCase().startsWith(t.toLowerCase().replace(/s$/, '')));
    const refTable = guess || tables[0] || '';
    const pk = refColumnsFor(refTable).find(c => c.isPrimary);
    state.table.foreignKeys.push({
      id: newId('f'), origName: null, name: '', columnId: candidate ? candidate.id : '',
      refTable, refColumn: pk ? pk.name : '', onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
    });
    renderForeignKeys();
    updateTablePreview();
  }

  /** Compara los tipos de las columnas relacionadas: MySQL exige que sean iguales */
  function normalizeType(type) {
    return String(type || '').toLowerCase()
      .replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1')
      .replace(/\s+(null|not null).*$/, '')
      .trim();
  }

  function fkWarnings() {
    const warnings = [];
    state.table.foreignKeys.forEach((fk, i) => {
      if (fk.multi) return;
      const col = state.table.columns.find(c => c.id === fk.columnId);
      const ref = refColumnsFor(fk.refTable).find(c => c.name === fk.refColumn);
      if (!col || !ref) return;
      const local = normalizeType(DDLBuilder.typeSql(col));
      const remote = normalizeType(ref.type);
      // En textos (CHAR/VARCHAR) la longitud puede variar; en los demás tipos deben ser idénticos
      const bothStrings = /^(var)?char/.test(local) && /^(var)?char/.test(remote);
      if (local !== remote && !bothStrings) {
        warnings.push(`Relación #${i + 1}: "${col.name}" es ${local.toUpperCase()} pero "${fk.refTable}.${fk.refColumn}" es ${remote.toUpperCase()}. MySQL exige el mismo tipo (incluido UNSIGNED).`);
      }
      if (!ref.isPrimary && fk.refTable !== state.table.name) {
        warnings.push(`Relación #${i + 1}: "${fk.refTable}.${fk.refColumn}" no es llave primaria; debe tener al menos un índice.`);
      }
    });
    return warnings;
  }

  // ---------- Vista previa ----------
  function buildResult() {
    return state.mode === 'alter'
      ? DDLBuilder.buildAlterTable(state.original, state.table)
      : DDLBuilder.buildCreateTable(state.table);
  }

  function updateTablePreview() {
    if (!state) return;
    const result = buildResult();
    const warnings = [...result.warnings, ...fkWarnings()];
    const sql = result.statements.length ? result.statements.join(';\n\n') + ';' : '-- Sin cambios todavía';
    $('tdPreview').innerHTML = UI.highlightSql(sql);
    const showErrors = state.mode === 'alter' || state.table.name || state.table.columns.some(c => c.name && c.name !== 'id');
    renderMessages($('tdMessages'), showErrors ? result.errors : [], warnings);
    $('tdSubmit').disabled = result.errors.length > 0 || !result.statements.length ||
      (state.mode === 'alter' && JSON.stringify(state.table) === state.initialJson);
    $('tdCounter').textContent = `${state.table.columns.length} columna(s) · ${state.table.foreignKeys.length} relación(es)`;
  }

  // ---------- Eventos ----------
  // Tipos cuya longitud significa lo mismo (al cambiar entre ellos se conserva)
  const LENGTH_FAMILIES = [
    ['VARCHAR', 'CHAR', 'VARBINARY', 'BINARY'],
    ['DECIMAL', 'FLOAT', 'DOUBLE'],
    ['ENUM', 'SET'],
    ['DATETIME', 'TIMESTAMP', 'TIME'],
    ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT']
  ];

  function applyColumnRules(col, field, previous) {
    const meta = T[col.type] || {};
    if (field === 'type') {
      const sameFamily = LENGTH_FAMILIES.some(f => f.includes(previous) && f.includes(col.type));
      if (!sameFamily || !col.length) col.length = DEFAULT_LENGTH[col.type] || '';
      if (meta.group !== 'int' && meta.group !== 'num') col.unsigned = false;
      if (meta.group !== 'int') col.ai = false;
      if (meta.group !== 'date') col.onUpdateNow = false;
    }
    if (field === 'pk' && col.pk) { col.nn = true; col.uq = false; }
    if (field === 'ai' && col.ai) {
      if (!col.pk && !col.uq) col.pk = true;
      col.nn = true;
      col.def = '';
    }
  }

  function onColumnsEvent(e) {
    const row = e.target.closest('tr[data-id]');
    if (!row || !state) return;
    const col = state.table.columns.find(c => c.id === row.dataset.id);
    const field = e.target.dataset.field;
    if (!col || !field) return;
    // Los <select> y checkboxes disparan "input" y "change": solo se procesa "change"
    if (e.type === 'input' && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')) return;

    const previous = col[field];
    col[field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;

    if (e.type === 'change') {
      applyColumnRules(col, field, previous);
      if (field !== 'name' && field !== 'def' && field !== 'length') renderColumns();
      renderForeignKeys();
    }
    updateTablePreview();
  }

  function onColumnsClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !state) return;
    const row = btn.closest('tr[data-id]');
    const cols = state.table.columns;
    const idx = cols.findIndex(c => c.id === row.dataset.id);
    if (btn.dataset.act === 'up' && idx > 0) [cols[idx - 1], cols[idx]] = [cols[idx], cols[idx - 1]];
    if (btn.dataset.act === 'down' && idx < cols.length - 1) [cols[idx + 1], cols[idx]] = [cols[idx], cols[idx + 1]];
    if (btn.dataset.act === 'remove') {
      const removed = cols.splice(idx, 1)[0];
      // Si la columna tenía relaciones, también se quitan
      state.table.foreignKeys = state.table.foreignKeys.filter(fk => fk.columnId !== removed.id || fk.multi);
    }
    renderColumns();
    renderForeignKeys();
    updateTablePreview();
  }

  function onForeignKeysEvent(e) {
    const row = e.target.closest('.fk-row');
    if (!row || !state) return;
    const fk = state.table.foreignKeys.find(f => f.id === row.dataset.id);
    const field = e.target.dataset.fk;
    if (!fk || !field) return;
    fk[field] = e.target.value;
    if (field === 'refTable') {
      const pk = refColumnsFor(fk.refTable).find(c => c.isPrimary);
      fk.refColumn = pk ? pk.name : '';
      renderForeignKeys();
    }
    updateTablePreview();
  }

  function onForeignKeysClick(e) {
    const btn = e.target.closest('button[data-act="remove-fk"]');
    if (!btn || !state) return;
    const id = btn.closest('.fk-row').dataset.id;
    state.table.foreignKeys = state.table.foreignKeys.filter(f => f.id !== id);
    renderForeignKeys();
    updateTablePreview();
  }

  async function onMetaChange(e) {
    if (!state) return;
    const t = state.table;
    if (e.target.id === 'tdDatabase') {
      t.database = e.target.value;
      t.foreignKeys = [];
      await getSchema(t.database);
      renderForeignKeys();
    }
    if (e.target.id === 'tdName') t.name = e.target.value;
    if (e.target.id === 'tdEngine') t.engine = e.target.value;
    if (e.target.id === 'tdComment') t.comment = e.target.value;
    if (e.type === 'change' && e.target.id === 'tdName') renderForeignKeys();
    updateTablePreview();
  }

  function addColumn() {
    const col = newColumn();
    state.table.columns.push(col);
    renderColumns();
    renderForeignKeys();
    updateTablePreview();
    const input = document.querySelector(`#tdColumns tr[data-id="${col.id}"] input[data-field="name"]`);
    if (input) input.focus();
  }

  async function submitTable() {
    if (!state) return;
    const result = buildResult();
    if (result.errors.length) return;
    const btn = $('tdSubmit');

    if (state.mode === 'alter') {
      const keep = new Set(state.table.columns.map(c => c.origName).filter(Boolean));
      const dropped = state.original.columns.filter(c => !keep.has(c.name)).map(c => c.name);
      const droppedFks = state.original.foreignKeys.filter(f => !state.table.foreignKeys.some(x => x.origName === f.origName)).map(f => f.name);
      const renamed = state.table.name !== state.original.name;
      if (dropped.length || droppedFks.length || renamed) {
        const items = [
          ...dropped.map(n => `<li>Se eliminará la columna <strong>${UI.escape(n)}</strong> y todos sus datos</li>`),
          ...droppedFks.map(n => `<li>Se eliminará la relación <strong>${UI.escape(n)}</strong></li>`),
          ...(renamed ? [`<li>La tabla se renombrará a <strong>${UI.escape(state.table.name)}</strong>; las consultas que usen el nombre anterior dejarán de funcionar</li>`] : [])
        ];
        const ok = await UI.confirm({
          title: '⚠️ Confirmar cambios en la tabla',
          html: `<ul class="danger-list">${items.join('')}</ul><p style="margin-top:8px;">Estos cambios no se pueden deshacer. Considera hacer un respaldo antes.</p>`,
          confirmLabel: 'Aplicar cambios',
          danger: true,
          requireText: dropped.length ? state.original.name : null
        });
        if (!ok) return;
      }
    }

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Aplicando...';
    try {
      const data = state.mode === 'alter'
        ? await UI.api('/designer/alter-table', { original: state.original, edited: state.table })
        : await UI.api('/designer/create-table', { definition: state.table });
      data.statements.forEach(s => logConsole(`[Diseñador] ${s};`, 'success'));
      const db = state.table.database;
      UI.toast(state.mode === 'alter' ? `Tabla "${state.table.name}" actualizada` : `Tabla "${state.table.name}" creada en ${db}`, 'success');
      await closeTableDesigner(true);
      await refreshAfterChange(db);
    } catch (e) {
      renderMessages($('tdMessages'), [e.message]);
      btn.disabled = false;
    } finally {
      btn.textContent = label;
    }
  }

  function copyTableSql() {
    if (!state) return;
    const result = buildResult();
    if (!result.statements.length) return;
    const sql = `-- Generado por el Diseñador Visual\n${result.statements.join(';\n\n')};\n`;
    const title = state.table.name || 'nueva_tabla';
    closeTableDesigner(true);
    sendToEditor(sql, title);
  }

  function copyDatabaseSql() {
    const result = DDLBuilder.buildCreateDatabase(databaseDefinition());
    closeDatabaseModal();
    sendToEditor(result.statements.join(';\n') + ';\n', 'nueva_bd');
  }

  // ---------- Inicialización de eventos ----------
  document.addEventListener('DOMContentLoaded', () => {
    const body = $('tdColumns');
    if (!body) return;
    body.addEventListener('input', onColumnsEvent);
    body.addEventListener('change', onColumnsEvent);
    body.addEventListener('click', onColumnsClick);
    $('tdForeignKeys').addEventListener('change', onForeignKeysEvent);
    $('tdForeignKeys').addEventListener('click', onForeignKeysClick);
    ['tdDatabase', 'tdName', 'tdEngine', 'tdComment'].forEach(id => {
      $(id).addEventListener('input', onMetaChange);
      $(id).addEventListener('change', onMetaChange);
    });
    ['dbDesignerName', 'dbDesignerCollation'].forEach(id => $(id).addEventListener('input', updateDatabasePreview));
    $('dbDesignerCharset').addEventListener('change', () => { fillCollations(); updateDatabasePreview(); });
    $('dbDesignerCollation').addEventListener('change', updateDatabasePreview);
    $('dbDesignerName').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('dbDesignerSubmit').disabled) submitDatabase(); });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.ui-dialog-overlay[style*="flex"]')) return;
      if ($('tableDesignerModal').style.display === 'flex') closeTableDesigner();
      else if ($('dbDesignerModal').style.display === 'flex') closeDatabaseModal();
    });
  });

  return {
    openCreateDatabase,
    submitDatabase,
    closeDatabaseModal,
    copyDatabaseSql,
    openCreateTable,
    openEditTable,
    closeTableDesigner,
    addColumn,
    addForeignKey,
    submitTable,
    copyTableSql,
    invalidate
  };
})();
