/**
 * ============================================================================
 * PROTECCIÓN CONTRA OPERACIONES PELIGROSAS (safety.js)
 * ============================================================================
 * Antes de ejecutar un script, lo analiza con SqlUtils.analyzeRisk() y, si hay
 * sentencias peligrosas, pide confirmación:
 *   - Riesgo ALTO (DROP DATABASE/TABLE, TRUNCATE, DELETE/UPDATE sin WHERE):
 *     el usuario debe escribir CONFIRMAR.
 *   - Riesgo MEDIO (ALTER TABLE ... DROP, RENAME, DROP VIEW...): basta un clic.
 * Las bases de datos del sistema (mysql, sys, information_schema,
 * performance_schema) nunca se pueden eliminar.
 *
 * El "Modo seguro" se puede apagar desde la barra de herramientas.
 */
const SafetyGuard = (() => {
  const STORAGE_KEY = 'mbdb.safeMode';

  function isEnabled() {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  }

  function setEnabled(on) {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    renderToggle();
    UI.toast(on ? '🛡️ Modo seguro activado' : 'Modo seguro desactivado: no se pedirá confirmación', on ? 'success' : 'warning');
  }

  function renderToggle() {
    const btn = document.getElementById('safeModeToggle');
    if (!btn) return;
    const on = isEnabled();
    btn.classList.toggle('safe-on', on);
    btn.classList.toggle('safe-off', !on);
    btn.innerHTML = on ? '🛡️ Modo seguro: <strong>ON</strong>' : '⚠️ Modo seguro: <strong>OFF</strong>';
    btn.title = on
      ? 'Se pedirá confirmación antes de ejecutar DROP, TRUNCATE, DELETE/UPDATE sin WHERE, etc.'
      : 'Las sentencias peligrosas se ejecutarán sin confirmación';
  }

  async function toggle() {
    if (isEnabled()) {
      const ok = await UI.confirm({
        title: 'Desactivar modo seguro',
        html: 'Sin el modo seguro, sentencias como <code>DROP TABLE</code> o <code>DELETE</code> sin <code>WHERE</code> se ejecutarán sin pedir confirmación.<br><br>La protección de las bases de datos del sistema seguirá activa.',
        confirmLabel: 'Desactivar',
        danger: true
      });
      if (!ok) return;
      setEnabled(false);
    } else {
      setEnabled(true);
    }
  }

  function snippet(sql) {
    const oneLine = sql.replace(/\s+/g, ' ').trim();
    return oneLine.length > 140 ? oneLine.slice(0, 140) + '…' : oneLine;
  }

  /**
   * Revisa un script antes de enviarlo al servidor.
   * @returns {Promise<boolean>} true si se puede ejecutar
   */
  async function confirmScript(sql) {
    const blocked = SqlUtils.findBlockedStatement(sql);
    if (blocked) {
      await UI.alert('⛔ Operación bloqueada', `${UI.escape(blocked)}<br><br>Estas bases de datos son internas de MySQL; eliminarlas dañaría el servidor.`);
      return false;
    }
    if (!isEnabled()) return true;

    const findings = SqlUtils.analyzeRisk(sql);
    if (!findings.length) return true;

    const hasHigh = findings.some(f => f.level === 'high');
    const list = findings.map(f => `
      <div class="risk-item risk-${f.level}">
        <div class="risk-head">
          <span class="risk-badge">${f.level === 'high' ? 'ALTO' : 'MEDIO'}</span>
          <span>${UI.escape(f.reason)}</span>
          <span class="risk-line">línea ${f.line}</span>
        </div>
        <code class="risk-sql">${UI.escape(snippet(f.sql))}</code>
      </div>`).join('');

    return UI.confirm({
      title: hasHigh ? '⚠️ Operación peligrosa detectada' : '⚠️ Confirmar operación',
      width: '560px',
      html: `
        <p style="margin-bottom:10px;">El script contiene ${findings.length === 1 ? 'una sentencia que puede' : findings.length + ' sentencias que pueden'} borrar o modificar información de forma permanente:</p>
        <div class="risk-list">${list}</div>
        ${hasHigh ? '<p class="risk-tip">💡 Consejo: haz un respaldo con <strong>💾 Respaldo</strong> antes de continuar.</p>' : ''}`,
      confirmLabel: 'Ejecutar de todas formas',
      danger: true,
      requireText: hasHigh ? 'CONFIRMAR' : null
    });
  }

  /**
   * Confirmación para eliminar una base de datos desde el árbol lateral.
   * Muestra cuántas tablas se perderán y ofrece hacer un respaldo antes.
   */
  async function confirmDropDatabase(dbName) {
    if (SqlUtils.isSystemSchema(dbName)) {
      await UI.alert('🔒 Base de datos protegida', `<strong>${UI.escape(dbName)}</strong> es una base de datos interna de MySQL y no se puede eliminar.`);
      return false;
    }
    let tableInfo = '';
    try {
      const data = await UI.api('/tables', { database: dbName });
      const n = (data.tables || []).length;
      tableInfo = n
        ? `Contiene <strong>${n} tabla(s)</strong>: ${data.tables.slice(0, 8).map(t => `<code>${UI.escape(t)}</code>`).join(', ')}${n > 8 ? '…' : ''}`
        : 'La base de datos está vacía.';
    } catch (e) { /* si falla, igual se pide confirmación */ }

    return UI.confirm({
      title: '🗑️ Eliminar base de datos',
      width: '520px',
      html: `Esta acción eliminará <strong>permanentemente</strong> la base de datos <strong>${UI.escape(dbName)}</strong> junto con todas sus tablas y datos.<br><br>${tableInfo}`,
      confirmLabel: 'Eliminar para siempre',
      danger: true,
      requireText: dbName,
      extra: typeof Backup !== 'undefined' ? { label: '💾 Respaldar primero', onClick: () => Backup.quickBackup(dbName) } : null
    });
  }

  /** Confirmación para eliminar una tabla desde el árbol lateral */
  async function confirmDropTable(dbName, table) {
    return UI.confirm({
      title: '🗑️ Eliminar tabla',
      html: `Se eliminará la tabla <strong>${UI.escape(dbName)}.${UI.escape(table)}</strong> con todos sus datos. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar tabla',
      danger: true,
      requireText: table,
      extra: typeof Backup !== 'undefined' ? { label: '💾 Respaldar BD primero', onClick: () => Backup.quickBackup(dbName) } : null
    });
  }

  document.addEventListener('DOMContentLoaded', renderToggle);

  return { isEnabled, toggle, confirmScript, confirmDropDatabase, confirmDropTable };
})();
