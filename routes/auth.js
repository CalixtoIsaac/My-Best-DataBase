const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();
const USERS_FILE = path.join(__dirname, '../data/users.json');

// Mapa RAM para almacenamiento OTP
const otpStore = new Map();

function getUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  const data = fs.readFileSync(USERS_FILE, 'utf-8');
  return JSON.parse(data || '[]');
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS_APP
  }
});

// 1. SOLICITAR CÓDIGO
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'El correo es obligatorio.' });

    const cleanEmail = String(email).toLowerCase().trim();
    const users = getUsers();

    if (users.some(u => u.email === cleanEmail)) {
      return res.status(400).json({ error: 'Este correo electrónico ya está registrado.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    otpStore.set(cleanEmail, { code, expiresAt });

    const mailOptions = {
      from: `"My Best DataBase" <${process.env.EMAIL_USER}>`,
      to: cleanEmail,
      subject: 'Código de Verificación - My Best DataBase',
      text: `¡Bienvenido a My Best DataBase!\n\nTu código de verificación es: ${code}\n\nEste código es válido por 10 minutos.`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #1e1e24; color: #f0f0f5; padding: 24px; border-radius: 8px; max-width: 400px; margin: auto;">
          <h2 style="color: #007acc; text-align: center;">My Best DataBase</h2>
          <p style="text-align: center; color: #8a8a9e;">Tu código de verificación es:</p>
          <div style="text-align: center; margin: 20px 0;">
            <span style="background: #007acc; color: white; padding: 12px 24px; font-size: 24px; font-weight: bold; letter-spacing: 6px; border-radius: 6px; display: inline-block;">${code}</span>
          </div>
          <p style="color: #8a8a9e; font-size: 11px; text-align: center;">Válido por 10 minutos.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return res.json({ message: 'Código enviado correctamente.' });

  } catch (error) {
    console.error('Error enviando correo:', error);
    return res.status(500).json({ error: 'Error al enviar el correo de verificación.' });
  }
});

// 2. VERIFICAR CÓDIGO Y REGISTRAR
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, code } = req.body;

    // Control de existencia de campos
    if (!name || !email || !password || !code) {
      return res.status(400).json({ error: 'Faltan datos obligatorios para el registro. Regresa al paso 1.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanCode = String(code).trim();
    const record = otpStore.get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No existe una solicitud de código activa o la sesión expiró. Solicita uno nuevo.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'El código ha expirado. Solicita uno nuevo.' });
    }

    if (String(record.code).trim() !== cleanCode) {
      return res.status(400).json({ error: 'El código de verificación es incorrecto.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const users = getUsers();

    if (users.some(u => u.email === cleanEmail)) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'Este correo electrónico ya está registrado.' });
    }

    const newUser = {
      id: Date.now().toString(),
      name: String(name).toUpperCase().trim(),
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);
    otpStore.delete(cleanEmail);

    return res.json({ message: 'Cuenta creada con éxito.' });

  } catch (error) {
    console.error('Error en el registro:', error);
    return res.status(500).json({ error: 'Error interno del servidor al crear la cuenta.' });
  }
});

// 3. INICIAR SESIÓN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Por favor ingresa correo y contraseña.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const users = getUsers();
    const user = users.find(u => u.email === cleanEmail);

    if (!user) {
      return res.status(400).json({ error: 'El correo electrónico no está registrado.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Contraseña incorrecta.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET || 'secreto_super_seguro',
      { expiresIn: '8h' }
    );

    return res.json({
      token,
      user: { name: user.name, email: user.email }
    });

  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ error: 'Error interno del servidor al iniciar sesión.' });
  }
});

module.exports = router;