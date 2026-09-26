/**
 * ============================================================================
 * CONSTRUCTOR VISUAL DE CONSULTAS (query-builder.js)
 * ============================================================================
 * Pestaña "Constructor de Consultas": arma sentencias SELECT sin escribir SQL.
 *
 *  1. Tablas: la primera marcada es la tabla base (FROM). Las siguientes se unen
 *     con JOIN inferido de las llaves foráneas del esquema (el mismo diccionario
 *     /api/schema que usa el Diagrama ER). Si no hay FK, se intenta por nombre
 *     (usuario_id → usuarios.id). El tipo de JOIN y la condición son editables.
 *  2. Columnas: acordeón por tabla con casillas y "Seleccionar todas (*)".
 *     Si dos columnas se llaman igual (p. ej. id) se agrega alias automático.
 *  3. WHERE (AND / OR) y ORDER BY (ASC / DESC), además de DISTINCT y LIMIT.
 *  4. Vista previa en tiempo real y botón "Enviar a Editor SQL".
 *
 * La generación del SQL (buildSql) es una función pura: no toca el DOM.
 * ============================================================================
 */
const QueryBuilder = (() => {

  // ==========================================================================
  // 1. GENERACIÓN DE SQL (lógica pura)
  // ==========================================================================
  const RESERVED = new Set(('ADD ALL ALTER AND AS ASC BETWEEN BY CASE CHECK COLUMN CONSTRAINT CREATE CROSS ' +
    'CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DELETE DESC DISTINCT DROP ELSE EXISTS FALSE ' +
    'FOR FOREIGN FROM FULLTEXT GROUP HAVING IF IN INDEX INNER INSERT INTERVAL INTO IS JOIN KEY KEYS LEFT LIKE ' +
    'LIMIT MATCH NOT NULL ON OR ORDER OUTER PRIMARY RANGE REFERENCES REGEXP RENAME REPLACE RIGHT ROW ROWS ' +
    'SELECT SET SHOW TABLE THEN TO TRUE UNION UNIQUE UPDATE USAGE USE USING VALUES WHEN WHERE WITH ' +
    'RANK GROUPS ORDER KEY STATUS').split(' '));

  /** Identificador SQL: sin comillas si es simple; con `backticks` si hace falta */
  function qi(name) {
    const s = String(name);
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(s) && !RESERVED.has(s.toUpperCase())
      ? s : '`' + s.replace(/`/g, '``') + '`';
  }

  const NUMERIC_TYPE = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|year)\b/i;

  function sqlString(v) {
    return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  }

  /** Convierte lo que escribió el usuario en un literal SQL según el tipo de la columna */
  function literal(raw, colType) {
    let v = String(raw).trim();
    // Si el usuario ya escribió comillas, se respeta el texto interior
    const quoted = /^'(.*)'$/s.exec(v) || /^"(.*)"$/s.exec(v);
    if (quoted) return sqlString(quoted[1]);
    if (/^null$/i.test(v)) return 'NULL';
    if (NUMERIC_TYPE.test(colType || '')) {
      if (/^-?\d+(\.\d+)?$/.test(v)) return v;
      if (/^(true|false)$/i.test(v)) return v.toUpperCase();
    }
    return sqlString(v);
  }

  /** Divide "1, 2, 'a,b'" respetando comillas */
  function splitList(text) {
    const out = [];
    let cur = '';
    let quote = null;
    for (const ch of String(text)) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
      if (ch === ',') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim()).filter(Boolean);
  }

  const OPERATORS = [
    { op: '=', label: '=' },
    { op: '<>', label: '≠  (distinto)' },
    { op: '>', label: '>' },
    { op: '<', label: '<' },
    { op: '>=', label: '≥' },
    { op: '<=', label: '≤' },
    { op: 'LIKE', label: 'LIKE (contiene…)' },
    { op: 'NOT LIKE', label: 'NOT LIKE' },
    { op: 'IN', label: 'IN (lista)' },
    { op: 'NOT IN', label: 'NOT IN (lista)' },
    { op: 'IS NULL', label: 'IS NULL (vacío)', noValue: true },
    { op: 'IS NOT NULL', label: 'IS NOT NULL', noValue: true }
  ];
  const opInfo = (op) => OPERATORS.find(o => o.op === op) || OPERATORS[0];

  /**
   * Construye la condición de un filtro. Devuelve null si está incompleto.
   */
  function filterSql(f, colType) {
    if (!f.table || !f.column) return null;
    const ref = `${qi(f.table)}.${qi(f.column)}`;
    const info = opInfo(f.op);
    if (info.noValue) return `${ref} ${f.op}`;
    const raw = String(f.value == null ? '' : f.value);
    if (!raw.trim()) return null;
    if (f.op === 'IN' || f.op === 'NOT IN') {
      const items = splitList(raw.replace(/^\(|\)$/g, ''));
      if (!items.length) return null;
      return `${ref} ${f.op} (${items.map(i => literal(i, colType)).join(', ')})`;
    }
    if (f.op === 'LIKE' || f.op === 'NOT LIKE') return `${ref} ${f.op} ${literal(raw, 'text')}`;
    return `${ref} ${f.op} ${literal(raw, colType)}`;
  }

  /**
   * Genera la consulta a partir del estado del constructor.
   * @param {object} st  { tables:[{name, joinType, on:[{left:{t,c}, right:{t,c}}]}],
   *                       cols:{tabla:{all, set:Set}}, filters, orders, distinct, limit,
   *                       qualifier (esquema a anteponer o null), columnTypes(t,c) }
   * @returns {{ sql: string, warnings: string[], incomplete: Set<string> }}
   */
  function buildSql(st) {
    const warnings = [];
    const incomplete = new Set();
    if (!st.tables.length) return { sql: '-- Marca una tabla en el panel izquierdo para comenzar.', warnings, incomplete };

    const tableRef = (name) => (st.qualifier ? `${qi(st.qualifier)}.${qi(name)}` : qi(name));
    const typeOf = (t, c) => (st.columnTypes ? st.columnTypes(t, c) : '');

    // --- SELECT ---
    const picked = [];
    st.tables.forEach(t => {
      const sel = st.cols[t.name];
      if (!sel) return;
      if (sel.all) picked.push({ table: t.name, column: '*' });
      else sel.order.forEach(c => { if (sel.set.has(c)) picked.push({ table: t.name, column: c }); });
    });
    // Alias cuando el mismo nombre de columna viene de varias tablas
    const count = {};
    picked.forEach(p => { if (p.column !== '*') count[p.column.toLowerCase()] = (count[p.column.toLowerCase()] || 0) + 1; });
    const selectItems = picked.map(p => {
      if (p.column === '*') return `${qi(p.table)}.*`;
      const ref = `${qi(p.table)}.${qi(p.column)}`;
      return count[p.column.toLowerCase()] > 1 ? `${ref} AS ${qi(`${p.table}_${p.column}`)}` : ref;
    });
    if (!selectItems.length) selectItems.push('*');

    const lines = [];
    lines.push(`SELECT${st.distinct ? ' DISTINCT' : ''}`);
    lines.push(selectItems.map(s => '  ' + s).join(',\n'));

    // --- FROM / JOIN ---
    lines.push(`FROM ${tableRef(st.tables[0].name)}`);
    st.tables.slice(1).forEach(t => {
      const conds = (t.on || []).filter(c => c.left && c.right && c.left.t && c.left.c && c.right.t && c.right.c);
      const type = ['INNER', 'LEFT', 'RIGHT'].includes(t.joinType) ? t.joinType : 'INNER';
      if (!conds.length) {
        incomplete.add(`join:${t.name}`);
        warnings.push(`Falta la condición ON para unir "${t.name}"; se generó un CROSS JOIN (producto cartesiano).`);
        lines.push(`CROSS JOIN ${tableRef(t.name)}`);
        return;
      }
      const on = conds.map(c => `${qi(c.left.t)}.${qi(c.left.c)} = ${qi(c.right.t)}.${qi(c.right.c)}`).join(' AND ');
      lines.push(`${type} JOIN ${tableRef(t.name)} ON ${on}`);
    });

    // --- WHERE ---
    const whereParts = [];
    (st.filters || []).forEach(f => {
      const cond = filterSql(f, typeOf(f.table, f.column));
      if (!cond) { incomplete.add(`filter:${f.id}`); return; }
      whereParts.push({ conj: whereParts.length ? (f.conj === 'OR' ? 'OR' : 'AND') : '', cond });
    });
    if (whereParts.length) {
      lines.push('WHERE ' + whereParts[0].cond);
      whereParts.slice(1).forEach(w => lines.push(`  ${w.conj} ${w.cond}`));
      const conjs = new Set(whereParts.slice(1).map(w => w.conj));
      if (conjs.size > 1) warnings.push('Mezclas AND y OR: en SQL, AND se evalúa antes que OR.');
    }
    if (incomplete.size && [...incomplete].some(k => k.startsWith('filter:'))) {
      warnings.push('Hay filtros incompletos (sin columna o sin valor); no se incluyeron.');
    }

    // --- ORDER BY ---
    const orders = (st.orders || []).filter(o => o.table && o.column);
    if (orders.length) {
      lines.push('ORDER BY ' + orders.map(o => `${qi(o.table)}.${qi(o.column)} ${o.dir === 'DESC' ? 'DESC' : 'ASC'}`).join(', '));
    }

    // --- LIMIT ---
    const limit = String(st.limit == null ? '' : st.limit).trim();
    if (/^\d+$/.test(limit) && Number(limit) > 0) lines.push(`LIMIT ${Number(limit)}`);

    return { sql: lines.join('\n') + ';', warnings, incomplete };
  }

  // ==========================================================================
  // 2. INFERENCIA DE JOINS
  // ==========================================================================
  const singular = (w) => {
    const s = String(w).toLowerCase();
    if (s.endsWith('es') && s.length > 4) return [s.slice(0, -2), s.slice(0, -1)];
    if (s.endsWith('s') && s.length > 2) return [s.slice(0, -1)];
    return [s];
  };

  /**
   * Candidatos de unión entre `table` y alguna de las tablas `previous`.
   * Primero llaves foráneas reales (agrupadas por restricción: soporta FK compuestas),
   * después coincidencias por nombre de columna.
   * @returns {Array<{source:'fk'|'name', label:string, on:Array}>}
   */
  function joinCandidates(table, previous, schema) {
    const out = [];
    const groups = new Map();
    (schema.relations || []).forEach(r => {
      let cond = null;
      if (r.fromTable === table && previous.includes(r.toTable) && r.toTable !== table) {
        cond = { left: { t: r.fromTable, c: r.fromColumn }, right: { t: r.toTable, c: r.toColumn }, other: r.toTable };
      } else if (r.toTable === table && previous.includes(r.fromTable) && r.fromTable !== table) {
        cond = { left: { t: r.fromTable, c: r.fromColumn }, right: { t: r.toTable, c: r.toColumn }, other: r.fromTable };
      }
      if (!cond) return;
      const key = `${r.constraint || r.fromColumn}|${r.fromTable}|${r.toTable}`;
      if (!groups.has(key)) groups.set(key, { source: 'fk', other: cond.other, on: [] });
      groups.get(key).on.push({ left: cond.left, right: cond.right });
    });
    // Preferir la tabla anterior más reciente (encadenamiento natural)
    const rank = (other) => previous.length - previous.indexOf(other);
    [...groups.values()].sort((a, b) => rank(a.other) - rank(b.other)).forEach(g => out.push(g));

    if (!out.length) {
      // Heurística por nombre: pedidos.usuario_id → usuarios.id (en ambos sentidos)
      const tables = schema.tablesByName;
      const cols = (t) => (tables[t] ? tables[t].columns : []);
      const pkOf = (t) => (cols(t).find(c => c.isPrimary) || cols(t).find(c => c.name.toLowerCase() === 'id'));
      [...previous].reverse().forEach(prev => {
        [[table, prev], [prev, table]].forEach(([child, parent]) => {
          const pk = pkOf(parent);
          if (!pk) return;
          const names = singular(parent).flatMap(s => [`${s}_id`, `id_${s}`, `${s}id`]);
          const fkCol = cols(child).find(c => names.includes(c.name.toLowerCase()));
          if (fkCol) {
            out.push({ source: 'name', other: prev, on: [{ left: { t: child, c: fkCol.name }, right: { t: parent, c: pk.name } }] });
          }
        });
      });
    }
    out.forEach(c => {
      c.label = c.on.map(o => `${o.left.t}.${o.left.c} = ${o.right.t}.${o.right.c}`).join(' AND ');
    });
    return out;
  }

  // ==========================================================================
  // 3. ESTADO E INTERFAZ
  // ==========================================================================
  const state = {
    db: '',
    schema: null,             // { tables:[], relations:[], tablesByName:{} }
    loading: false,
    error: '',
    search: '',
    tables: [],               // [{ name, joinType, on:[...], source, candidates:[...] }]
    cols: {},                 // tabla → { all:boolean, set:Set, order:[...] }
    open: {},                 // tabla → acordeón abierto
    filters: [],
    orders: [],
    distinct: false,
    limit: '100',
    lastSql: ''
  };
  let uid = 0;
  const schemaCache = new Map();  // "host:port:user|db" → schema

  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.escape(s);
  const connection = () => UI.getConnection();

  function colsOf(table) {
    const t = state.schema && state.schema.tablesByName[table];
    return t ? t.columns : [];
  }
  function columnType(table, column) {
    const c = colsOf(table).find(x => x.name === column);
    return c ? c.type : '';
  }
  const selectedNames = () => state.tables.map(t => t.name);

  // ---------------------- Carga del esquema ----------------------
  function databaseOptions() {
    const list = (typeof currentDatabasesList !== 'undefined' ? currentDatabasesList : []) || [];
    return list.filter(db => !(window.SqlUtils && SqlUtils.isSystemSchema(db)));
  }

  async function loadSchema(db, { force = false } = {}) {
    const conn = connection();
    if (!conn || !db) return;
    const key = `${conn.host}:${conn.port}:${conn.user}|${db}`;
    state.db = db;
    state.error = '';
    if (!force && schemaCache.has(key)) {
      state.schema = schemaCache.get(key);
      renderAll();
      return;
    }
    state.loading = true;
    state.schema = null;
    renderAll();
    try {
      const data = await UI.api('/schema', { database: db });
      const tablesByName = {};
      (data.tables || []).forEach(t => { tablesByName[t.name] = t; });
      const schema = { tables: data.tables || [], relations: data.relations || [], tablesByName };
      schemaCache.set(key, schema);
      if (state.db === db) state.schema = schema;
    } catch (e) {
      state.error = e.message || 'No se pudo leer el esquema.';
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  function resetQuery() {
    state.tables = [];
    state.cols = {};
    state.open = {};
    state.filters = [];
    state.orders = [];
    state.distinct = false;
    state.limit = '100';
  }

  // ---------------------- Acciones sobre tablas ----------------------
  function applyBestJoin(entry, index) {
    const previous = state.tables.slice(0, index).map(t => t.name);
    entry.candidates = joinCandidates(entry.name, previous, state.schema);
    const best = entry.candidates[0];
    entry.on = best ? best.on.map(o => ({ left: { ...o.left }, right: { ...o.right } })) : [];
    entry.source = best ? best.source : null;
    entry.candidateIndex = best ? 0 : -1;
  }

  function toggleTable(name, checked) {
    if (checked) {
      if (selectedNames().includes(name)) return;
      const entry = { name, joinType: 'INNER', on: [], source: null, candidates: [], candidateIndex: -1 };
      // Si alguna tabla ya marcada quedó sin relación (CROSS JOIN) y la nueva tabla sirve
      // de "puente", se inserta justo antes de ella para que ambas se unan correctamente.
      const bridgeAt = state.tables.findIndex((t, k) => {
        if (k === 0 || t.on.length) return false;
        const before = state.tables.slice(0, k).map(x => x.name);
        return joinCandidates(name, before, state.schema).length &&
          joinCandidates(t.name, [...before, name], state.schema).length;
      });
      if (bridgeAt > 0) {
        state.tables.splice(bridgeAt, 0, entry);
        state.tables.forEach((t, i) => { if (i >= bridgeAt && (t === entry || !t.on.length)) applyBestJoin(t, i); });
      } else {
        state.tables.push(entry);
        if (state.tables.length > 1) applyBestJoin(entry, state.tables.length - 1);
      }
      const order = colsOf(name).map(c => c.name);
      state.cols[name] = { all: false, set: new Set(), order };
      state.open[name] = true;
    } else {
      removeTable(name);
    }
    renderAll();
  }

  function removeTable(name) {
    state.tables = state.tables.filter(t => t.name !== name);
    delete state.cols[name];
    delete state.open[name];
    state.filters = state.filters.filter(f => f.table !== name);
    state.orders = state.orders.filter(o => o.table !== name);
    // La nueva tabla base no lleva JOIN; las demás se re-infieren si dependían de la eliminada
    state.tables.forEach((t, i) => {
      if (i === 0) { t.on = []; t.source = null; t.candidates = []; return; }
      const allowed = state.tables.slice(0, i + 1).map(x => x.name);
      const broken = !t.on.length || t.on.some(c => !allowed.includes(c.left.t) || !allowed.includes(c.right.t));
      if (broken) applyBestJoin(t, i);
      else t.candidates = joinCandidates(t.name, allowed.slice(0, -1), state.schema);
    });
  }

  function makeBase(name) {
    const idx = state.tables.findIndex(t => t.name === name);
    if (idx <= 0) return;
    const [entry] = state.tables.splice(idx, 1);
    state.tables.unshift(entry);
    state.tables.forEach((t, i) => {
      if (i === 0) { t.on = []; t.source = null; t.candidates = []; }
      else applyBestJoin(t, i);
    });
    renderAll();
  }

  // ---------------------- Renderizado ----------------------
  function renderAll() {
    if (!$('qbRoot')) return;
    renderHeader();
    renderTableList();
    renderJoins();
    renderColumns();
    renderFilters();
    renderOrders();
    updatePreview();
  }

  function renderHeader() {
    const conn = connection();
    const sel = $('qbDatabase');
    const dbs = databaseOptions();
    if (conn && state.db && !dbs.includes(state.db)) dbs.unshift(state.db);
    sel.innerHTML = dbs.length
      ? dbs.map(db => `<option value="${esc(db)}" ${db === state.db ? 'selected' : ''}>${esc(db)}</option>`).join('')
      : '<option value="">(sin bases de datos)</option>';
    sel.disabled = !conn || !dbs.length;
    $('qbDistinct').checked = state.distinct;
    $('qbLimit').value = state.limit;
  }

  function renderTableList() {
    const box = $('qbTableList');
    const conn = connection();
    if (!conn) {
      box.innerHTML = `<div class="qb-empty">🔌 Conecta un servidor con <strong>+ Conectar Servidor</strong> para usar el constructor.</div>`;
      return;
    }
    if (!state.db) { box.innerHTML = '<div class="qb-empty">Selecciona una base de datos.</div>'; return; }
    if (state.loading) { box.innerHTML = '<div class="qb-empty">⏳ Leyendo tablas y relaciones…</div>'; return; }
    if (state.error) {
      box.innerHTML = `<div class="qb-empty qb-error">⛔ ${esc(state.error)}<br><button class="btn btn-small" onclick="QueryBuilder.reload()">Reintentar</button></div>`;
      return;
    }
    const tables = (state.schema ? state.schema.tables : []);
    if (!tables.length) { box.innerHTML = '<div class="qb-empty">Esta base de datos no tiene tablas.</div>'; return; }

    const q = state.search.trim().toLowerCase();
    const selected = selectedNames();
    // Tablas relacionadas con las ya marcadas (sugerencia visual)
    const related = new Set();
    (state.schema.relations || []).forEach(r => {
      if (selected.includes(r.fromTable)) related.add(r.toTable);
      if (selected.includes(r.toTable)) related.add(r.fromTable);
    });

    const items = tables.filter(t => !q || t.name.toLowerCase().includes(q)).map(t => {
      const idx = selected.indexOf(t.name);
      const isBase = idx === 0;
      const badge = isBase ? '<span class="qb-badge qb-badge-base" title="Tabla base (FROM)">FROM</span>'
        : idx > 0 ? '<span class="qb-badge" title="Unida con JOIN">JOIN</span>'
        : related.has(t.name) ? '<span class="qb-badge qb-badge-rel" title="Tiene relación (FK) con una tabla marcada">🔗</span>' : '';
      return `
        <label class="qb-table-item ${idx >= 0 ? 'checked' : ''}">
          <input type="checkbox" data-table="${esc(t.name)}" ${idx >= 0 ? 'checked' : ''}>
          <span class="qb-table-name" title="${esc(t.name)}">${esc(t.name)}</span>
          <small>${t.columns.length}</small>
          ${badge}
        </label>`;
    }).join('');
    box.innerHTML = items || '<div class="qb-empty">Sin coincidencias.</div>';
    box.querySelectorAll('input[data-table]').forEach(cb => {
      cb.addEventListener('change', () => toggleTable(cb.dataset.table, cb.checked));
    });
  }

  /** <option> con todas las columnas de las tablas indicadas */
  function columnOptions(tables, selT, selC, { placeholder = 'Columna…' } = {}) {
    let html = `<option value="">${esc(placeholder)}</option>`;
    tables.forEach(t => {
      html += `<optgroup label="${esc(t)}">` + colsOf(t).map(c => {
        const v = JSON.stringify([t, c.name]);
        const sel = t === selT && c.name === selC ? 'selected' : '';
        const tag = c.isPrimary ? ' 🔑' : c.isForeign ? ' 🔗' : '';
        return `<option value="${esc(v)}" ${sel}>${esc(t)}.${esc(c.name)}${tag}</option>`;
      }).join('') + '</optgroup>';
    });
    return html;
  }
  const splitRef = (v) => {
    try { const [t, c] = JSON.parse(v); return { t: t || '', c: c || '' }; } catch (e) { return { t: '', c: '' }; }
  };

  function renderJoins() {
    const box = $('qbJoins');
    const section = $('qbJoinsSection');
    if (!state.tables.length) {
      section.hidden = false;
      box.innerHTML = '<div class="qb-hint">La <strong>primera tabla</strong> que marques será la tabla base (<code>FROM</code>). Al marcar más tablas se sugiere el <code>JOIN</code> a partir de las llaves foráneas.</div>';
      return;
    }
    section.hidden = false;
    const base = state.tables[0];
    let html = `
      <div class="qb-join-row qb-join-base">
        <span class="qb-join-kw">FROM</span>
        <strong>${esc(base.name)}</strong>
        <span class="qb-muted">tabla base</span>
      </div>`;
    state.tables.slice(1).forEach((t, k) => {
      const i = k + 1;
      const allowed = state.tables.slice(0, i + 1).map(x => x.name);
      const srcBadge = t.source === 'fk' ? '<span class="qb-badge qb-badge-ok" title="Inferido de una llave foránea real">FK detectada</span>'
        : t.source === 'name' ? '<span class="qb-badge qb-badge-warn" title="No hay FK; se dedujo por el nombre de la columna">sugerido por nombre</span>'
        : t.on.length ? '<span class="qb-badge">manual</span>'
        : '<span class="qb-badge qb-badge-err">sin relación: elige las columnas</span>';
      const candidates = (t.candidates || []).length > 1 ? `
          <select class="form-control qb-select qb-candidate" data-i="${i}" title="Relaciones posibles">
            ${t.candidates.map((c, ci) => `<option value="${ci}" ${ci === t.candidateIndex ? 'selected' : ''}>${c.source === 'fk' ? 'FK' : 'nombre'}: ${esc(c.label)}</option>`).join('')}
            <option value="-1" ${t.candidateIndex === -1 ? 'selected' : ''}>Condición personalizada</option>
          </select>` : '';
      const conds = (t.on.length ? t.on : [{ left: { t: '', c: '' }, right: { t: t.name, c: '' } }]).map((c, ci) => `
          <div class="qb-cond" data-i="${i}" data-ci="${ci}">
            <span class="qb-join-kw">${ci === 0 ? 'ON' : 'AND'}</span>
            <select class="form-control qb-select" data-side="left">${columnOptions(allowed, c.left.t, c.left.c)}</select>
            <span class="qb-eq">=</span>
            <select class="form-control qb-select" data-side="right">${columnOptions(allowed, c.right.t, c.right.c)}</select>
            ${t.on.length > 1 ? `<button class="icon-btn" data-action="del-cond" title="Quitar condición">✕</button>` : ''}
          </div>`).join('');
      html += `
        <div class="qb-join-card">
          <div class="qb-join-row">
            <select class="form-control qb-select qb-join-type" data-i="${i}">
              ${['INNER', 'LEFT', 'RIGHT'].map(j => `<option value="${j}" ${t.joinType === j ? 'selected' : ''}>${j} JOIN</option>`).join('')}
            </select>
            <strong>${esc(t.name)}</strong>
            ${srcBadge}
            <span class="qb-spacer"></span>
            <button class="btn btn-small" data-action="make-base" data-i="${i}" title="Usar como tabla base (FROM)">Hacer base</button>
          </div>
          ${candidates}
          ${conds}
          <button class="qb-link" data-action="add-cond" data-i="${i}">+ condición</button>
        </div>`;
    });
    box.innerHTML = html;

    box.querySelectorAll('.qb-join-type').forEach(sel => sel.addEventListener('change', () => {
      state.tables[+sel.dataset.i].joinType = sel.value;
      updatePreview();
    }));
    box.querySelectorAll('.qb-candidate').forEach(sel => sel.addEventListener('change', () => {
      const t = state.tables[+sel.dataset.i];
      t.candidateIndex = +sel.value;
      const c = t.candidates[t.candidateIndex];
      if (c) { t.on = c.on.map(o => ({ left: { ...o.left }, right: { ...o.right } })); t.source = c.source; }
      else { t.source = null; }
      renderJoins();
      updatePreview();
    }));
    box.querySelectorAll('.qb-cond').forEach(row => {
      const t = state.tables[+row.dataset.i];
      const ci = +row.dataset.ci;
      row.querySelectorAll('select[data-side]').forEach(sel => sel.addEventListener('change', () => {
        if (!t.on[ci]) t.on[ci] = { left: { t: '', c: '' }, right: { t: t.name, c: '' } };
        t.on[ci][sel.dataset.side] = splitRef(sel.value);
        t.source = null;
        t.candidateIndex = -1;
        renderJoins();
        updatePreview();
      }));
      const del = row.querySelector('[data-action="del-cond"]');
      if (del) del.addEventListener('click', () => { t.on.splice(ci, 1); t.source = null; renderJoins(); updatePreview(); });
    });
    box.querySelectorAll('[data-action="add-cond"]').forEach(btn => btn.addEventListener('click', () => {
      const t = state.tables[+btn.dataset.i];
      if (!t.on.length) t.on.push({ left: { t: '', c: '' }, right: { t: t.name, c: '' } });
      t.on.push({ left: { t: '', c: '' }, right: { t: t.name, c: '' } });
      t.source = null;
      renderJoins();
    }));
    box.querySelectorAll('[data-action="make-base"]').forEach(btn => btn.addEventListener('click', () => makeBase(state.tables[+btn.dataset.i].name)));
  }

  function renderColumns() {
    const box = $('qbColumns');
    if (!state.tables.length) { box.innerHTML = '<div class="qb-hint">Las columnas de cada tabla marcada aparecerán aquí.</div>'; return; }
    box.innerHTML = state.tables.map(t => {
      const sel = state.cols[t.name];
      const cols = colsOf(t.name);
      const n = sel.all ? 'todas (*)' : `${sel.set.size} de ${cols.length}`;
      const open = state.open[t.name];
      return `
        <div class="qb-acc ${open ? 'open' : ''}" data-table="${esc(t.name)}">
          <button class="qb-acc-head" type="button" aria-expanded="${open}">
            <span class="qb-acc-caret">▸</span>
            <strong>${esc(t.name)}</strong>
            <span class="qb-muted">${n}</span>
          </button>
          <div class="qb-acc-body" ${open ? '' : 'hidden'}>
            <label class="qb-col qb-col-all">
              <input type="checkbox" data-all ${sel.all ? 'checked' : ''}> <span>Seleccionar todas (<code>${esc(t.name)}.*</code>)</span>
            </label>
            <div class="qb-col-grid">
              ${cols.map(c => `
                <label class="qb-col ${sel.all ? 'disabled' : ''}" title="${esc(c.type)}">
                  <input type="checkbox" data-col="${esc(c.name)}" ${sel.all || sel.set.has(c.name) ? 'checked' : ''} ${sel.all ? 'disabled' : ''}>
                  <span class="qb-col-name">${esc(c.name)}</span>
                  <small>${c.isPrimary ? '🔑 ' : c.isForeign ? '🔗 ' : ''}${esc(c.type)}</small>
                </label>`).join('')}
            </div>
            <div class="qb-col-actions">
              <button class="qb-link" data-bulk="none">Ninguna</button>
              <button class="qb-link" data-bulk="each">Marcar cada una</button>
            </div>
          </div>
        </div>`;
    }).join('');

    box.querySelectorAll('.qb-acc').forEach(acc => {
      const name = acc.dataset.table;
      const sel = state.cols[name];
      acc.querySelector('.qb-acc-head').addEventListener('click', () => { state.open[name] = !state.open[name]; renderColumns(); });
      acc.querySelector('[data-all]').addEventListener('change', e => { sel.all = e.target.checked; renderColumns(); updatePreview(); });
      acc.querySelectorAll('input[data-col]').forEach(cb => cb.addEventListener('change', () => {
        if (cb.checked) sel.set.add(cb.dataset.col); else sel.set.delete(cb.dataset.col);
        const head = acc.querySelector('.qb-acc-head .qb-muted');
        head.textContent = `${sel.set.size} de ${sel.order.length}`;
        updatePreview();
      }));
      acc.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => {
        sel.all = false;
        sel.set = b.dataset.bulk === 'each' ? new Set(sel.order) : new Set();
        renderColumns();
        updatePreview();
      }));
    });
  }

  function renderFilters() {
    const box = $('qbFilters');
    const tables = selectedNames();
    if (!state.filters.length) {
      box.innerHTML = `<div class="qb-hint">${tables.length ? 'Sin filtros: se devolverán todas las filas.' : 'Marca una tabla para poder filtrar.'}</div>`;
    } else {
      box.innerHTML = state.filters.map((f, i) => {
        const info = opInfo(f.op);
        const placeholder = f.op.includes('IN') && !f.op.includes('NULL') ? "1, 2, 'texto'"
          : f.op.includes('LIKE') ? '%texto%' : 'valor';
        return `
          <div class="qb-filter" data-id="${f.id}">
            ${i === 0 ? '<span class="qb-join-kw qb-where-kw">WHERE</span>' : `
              <select class="form-control qb-select qb-conj" data-k="conj">
                <option ${f.conj === 'AND' ? 'selected' : ''}>AND</option>
                <option ${f.conj === 'OR' ? 'selected' : ''}>OR</option>
              </select>`}
            <select class="form-control qb-select" data-k="table">
              ${tables.map(t => `<option value="${esc(t)}" ${t === f.table ? 'selected' : ''}>${esc(t)}</option>`).join('')}
            </select>
            <select class="form-control qb-select" data-k="column">
              <option value="">Columna…</option>
              ${colsOf(f.table).map(c => `<option value="${esc(c.name)}" ${c.name === f.column ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <select class="form-control qb-select qb-op" data-k="op">
              ${OPERATORS.map(o => `<option value="${o.op}" ${o.op === f.op ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select>
            <input class="form-control qb-value" data-k="value" value="${esc(f.value)}" placeholder="${esc(placeholder)}"
              ${info.noValue ? 'disabled' : ''} spellcheck="false">
            <button class="icon-btn danger" data-action="del" title="Quitar filtro">✕</button>
          </div>`;
      }).join('');
    }
    $('qbAddFilter').disabled = !tables.length;

    box.querySelectorAll('.qb-filter').forEach(row => {
      const f = state.filters.find(x => String(x.id) === row.dataset.id);
      row.querySelectorAll('select[data-k]').forEach(sel => sel.addEventListener('change', () => {
        f[sel.dataset.k] = sel.value;
        if (sel.dataset.k === 'table') f.column = '';
        if (sel.dataset.k === 'op' && opInfo(f.op).noValue) f.value = '';
        renderFilters();
        updatePreview();
      }));
      row.querySelector('input[data-k="value"]').addEventListener('input', e => { f.value = e.target.value; updatePreview(); });
      row.querySelector('[data-action="del"]').addEventListener('click', () => {
        state.filters = state.filters.filter(x => x !== f);
        renderFilters();
        updatePreview();
      });
    });
  }

  function renderOrders() {
    const box = $('qbOrders');
    const tables = selectedNames();
    if (!state.orders.length) {
      box.innerHTML = `<div class="qb-hint">${tables.length ? 'Sin orden específico.' : 'Marca una tabla para poder ordenar.'}</div>`;
    } else {
      box.innerHTML = state.orders.map((o, i) => `
        <div class="qb-order" data-id="${o.id}">
          <span class="qb-join-kw">${i === 0 ? 'ORDER BY' : ','}</span>
          <select class="form-control qb-select qb-order-col" data-k="ref">${columnOptions(tables, o.table, o.column)}</select>
          <div class="qb-seg" role="group">
            <button type="button" class="${o.dir !== 'DESC' ? 'active' : ''}" data-dir="ASC" title="Ascendente (A→Z, 0→9)">ASC ↑</button>
            <button type="button" class="${o.dir === 'DESC' ? 'active' : ''}" data-dir="DESC" title="Descendente (Z→A, 9→0)">DESC ↓</button>
          </div>
          <button class="icon-btn danger" data-action="del" title="Quitar">✕</button>
        </div>`).join('');
    }
    $('qbAddOrder').disabled = !tables.length;

    box.querySelectorAll('.qb-order').forEach(row => {
      const o = state.orders.find(x => String(x.id) === row.dataset.id);
      row.querySelector('select').addEventListener('change', e => { const r = splitRef(e.target.value); o.table = r.t; o.column = r.c; updatePreview(); });
      row.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { o.dir = b.dataset.dir; renderOrders(); updatePreview(); }));
      row.querySelector('[data-action="del"]').addEventListener('click', () => { state.orders = state.orders.filter(x => x !== o); renderOrders(); updatePreview(); });
    });
  }

  // ---------------------- Vista previa ----------------------
  function currentSql() {
    const conn = connection();
    const qualifier = conn && state.db && (conn.database || '').toLowerCase() !== state.db.toLowerCase() ? state.db : null;
    return buildSql({
      tables: state.tables, cols: state.cols, filters: state.filters, orders: state.orders,
      distinct: state.distinct, limit: state.limit, qualifier, columnTypes: columnType
    });
  }

  function updatePreview() {
    const { sql, warnings, incomplete } = currentSql();
    state.lastSql = state.tables.length ? sql : '';
    const pre = $('qbPreview');
    pre.innerHTML = typeof highlightSqlHtml === 'function' ? highlightSqlHtml(sql) : esc(sql);
    $('qbWarnings').innerHTML = warnings.map(w => `<div>⚠️ ${esc(w)}</div>`).join('');
    $('qbWarnings').hidden = !warnings.length;
    $('qbSend').disabled = !state.tables.length;
    $('qbCopy').disabled = !state.tables.length;
    document.querySelectorAll('#qbFilters .qb-filter').forEach(row =>
      row.classList.toggle('incomplete', incomplete.has(`filter:${row.dataset.id}`)));
    const joinCount = Math.max(0, state.tables.length - 1);
    $('qbSummary').textContent = state.tables.length
      ? `${state.tables.length} tabla(s) · ${joinCount} JOIN · ${state.filters.length} filtro(s)` : '';
  }

  // ---------------------- Enviar al editor ----------------------
  function sendToEditor() {
    const sql = state.lastSql;
    if (!sql) return;
    if (typeof switchTab === 'function') switchTab('tab-editor');
    const editor = $('sqlEditor');
    if (!editor) return;
    editor.focus();

    const existing = editor.value;
    let start;
    if (!existing.trim()) {
      editor.select();
      start = 0;
      if (!document.execCommand('insertText', false, sql)) { editor.value = sql; editor.dispatchEvent(new Event('input')); }
    } else {
      // Se agrega al final de la pestaña activa (no se pierde lo que ya estaba escrito)
      const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
      editor.setSelectionRange(existing.length, existing.length);
      start = existing.length + sep.length;
      if (!document.execCommand('insertText', false, sep + sql)) {
        editor.value = existing + sep + sql;
        editor.dispatchEvent(new Event('input'));
      }
    }
    // Queda seleccionada: Ctrl+Shift+Enter ejecuta solo esta consulta
    editor.setSelectionRange(start, start + sql.length);
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
    editor.scrollTop = Math.max(0, (existing.slice(0, start).split('\n').length - 3) * lineHeight);
    editor.dispatchEvent(new Event('scroll'));
    UI.toast('Consulta enviada al editor. Ctrl+Shift+Enter ejecuta la selección.', 'success');
  }

  async function copySql() {
    if (!state.lastSql) return;
    try { await navigator.clipboard.writeText(state.lastSql); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = state.lastSql; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    UI.toast('SQL copiado al portapapeles', 'success');
  }

  // ---------------------- Inicialización ----------------------
  let bound = false;
  function bind() {
    if (bound || !$('qbRoot')) return;
    bound = true;
    $('qbDatabase').addEventListener('change', async e => {
      if (state.tables.length && !(await UI.confirm({
        title: 'Cambiar de base de datos',
        message: 'Se descartará la consulta que estás armando. ¿Continuar?',
        confirmLabel: 'Cambiar'
      }))) { e.target.value = state.db; return; }
      resetQuery();
      loadSchema(e.target.value);
    });
    $('qbSearch').addEventListener('input', e => { state.search = e.target.value; renderTableList(); });
    $('qbDistinct').addEventListener('change', e => { state.distinct = e.target.checked; updatePreview(); });
    $('qbLimit').addEventListener('input', e => { state.limit = e.target.value.replace(/\D/g, ''); e.target.value = state.limit; updatePreview(); });
    $('qbAddFilter').addEventListener('click', () => {
      const t = selectedNames()[0];
      if (!t) return;
      const last = state.filters[state.filters.length - 1];
      state.filters.push({ id: ++uid, conj: 'AND', table: last ? last.table : t, column: '', op: '=', value: '' });
      renderFilters();
      updatePreview();
      const selects = $('qbFilters').querySelectorAll('.qb-filter:last-child select[data-k="column"]');
      if (selects[0]) selects[0].focus();
    });
    $('qbAddOrder').addEventListener('click', () => {
      state.orders.push({ id: ++uid, table: '', column: '', dir: 'ASC' });
      renderOrders();
      updatePreview();
    });
    $('qbReset').addEventListener('click', () => { resetQuery(); renderAll(); });
    $('qbSend').addEventListener('click', sendToEditor);
    $('qbCopy').addEventListener('click', copySql);
    $('qbRefresh').addEventListener('click', () => reload());
  }

  /** Se llama al abrir la pestaña */
  function onShow() {
    bind();
    const conn = connection();
    if (!conn) { state.db = ''; state.schema = null; renderAll(); return; }
    if (!state.db) {
      const dbs = databaseOptions();
      const preferred = conn.database && !(window.SqlUtils && SqlUtils.isSystemSchema(conn.database)) ? conn.database : dbs[0];
      if (preferred) { loadSchema(preferred); return; }
    }
    renderAll();
  }

  function reload() {
    if (!state.db) return onShow();
    const selected = state.tables.length;
    loadSchema(state.db, { force: true }).then(() => {
      if (selected) {
        // Quita del armado lo que ya no exista tras recargar
        const names = new Set((state.schema ? state.schema.tables : []).map(t => t.name));
        state.tables.filter(t => !names.has(t.name)).forEach(t => removeTable(t.name));
        renderAll();
      }
    });
  }

  return {
    onShow, reload, sendToEditor,
    // Expuestos para pruebas
    buildSql, joinCandidates, literal, qi, _state: state
  };
})();

if (typeof module === 'object' && module.exports) module.exports = QueryBuilder;
