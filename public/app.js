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
const toastEl = document.getElementById('toast');
const profileModal = document.getElementById('profile-modal');
let currentProfile = null; // Храним профиль в памяти

// Функция красивых уведомлений
function showToast(message, isSuccess = false) {
  toastEl.textContent = message;
  toastEl.className = isSuccess ? 'success show' : 'show';
  setTimeout(() => { toastEl.className = ''; }, 3000);
}

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
  const btn = document.getElementById('btn-register');
  
  btn.addEventListener('click', async () => {
    const nick = document.getElementById('reg-nickname').value.trim();
    const age = parseInt(document.getElementById('reg-age').value);
    const tut = document.getElementById('reg-tutorial').checked;

    if (!nick) return showToast('Введите никнейм!');
    if (!age || age < 10) return showToast('Введите корректный возраст (от 10 лет)!');

    btn.disabled = true;
    btn.textContent = 'Создание...';

    try {
      const res = await apiFetch('/api/register', {
        method: 'POST',
        body: JSON.stringify({ nickname: nick, age: age, tutorialDone: tut })
      });
      
      regScreen.style.display = 'none';
      showToast('Аккаунт успешно создан!', true);
      showMain(res.profile, tgUser);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Создать аккаунт';
    }
  });
}

function showMain(profile, tgUser) {
  mainScreen.style.display = 'flex';
  currentProfile = profile;
  
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

  // Настройка модального окна
  document.getElementById('open-profile-btn').addEventListener('click', () => {
    document.getElementById('edit-nickname-input').value = currentProfile.nickname;
    profileModal.style.display = 'flex';
  });

  document.getElementById('close-profile').addEventListener('click', () => {
    profileModal.style.display = 'none';
  });

  document.getElementById('btn-save-nickname').addEventListener('click', async () => {
    const newNick = document.getElementById('edit-nickname-input').value.trim();
    if (!newNick) return showToast('Никнейм не может быть пустым');
    
    try {
      const res = await apiFetch('/api/profile/nickname', {
        method: 'PUT',
        body: JSON.stringify({ nickname: newNick })
      });
      currentProfile = res.profile;
      document.getElementById('ui-nickname').textContent = res.profile.nickname;
      profileModal.style.display = 'none';
      showToast('Никнейм изменен', true);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (!confirm('Вы уверены? Весь ваш прогресс (карты, ресурсы, уровень) будет УДАЛЕН безвозвратно.')) return;
    
    try {
      await apiFetch('/api/profile', { method: 'DELETE' });
      location.reload(); // Перезагружаем страницу, чтобы показать экран регистрации
    } catch (err) {
      showToast('Ошибка выхода: ' + err.message);
    }
  });
}

init();
