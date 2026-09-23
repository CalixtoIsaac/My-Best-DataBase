/**
 * ============================================================================
 * PESTAÑAS MÚLTIPLES DEL EDITOR SQL (editor-tabs.js)
 * ============================================================================
 * Cada pestaña guarda su propio script, posición del cursor y último resultado.
 * - "+" crea una pestaña nueva (también Alt+N).
 * - "×" o clic con el botón central del mouse la cierra (también Alt+W).
 * - Doble clic sobre el título para renombrarla.
 * - Los scripts se guardan en el navegador y se recuperan al volver a entrar.
 *
 * Se usa un solo <textarea> (el editor original con resaltado y autocompletado):
 * al cambiar de pestaña se guarda su contenido y se carga el de la otra.
 */
const EditorTabs = (() => {
  const STORAGE_KEY = 'mbdb.editorTabs';
  let tabs = [];
  let activeId = null;
  let counter = 0;
  let saveTimer = null;

  const editor = () => document.getElementById('sqlEditor');
  const active = () => tabs.find(t => t.id === activeId);

  // ---------- Persistencia ----------
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          activeId, counter,
          tabs: tabs.map(t => ({ id: t.id, title: t.title, sql: t.sql, selStart: t.selStart, selEnd: t.selEnd }))
        }));
      } catch (e) { /* almacenamiento lleno o no disponible */ }
    }, 300);
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
        tabs = saved.tabs.map(t => ({ ...t, result: null, metrics: '' }));
        counter = saved.counter || tabs.length;
        activeId = tabs.some(t => t.id === saved.activeId) ? saved.activeId : tabs[0].id;
        return true;
      }
    } catch (e) { /* datos corruptos: empezar de cero */ }
    return false;
  }

  // ---------- Estado del editor ----------
  function captureEditor() {
    const t = active();
    const ed = editor();
    if (!t || !ed) return;
    t.sql = ed.value;
    t.selStart = ed.selectionStart;
    t.selEnd = ed.selectionEnd;
    t.scrollTop = ed.scrollTop;
  }

  function loadEditor(t) {
    const ed = editor();
    if (!ed) return;
    ed.value = t.sql || '';
    ed.dispatchEvent(new Event('input')); // recalcula resaltado y números de línea
    if (typeof hideAutocomplete === 'function') hideAutocomplete();
    const len = ed.value.length;
    ed.selectionStart = Math.min(t.selStart || 0, len);
    ed.selectionEnd = Math.min(t.selEnd || 0, len);
    ed.scrollTop = t.scrollTop || 0;
    ed.dispatchEvent(new Event('scroll'));
  }

  function showResult(t) {
    const footer = document.getElementById('footerMetrics');
    if (t.result && typeof renderDataGrid === 'function') {
      renderDataGrid(t.result.columns, t.result.rows, { ...t.result.meta, silent: true });
    } else {
      document.getElementById('gridHead').innerHTML = '<tr><th>Mensaje</th></tr>';
      document.getElementById('gridBody').innerHTML = '<tr><td>Ejecuta una consulta SQL para mostrar resultados.</td></tr>';
      window.lastQueryResult = null;
    }
    if (footer) footer.innerText = t.metrics || 'Filas: 0 | Tiempo: 0ms';
  }

  // ---------- Dibujo de la barra de pestañas ----------
  function render() {
    const bar = document.getElementById('queryTabs');
    if (!bar) return;
    bar.innerHTML = tabs.map(t => `
      <div class="qtab ${t.id === activeId ? 'active' : ''}" data-id="${t.id}" title="${UI.escape(t.title)} — doble clic para renombrar">
        <span class="qtab-icon">${t.running ? '⏳' : '📄'}</span>
        <span class="qtab-title">${UI.escape(t.title)}</span>
        <span class="qtab-close" data-close="${t.id}" title="Cerrar pestaña">×</span>
      </div>`).join('') +
      '<button type="button" class="qtab-add" title="Nueva pestaña (Alt+N)" onclick="EditorTabs.add()">+</button>';
  }

  // ---------- Acciones públicas ----------
  function add(sql = '', title = null) {
    captureEditor();
    counter++;
    const tab = {
      id: 't' + Date.now().toString(36) + counter,
      title: title || `Consulta ${counter}`,
      sql, selStart: sql.length, selEnd: sql.length, scrollTop: 0, result: null, metrics: ''
    };
    tabs.push(tab);
    activeId = tab.id;
    loadEditor(tab);
    showResult(tab);
    render();
    persist();
    editor().focus();
    return tab;
  }

  function activate(id) {
    if (id === activeId) return;
    captureEditor();
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    activeId = id;
    loadEditor(t);
    showResult(t);
    render();
    persist();
    editor().focus();
  }

  async function close(id) {
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    if (id === activeId) captureEditor();
    if ((t.sql || '').trim()) {
      const ok = await UI.confirm({
        title: 'Cerrar pestaña',
        html: `La pestaña <strong>${UI.escape(t.title)}</strong> tiene un script escrito. ¿Deseas cerrarla? El contenido se perderá.`,
        confirmLabel: 'Cerrar'
      });
      if (!ok) return;
    }
    const idx = tabs.indexOf(t);
    tabs.splice(idx, 1);
    if (!tabs.length) {
      counter = 0;
      add();
      return;
    }
    if (id === activeId) {
      const next = tabs[Math.max(0, idx - 1)];
      activeId = next.id;
      loadEditor(next);
      showResult(next);
    }
    render();
    persist();
  }

  function rename(id) {
    const t = tabs.find(x => x.id === id);
    const el = document.querySelector(`.qtab[data-id="${id}"] .qtab-title`);
    if (!t || !el) return;
    const input = document.createElement('input');
    input.className = 'qtab-rename';
    input.value = t.title;
    input.maxLength = 40;
    el.replaceWith(input);
    input.focus();
    input.select();
    const finish = (save) => {
      if (save && input.value.trim()) t.title = input.value.trim();
      render();
      persist();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  /** Abre SQL en una pestaña: reutiliza la actual si está vacía */
  function openWithSql(sql, title) {
    captureEditor();
    const t = active();
    if (t && !(t.sql || '').trim()) {
      t.sql = sql;
      if (title) t.title = title;
      t.selStart = t.selEnd = sql.length;
      loadEditor(t);
      render();
      persist();
      return t;
    }
    return add(sql, title);
  }

  // ---------- Integración con la ejecución de consultas (app.js) ----------
  /** Marca la pestaña activa como "ejecutando" y devuelve su id */
  function beginRun() {
    const t = active();
    if (!t) return null;
    t.running = true;
    render();
    return t.id;
  }

  /**
   * Guarda el resultado en la pestaña que lanzó la consulta.
   * @returns {boolean} true si esa pestaña sigue visible (entonces se dibuja el grid)
   */
  function deliverResult(tabId, result, metrics) {
    const t = tabs.find(x => x.id === tabId);
    if (!t) return false; // la pestaña se cerró mientras se ejecutaba
    t.running = false;
    if (result) t.result = result;
    if (metrics) t.metrics = metrics;
    render();
    if (tabId !== activeId) {
      UI.toast(`La consulta de "${t.title}" terminó. Cambia a esa pestaña para ver el resultado.`, 'info');
      return false;
    }
    return true;
  }

  // ---------- Inicialización ----------
  function init() {
    const ed = editor();
    if (!ed) return;
    if (!restore()) {
      counter = 1;
      tabs = [{ id: 't' + Date.now().toString(36), title: 'Consulta 1', sql: ed.value || '', selStart: 0, selEnd: 0, result: null, metrics: '' }];
      activeId = tabs[0].id;
    }
    loadEditor(active());
    render();

    ed.addEventListener('input', () => { captureEditor(); persist(); });

    const bar = document.getElementById('queryTabs');
    bar.addEventListener('click', e => {
      const closeId = e.target.dataset && e.target.dataset.close;
      if (closeId) { e.stopPropagation(); close(closeId); return; }
      const tab = e.target.closest('.qtab');
      if (tab) activate(tab.dataset.id);
    });
    bar.addEventListener('dblclick', e => {
      const tab = e.target.closest('.qtab');
      if (tab && !e.target.dataset.close) rename(tab.dataset.id);
    });
    bar.addEventListener('auxclick', e => {
      const tab = e.target.closest('.qtab');
      if (tab && e.button === 1) { e.preventDefault(); close(tab.dataset.id); }
    });

    document.addEventListener('keydown', e => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'n') { e.preventDefault(); add(); }
      if (key === 'w') { e.preventDefault(); close(activeId); }
    });
    window.addEventListener('beforeunload', () => { captureEditor(); clearTimeout(saveTimer); try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeId, counter,
        tabs: tabs.map(t => ({ id: t.id, title: t.title, sql: t.sql, selStart: t.selStart, selEnd: t.selEnd }))
      }));
    } catch (err) { /* sin almacenamiento */ } });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    add, activate, close, rename, openWithSql, beginRun, deliverResult,
    get activeId() { return activeId; }
  };
})();
