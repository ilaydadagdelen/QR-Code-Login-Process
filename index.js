// qr'la userId yerine sessionId gönderdim
// şifreleme kullandım (encryptSessionId)
// userId sunucuda saklandı - bütün istemcilere erişimi sağlanmadı
// kısa süreli qr kodla (sürekli yenileniyor ve benzersiz) güvenlik sağlandı


const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');
const sequelize = require('./database');
const User = require('./models/User');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit'); 
require('dotenv').config(); 

const app = express();
app.use(cors()); //kaynaklar arası istekleri izinli hale getirir ??
app.use(express.json());
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

// rate limiting (API'ye gelen istekleri sınırlamak için) - kötüye kullanıma karşı koruma
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Her 15 dakikada en fazla 100 istek
  message: 'Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.'
});
app.use(limiter);

// qr kodda yer alan veriyi şifreler, her kod ayrı kimlik
// iv ve content şifreleme
function encryptSessionId(sessionId) {
  const algorithm = 'aes-256-ctr';
  const secretKey = process.env.SECRET_KEY; // .env'den alınır
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(sessionId), cipher.final()]);

  return {
    iv: iv.toString('hex'),
    content: encrypted.toString('hex')
  };
}


// swagger ayarları 
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'QR Code Login API',
      version: '1.0.0',
      description: 'QR Kod ile giriş ve doğrulama API\'sinin belgeleri',
    },
    servers: [
      { url: 'http://localhost:4000' }
    ],
  },
  apis: ['./index.js'], 
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// QR kod üretme endpoint
// Her QR kod benzersiz bir sessionId taşır, userId QR kodda görünmez
// userId erişimi problemini söylediğinz için onun yerine sessionId kullandım
// swagger test için http://localhost:4000/api-docs
/**
 * @swagger
 * /generate-qr:
 *   get:
 *     summary: QR Kod oluşturur.
 *     responses:
 *       200:
 *         description: QR kod başarıyla oluşturuldu.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 qrCode:
 *                   type: string
 *                   description: Base64 formatında QR kod görseli
 */
app.get('/generate-qr', async (req, res) => {
  const sessionId = crypto.randomBytes(32).toString('hex'); // Daha uzun ve güvenli sessionId
  const qrCodeContent = JSON.stringify(encryptSessionId(sessionId));

  sessions[sessionId] = { authenticated: false, expiresAt: Date.now() + 60000 }; // 1 dakika geçerlilik

  try {
    const qrCodeImage = await QRCode.toDataURL(qrCodeContent); // QR kodu base64 formatında oluştur
    res.json({ success: true, qrCode: qrCodeImage, sessionId }); // sessionId döndür
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// qr kod doğrulama endpoint
// oturum artık geçerlidir
/**
 * @swagger
 * /validate-qr:
 *   post:
 *     summary: QR kod doğrulama.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: QR kod üretildiğinde dönen sessionId.
 *                 example: "YOUR_SESSION_ID_HERE"
 *     responses:
 *       200:
 *         description: QR kod başarıyla doğrulandı.
 *       400:
 *         description: Geçersiz veya süresi dolmuş QR kodu.
 */
app.post('/validate-qr', (req, res) => {
  const { sessionId } = req.body;

  const session = sessions[sessionId];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(400).json({ success: false, message: 'Geçersiz veya süresi dolmuş QR kodu!' });
  }

  session.authenticated = true; // Kullanıcı doğrulandı
  io.emit('qr-scanned', { sessionId });

  res.json({ success: true, message: 'QR kod başarıyla tarandı!' });
});

// QR kod tarama (Socket.IO)
// - her QR kod yalnızca bir kez kullanılabilir
io.on('connection', (socket) => {
  console.log(`Yeni bağlantı: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Bağlantı kesildi: ${socket.id}`);
  });

  socket.on('scan-qr', ({ sessionId }) => {
    const session = sessions[sessionId];
    if (!session) {
      socket.emit('auth-failure', { message: 'Geçersiz QR kodu!' });
      return;
    }

    if (session.authenticated) {
      socket.emit('auth-failure', { message: 'QR kod zaten kullanıldı!' });
      return;
    }

    if (Date.now() > session.expiresAt) {
      socket.emit('auth-failure', { message: 'QR kodun süresi doldu!' });
      return;
    }

    session.authenticated = true;

    // kullanıcıyı odaya ekler 
    // - güvenlik açısından her seferinde oda sistemini kullanır
    socket.join(sessionId);

    // oda içindeki istemciye mesaj gönderir
    io.to(sessionId).emit('auth-success', { message: 'Giriş başarılı!' });
  });
});



// register endpoint
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Bu e-posta zaten kayıtlı!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10); // Parolayı hashle
    const newUser = await User.create({ name, email, password: hashedPassword });
    res.json({ success: true, message: 'Kayıt başarılı!', user: newUser });
  } catch (error) {
    console.error('Kayıt sırasında hata:', error);
    res.status(500).json({ success: false, message: 'Kayıt sırasında bir hata oluştu!' });
  }
});

// login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(401).json({ success: false, message: 'E-posta bulunamadı!' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password); // Şifre doğrulama
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Şifre hatalı!' });
    }

    res.json({ success: true, message: 'Giriş başarılı!' });
  } catch (error) {
    console.error('Giriş sırasında hata:', error);
    res.status(500).json({ success: false, message: 'Giriş sırasında bir hata oluştu!' });
  }
});


server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
