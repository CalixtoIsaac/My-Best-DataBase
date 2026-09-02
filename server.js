<<<<<<< HEAD
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARES DE LA APLICACIÓN
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (CSS, JS, imágenes) desde /public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// RUTAS DE LA API
// ==========================================
app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'SQL Database Studio Engine',
    timestamp: new Date() 
  });
});

app.post('/api/query', async (req, res) => {
  const { sql, connectionConfig } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'Debes proporcionar una consulta SQL para ejecutar.' });
  }

  try {
    return res.json({
      status: 'success',
      columns: ['id', 'nombre', 'email', 'creado_en'],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 15
    });
  } catch (error) {
    console.error('Error SQL:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS DE NAVEGACIÓN WEB (HTML)
// ==========================================

// Ruta raíz: Redirige automáticamente al Login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la pantalla de Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la pantalla del Studio
app.get('/studio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'studio.html'));
});

// Redirección por defecto: Cualquier ruta no encontrada vuelve al login
app.get('*', (req, res) => {
  res.redirect('/login');
});

// ==========================================
// ARRANQUE DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 SQL Database Studio iniciado correctamente`);
  console.log(`🌐 Acceso Web: http://localhost:${PORT}`);
  console.log(`===============================================`);
=======
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARES DE LA APLICACIÓN
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (CSS, JS, imágenes) desde /public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// RUTAS DE LA API
// ==========================================
app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'SQL Database Studio Engine',
    timestamp: new Date() 
  });
});

app.post('/api/query', async (req, res) => {
  const { sql, connectionConfig } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'Debes proporcionar una consulta SQL para ejecutar.' });
  }

  try {
    return res.json({
      status: 'success',
      columns: ['id', 'nombre', 'email', 'creado_en'],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 15
    });
  } catch (error) {
    console.error('Error SQL:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS DE NAVEGACIÓN WEB (HTML)
// ==========================================

// Ruta raíz: Redirige automáticamente al Login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la pantalla de Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la pantalla del Studio
app.get('/studio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'studio.html'));
});

// Redirección por defecto: Cualquier ruta no encontrada vuelve al login
app.get('*', (req, res) => {
  res.redirect('/login');
});

// ==========================================
// ARRANQUE DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 SQL Database Studio iniciado correctamente`);
  console.log(`🌐 Acceso Web: http://localhost:${PORT}`);
  console.log(`===============================================`);
>>>>>>> a3c7533 (Primer commit: Interfaz Basicas hechas)
});