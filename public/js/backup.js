/**
 * ============================================================================
 * RESPALDO Y RESTAURACIÓN (backup.js)
 * ============================================================================
 * Respaldar: genera un archivo .sql con la estructura (CREATE TABLE), los datos
 *            (INSERT), vistas, triggers y procedimientos de una base de datos.
 * Restaurar: carga un archivo .sql y lo ejecuta sentencia por sentencia en la
 *            base de datos elegida (puede crearla si no existe).
 * El trabajo pesado lo hace el servidor: rutas /api/backup y /api/restore.
 */
const Backup = (() => {
  const $ = id => document.getElementById(id);
  const MAX_FILE_MB = 50;
  let restoreFile = null; // { name, size, text, statements }

  function userDatabases() {
    const list = (typeof currentDatabasesList !== 'undefined' ? currentDatabasesList : []) || [];
    return list.filter(db => !SqlUtils.isSystemSchema(db));
  }

  function fillDatabaseSelect(select, selected) {
    const dbs = userDatabases();
    select.innerHTML = dbs.length
      ? dbs.map(db => `<option value="${UI.escape(db)}">${UI.escape(db)}</option>`).join('')
      : '<option value="">(no hay bases de datos de usuario)</option>';
    if (selected && dbs.includes(selected)) select.value = selected;
  }

  function open(tab = 'backup', database = null) {
    if (!UI.getConnection()) {
      UI.alert('Sin conexión', 'Primero conecta un servidor con el botón <strong>+ Conectar Servidor</strong>.');
      return;
    }
    const conn = UI.getConnection();
    const db = database || conn.database;
    fillDatabaseSelect($('bkDatabase'), db);
    fillDatabaseSelect($('rsDatabase'), db);
    $('bkResult').innerHTML = '';
    $('rsResult').innerHTML = '';
    switchTab(tab);
    $('backupModal').style.display = 'flex';
  }

  function close() {
    $('backupModal').style.display = 'none';
  }

  function switchTab(tab) {
    document.querySelectorAll('#backupModal .bk-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('bkPanelBackup').style.display = tab === 'backup' ? '' : 'none';
    $('bkPanelRestore').style.display = tab === 'restore' ? '' : 'none';
  }

  // =====================================================================
  // RESPALDAR
  // =====================================================================
  async function runBackup(database, options) {
    const res = await UI.api('/backup', { database, options }, { raw: true });
    const summary = JSON.parse(decodeURIComponent(res.headers.get('X-Backup-Summary') || '%7B%7D'));
    const blob = await res.blob();
    const fileName = summary.fileName || `${database}_${UI.stamp()}.sql`;
    UI.download(blob, fileName);
    logConsole(`Respaldo generado: ${fileName} (${summary.tables} tablas, ${summary.rows} filas, ${UI.formatBytes(blob.size)})`, 'success');
    return { ...summary, fileName, size: blob.size };
  }

  async function submitBackup() {
    const database = $('bkDatabase').value;
    if (!database) return;
    const options = {
      structure: $('bkStructure').checked,
      data: $('bkData').checked,
      dropTables: $('bkDrop').checked,
      routines: $('bkRoutines').checked,
      createDatabase: $('bkCreateDb').checked
    };
    if (!options.structure && !options.data) {
      $('bkResult').innerHTML = '<div class="designer-msg error">✖ Elige al menos "Estructura" o "Datos".</div>';
      return;
    }
    const btn = $('bkSubmit');
    btn.disabled = true;
    btn.textContent = 'Generando...';
    $('bkResult').innerHTML = '<div class="designer-msg info">⏳ Leyendo tablas y datos...</div>';
    try {
      const s = await runBackup(database, options);
      $('bkResult').innerHTML = `<div class="designer-msg success">✔ Respaldo descargado: <strong>${UI.escape(s.fileName)}</strong><br>
        ${s.tables} tabla(s) · ${s.views} vista(s) · ${s.rows} fila(s) · ${UI.formatBytes(s.size)}</div>`;
    } catch (e) {
      $('bkResult').innerHTML = `<div class="designer-msg error">✖ ${UI.escape(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Descargar respaldo';
    }
  }

  /** Respaldo rápido con opciones por defecto (lo usa la confirmación de "Eliminar BD") */
  async function quickBackup(database) {
    try {
      UI.toast(`Generando respaldo de ${database}...`, 'info');
      const s = await runBackup(database, { structure: true, data: true, dropTables: true, routines: true, createDatabase: true });
      UI.toast(`Respaldo descargado: ${s.fileName}`, 'success', 5000);
    } catch (e) {
      UI.toast(`No se pudo respaldar: ${e.message}`, 'error', 6000);
    }
  }

  // =====================================================================
  // RESTAURAR
  // =====================================================================
  function onFileSelected(file) {
    restoreFile = null;
    $('rsResult').innerHTML = '';
    $('rsSubmit').disabled = true;
    if (!file) { $('rsFileInfo').innerHTML = ''; return; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      $('rsFileInfo').innerHTML = `<div class="designer-msg error">✖ El archivo pesa ${UI.formatBytes(file.size)}; el máximo es ${MAX_FILE_MB} MB.</div>`;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const statements = SqlUtils.splitStatements(text);
      const clean = statements.map(s => SqlUtils.stripForAnalysis(s.sql).toUpperCase());
      const count = re => clean.filter(s => re.test(s)).length;
      const creates = count(/^CREATE TABLE/);
      const inserts = count(/^(INSERT|REPLACE)/);
      const drops = count(/^DROP TABLE/);
      const hasUse = clean.some(s => /^(USE|CREATE (DATABASE|SCHEMA))\b/.test(s));
      restoreFile = { name: file.name, size: file.size, text, statements };

      const warnings = [];
      if (drops) warnings.push(`Contiene ${drops} DROP TABLE: las tablas con el mismo nombre en el destino se reemplazarán.`);
      if (hasUse) warnings.push('El archivo incluye USE / CREATE DATABASE: esas sentencias pueden enviar los datos a otra base de datos distinta a la elegida.');
      if (!statements.length) warnings.push('No se encontraron sentencias SQL en el archivo.');

      $('rsFileInfo').innerHTML = `
        <div class="file-summary">
          <div>📄 <strong>${UI.escape(file.name)}</strong> · ${UI.formatBytes(file.size)}</div>
          <div class="file-stats">${statements.length} sentencias · ${creates} CREATE TABLE · ${inserts} INSERT</div>
        </div>
        ${warnings.map(w => `<div class="designer-msg warning">⚠ ${UI.escape(w)}</div>`).join('')}`;
      $('rsSubmit').disabled = !statements.length;
    };
    reader.onerror = () => {
      $('rsFileInfo').innerHTML = '<div class="designer-msg error">✖ No se pudo leer el archivo.</div>';
    };
    reader.readAsText(file, 'utf-8');
  }

  function restoreTarget() {
    const isNew = $('rsModeNew').checked;
    return {
      isNew,
      database: isNew ? $('rsNewName').value.trim() : $('rsDatabase').value
    };
  }

  function onModeChange() {
    const isNew = $('rsModeNew').checked;
    $('rsDatabase').disabled = isNew;
    $('rsNewName').disabled = !isNew;
    if (isNew) $('rsNewName').focus();
  }

  async function submitRestore() {
    if (!restoreFile) return;
    const target = restoreTarget();
    const nameError = DDLBuilder.validateName(target.database, 'la base de datos destino');
    if (nameError) {
      $('rsResult').innerHTML = `<div class="designer-msg error">✖ ${UI.escape(nameError)}</div>`;
      return;
    }
    if (target.isNew && userDatabases().some(db => db.toLowerCase() === target.database.toLowerCase())) {
      $('rsResult').innerHTML = `<div class="designer-msg error">✖ Ya existe una base de datos llamada "${UI.escape(target.database)}". Elige "Base de datos existente".</div>`;
      return;
    }

    const ok = await UI.confirm({
      title: '♻️ Confirmar restauración',
      html: `Se ejecutarán <strong>${restoreFile.statements.length} sentencias</strong> de <strong>${UI.escape(restoreFile.name)}</strong>
        en la base de datos <strong>${UI.escape(target.database)}</strong>${target.isNew ? ' (nueva)' : ''}.<br><br>
        ${target.isNew ? '' : 'Las tablas que ya existan con el mismo nombre pueden ser <strong>reemplazadas</strong>. '}Esta acción no se puede deshacer.`,
      confirmLabel: 'Restaurar',
      danger: !target.isNew,
      extra: !target.isNew ? { label: '💾 Respaldar destino primero', onClick: () => quickBackup(target.database) } : null
    });
    if (!ok) return;

    const btn = $('rsSubmit');
    btn.disabled = true;
    btn.textContent = 'Restaurando...';
    $('rsResult').innerHTML = `<div class="designer-msg info">⏳ Ejecutando ${restoreFile.statements.length} sentencias...</div>`;
    try {
      const data = await UI.api('/restore', {
        database: target.database,
        createIfMissing: target.isNew,
        sql: restoreFile.text
      });
      $('rsResult').innerHTML = `<div class="designer-msg success">✔ Restauración completada: ${data.executed} de ${data.total} sentencias en ${data.timeMs} ms.</div>`;
      logConsole(`Restauración de ${restoreFile.name} en ${target.database}: ${data.executed} sentencias OK`, 'success');
      UI.toast(`Base de datos "${target.database}" restaurada`, 'success');
      if (typeof Designer !== 'undefined') Designer.invalidate(target.database);
      if (typeof loadDatabasesTree === 'function') await loadDatabasesTree();
      fillDatabaseSelect($('rsDatabase'), target.database);
    } catch (e) {
      const d = e.data || {};
      const where = d.failedAt ? `<br>Falló la sentencia <strong>${d.failedAt} de ${d.total}</strong> (línea ${d.line} del archivo). Se ejecutaron ${d.executed} correctamente antes del error.` : '';
      const snippet = d.snippet ? `<pre class="sql-preview small">${UI.escape(d.snippet)}</pre>` : '';
      $('rsResult').innerHTML = `<div class="designer-msg error">✖ ${UI.escape(e.message)}${where}</div>${snippet}`;
      logConsole(`Error al restaurar: ${e.message}`, 'error');
      if (typeof loadDatabasesTree === 'function') loadDatabasesTree();
    } finally {
      btn.disabled = false;
      btn.textContent = '♻️ Restaurar';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const input = $('rsFile');
    if (!input) return;
    input.addEventListener('change', () => onFileSelected(input.files[0]));
    $('rsModeExisting').addEventListener('change', onModeChange);
    $('rsModeNew').addEventListener('change', onModeChange);

    // Arrastrar y soltar un .sql sobre la zona de carga
    const drop = $('rsDropZone');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (file) onFileSelected(file);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('backupModal').style.display === 'flex' && !document.querySelector('.ui-dialog-overlay[style*="flex"]')) close();
    });
  });

  return { open, close, switchTab, submitBackup, submitRestore, quickBackup };
})();
