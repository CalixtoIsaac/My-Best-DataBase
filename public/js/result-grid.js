/**
 * ============================================================================
 * GRID DE RESULTADOS: FILTROS POR COLUMNA + EDICIÓN DE DATOS (result-grid.js)
 * ============================================================================
 * FILTROS (clic en el encabezado de una columna):
 *   - Ordenar ascendente / descendente.
 *   - Filtrar según el tipo de dato: número (=, entre, mayor que...), texto
 *     (empieza con, contiene...), fecha (antes de, entre...), NULL.
 *   - La consulta se vuelve a ejecutar en el servidor con el WHERE generado,
 *     y el SQL resultante se puede ver y copiar al editor.
 *
 * EDICIÓN (estilo Workbench):
 *   - Solo si el resultado viene de UNA tabla con LLAVE PRIMARIA incluida.
 *   - Doble clic en una celda para editarla; "+ Fila" para insertar; clic en
 *     el número de fila para seleccionarla y marcarla para eliminar.
 *   - Los cambios quedan pendientes (con colores) hasta "Revisar y aplicar":
 *     se muestran los UPDATE / INSERT / DELETE y se ejecutan en una transacción.
 *
 * El SQL lo generan las funciones compartidas de GridSql (grid-sql.js), las
 * mismas que usa el servidor para validar y ejecutar.
 */
const ResultGrid = (() => {
  const $ = id => document.getElementById(id);
  const structureCache = {};   // "bd.tabla" -> Promise con la estructura
  let current = null;          // resultado que se está mostrando
  let popover = null;          // ventana de filtro abierta
  let editorState = null;      // celda que se está editando

  const KIND_LABEL = { number: 'número', text: 'texto', date: 'fecha', other: 'otro', binary: 'binario' };

  // ------------------------------------------------------------------
  // Estado auxiliar guardado dentro del objeto "resultado"
  // ------------------------------------------------------------------
  function ensureState(r) {
    if (!r.filters) r.filters = [];
    if (r.sort === undefined) r.sort = null;
    if (!r.baseFields) r.baseFields = r.fields || [];
    if (!r.pending) r.pending = { edits: {}, deleted: [], inserts: [] };
    if (!r.selected) r.selected = [];
    return r;
  }

  function fieldMeta(r, name) {
    return (r.baseFields || []).find(f => f.name === name) || (r.fields || []).find(f => f.name === name) || { name, kind: 'other' };
  }

  function canFilter(r) {
    return !!(r && r.baseSql && r.columns && r.columns.length);
  }

  function pendingCount(r) {
    if (!r || !r.pending) return 0;
    const edited = Object.keys(r.pending.edits).filter(i => Object.keys(r.pending.edits[i]).length && !r.pending.deleted.includes(Number(i))).length;
    return edited + r.pending.deleted.length + r.pending.inserts.length;
  }

  function resetPending(r) {
    r.pending = { edits: {}, deleted: [], inserts: [] };
    r.selected = [];
  }

  // ------------------------------------------------------------------
  // ¿Se puede editar este resultado?
  // ------------------------------------------------------------------
  function getStructure(db, table) {
    const key = `${db}.${table}`;
    if (!structureCache[key]) {
      structureCache[key] = UI.api('/designer/table-structure', { database: db, table })
        .catch(err => { delete structureCache[key]; throw err; });
    }
    return structureCache[key];
  }

  async function checkEditable(r) {
    const fields = r.baseFields || [];
    const readOnly = reason => ({ editable: false, reason });

    if (!r.columns.length) return readOnly('');
    if (!r.baseSql) return readOnly('el resultado no viene de una consulta SELECT');
    if (new Set(r.columns).size !== r.columns.length || fields.length !== r.columns.length) {
      return readOnly('hay columnas repetidas con el mismo nombre');
    }
    const sources = [...new Set(fields.filter(f => f.orgTable).map(f => `${f.db}\u0000${f.orgTable}`))];
    if (!sources.length) return readOnly('las columnas son calculadas, no vienen de una tabla');
    if (sources.length > 1) return readOnly('combina varias tablas (JOIN); edita cada tabla por separado');

    const { clauses } = SqlUtils.topLevelClauses(r.baseSql);
    if (clauses.some(c => ['GROUP BY', 'UNION', 'HAVING'].includes(c.kw))) return readOnly('usa GROUP BY / UNION: cada fila no corresponde a un solo registro');
    if (/^\(*\s*SELECT\s+DISTINCT\b/i.test(SqlUtils.stripForAnalysis(r.baseSql))) return readOnly('usa DISTINCT');

    const [db, table] = sources[0].split('\u0000');
    if (SqlUtils.isSystemSchema(db)) return readOnly(`${db} es una base de datos del sistema`);

    let data;
    try {
      data = await getStructure(db, table);
    } catch (e) {
      return readOnly(/vista/i.test(e.message) ? `${table} es una vista` : e.message);
    }
    const structure = data.table;
    const pk = structure.columns.filter(c => c.pk).map(c => c.name);
    if (!pk.length) return readOnly(`la tabla ${table} no tiene llave primaria (PK)`);

    // Columna del resultado -> columna real de la tabla
    const colMap = {};
    fields.forEach(f => {
      if (f.orgTable === table && f.orgName) {
        const col = structure.columns.find(c => c.name === f.orgName);
        if (col) colMap[f.name] = col;
      }
    });
    const pkInResult = {};
    pk.forEach(name => {
      const resultName = Object.keys(colMap).find(n => colMap[n].name === name);
      if (resultName) pkInResult[name] = resultName;
    });
    const missing = pk.filter(name => !pkInResult[name]);
    if (missing.length) return readOnly(`incluye la llave primaria (${missing.join(', ')}) en el SELECT para poder editar`);

    return { editable: true, database: db, table, structure, colMap, pkInResult };
  }

  function cellEditable(r, name) {
    const info = r.editInfo;
    if (!info || !info.editable) return false;
    const col = info.colMap[name];
    if (!col) return false;
    const kind = GridSql.kindOfColumn(col);
    return kind !== 'generated' && kind !== 'binary';
  }

  // ------------------------------------------------------------------
  // Dibujo
  // ------------------------------------------------------------------
  function render(r) {
    closePopover();
    closeEditor(false);
    current = ensureState(r);
    window.lastQueryResult = r;
    renderToolbar();
    renderTable();
    if (typeof toggleResultView === 'function') toggleResultView('grid');

    if (r.editInfo === undefined && r.columns.length) {
      r.editInfo = null; // "verificando"
      checkEditable(r).then(info => {
        r.editInfo = info;
        if (current === r) { renderToolbar(); renderTable(); }
      });
    }
  }

  /** Limpia el grid (pestaña sin resultados) */
  function clear() {
    closePopover();
    closeEditor(false);
    current = null;
    window.lastQueryResult = null;
    $('gridHead').innerHTML = '<tr><th>Mensaje</th></tr>';
    $('gridBody').innerHTML = '<tr><td>Ejecuta una consulta SQL para mostrar resultados.</td></tr>';
    renderToolbar();
  }

  function formatValue(v) {
    if (v === null || v === undefined) return '<span class="cell-null-text">NULL</span>';
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return UI.escape(text.length > 300 ? text.slice(0, 300) + '…' : text);
  }

  function renderTable() {
    const r = current;
    const head = $('gridHead');
    const body = $('gridBody');
    if (!r) return;

    if (!r.columns.length) {
      head.innerHTML = '<tr><th>Resultado</th></tr>';
      const affected = r.meta && r.meta.affectedRows ? ` Filas afectadas: ${r.meta.affectedRows}.` : '';
      body.innerHTML = `<tr><td>Operación completada sin filas devueltas.${affected}</td></tr>`;
      return;
    }

    const info = r.editInfo;
    const editable = !!(info && info.editable);
    const filtersByCol = {};
    r.filters.forEach(f => { filtersByCol[f.column] = f; });

    head.innerHTML = '<tr><th class="rownum-h" title="Clic en el número de fila para seleccionarla">#</th>' + r.columns.map(name => {
      const meta = fieldMeta(r, name);
      const isPk = editable && info.colMap[name] && info.colMap[name].pk;
      const sortIcon = r.sort && r.sort.column === name ? (r.sort.dir === 'DESC' ? '▼' : '▲') : '';
      const filtered = filtersByCol[name];
      const ro = editable && !cellEditable(r, name) ? '<span class="th-ro" title="Columna de solo lectura">🔒</span>' : '';
      return `<th data-col="${UI.escape(name)}" class="${canFilter(r) ? 'th-clickable' : ''} ${filtered ? 'th-filtered' : ''}"
        title="${UI.escape(`${name} · ${KIND_LABEL[meta.kind] || meta.kind}${meta.orgTable ? ` · ${meta.orgTable}.${meta.orgName}` : ''}${canFilter(r) ? ' — clic para filtrar u ordenar' : ''}`)}">
        <div class="th-inner">
          ${isPk ? '<span class="th-pk" title="Llave primaria">🔑</span>' : ''}
          <span class="th-name">${UI.escape(name)}</span>
          ${ro}
          <span class="th-icons">${sortIcon ? `<span class="th-sort">${sortIcon}</span>` : ''}${filtered ? '<span class="th-funnel" title="Filtrado">⏷</span>' : ''}</span>
        </div>
      </th>`;
    }).join('') + '</tr>';

    const p = r.pending;
    const rowsHtml = r.rows.map((row, i) => {
      const deleted = p.deleted.includes(i);
      const selected = r.selected.includes(i);
      const edits = p.edits[i] || {};
      const cells = r.columns.map(name => {
        const isEdited = Object.prototype.hasOwnProperty.call(edits, name);
        const value = isEdited ? edits[name] : row[name];
        const cls = [
          isEdited ? 'cell-edited' : '',
          value === null || value === undefined ? 'cell-null' : '',
          editable && !cellEditable(r, name) ? 'cell-readonly' : ''
        ].join(' ');
        const title = isEdited ? ` title="Valor original: ${UI.escape(row[name] === null ? 'NULL' : String(row[name]))}"` : '';
        return `<td data-col="${UI.escape(name)}" class="${cls}"${title}>${formatValue(value)}</td>`;
      }).join('');
      return `<tr data-row="${i}" class="${deleted ? 'row-deleted' : ''} ${selected ? 'row-selected' : ''}">
        <td class="rownum ${editable ? 'rownum-selectable' : ''}" title="${deleted ? 'Clic para NO eliminar esta fila' : editable ? 'Clic para seleccionar' : ''}">${deleted ? '✕' : i + 1}</td>${cells}</tr>`;
    }).join('');

    const insertsHtml = p.inserts.map((ins, j) => {
      const cells = r.columns.map(name => {
        const col = editable ? info.colMap[name] : null;
        const has = Object.prototype.hasOwnProperty.call(ins, name);
        let content;
        if (has) content = formatValue(ins[name]);
        else if (col && col.ai) content = '<span class="cell-placeholder">(auto)</span>';
        else if (col && String(col.def || '').trim()) content = `<span class="cell-placeholder">(${UI.escape(col.def)})</span>`;
        else content = '<span class="cell-placeholder">(vacío)</span>';
        const cls = [has ? 'cell-edited' : '', editable && !cellEditable(r, name) ? 'cell-readonly' : ''].join(' ');
        return `<td data-col="${UI.escape(name)}" class="${cls}">${content}</td>`;
      }).join('');
      return `<tr data-new="${j}" class="row-new"><td class="rownum rownum-selectable" title="Clic para quitar esta fila nueva">＋</td>${cells}</tr>`;
    }).join('');

    body.innerHTML = rowsHtml + insertsHtml ||
      `<tr><td colspan="${r.columns.length + 1}" class="grid-empty">Sin filas${r.filters.length ? ' que cumplan los filtros' : ''}.</td></tr>`;
  }

  function renderToolbar() {
    const bar = $('gridToolbar');
    if (!bar) return;
    const r = current;
    if (!r || !r.columns || !r.columns.length) {
      bar.innerHTML = '';
      bar.classList.add('empty');
      return;
    }
    bar.classList.remove('empty');

    // --- Lado izquierdo: filtros ---
    let left = '';
    if (canFilter(r)) {
      const chips = r.filters.map((f, idx) =>
        `<span class="filter-chip" title="Clic para editar">
          <span data-chip="${idx}">${UI.escape(GridSql.describeFilter(f))}</span>
          <button class="chip-x" data-remove-filter="${idx}" title="Quitar filtro">×</button>
        </span>`).join('');
      const sortChip = r.sort
        ? `<span class="filter-chip sort-chip">${r.sort.dir === 'DESC' ? '▼' : '▲'} ${UI.escape(r.sort.column)}<button class="chip-x" data-remove-sort="1" title="Quitar orden">×</button></span>`
        : '';
      if (chips || sortChip) {
        left = `<span class="toolbar-label">🔎</span>${chips}${sortChip}
          <button class="grid-link" data-act="clear-filters">Limpiar</button>
          <button class="grid-link" data-act="sql-to-editor" title="Abrir en el editor la consulta generada">Ver SQL</button>`;
      } else {
        left = '<span class="toolbar-hint">🔎 Clic en un encabezado para filtrar u ordenar</span>';
      }
    } else {
      left = '<span class="toolbar-hint">Filtros disponibles solo para consultas SELECT</span>';
    }

    // --- Lado derecho: edición ---
    let right = '';
    const info = r.editInfo;
    if (info === null || info === undefined) {
      right = '<span class="toolbar-hint">⏳ Verificando si se puede editar…</span>';
    } else if (!info.editable) {
      right = info.reason ? `<span class="edit-badge readonly" title="${UI.escape(info.reason)}">🔒 Solo lectura: ${UI.escape(info.reason)}</span>` : '';
    } else {
      const n = pendingCount(r);
      const sel = r.selected.length;
      right = `
        <span class="edit-badge editable" title="Doble clic en una celda para editarla">✏️ Editable: ${UI.escape(info.table)}</span>
        <button class="grid-btn" data-act="add-row" title="Agregar una fila nueva">＋ Fila</button>
        ${sel ? `<button class="grid-btn danger" data-act="delete-selected">🗑️ Eliminar (${sel})</button>` : ''}
        ${n ? `<span class="pending-count">${n} cambio(s) sin aplicar</span>
          <button class="grid-btn" data-act="discard">Descartar</button>
          <button class="grid-btn primary" data-act="review">Revisar y aplicar</button>` : ''}`;
    }
    bar.innerHTML = `<div class="grid-toolbar-left">${left}</div><div class="grid-toolbar-right">${right}</div>`;
  }

  // ------------------------------------------------------------------
  // Ejecución de la consulta filtrada / refresco
  // ------------------------------------------------------------------
  async function rerun(r, sql) {
    const started = performance.now();
    let data;
    try {
      data = await UI.api('/query', { sql });
    } catch (e) {
      logConsole(`Error al filtrar: ${e.message}`, 'error');
      UI.alert('No se pudo ejecutar la consulta', `${UI.escape(e.message)}<pre class="sql-preview small">${UI.highlightSql(sql)}</pre>`);
      return false;
    }
    const ms = Math.round(performance.now() - started);
    r.columns = data.columns || [];
    r.rows = data.rows || [];
    r.fields = data.fields || [];
    r.sql = sql;
    resetPending(r);
    const metrics = `Filas: ${r.rows.length} | Tiempo: ${ms}ms`;
    r.metricsText = metrics;
    if (current === r) {
      const footer = $('footerMetrics');
      if (footer) footer.innerText = metrics;
      render(r);
    }
    logConsole(`Consulta actualizada (${r.rows.length} filas, ${ms}ms):\n${sql}`, 'info');
    return true;
  }

  async function applyFilters(r) {
    if (pendingCount(r) && !(await confirmDiscard())) return false;
    const built = GridSql.buildFilteredSql(r.baseSql, r.baseFields, r.filters, r.sort);
    if (built.errors.length) {
      UI.alert('Revisa el filtro', built.errors.map(UI.escape).join('<br>'));
      return false;
    }
    // Sin filtros ni orden: volver a la consulta original tal cual
    const sql = !r.filters.length && !r.sort ? r.baseSql : built.sql;
    return rerun(r, sql);
  }

  // ------------------------------------------------------------------
  // Ventana de filtro por columna
  // ------------------------------------------------------------------
  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  function openPopover(th, column) {
    closePopover();
    const r = current;
    if (!canFilter(r)) {
      UI.toast('Los filtros solo funcionan con consultas SELECT.', 'warning');
      return;
    }
    const meta = fieldMeta(r, column);
    const kind = GridSql.FILTER_OPS[meta.kind] ? meta.kind : 'other';
    const existing = r.filters.find(f => f.column === column);
    const ops = GridSql.FILTER_OPS[kind];
    const defaultOp = existing ? existing.op : (kind === 'text' ? 'starts' : kind === 'number' ? 'eq' : ops[0][0]);

    popover = document.createElement('div');
    popover.className = 'col-popover';
    popover.innerHTML = `
      <div class="pop-title">
        <strong>${UI.escape(column)}</strong>
        <span class="kind-badge kind-${kind}">${KIND_LABEL[meta.kind] || meta.kind}</span>
        ${meta.orgTable ? `<span class="pop-src">${UI.escape(meta.orgTable)}.${UI.escape(meta.orgName)}</span>` : '<span class="pop-src">columna calculada</span>'}
      </div>
      <div class="pop-section">Ordenar</div>
      <div class="pop-row">
        <button class="grid-btn ${r.sort && r.sort.column === column && r.sort.dir === 'ASC' ? 'active' : ''}" data-sort="ASC">▲ ${kind === 'text' ? 'A → Z' : 'Menor a mayor'}</button>
        <button class="grid-btn ${r.sort && r.sort.column === column && r.sort.dir === 'DESC' ? 'active' : ''}" data-sort="DESC">▼ ${kind === 'text' ? 'Z → A' : 'Mayor a menor'}</button>
        ${r.sort && r.sort.column === column ? '<button class="grid-btn" data-sort="">Quitar</button>' : ''}
      </div>
      <div class="pop-section">Filtrar</div>
      <select class="form-control pop-input" data-f="op">
        ${ops.map(([k, label]) => `<option value="${k}" ${k === defaultOp ? 'selected' : ''}>${UI.escape(label)}</option>`).join('')}
      </select>
      <div class="pop-values">
        <input class="form-control pop-input" data-f="value" spellcheck="false" autocomplete="off" value="${UI.escape(existing ? existing.value || '' : '')}">
        <span class="pop-and">y</span>
        <input class="form-control pop-input" data-f="value2" spellcheck="false" autocomplete="off" value="${UI.escape(existing ? existing.value2 || '' : '')}">
      </div>
      <div class="pop-preview" data-f="preview"></div>
      <div class="pop-actions">
        ${existing ? '<button class="grid-btn" data-act="remove">Quitar filtro</button>' : ''}
        <button class="grid-btn primary" data-act="apply">Aplicar filtro</button>
      </div>`;
    document.body.appendChild(popover);

    const opSel = popover.querySelector('[data-f="op"]');
    const v1 = popover.querySelector('[data-f="value"]');
    const v2 = popover.querySelector('[data-f="value2"]');
    const and = popover.querySelector('.pop-and');
    const preview = popover.querySelector('[data-f="preview"]');

    const placeholders = {
      number: { eq: 'ej. 100', between: 'desde, ej. 100', in: 'ej. 1, 5, 9', _: 'ej. 100' },
      text: { starts: 'ej. N', ends: 'ej. ez', contains: 'ej. ana', in: 'ej. Ana, Luis', _: 'texto' },
      date: { _: 'AAAA-MM-DD' },
      other: { _: 'valor' }
    };
    const readFilter = () => ({ column, op: opSel.value, value: v1.value, value2: v2.value });
    const refresh = () => {
      const op = opSel.value;
      const noValue = GridSql.NO_VALUE_OPS.includes(op);
      v1.style.display = noValue ? 'none' : '';
      v2.style.display = op === 'between' ? '' : 'none';
      and.style.display = op === 'between' ? '' : 'none';
      const ph = placeholders[kind] || placeholders.other;
      v1.placeholder = ph[op] || ph._;
      v2.placeholder = op === 'between' ? (kind === 'date' ? 'AAAA-MM-DD' : 'hasta, ej. 200') : '';
      const ref = meta.orgName && meta.orgTable ? DDLBuilder.q(meta.orgName) : DDLBuilder.q(column);
      const c = GridSql.conditionSql(readFilter(), ref, meta);
      preview.innerHTML = c.sql ? `WHERE ${UI.highlightSql(c.sql)}` : (v1.value || noValue ? `<span class="pop-error">${UI.escape(c.error)}</span>` : '');
    };
    opSel.addEventListener('change', refresh);
    v1.addEventListener('input', refresh);
    v2.addEventListener('input', refresh);
    refresh();

    const apply = async () => {
      const f = readFilter();
      const c = GridSql.conditionSql(f, '`x`', meta);
      if (c.error) { preview.innerHTML = `<span class="pop-error">${UI.escape(c.error)}</span>`; return; }
      const previous = r.filters.slice();
      r.filters = r.filters.filter(x => x.column !== column).concat([f]);
      closePopover();
      if (!(await applyFilters(r))) { r.filters = previous; renderToolbar(); renderTable(); }
    };
    popover.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
      if (e.key === 'Escape') { e.stopPropagation(); closePopover(); }
    });
    popover.addEventListener('click', async e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.sort !== undefined) {
        const previous = r.sort;
        r.sort = btn.dataset.sort ? { column, dir: btn.dataset.sort } : null;
        closePopover();
        if (!(await applyFilters(r))) { r.sort = previous; renderToolbar(); renderTable(); }
      } else if (btn.dataset.act === 'apply') {
        apply();
      } else if (btn.dataset.act === 'remove') {
        const previous = r.filters.slice();
        r.filters = r.filters.filter(x => x.column !== column);
        closePopover();
        if (!(await applyFilters(r))) { r.filters = previous; renderToolbar(); renderTable(); }
      }
    });

    // Posición: debajo del encabezado, o arriba si no cabe
    const rect = th.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - pw - 10);
    let top = rect.bottom + 4;
    if (top + ph > window.innerHeight - 10) top = Math.max(10, rect.top - ph - 4);
    popover.style.left = Math.max(10, left) + 'px';
    popover.style.top = top + 'px';
    setTimeout(() => (GridSql.NO_VALUE_OPS.includes(opSel.value) ? opSel : v1).focus(), 20);
  }

  // ------------------------------------------------------------------
  // Edición de celdas
  // ------------------------------------------------------------------
  function enumOptions(col) {
    if (!col || !['ENUM', 'SET'].includes(String(col.type).toUpperCase()) || String(col.type).toUpperCase() === 'SET') return null;
    const list = [];
    String(col.length || '').replace(/'((?:[^'\\]|''|\\.)*)'/g, (m, v) => { list.push(v.replace(/''/g, "'")); return m; });
    return list.length ? list : null;
  }

  function openEditor(td) {
    const r = current;
    const tr = td.parentElement;
    const name = td.dataset.col;
    if (!r || !name || !cellEditable(r, name)) {
      if (r && r.editInfo && r.editInfo.editable && name) UI.toast(`La columna "${name}" es de solo lectura (calculada o binaria).`, 'warning');
      return;
    }
    const isNew = tr.dataset.new !== undefined;
    const idx = Number(isNew ? tr.dataset.new : tr.dataset.row);
    if (!isNew && r.pending.deleted.includes(idx)) return;
    closeEditor(true);

    const col = r.editInfo.colMap[name];
    let value;
    if (isNew) value = Object.prototype.hasOwnProperty.call(r.pending.inserts[idx], name) ? r.pending.inserts[idx][name] : undefined;
    else {
      const edits = r.pending.edits[idx] || {};
      value = Object.prototype.hasOwnProperty.call(edits, name) ? edits[name] : r.rows[idx][name];
    }
    const text = value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));

    const options = enumOptions(col);
    const input = document.createElement(options ? 'select' : 'input');
    input.className = 'cell-input';
    if (options) {
      input.innerHTML = options.map(o => `<option value="${UI.escape(o)}">${UI.escape(o)}</option>`).join('');
      input.value = options.includes(text) ? text : options[0];
    } else {
      input.value = text;
      input.spellcheck = false;
      input.placeholder = value === null ? 'NULL' : '';
    }
    const nullBtn = document.createElement('button');
    nullBtn.className = 'cell-null-btn';
    nullBtn.type = 'button';
    nullBtn.textContent = 'NULL';
    nullBtn.title = col.nn || col.pk ? 'Esta columna no permite NULL' : 'Guardar NULL (sin valor)';
    nullBtn.disabled = !!(col.nn || col.pk);

    td.classList.add('cell-editing');
    td.innerHTML = '';
    td.appendChild(input);
    td.appendChild(nullBtn);
    editorState = { td, input, name, isNew, idx, original: value };
    input.focus();
    if (input.select) input.select();

    nullBtn.addEventListener('mousedown', e => e.preventDefault());
    nullBtn.addEventListener('click', () => commitValue(null));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); closeEditor(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditor(false); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const cells = [...tr.querySelectorAll('td[data-col]')];
        const pos = cells.indexOf(td);
        closeEditor(true);
        const nextTr = $('gridBody').querySelector(isNew ? `tr[data-new="${idx}"]` : `tr[data-row="${idx}"]`);
        const nextCells = nextTr ? [...nextTr.querySelectorAll('td[data-col]')] : [];
        const step = e.shiftKey ? -1 : 1;
        for (let k = pos + step; k >= 0 && k < nextCells.length; k += step) {
          if (cellEditable(r, nextCells[k].dataset.col)) { openEditor(nextCells[k]); break; }
        }
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (editorState && editorState.input === input) closeEditor(true); }, 120));
  }

  function commitValue(value) {
    const st = editorState;
    if (!st) return;
    editorState = null;
    const r = current;
    if (st.isNew) {
      r.pending.inserts[st.idx][st.name] = value;
    } else {
      const original = r.rows[st.idx][st.name];
      const same = value === null ? original === null
        : original !== null && original !== undefined && (typeof original === 'object' ? JSON.stringify(original) : String(original)) === value;
      const edits = r.pending.edits[st.idx] || (r.pending.edits[st.idx] = {});
      if (same) delete edits[st.name]; else edits[st.name] = value;
      if (!Object.keys(edits).length) delete r.pending.edits[st.idx];
    }
    renderTable();
    renderToolbar();
  }

  function closeEditor(save) {
    const st = editorState;
    if (!st) return;
    if (save) {
      const newText = st.input.value;
      const oldText = st.original === null || st.original === undefined ? null : String(st.original);
      // Si no se tocó una celda NULL (o vacía en fila nueva), se deja igual
      if ((st.original === null || st.original === undefined) && newText === '') {
        editorState = null;
        renderTable();
        return;
      }
      if (newText !== oldText) { commitValue(newText); return; }
    }
    editorState = null;
    renderTable();
  }

  // ------------------------------------------------------------------
  // Acciones de la barra de edición
  // ------------------------------------------------------------------
  function addRow() {
    const r = current;
    r.pending.inserts.push({});
    renderTable();
    renderToolbar();
    const container = $('view-grid');
    container.scrollTop = container.scrollHeight;
    const tr = $('gridBody').querySelector(`tr[data-new="${r.pending.inserts.length - 1}"]`);
    const firstEditable = tr && [...tr.querySelectorAll('td[data-col]')].find(td => {
      const col = r.editInfo.colMap[td.dataset.col];
      return cellEditable(r, td.dataset.col) && !(col && col.ai);
    });
    if (firstEditable) openEditor(firstEditable);
  }

  function toggleRowSelection(tr) {
    const r = current;
    if (!r.editInfo || !r.editInfo.editable) return;
    if (tr.dataset.new !== undefined) {
      r.pending.inserts.splice(Number(tr.dataset.new), 1);
    } else {
      const i = Number(tr.dataset.row);
      if (r.pending.deleted.includes(i)) {
        r.pending.deleted = r.pending.deleted.filter(x => x !== i);
      } else if (r.selected.includes(i)) {
        r.selected = r.selected.filter(x => x !== i);
      } else {
        r.selected.push(i);
      }
    }
    renderTable();
    renderToolbar();
  }

  function deleteSelected() {
    const r = current;
    r.selected.forEach(i => { if (!r.pending.deleted.includes(i)) r.pending.deleted.push(i); });
    r.selected = [];
    renderTable();
    renderToolbar();
  }

  /** Convierte los cambios pendientes al formato de GridSql.buildChanges (nombres reales) */
  function buildRequest(r) {
    const info = r.editInfo;
    const keyOf = i => {
      const key = {};
      Object.entries(info.pkInResult).forEach(([real, resultName]) => { key[real] = r.rows[i][resultName]; });
      return key;
    };
    const updates = [];
    Object.entries(r.pending.edits).forEach(([i, edits]) => {
      const idx = Number(i);
      if (r.pending.deleted.includes(idx) || !Object.keys(edits).length) return;
      const set = {};
      Object.entries(edits).forEach(([name, value]) => { set[info.colMap[name].name] = value; });
      updates.push({ key: keyOf(idx), set });
    });
    const deletes = r.pending.deleted.slice().sort((a, b) => a - b).map(i => ({ key: keyOf(i) }));
    const inserts = r.pending.inserts.map(ins => {
      const values = {};
      Object.entries(ins).forEach(([name, value]) => {
        if (info.colMap[name]) values[info.colMap[name].name] = value;
      });
      return { values };
    });
    return { updates, deletes, inserts };
  }

  async function review() {
    const r = current;
    closeEditor(true);
    const info = r.editInfo;
    const request = buildRequest(r);
    const built = GridSql.buildChanges(info.structure, request);
    if (built.errors.length) {
      UI.alert('Hay datos que corregir', `<ul class="danger-list">${built.errors.map(e => `<li>${UI.escape(e)}</li>`).join('')}</ul>`);
      return;
    }
    if (!built.statements.length) { UI.toast('No hay cambios que aplicar.', 'info'); return; }

    const count = type => built.statements.filter(s => s.type === type).length;
    const summary = [
      count('update') && `<span class="sum-chip update">${count('update')} UPDATE</span>`,
      count('insert') && `<span class="sum-chip insert">${count('insert')} INSERT</span>`,
      count('delete') && `<span class="sum-chip delete">${count('delete')} DELETE</span>`
    ].filter(Boolean).join(' ');
    const sqlText = built.statements.map(s => s.sql + ';').join('\n\n');

    const ok = await UI.confirm({
      title: '📝 Revisar cambios antes de aplicarlos',
      width: '680px',
      html: `
        <div class="review-summary">Tabla <strong>${UI.escape(info.database)}.${UI.escape(info.table)}</strong>: ${summary}</div>
        <pre class="sql-preview review-sql">${UI.highlightSql(sqlText)}</pre>
        <p class="designer-hint">🔒 Se ejecutarán dentro de una <strong>transacción</strong>: si alguna falla o no encuentra su fila, se deshacen todas (ROLLBACK).</p>`,
      confirmLabel: 'Aplicar cambios',
      danger: count('delete') > 0,
      extra: {
        label: '📝 Copiar al editor',
        onClick: () => {
          if (typeof EditorTabs !== 'undefined') {
            EditorTabs.add(`-- Cambios generados desde el grid (${info.table})\nSTART TRANSACTION;\n\n${sqlText}\n\nCOMMIT;\n`, `cambios_${info.table}`);
            UI.toast('SQL copiado a una pestaña nueva del editor.', 'info');
          }
        }
      }
    });
    if (!ok) return;

    try {
      const data = await UI.api('/grid/apply', { database: info.database, table: info.table, changes: request });
      data.results.forEach(res => logConsole(`[Grid] ${res.sql.replace(/\n\s*/g, ' ')}; → ${res.affectedRows} fila(s)${res.insertId ? ` (id ${res.insertId})` : ''}`, 'success'));
      UI.toast(`Cambios aplicados: ${summary.replace(/<[^>]+>/g, '')}`, 'success', 4500);
      await rerun(r, r.sql);
    } catch (e) {
      logConsole(`Error al aplicar cambios: ${e.message}`, 'error');
      UI.alert('No se aplicaron los cambios', `${UI.escape(e.message).replace(/\n/g, '<br>')}${e.data && e.data.sql ? `<pre class="sql-preview small">${UI.highlightSql(e.data.sql)}</pre>` : ''}`);
    }
  }

  async function discard() {
    const r = current;
    const ok = await UI.confirm({
      title: 'Descartar cambios',
      html: `Se perderán ${pendingCount(r)} cambio(s) sin aplicar.`,
      confirmLabel: 'Descartar',
      danger: true
    });
    if (!ok) return;
    resetPending(r);
    renderTable();
    renderToolbar();
  }

  /** Antes de ejecutar otra consulta: avisar si hay cambios sin aplicar */
  async function confirmDiscard() {
    const r = current;
    if (!r || !pendingCount(r)) return true;
    const ok = await UI.confirm({
      title: 'Cambios sin aplicar',
      html: `Tienes <strong>${pendingCount(r)} cambio(s)</strong> en el grid que todavía no se guardan en la base de datos. Si continúas se perderán.`,
      confirmLabel: 'Continuar y descartar',
      danger: true
    });
    if (ok) resetPending(r);
    return ok;
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const head = $('gridHead');
    const body = $('gridBody');
    const bar = $('gridToolbar');
    if (!head || !body || !bar) return;

    head.addEventListener('click', e => {
      const th = e.target.closest('th[data-col]');
      if (th && current) openPopover(th, th.dataset.col);
    });
    body.addEventListener('dblclick', e => {
      const td = e.target.closest('td[data-col]');
      if (td && current && current.editInfo && current.editInfo.editable && !td.classList.contains('cell-editing')) openEditor(td);
    });
    body.addEventListener('click', e => {
      const num = e.target.closest('td.rownum-selectable');
      if (num && current) toggleRowSelection(num.parentElement);
    });
    bar.addEventListener('click', async e => {
      const r = current;
      if (!r) return;
      const btn = e.target.closest('button, [data-chip]');
      if (!btn) return;
      if (btn.dataset.removeFilter !== undefined) {
        r.filters.splice(Number(btn.dataset.removeFilter), 1);
        applyFilters(r);
      } else if (btn.dataset.removeSort) {
        r.sort = null;
        applyFilters(r);
      } else if (btn.dataset.chip !== undefined) {
        const f = r.filters[Number(btn.dataset.chip)];
        const th = head.querySelector(`th[data-col="${CSS.escape(f.column)}"]`);
        if (th) openPopover(th, f.column);
      } else {
        const act = btn.dataset.act;
        if (act === 'clear-filters') { r.filters = []; r.sort = null; applyFilters(r); }
        if (act === 'sql-to-editor' && typeof EditorTabs !== 'undefined') {
          EditorTabs.add(r.sql, 'consulta filtrada');
          UI.toast('Consulta filtrada abierta en una pestaña nueva.', 'info');
        }
        if (act === 'add-row') addRow();
        if (act === 'delete-selected') deleteSelected();
        if (act === 'discard') discard();
        if (act === 'review') review();
      }
    });

    document.addEventListener('mousedown', e => {
      if (popover && !popover.contains(e.target) && !e.target.closest('th[data-col]')) closePopover();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && popover) closePopover();
    });
    window.addEventListener('resize', closePopover);
    window.addEventListener('beforeunload', e => {
      if (current && pendingCount(current)) { e.preventDefault(); e.returnValue = ''; }
    });
    renderToolbar();
  });

  return {
    render,
    clear,
    confirmDiscard,
    hasPendingChanges: () => !!(current && pendingCount(current)),
    /** Olvida estructuras guardadas (sin argumentos: todas) tras un cambio de estructura */
    invalidateStructure: (db, table) => {
      Object.keys(structureCache).forEach(k => {
        if (!db || k === `${db}.${table}` || (!table && k.startsWith(db + '.'))) delete structureCache[k];
      });
      if (current && current.editInfo && (!db || current.editInfo.database === db)) current.editInfo = undefined;
    }
  };
})();
