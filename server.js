import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validate, parse } from '@tma.js/init-data-node';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) console.warn('BOT_TOKEN is not set.');
if (!DATABASE_URL) console.warn('DATABASE_URL is not set.');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    nickname VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL,
    tutorial_done BOOLEAN DEFAULT FALSE,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    crystals INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 100,
    mana INTEGER DEFAULT 50,
    badge VARCHAR(50) DEFAULT NULL,
    avatar_url TEXT DEFAULT NULL
  )
`).catch(err => console.error('DB Init Error:', err));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

const hashPassword = (pass) => crypto.createHash('sha256').update(pass).digest('hex');

function telegramAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [authType, authData = ''] = authHeader.split(' ');

  if (authType !== 'tma' || !authData) {
    return res.status(401).json({ error: 'Unauthorized: missing initData' });
  }

  try {
    validate(authData, BOT_TOKEN, { expiresIn: 3600 });
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid initData', details: err.message });
  }
}

async function playerAuth(req, res, next) {
  const playerId = req.headers['x-player-id'];
  if (!playerId) return res.status(401).json({ error: 'Не авторизован' });

  try {
    const result = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Аккаунт не найден' });
    req.player = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/register', telegramAuth, async (req, res) => {
  const { nickname, password, age, tutorialDone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO players (nickname, password_hash, age, tutorial_done) VALUES ($1, $2, $3, $4) RETURNING id, nickname, level, xp, crystals, coins, mana, avatar_url',
      [nickname, hashPassword(password), age, tutorialDone]
    );
    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Этот никнейм уже занят' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', telegramAuth, async (req, res) => {
  const { nickname, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM players WHERE nickname = $1', [nickname]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Аккаунт не найден' });
    
    const player = result.rows[0];
    if (player.password_hash !== hashPassword(password)) {
      return res.status(400).json({ error: 'Неверный пароль' });
    }
    
    delete player.password_hash;
    res.json({ success: true, profile: player });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', telegramAuth, playerAuth, (req, res) => {
  const player = req.player;
  delete player.password_hash;
  res.json({ success: true, profile: player });
});

app.put('/api/profile/nickname', telegramAuth, playerAuth, async (req, res) => {
  const { nickname } = req.body;
  try {
    const result = await pool.query(
      'UPDATE players SET nickname = $1 WHERE id = $2 RETURNING nickname',
      [nickname.trim(), req.player.id]
    );
    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Этот никнейм уже занят' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile/password', telegramAuth, playerAuth, async (req, res) => {
  const { newPassword } = req.body;
  try {
    await pool.query('UPDATE players SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), req.player.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile/avatar', telegramAuth, playerAuth, async (req, res) => {
  const { avatarBase64 } = req.body;
  try {
    const result = await pool.query(
      'UPDATE players SET avatar_url = $1 WHERE id = $2 RETURNING avatar_url',
      [avatarBase64, req.player.id]
    );
    res.json({ success: true, avatar_url: result.rows[0].avatar_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить инвентарь игрока
app.get('/api/inventory', telegramAuth, playerAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT inv.id as inv_id, inv.level, c.* 
      FROM player_inventory inv
      JOIN cards c ON inv.card_id = c.id
      WHERE inv.player_id = $1
      ORDER BY inv.id DESC
    `, [req.player.id]);
    res.json({ success: true, cards: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Открыть бесплатный кейс (для теста)
app.post('/api/shop/open', telegramAuth, playerAuth, async (req, res) => {
  try {
    // Выбираем случайную карту (пока просто случайную из всех)
    const cardResult = await pool.query('SELECT id FROM cards ORDER BY RANDOM() LIMIT 1');
    if (cardResult.rows.length === 0) return res.status(500).json({ error: 'База карт пуста' });
    
    const cardId = cardResult.rows[0].id;
    
    // Добавляем в инвентарь
    await pool.query('INSERT INTO player_inventory (player_id, card_id) VALUES ($1, $2)', [req.player.id, cardId]);
    
    res.json({ success: true, message: 'Карта добавлена в инвентарь!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});