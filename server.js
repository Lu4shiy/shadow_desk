import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validate } from '@tma.js/init-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn('BOT_TOKEN is not set. Auth will fail.');
}

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Middleware: валидация Telegram initData
function telegramAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [authType, authData = ''] = authHeader.split(' ');

  if (authType !== 'tma' || !authData) {
    return res.status(401).json({ error: 'Unauthorized: missing initData' });
  }

  try {
    // expiresIn: 3600 — данные считаются валидными 1 час
    const initData = validate(authData, BOT_TOKEN, { expiresIn: 3600 });
    req.telegramUser = initData.user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid initData', details: err.message });
  }
}

// Health endpoint для UptimeRobot
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Пример защищённого endpoint
app.get('/api/me', telegramAuth, (req, res) => {
  res.json({ user: req.telegramUser });
});

// Заглушка коллекции: позже здесь будет выдача карт из БД
app.get('/api/collection', telegramAuth, (req, res) => {
  res.json({
    cards: [
      { id: 1, name: 'Крыса-разведчик', type: 'character', rarity: 'common' },
      { id: 2, name: 'Удар', type: 'attack', rarity: 'common' }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
