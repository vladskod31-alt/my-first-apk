# LIBO Advertising API v1 — 2.8.9.1

Це власний self-hosted API, не Telegram Ads/AdMob. Сервер **не розгорнуто публічно автоматично**. APK містить клієнт, а `server/` — код сервера. Немає рекламного доходу, білінгу або справжніх винагород за покази. Події недовірені й можуть бути підроблені: не використовуйте їх для виплат.

## Запуск

```sh
npm ci
mkdir -p ads-data
cp docs/examples/campaigns.json ads-data/campaigns.json
export LIBO_ADS_FILE="$PWD/ads-data/campaigns.json"
# Генерується лише на вашому сервері; не зберігайте в Git/чаті/APK.
export LIBO_ADS_ADMIN_TOKEN="$(openssl rand -hex 32)"
export LIBO_ADS_ORIGINS='https://appassets.androidplatform.net,https://your-web-app.example'
PORT=8787 npm run ads:serve
```

Сервер слухає `0.0.0.0:8787`. Для публічного доступу потрібен TLS reverse proxy, firewall, контроль доступу й резервне копіювання `ads-data`. Рекламний API URL у застосунку: `https://your-domain.example/api/ads/v1`, без query/пароля/токена. Налаштуйте власний домен/CORS. Токен адміністратора ніколи не вводиться у клієнт LIBO.

У dev preview є **порожній read-only API** `/api/ads/v1`; це не публікація кампаній і не адміністративний сервер. Публічний self-hosted сервер запускається окремою командою вище. Для роботи за reverse proxy поточний rate limiter рахує IP без довіри до `X-Forwarded-For`: якщо всі запити бачаться як один proxy IP, установіть зовнішній rate limiter; не вмикайте довіру до довільних proxy-заголовків.

## Контракт

| Метод і шлях від `/api/ads/v1` | Доступ | Результат |
|---|---|---|
| `GET /health` | public | версія, experimental, monetaryValue=false |
| `GET /campaigns` | public | `{version:1,campaigns:[...]}`; лише активні зараз |
| `POST /events` | public, optional consent у клієнті | `{campaignId,type:"impression"|"click"}` → 202, billable=false |
| `PUT /campaigns/:id` | Bearer admin token | створення/заміна валідованої кампанії, ID мають збігатися |
| `DELETE /campaigns/:id` | Bearer admin token | видалення → 204 |
| `GET /stats` | Bearer admin token | агрегати в пам’яті, скидаються після рестарту |

Немає cookie-auth, балансів користувачів, платежів, purchase verification або API Telegram. Без токена довжиною ≥32 символи й шляху файлу адміністрування вимкнене (503); неправильний токен — 401. Потрібно заздалегідь створити JSON-файл, хоча б `[]`. Записи серіалізовані та замінюють файл атомарно в межах **одного процесу**; кілька процесів на одному файлі не підтримуються.

Формат кампанії: `docs/examples/campaigns.json`. `start/end` — Unix milliseconds UTC, `dailyCap` 1–20, `cooldownMinutes` 1–1440, `weight` 1–10. `title` ≤80, `text` ≤280, `sponsor` ≤80. Посилання — HTTPS без вбудованих облікових даних. Зображення — лише вбудоване data URL PNG/JPEG/WebP, ≤120000 символів. HTML не виконується. Зовнішні зображення/пікселі та SVG відхиляються. Ліміт файлу/відповіді — 256000 байтів, до 50 кампаній сервера / 20 локальних. Рекомендовано компактний JSON.

Приклад публікації (захищений токен уже в середовищі адміністратора):

```sh
# campaign.json — один об’єкт кампанії, не масив. Укажіть enabled:true.
curl --fail -X PUT 'https://your-domain.example/api/ads/v1/campaigns/my-offer' \
  -H "Authorization: Bearer $LIBO_ADS_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @campaign.json
```

## Приватність та ліміти

- Покази й мережеві запити вимкнені, поки користувач явно не дозволить їх у студії.
- Статистика має окрему згоду, за замовчуванням вимкнена. У тілі лише ID кампанії й тип події. Немає peer ID, fingerprint, гаманця, текстів чатів або постійного ad ID.
- HTTP-сервер/proxy бачить IP з’єднання. Rate limiter тимчасово використовує її до хвилини; IP не додається у статистику. Власник хостингу відповідає за access logs і політику приватності.
- Вибір за розкладом, вагою, локальним cap і cooldown. Не профілюємо за змістом листування. Картка лише на welcome, не в чаті. Premium приховує рекламу та припиняє feed-запити.
- Видимий показ рахується після ≥50% картки протягом 1 с без відкритого діалогу; це не незалежна перевірка видимості/антифрод. Локальні ліміти можна обійти очищенням даних/зміною годинника.
- До 120 запитів/хв на socket IP, до 1000 IP у rate map. Це базовий захист, не заміна reverse proxy/WAF.
- Помилка API, завелика або некоректна відповідь → без реклами; приватні чати продовжують працювати.
