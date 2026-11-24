# Telegram WebSocket Proxy via Cloudflare Worker

Готовый проект для автоматического деплоя персонального Cloudflare Worker'а через **GitHub Actions** и настройки локальных/мобильных клиентов **`tg-ws-proxy`**.

---

## 🚀 Как это работает

1. Трафик Telegram упаковывается клиентом `tg-ws-proxy` в обычные WebSocket-кадры.
2. Соединение идёт на **порт 80 (HTTP/WS)** к вашему персональному воркеру на `*.workers.dev` (обходит блокировки и замедления TLS на ТСПУ/РКН).
3. Воркер на серверах Cloudflare (в Европе) пересылает данные напрямую в дата-центры Telegram по прямому TCP-сокету (`connect({ hostname, port: 443 })`).
4. При любом изменении кода в репозитории **GitHub Actions** автоматически публикует обновлённую версию в ваш Cloudflare через официальный экшен `cloudflare/wrangler-action`.

---

## 🛠️ Быстрый старт: Настройка деплоя за 3 шага

### Шаг 1. Создайте репозиторий на GitHub
1. Создайте новый репозиторий (например, `tg-ws-worker`) у себя на GitHub (можно приватный).
2. Склонируйте или загрузите в него файлы из этого каталога:
   - `worker.js`
   - `wrangler.toml`
   - `.github/workflows/deploy.yml`

### Шаг 2. Получите API Token и Account ID в Cloudflare
1. **Account ID:**
   * Зайдите в [dash.cloudflare.com](https://dash.cloudflare.com/).
   * В боковом меню перейдите в **Compute (Workers & Pages)**.
   * Справа в блоке *Account ID* скопируйте ваш идентификатор (32-значная строка).
2. **API Token:**
   * Нажмите на иконку своего профиля в правом верхнем углу → **My Profile** → **API Tokens** (или перейдите по ссылке [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)).
   * Нажмите кнопку **Create Token**.
   * Выберите шаблон **Edit Cloudflare Workers** → нажмите *Use template*.
   * В блоке *Account Resources* выберите `All accounts` (или ваш аккаунт).
   * Нажмите внизу **Continue to summary** → **Create Token**.
   * Скопируйте сгенерированный токен (он показывается только один раз).

### Шаг 3. Добавьте секреты в репозиторий GitHub
1. В вашем репозитории на GitHub перейдите во вкладку **Settings** → **Secrets and variables** → **Actions**.
2. Нажмите **New repository secret** и добавьте два секрета:
   * Имя: `CLOUDFLARE_API_TOKEN` → Значение: *токен из Шага 2*
   * Имя: `CLOUDFLARE_ACCOUNT_ID` → Значение: *Account ID из Шага 2*
3. Перейдите во вкладку **Actions** на GitHub → выберите воркфлоу **Deploy to Cloudflare Workers** → нажмите **Run workflow**.
4. После завершения деплоя в выводе экшена или в панели Cloudflare вы увидите URL вашего воркера:
   ```
   https://tg-ws-proxy.<ваш-субдомен>.workers.dev
   ```

---

## 💻 Настройка клиентов (ПК: Windows / Linux)

1. Установите `tg-ws-proxy` (версия 1.12.0 или выше) из [репозитория Flowseal](https://github.com/Flowseal/tg-ws-proxy/releases).
2. Откройте файл настроек:
   * **Windows:** `%APPDATA%\TgWsProxy\config.json`
   * **Linux:** `~/.config/TgWsProxy/config.json`
3. Скопируйте настройки из `config.template.json` и укажите ваш домен:
   ```json
   {
     "port": 1443,
     "host": "127.0.0.1",
     "dc_ip": [],
     "verbose": false,
     "check_updates": true,
     "log_max_mb": 5.0,
     "buf_kb": 512,
     "pool_size": 8,
     "cfproxy": true,
     "h2": true,
     "cfproxy_user_domain_enabled": false,
     "cfproxy_user_domain": [],
     "cfproxy_worker_enabled": true,
     "cfproxy_worker_domain": [
       "tg-ws-proxy.ВАШ-СУБДОМЕН.workers.dev"
     ],
     "force_test_dc": false,
     "no_secure": true,
     "secret": "a4a7742002abe25d7c63a01f571ffcfb",
     "language": "ru",
     "ws_keepalive_interval": 30
   }
   ```
4. **Важные параметры:**
   * `"no_secure": true` — переключает подключение на порт 80 (HTTP/WS), спасает от сброса TLS-рукопожатий.
   * `"pool_size": 8` — расширяет пул соединений, предотвращая «залипание» при открытии тяжёлых чатов с большим количеством аватарок.
   * `"buf_kb": 512` — ускоряет прокачку больших пакетов истории.
   * `"dc_ip": []` — должен быть пустым, чтобы не вызывать зацикливание на недоступных IP.

---

## 📱 Настройка для мобильных устройств (Android / iOS)

### Вариант 1. Мобильный форк `tg-ws-proxy` (Android)
Если вы используете мобильный клиент/форк с поддержкой WebSocket-прокси (например, Android-сборки на базе Termux / мобильного моста):
* В настройках клиента укажите адрес вашего воркера: `tg-ws-proxy.<ваш-субдомен>.workers.dev`.
* Порт: `80` (HTTP).
* Путь API: `/apiws`.
* Протокол: `ws://` (не зашифрованный, так как внутри MTProto уже зашифрован Telegram'ом).

### Вариант 2. Домашний Wi-Fi через компьютер
Если компьютер включен, телефон дома может выходить в Telegram через него:
1. В `config.json` на компьютере укажите `"host": "0.0.0.0"`.
2. В Telegram на смартфоне перейдите: **Настройки → Данные и память → Прокси → Добавить MTProto-прокси**:
   * **Сервер:** Локальный IP вашего ПК (например, `192.168.1.50`)
   * **Порт:** `1443`
   * **Ключ:** `dda4a7742002abe25d7c63a01f571ffcfb`

---

## 💡 Особенности реализации воркера (`worker.js`)
* В стандартном примере из репозиториев запись в TCP-сокет выполняется асинхронно без очереди, что приводит к падению соединений (`tcp write failed`) при скачивании или отправке картинок.
* В данном коде реализована **строгая асинхронная очередь (`writeQueue`)**: любые параллельные пакеты Telegram пишутся последовательно, исключая коллизии и разрывы сессий.
* Поддерживаются все типы бинарных данных (`ArrayBuffer`, `Uint8Array`, `Blob`).
