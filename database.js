const { Sequelize } = require('sequelize');

// SQLite veritabanı
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite', // SQLite dosyası
});

(async () => {
  try {
    await sequelize.authenticate();
    console.log('SQLite bağlantısı başarılı!');
  } catch (error) {
    console.error('SQLite bağlantısı başarısız:', error);
  }
})();

module.exports = sequelize;
