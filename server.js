import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validate, parse } from '@tma.js/init-data-node';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) console.warn('BOT_TOKEN is not set. Auth will fail.');
if (!DATABASE_URL) console.warn('DATABASE_URL is not set. Database will fail.');

// Подключение к базе данных
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Создаем таблицу игроков при запуске (если ее нет)
pool.query(`
  CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    age INTEGER NOT NULL,
    tutorial_done BOOLEAN DEFAULT FALSE,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    crystals INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 100,
    mana INTEGER DEFAULT 50
  )
`).catch(err => console.error('DB Init Error:', err));

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
    validate(authData, BOT_TOKEN, { expiresIn: 3600 });
    const initData = parse(authData);
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

// Получение профиля (проверка регистрации)
app.get('/api/me', telegramAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM players WHERE telegram_id = $1', [req.telegramUser.id]);
    if (result.rows.length === 0) {
      return res.json({ registered: false, tgUser: req.telegramUser });
    }
    res.json({ registered: true, profile: result.rows[0], tgUser: req.telegramUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Регистрация нового игрока
app.post('/api/register', telegramAuth, async (req, res) => {
  const { nickname, age, tutorialDone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO players (telegram_id, nickname, age, tutorial_done) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.telegramUser.id, nickname, age, tutorialDone]
    );
    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
