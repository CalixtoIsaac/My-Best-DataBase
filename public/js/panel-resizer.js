/**
 * ============================================================================
 * DIVISOR REDIMENSIONABLE EDITOR / RESULTADOS (panel-resizer.js)
 * ============================================================================
 * Barra entre el Editor SQL y el panel de Resultados/Consola (como en Workbench):
 *  - Arrastrar con el mouse (o dedo) cambia la altura del panel de resultados.
 *  - Doble clic en la barra, o el botón ▾/▴ del panel, lo minimiza/restaura.
 *  - Teclado (barra enfocada): ↑/↓ mueven 24 px, Inicio = maximizar, Fin = minimizar,
 *    Enter = minimizar/restaurar.
 *  - La altura se guarda en localStorage y se respeta al recargar.
 *  - Si el panel está minimizado y llega un resultado o un mensaje de consola,
 *    se vuelve a abrir solo.
 * ============================================================================
 */
const PanelResizer = (() => {
  const STORAGE_KEY = 'mbd-results-height';
  const DEFAULT_HEIGHT = 240;
  const MIN_EDITOR = 90;      // el editor nunca queda más chico que esto
  const KEY_STEP = 24;

  let pane, splitter, container, toggleBtn;
  let height = DEFAULT_HEIGHT;       // altura "abierta" preferida
  let collapsed = false;

  const $ = (id) => document.getElementById(id);

  /** Altura mínima = solo la barra de pestañas del panel (Resultados / Consola) */
  function minHeight() {
    const nav = pane.querySelector('.results-navbar');
    return (nav ? nav.offsetHeight : 34) + 1;
  }

  /** Altura máxima = lo que deja libre el editor con su mínimo */
  function maxHeight() {
    const tabs = $('queryTabs');
    const available = container.clientHeight - (tabs ? tabs.offsetHeight : 0) - splitter.offsetHeight;
    return Math.max(minHeight(), available - MIN_EDITOR);
  }

  const clamp = (h) => Math.round(Math.min(Math.max(h, minHeight()), maxHeight()));

  function apply(h, { save = true } = {}) {
    const value = clamp(h);
    pane.style.height = value + 'px';
    collapsed = value <= minHeight() + 2;
    pane.classList.toggle('collapsed', collapsed);
    splitter.setAttribute('aria-valuenow', String(value));
    splitter.setAttribute('aria-valuemax', String(maxHeight()));
    if (toggleBtn) {
      toggleBtn.textContent = collapsed ? '▴' : '▾';
      toggleBtn.title = collapsed ? 'Mostrar resultados' : 'Minimizar resultados';
    }
    if (!collapsed) height = value;
    if (save) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, collapsed })); } catch (e) { /* sin persistencia */ }
    }
  }

  function toggle() {
    if (collapsed) apply(height > minHeight() + 2 ? height : DEFAULT_HEIGHT);
    else apply(0);             // `height` conserva la altura para restaurarla
  }

  function expandIfCollapsed() {
    if (collapsed) apply(height || DEFAULT_HEIGHT);
  }

  // ---------------------- Arrastre ----------------------
  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = pane.offsetHeight;
    let frame = 0;
    let lastY = startY;
    splitter.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing-v');
    splitter.classList.add('dragging');

    const onMove = (ev) => {
      lastY = ev.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply(startH + (startY - lastY), { save: false });   // arrastrar hacia arriba = panel más alto
      });
    };
    const onUp = (ev) => {
      if (frame) cancelAnimationFrame(frame);
      apply(startH + (startY - ev.clientY));
      splitter.releasePointerCapture(e.pointerId);
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      splitter.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('is-resizing-v');
      splitter.classList.remove('dragging');
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
    splitter.addEventListener('pointercancel', onUp);
  }

  function onKey(e) {
    const current = pane.offsetHeight;
    if (e.key === 'ArrowUp') apply(current + KEY_STEP);
    else if (e.key === 'ArrowDown') apply(current - KEY_STEP);
    else if (e.key === 'Home') apply(maxHeight());
    else if (e.key === 'End') apply(0);
    else if (e.key === 'Enter' || e.key === ' ') toggle();
    else return;
    e.preventDefault();
  }

  // ---------------------- Inicialización ----------------------
  function init() {
    pane = document.querySelector('#tab-editor .results-pane');
    splitter = $('resultsSplitter');
    container = $('tab-editor');
    if (!pane || !splitter || !container) return;

    // Botón minimizar/restaurar al final de la barra del panel
    const nav = pane.querySelector('.results-navbar');
    if (nav && !$('resultsToggleBtn')) {
      toggleBtn = document.createElement('button');
      toggleBtn.id = 'resultsToggleBtn';
      toggleBtn.type = 'button';
      toggleBtn.className = 'results-toggle-btn';
      toggleBtn.addEventListener('click', toggle);
      nav.appendChild(toggleBtn);
    }

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.height) height = saved.height;
      collapsed = !!(saved && saved.collapsed);
    } catch (e) { /* valores por defecto */ }

    // Con el panel minimizado, clic en "Resultados Grid" / "Consola de Salida" lo abre
    pane.querySelectorAll('.results-tab').forEach(tab => tab.addEventListener('click', expandIfCollapsed));

    splitter.addEventListener('pointerdown', startDrag);
    splitter.addEventListener('dblclick', toggle);
    splitter.addEventListener('keydown', onKey);

    // Al cambiar el tamaño de la ventana se respetan los límites
    window.addEventListener('resize', () => {
      if (!container.offsetHeight) return;         // pestaña oculta
      if (collapsed) apply(0, { save: false });
      else apply(height, { save: false });
    });

    // Cada ejecución escribe en la consola: si el panel está minimizado, se abre solo.
    // (Se ignoran los primeros 600 ms para no deshacer el estado guardado al cargar.)
    const readyAt = Date.now() + 600;
    const log = $('view-log');
    if (log) new MutationObserver(() => { if (Date.now() > readyAt) expandIfCollapsed(); })
      .observe(log, { childList: true });

    // Primer cálculo cuando el layout ya tiene tamaño
    requestAnimationFrame(() => {
      if (collapsed) apply(0, { save: false });
      else apply(height, { save: false });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { toggle, expand: expandIfCollapsed, setHeight: (h) => apply(h) };
})();
