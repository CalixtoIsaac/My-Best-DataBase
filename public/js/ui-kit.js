/**
 * ============================================================================
 * KIT DE INTERFAZ (ui-kit.js)
 * ============================================================================
 * Componentes reutilizables por todos los módulos nuevos del Studio:
 *  - UI.escape()      → evita inyectar HTML al mostrar nombres o datos.
 *  - UI.confirm()     → ventana de confirmación (con opción de escribir un texto).
 *  - UI.alert()       → ventana informativa.
 *  - UI.toast()       → notificación pequeña en la esquina.
 *  - UI.download()    → descarga un archivo generado en el navegador.
 *  - UI.api()         → llamada POST a la API con la conexión activa.
 *  - UI.getConnection() / UI.highlightSql()
 */
const UI = (() => {

  function escape(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Devuelve la conexión guardada en localStorage (o null) */
  function getConnection() {
    try {
      const raw = localStorage.getItem('activeDbConnection');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * POST a la API agregando automáticamente la configuración de conexión.
   * Lanza un Error con el mensaje del servidor si la respuesta no es 2xx.
   */
  async function api(path, body = {}, { raw = false } = {}) {
    const connectionConfig = getConnection();
    if (!connectionConfig) throw new Error('No hay un servidor conectado. Usa "+ Conectar Servidor".');
    const res = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionConfig, ...body })
    });
    if (raw && res.ok) return res;
    let data = {};
    try { data = await res.json(); } catch (e) { /* respuesta sin JSON */ }
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.data = data;
      throw err;
    }
    return data;
  }

  /** Resaltado simple de SQL para las vistas previas (mismos colores que el editor) */
  function highlightSql(sql) {
    let html = escape(sql);
    html = html.replace(/(&#39;(?:[^&]|&(?!#39;))*?&#39;)/g, '<span class="sql-string">$1</span>');
    html = html.replace(/\b(CREATE|DATABASE|TABLE|ALTER|ADD|DROP|CHANGE|COLUMN|PRIMARY|KEY|UNIQUE|FOREIGN|REFERENCES|CONSTRAINT|ON|DELETE|UPDATE|CASCADE|RESTRICT|SET|NULL|NOT|DEFAULT|AUTO_INCREMENT|UNSIGNED|ENGINE|COMMENT|CHARACTER|COLLATE|INDEX|RENAME|TO|AFTER|FIRST|CURRENT_TIMESTAMP|NO|ACTION|IF|EXISTS|GENERATED|ALWAYS|AS|VIRTUAL|STORED|SELECT|FROM|WHERE|AND|OR|INSERT|INTO|VALUES|LIMIT|ORDER|BY|ASC|DESC|LIKE|BETWEEN|IN|IS|START|TRANSACTION|COMMIT|JOIN|LEFT|INNER|GROUP)\b/g,
      '<span class="sql-keyword">$1</span>');
    html = html.replace(/\b(INT|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|FLOAT|DOUBLE|BOOLEAN|BIT|VARCHAR|CHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|DATE|DATETIME|TIMESTAMP|TIME|YEAR|JSON|BINARY|VARBINARY|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)\b/g,
      '<span class="sql-function">$1</span>');
    return html;
  }

  // ------------------------------------------------------------------
  // Ventana de diálogo genérica (se crea una sola vez y se reutiliza)
  // ------------------------------------------------------------------
  let dialogEl = null;
  function ensureDialog() {
    if (dialogEl) return dialogEl;
    dialogEl = document.createElement('div');
    dialogEl.className = 'modal-overlay ui-dialog-overlay';
    dialogEl.innerHTML = `
      <div class="modal ui-dialog" role="dialog" aria-modal="true">
        <div class="modal-header ui-dialog-title"></div>
        <div class="modal-body ui-dialog-body"></div>
        <div class="ui-dialog-confirm-text" style="display:none;">
          <label class="ui-dialog-label"></label>
          <input type="text" class="form-control ui-dialog-input" autocomplete="off" spellcheck="false">
        </div>
        <div class="modal-footer">
          <button class="btn ui-dialog-extra" style="display:none; margin-right:auto;"></button>
          <button class="btn ui-dialog-cancel">Cancelar</button>
          <button class="btn btn-primary ui-dialog-ok">Aceptar</button>
        </div>
      </div>`;
    document.body.appendChild(dialogEl);
    return dialogEl;
  }

  /**
   * Muestra una confirmación y devuelve una Promesa<boolean>.
   * @param {object} opts
   *  - title, html (contenido ya escapado), confirmLabel, cancelLabel
   *  - danger: botón rojo
   *  - requireText: el usuario debe escribir exactamente este texto para habilitar el botón
   *  - extra: { label, onClick } botón adicional a la izquierda (ej. "Respaldar primero")
   *  - alertOnly: solo botón Aceptar
   */
  function confirm(opts = {}) {
    const el = ensureDialog();
    const title = el.querySelector('.ui-dialog-title');
    const body = el.querySelector('.ui-dialog-body');
    const okBtn = el.querySelector('.ui-dialog-ok');
    const cancelBtn = el.querySelector('.ui-dialog-cancel');
    const extraBtn = el.querySelector('.ui-dialog-extra');
    const textWrap = el.querySelector('.ui-dialog-confirm-text');
    const input = el.querySelector('.ui-dialog-input');
    const label = el.querySelector('.ui-dialog-label');

    title.textContent = opts.title || 'Confirmar';
    body.innerHTML = opts.html || escape(opts.message || '');
    okBtn.textContent = opts.confirmLabel || 'Aceptar';
    okBtn.className = 'btn ui-dialog-ok ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
    cancelBtn.style.display = opts.alertOnly ? 'none' : '';
    el.querySelector('.ui-dialog').style.width = opts.width || '';

    if (opts.extra) {
      extraBtn.style.display = '';
      extraBtn.textContent = opts.extra.label;
      extraBtn.onclick = opts.extra.onClick;
    } else {
      extraBtn.style.display = 'none';
      extraBtn.onclick = null;
    }

    if (opts.requireText) {
      textWrap.style.display = '';
      label.innerHTML = `Para continuar escribe <strong class="ui-dialog-code">${escape(opts.requireText)}</strong>:`;
      input.value = '';
      okBtn.disabled = true;
      input.oninput = () => { okBtn.disabled = input.value !== opts.requireText; };
    } else {
      textWrap.style.display = 'none';
      okBtn.disabled = false;
      input.oninput = null;
    }

    el.style.display = 'flex';
    setTimeout(() => (opts.requireText ? input : okBtn).focus(), 30);

    return new Promise(resolve => {
      const close = (result) => {
        el.style.display = 'none';
        document.removeEventListener('keydown', onKey, true);
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(false); }
        if (e.key === 'Enter' && !okBtn.disabled && document.activeElement !== cancelBtn && document.activeElement !== extraBtn) {
          e.preventDefault(); e.stopPropagation(); close(true);
        }
      };
      okBtn.onclick = () => close(true);
      cancelBtn.onclick = () => close(false);
      document.addEventListener('keydown', onKey, true);
    });
  }

  function alert(title, html) {
    return confirm({ title, html, alertOnly: true, confirmLabel: 'Entendido' });
  }

  // ------------------------------------------------------------------
  // Notificaciones tipo "toast"
  // ------------------------------------------------------------------
  function toast(message, type = 'info', ms = 3500) {
    let stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(() => item.classList.add('hide'), ms);
    setTimeout(() => item.remove(), ms + 400);
  }

  // ------------------------------------------------------------------
  // Descargas
  // ------------------------------------------------------------------
  function download(content, fileName, mimeType = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Marca de tiempo para nombres de archivo: 20250922_2215 */
  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  return { escape, getConnection, api, highlightSql, confirm, alert, toast, download, stamp, formatBytes };
})();
