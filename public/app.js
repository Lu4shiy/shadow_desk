const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Список картинок для предзагрузки
const ASSETS_TO_PRELOAD = [
  '/img/crystal.png',
  '/img/coin.png',
  '/img/mana.png'
];

// Функция предзагрузки картинок
function preloadImages(urls) {
  return Promise.all(urls.map(url => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // Игнорируем ошибки, чтобы игра запустилась даже без картинок
      img.src = url;
    });
  }));
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `tma ${tg.initData}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

// UI Элементы
const loadScreen = document.getElementById('loading-screen');
const regScreen = document.getElementById('register-screen');
const mainScreen = document.getElementById('main-screen');

async function init() {
  try {
    // 1. Загружаем картинки (имитируем задержку для красоты)
    await preloadImages(ASSETS_TO_PRELOAD);
    
    // 2. Проверяем аккаунт
    const data = await apiFetch('/api/me');
    
    // Скрываем экран загрузки
    loadScreen.style.opacity = '0';
    setTimeout(() => loadScreen.style.display = 'none', 500);

    if (!data.registered) {
      showRegister(data.tgUser);
    } else {
      showMain(data.profile, data.tgUser);
    }
  } catch (err) {
    document.getElementById('loading-screen').innerHTML = `<p style="color:red">Ошибка: ${err.message}</p>`;
  }
}

function showRegister(tgUser) {
  regScreen.style.display = 'flex';
  
  document.getElementById('btn-register').addEventListener('click', async () => {
    const nick = document.getElementById('reg-nickname').value.trim();
    const age = parseInt(document.getElementById('reg-age').value);
    const tut = document.getElementById('reg-tutorial').checked;

    if (!nick || !age) return alert('Заполните все поля!');

    try {
      const res = await apiFetch('/api/register', {
        method: 'POST',
        body: JSON.stringify({ nickname: nick, age: age, tutorialDone: tut })
      });
      
      regScreen.style.display = 'none';
      showMain(res.profile, tgUser);
    } catch (err) {
      alert('Ошибка регистрации: ' + err.message);
    }
  });
}

function showMain(profile, tgUser) {
  mainScreen.style.display = 'flex';
  
  // Аватарка Telegram (если есть)
  if (tgUser.photo_url) {
    document.getElementById('ui-avatar').src = tgUser.photo_url;
  }

  document.getElementById('ui-nickname').textContent = profile.nickname;
  document.getElementById('ui-id').textContent = profile.id;
  document.getElementById('ui-level').textContent = profile.level;
  document.getElementById('ui-xp').textContent = profile.xp;
  
  // Считаем опыт для следующего уровня (1 уровень = 1000 опыта)
  const maxXp = profile.level * 1000; 
  document.getElementById('ui-max-xp').textContent = maxXp;
  
  document.getElementById('ui-crystals').textContent = profile.crystals;
  document.getElementById('ui-coins').textContent = profile.coins;
  document.getElementById('ui-mana').textContent = profile.mana;
}

init();
