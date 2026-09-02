// Estado temporal para el registro de dos pasos
let pendingRegisterData = {};

document.addEventListener('DOMContentLoaded', () => {
  checkActiveSession();
  initProBackground();
});

// ==========================================
// CONTROL DE SESIÓN Y NAVEGACIÓN ENTRE PÁGINAS
// ==========================================
function checkActiveSession() {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const currentPath = window.location.pathname;

  const userNameDisplay = document.getElementById('userNameDisplay');

  // Si tiene sesión activa
  if (token && user.name) {
    if (currentPath === '/' || currentPath === '/login' || currentPath.endsWith('login.html')) {
      window.location.href = '/studio';
      return;
    }
    if (userNameDisplay) {
      userNameDisplay.innerText = user.name;
    }
  } else {
    if (currentPath === '/studio' || currentPath.endsWith('studio.html')) {
      window.location.href = '/login';
    }
  }
}

function switchAuthTab(tab) {
  const loginBtn = document.getElementById('tabBtnLogin');
  const regBtn = document.getElementById('tabBtnRegister');
  const loginForm = document.getElementById('loginForm');
  const regStep1 = document.getElementById('registerStep1Form');
  const regStep2 = document.getElementById('registerStep2Form');

  hideAlert();

  if (tab === 'login') {
    if (loginBtn) loginBtn.classList.add('active');
    if (regBtn) regBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'flex';
    if (regStep1) regStep1.style.display = 'none';
    if (regStep2) regStep2.style.display = 'none';
  } else {
    if (regBtn) regBtn.classList.add('active');
    if (loginBtn) loginBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'none';
    if (regStep1) regStep1.style.display = 'flex';
    if (regStep2) regStep2.style.display = 'none';
  }
}

function backToStep1() {
  hideAlert();
  const regStep1 = document.getElementById('registerStep1Form');
  const regStep2 = document.getElementById('registerStep2Form');
  if (regStep1) regStep1.style.display = 'flex';
  if (regStep2) regStep2.style.display = 'none';
}

function showAlert(message, type = 'error') {
  const alertBox = document.getElementById('authAlert');
  if (!alertBox) return;
  alertBox.className = `auth-alert ${type}`;
  alertBox.innerText = message;
  alertBox.style.display = 'block';
}

function hideAlert() {
  const alertBox = document.getElementById('authAlert');
  if (alertBox) alertBox.style.display = 'none';
}

// ==========================================
// FLUJO DE REGISTRO DE 2 PASOS
// ==========================================
async function handleSendCode(e) {
  e.preventDefault();
  hideAlert();

  const name = document.getElementById('regName')?.value.trim().toUpperCase();
  const email = document.getElementById('regEmail')?.value.trim().toLowerCase();
  const password = document.getElementById('regPassword')?.value;
  const confirmPassword = document.getElementById('regConfirmPassword')?.value;

  if (!name || !email || !password || !confirmPassword) {
    showAlert('Por favor completa todos los campos.');
    return;
  }

  if (password !== confirmPassword) {
    showAlert('Las contraseñas no coinciden. Por favor verifícalas.');
    return;
  }

  try {
    const response = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || 'Error al enviar el código de verificación.');
      return;
    }

    // Guardar los datos temporalmente asegurando el formato
    pendingRegisterData = { name, email, password };

    document.getElementById('registerStep1Form').style.display = 'none';
    document.getElementById('registerStep2Form').style.display = 'flex';
    showAlert(`Código enviado a ${email}. Revisa tu bandeja de entrada o spam.`, 'success');

  } catch (err) {
    showAlert('No se pudo conectar con el servidor.');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  hideAlert();

  // Validar que los datos del Paso 1 no se hayan perdido
  if (!pendingRegisterData.email || !pendingRegisterData.name || !pendingRegisterData.password) {
    showAlert('Sesión de registro expirada. Regresa al paso 1.');
    backToStep1();
    return;
  }

  const code = document.getElementById('regCode')?.value.trim();

  if (!code || code.length !== 6) {
    showAlert('El código debe ser de 6 dígitos.');
    return;
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: pendingRegisterData.name,
        email: pendingRegisterData.email,
        password: pendingRegisterData.password,
        code: code
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || 'Error al completar el registro.');
      return;
    }

    // Limpiar formulario y estado tras el registro exitoso
    pendingRegisterData = {};
    document.getElementById('registerStep1Form').reset();
    document.getElementById('registerStep2Form').reset();
    switchAuthTab('login');
    showAlert('¡Cuenta creada con éxito! Ya puedes iniciar sesión.', 'success');

  } catch (err) {
    showAlert('Error de conexión al registrar el usuario.');
  }
}

// ==========================================
// FLUJO DE INICIO DE SESIÓN Y LOGOUT
// ==========================================
async function handleLogin(e) {
  e.preventDefault();
  hideAlert();

  const email = document.getElementById('loginEmail')?.value.trim().toLowerCase();
  const password = document.getElementById('loginPassword')?.value;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || 'Credenciales incorrectas.');
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    window.location.href = '/studio';

  } catch (err) {
    showAlert('Error de conexión al iniciar sesión.');
  }
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

// ==========================================
// MOTOR GRÁFICO (CANVAS NODES & SPOTLIGHT)
// ==========================================
function initProBackground() {
  const canvas = document.getElementById('bgCanvas');
  const spotlight = document.getElementById('mouseSpotlight');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  let mouse = { x: null, y: null, radius: 150 };

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    createParticles();
  }

  window.addEventListener('resize', resize);

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (spotlight) {
      spotlight.style.setProperty('--mouse-x', `${e.clientX}px`);
      spotlight.style.setProperty('--mouse-y', `${e.clientY}px`);
    }
  });

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.8;
      this.vy = (Math.random() - 0.5) * 0.8;
      this.radius = Math.random() * 2 + 1;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      if (this.x < 0 || this.x > width) this.vx *= -1;
      if (this.y < 0 || this.y > height) this.vy *= -1;

      if (mouse.x !== null) {
        let dx = mouse.x - this.x;
        let dy = mouse.y - this.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mouse.radius) {
          let angle = Math.atan2(dy, dx);
          let force = (mouse.radius - dist) / mouse.radius;
          this.x -= Math.cos(angle) * force * 2;
          this.y -= Math.sin(angle) * force * 2;
        }
      }
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 122, 204, 0.8)';
      ctx.fill();
    }
  }

  function createParticles() {
    particles = [];
    const count = Math.floor((width * height) / 12000);
    for (let i = 0; i < count; i++) {
      particles.push(new Particle());
    }
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      particles[i].update();
      particles[i].draw();

      for (let j = i + 1; j < particles.length; j++) {
        let dx = particles[i].x - particles[j].x;
        let dy = particles[i].y - particles[j].y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0, 122, 204, ${1 - dist / 120})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(animate);
  }

  resize();
  animate();
}