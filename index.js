const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');
const sequelize = require('./database');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json());

// Statik dosyalar için public klasörünü kullan
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 4000;
const sessions = {};

// Login sayfasını göstermek için '/' endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html')); // Ana sayfa
});

// QR kod üretme endpoint
app.get('/generate-qr', async (req, res) => {
  const userId = Math.random().toString(36).substring(2, 10);
  const qrCodeContent = JSON.stringify({ userId });

  sessions[userId] = { authenticated: false };

  try {
    const qrCodeImage = await QRCode.toDataURL(qrCodeContent);
    res.json({ success: true, qrCode: qrCodeImage, userId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// QR ile giriş kontrolü (Socket.IO)
io.on('connection', (socket) => {
  console.log(`Yeni bağlantı: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Bağlantı kesildi: ${socket.id}`);
  });

  socket.on('scan-qr', ({ userId }) => {
    if (!userId || !sessions[userId]) {
      socket.emit('auth-failure', { message: 'Geçersiz QR kodu!' });
      return;
    }

    sessions[userId].authenticated = true;
    socket.emit('auth-success', { message: 'Giriş başarılı!' });
    io.emit('user-authenticated', { userId });
  });
});

// QR kod doğrulama endpoint'i
app.post('/validate-qr', (req, res) => {
  const { userId } = req.body;

  if (!sessions[userId]) {
    return res.status(400).json({ success: false, message: 'Geçersiz QR kodu!' });
  }

  // Kullanıcı doğrulandı
  sessions[userId].authenticated = true;

  // QR tarama olayını tetikle
  io.emit('qr-scanned', { userId });

  res.json({ success: true, message: 'QR kod başarıyla tarandı!' });
});






// Register endpoint
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Bu e-posta zaten kayıtlı!' });
    }

    const newUser = await User.create({ name, email, password });
    res.json({ success: true, message: 'Kayıt başarılı!', user: newUser });
  } catch (error) {
    console.error('Kayıt sırasında hata:', error);
    res.status(500).json({ success: false, message: 'Kayıt sırasında bir hata oluştu!' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(401).json({ success: false, message: 'E-posta bulunamadı!' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Şifre hatalı!' });
    }

    res.json({ success: true, message: 'Giriş başarılı!' });
  } catch (error) {
    console.error('Giriş sırasında hata:', error);
    res.status(500).json({ success: false, message: 'Giriş sırasında bir hata oluştu!' });
  }
});

// Sunucuyu başlat
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
