/**
 * ============================================================================
 * ALTERNADOR DE TEMA (theme.js)
 * ============================================================================
 * Modo Oscuro / Modo Claro para todo My Best DataBase.
 *
 *  - Se carga en el <head> ANTES de los estilos para aplicar el tema guardado
 *    antes del primer pintado (evita el "parpadeo" del tema equivocado).
 *  - El tema es un atributo en <html data-theme="dark|light">; todos los
 *    colores salen de variables CSS en css/theme.css, así que el cambio es
 *    global e instantáneo.
 *  - La preferencia se guarda en localStorage ("mbd-theme"). Si el usuario
 *    nunca eligió, se respeta la preferencia del sistema operativo.
 *  - Cualquier botón con el atributo [data-theme-toggle] funciona como alternador.
 *  - Emite el evento "themechange" en window por si algún módulo (p. ej. un
 *    canvas) necesita volver a dibujarse con los nuevos colores.
 * ============================================================================
 */
(function () {
  const STORAGE_KEY = 'mbd-theme';
  const THEMES = ['dark', 'light'];
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function readSaved() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return THEMES.includes(v) ? v : null;
    } catch (e) {
      return null; // localStorage bloqueado: se usa el tema del sistema
    }
  }

  function systemTheme() {
    return media && media.matches ? 'light' : 'dark';
  }

  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  /** Actualiza texto, ícono y estado accesible de todos los alternadores */
  function renderToggles() {
    const theme = current();
    const next = theme === 'dark' ? 'claro' : 'oscuro';
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(theme === 'light'));
      btn.setAttribute('title', `Cambiar a modo ${next}`);
      btn.setAttribute('aria-label', `Cambiar a modo ${next}`);
      const icon = btn.querySelector('.theme-toggle-thumb');
      const label = btn.querySelector('.theme-toggle-label');
      if (icon) icon.textContent = theme === 'dark' ? '☾' : '☀';
      if (label) label.textContent = theme === 'dark' ? 'Oscuro' : 'Claro';
    });
  }

  function apply(theme, { animate = false } = {}) {
    if (!THEMES.includes(theme)) theme = 'dark';
    if (animate) {
      root.classList.add('theme-switching');
      clearTimeout(apply._t);
      apply._t = setTimeout(() => root.classList.remove('theme-switching'), 260);
    }
    root.setAttribute('data-theme', theme);
    renderToggles();
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function set(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* sin persistencia */ }
    apply(theme, { animate: true });
  }

  function toggle() {
    set(current() === 'dark' ? 'light' : 'dark');
  }

  // 1) Aplicar de inmediato (el script está en el <head>)
  apply(readSaved() || systemTheme());

  // 2) Conectar botones cuando exista el DOM
  function bind() {
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', toggle);
    });
    renderToggles();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  // 3) Sincronizar entre ventanas/pestañas abiertas de la app
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) apply(readSaved() || systemTheme(), { animate: true });
  });

  // 4) Si el usuario nunca eligió, seguir los cambios del sistema operativo
  if (media) {
    const onSystemChange = () => { if (!readSaved()) apply(systemTheme(), { animate: true }); };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  window.Theme = { get: current, set, toggle, bind };
})();
