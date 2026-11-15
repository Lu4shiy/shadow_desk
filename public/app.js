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
  const playerId = localStorage.getItem('playerId');
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `tma ${tg.initData}`,
      'Content-Type': 'application/json',
      ...(playerId ? { 'X-Player-Id': playerId } : {}),
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
const confirmModal = document.getElementById('confirm-modal');
let currentProfile = null;
let isRegisterMode = true; // По умолчанию экран регистрации

// Функция красивых уведомлений
function showToast(message, isSuccess = false) {
  toastEl.textContent = message;
  toastEl.className = isSuccess ? 'success show' : 'show';
  setTimeout(() => { toastEl.className = ''; }, 3000);
}

async function init() {
  try {
    await preloadImages(ASSETS_TO_PRELOAD);
    
    // Проверяем наличие сохраненного ID
    const playerId = localStorage.getItem('playerId');
    if (playerId) {
      try {
        const data = await apiFetch('/api/me');
        loadScreen.style.display = 'none';
        showMain(data.profile);
        return;
      } catch (err) {
        // Если аккаунт не найден (например, база сброшена), удаляем ID
        localStorage.removeItem('playerId');
      }
    }
    
    // Если не авторизован - показываем экран входа
    loadScreen.style.display = 'none';
    showRegister();
  } catch (err) {
    document.getElementById('loading-screen').innerHTML = `<p style="color:red">Ошибка: ${err.message}</p>`;
  }
}

function showRegister() {
  regScreen.style.display = 'flex';
  const btn = document.getElementById('btn-auth');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');
  const ageGroup = document.getElementById('age-group');
  const tutorialGroup = document.getElementById('tutorial-group');
  const title = document.getElementById('auth-title');

  // Переключение вкладок
  tabLogin.addEventListener('click', () => {
    isRegisterMode = false;
    title.textContent = 'Вход в аккаунт';
    ageGroup.style.display = 'none';
    tutorialGroup.style.display = 'none';
    tabLogin.style.background = 'linear-gradient(135deg, #9b59b6, #71368a)';
    tabLogin.style.boxShadow = '0 4px 15px rgba(155, 89, 182, 0.4)';
    tabReg.style.background = '#333';
    tabReg.style.boxShadow = 'none';
    btn.textContent = 'Войти';
  });

  tabReg.addEventListener('click', () => {
    isRegisterMode = true;
    title.textContent = 'Создание профиля';
    ageGroup.style.display = 'block';
    tutorialGroup.style.display = 'flex';
    tabReg.style.background = 'linear-gradient(135deg, #9b59b6, #71368a)';
    tabReg.style.boxShadow = '0 4px 15px rgba(155, 89, 182, 0.4)';
    tabLogin.style.background = '#333';
    tabLogin.style.boxShadow = 'none';
    btn.textContent = 'Создать аккаунт';
  });

  btn.addEventListener('click', async () => {
    const nick = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;
    const age = parseInt(document.getElementById('reg-age').value);
    const tut = document.getElementById('reg-tutorial').checked;

    if (!nick) return showToast('Введите никнейм!');
    if (!password) return showToast('Введите пароль!');
    
    if (isRegisterMode) {
      if (!age || age < 10) return showToast('Введите корректный возраст (от 10 лет)!');
    }

    btn.disabled = true;
    btn.textContent = 'Загрузка...';

    try {
      const endpoint = isRegisterMode ? '/api/register' : '/api/login';
      const payload = isRegisterMode ? { nickname: nick, password, age, tutorialDone: tut } : { nickname: nick, password };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      localStorage.setItem('playerId', res.profile.id); // Сохраняем сессию
      regScreen.style.display = 'none';
      showToast(isRegisterMode ? 'Аккаунт создан!' : 'Успешный вход!', true);
      showMain(res.profile);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
      btn.disabled = false;
      btn.textContent = isRegisterMode ? 'Создать аккаунт' : 'Войти';
    }
  });
}

function showMain(profile) {
  mainScreen.style.display = 'flex';
  currentProfile = profile;
  
  // Устанавливаем аватарку (из БД или дефолтную)
  const avatarImg = document.getElementById('ui-avatar');
  if (profile.avatar_url) {
    avatarImg.src = profile.avatar_url;
  } else if (tg.initDataUnsafe?.user?.photo_url) {
    avatarImg.src = tg.initDataUnsafe.user.photo_url;
  } else {
    avatarImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='; // Черный пиксель
  }

  document.getElementById('ui-nickname').textContent = profile.nickname;
  document.getElementById('ui-id').textContent = profile.id;
  document.getElementById('ui-level').textContent = profile.level;
  document.getElementById('ui-xp').textContent = profile.xp;
  
  const maxXp = profile.level * 1000; 
  document.getElementById('ui-max-xp').textContent = maxXp;
  
  document.getElementById('ui-crystals').textContent = profile.crystals;
  document.getElementById('ui-coins').textContent = profile.coins;
  document.getElementById('ui-mana').textContent = profile.mana;

  // Настройка модального окна
  document.getElementById('open-profile-btn').onclick = () => {
    document.getElementById('edit-nickname-input').value = currentProfile.nickname;
    document.getElementById('edit-password-input').value = '';
    profileModal.style.display = 'flex';
  };

  document.getElementById('close-profile').onclick = () => profileModal.style.display = 'none';

  // Смена никнейма
  document.getElementById('btn-save-nickname').onclick = async () => {
    const newNick = document.getElementById('edit-nickname-input').value.trim();
    if (!newNick) return showToast('Никнейм не может быть пустым');
    
    try {
      const res = await apiFetch('/api/profile/nickname', {
        method: 'PUT',
        body: JSON.stringify({ nickname: newNick })
      });
      currentProfile.nickname = res.profile.nickname;
      document.getElementById('ui-nickname').textContent = res.profile.nickname;
      showToast('Никнейм изменен', true);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  };

  // Смена пароля
  document.getElementById('btn-save-password').onclick = async () => {
    const newPass = document.getElementById('edit-password-input').value;
    if (!newPass || newPass.length < 4) return showToast('Пароль должен быть от 4 символов');
    
    try {
      await apiFetch('/api/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ newPassword: newPass })
      });
      document.getElementById('edit-password-input').value = '';
      showToast('Пароль изменен', true);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  };

  // Загрузка аватарки
  document.getElementById('avatar-upload').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) return showToast('Файл слишком большой (макс. 2 МБ)');

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result;
      try {
        const res = await apiFetch('/api/profile/avatar', {
          method: 'PUT',
          body: JSON.stringify({ avatarBase64: base64 })
        });
        currentProfile.avatar_url = res.avatar_url;
        avatarImg.src = res.avatar_url;
        showToast('Аватарка обновлена', true);
      } catch (err) {
        showToast('Ошибка: ' + err.message);
      }
    };
    reader.readAsDataURL(file);
  };

  // Кастомный выход
  document.getElementById('btn-logout').onclick = () => {
    document.getElementById('confirm-text').textContent = 'Вы уверены, что хотите выйти? Ваш прогресс сохранится, вы сможете войти снова.';
    confirmModal.style.display = 'flex';
  };

  document.getElementById('btn-confirm-cancel').onclick = () => confirmModal.style.display = 'none';
  document.getElementById('btn-confirm-ok').onclick = () => {
    localStorage.removeItem('playerId');
    location.reload();
  };
}

init();
