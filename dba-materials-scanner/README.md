# DBA Materials Scanner

Невеликий Ruby-сканер, який знаходить нові матеріали у RSS/Atom/JSON Feed-стрічці або на публічній HTML-сторінці, зберігає побачені записи у JSON і надсилає сповіщення в консоль, на JSON webhook та/або в Telegram.

> **Потрібне налаштування джерела:** у запиті не було URL DBA. Тому сканер зроблено універсальним: перед запуском вкажіть адресу стрічки/сторінки в `DBA_SOURCE_URL`. Він не підключений до конкретного порталу чи приватного облікового запису. Для HTML-сторінки можуть знадобитися CSS-селектори з документації нижче.

## Вимоги

- Ruby 3.1 або новіший
- Bundler
- Для HTML-режиму — Nokogiri (встановлюється через Bundler)

## Швидкий запуск

```sh
cd dba-materials-scanner
bundle install
cp .env.example .env
```

Заповніть значення і передайте їх процесу через середовище (сам файл `.env` навмисно не читається автоматично і не комітиться):

```sh
export DBA_SOURCE_URL='https://example.org/feed.xml'
export DBA_MODE=auto
bundle exec ruby bin/dba-scanner
```

Одноразовий запуск — типовий режим. Для періодичної перевірки, наприклад, кожні 15 хвилин:

```sh
bundle exec ruby bin/dba-scanner --interval 900
```

Або встановіть `DBA_INTERVAL_SECONDS=900`. Процес має працювати постійно; для фонового запуску використовуйте systemd, контейнер або інший менеджер процесів.

## Формати джерел

- **RSS/Atom або JSON Feed:** встановіть `DBA_MODE=feed` або залиште `auto`.
- **HTML:** встановіть `DBA_MODE=html` і, якщо потрібно, задайте селектори. Приклад для сторінки зі статтями:

```sh
export DBA_SOURCE_URL='https://example.org/materials'
export DBA_MODE=html
export DBA_ITEM_SELECTOR='article.material'
export DBA_TITLE_SELECTOR='h2'
export DBA_LINK_SELECTOR='a[href]'
export DBA_DATE_SELECTOR='time[datetime]'
bundle exec ruby bin/dba-scanner
```

HTML-парсер бере кожен елемент `DBA_ITEM_SELECTOR`, знаходить у ньому посилання й заголовок та нормалізує відносні посилання. Для іншої розмітки замініть селектори. Сканер читає лише публічну сторінку; вхід у приватні кабінети й сесійні cookies не налаштовані.

## Сповіщення

Якщо канал не налаштовано, нові матеріали друкуються в stdout.

**JSON webhook** — сканер надсилає POST з `Content-Type: application/json`:

```json
{
  "event": "new_material",
  "source_url": "https://example.org/feed.xml",
  "title": "Назва матеріалу",
  "url": "https://example.org/materials/123",
  "published_at": "2026-10-10T09:00:00Z"
}
```

Задайте `DBA_NOTIFY_WEBHOOK_URL`. Webhook має повертати HTTP 2xx.

**Telegram** — задайте обидві змінні `DBA_TELEGRAM_BOT_TOKEN` і `DBA_TELEGRAM_CHAT_ID`. Секрети тримайте у змінних середовища/секретах CI; не додавайте їх до `.env.example`, репозиторію, Drive чи Linear.

Можна налаштувати і webhook, і Telegram одночасно. Доставка виконується перед збереженням ID, тож при тимчасовій помилці запис буде повторно спробувано; за часткового успіху можливе повторне сповіщення в каналі, який уже прийняв повідомлення.

## Перший запуск і стан

Перший запуск за замовчуванням створює базову копію поточних матеріалів і **не** надсилає сповіщення про старі записи. Нові матеріали повідомляються при наступних запусках. Щоб отримати сповіщення про всі матеріали вже під час першого запуску, додайте `--notify-existing`.

Ідентифікатори зберігаються в `data/seen.json` (можна змінити через `DBA_STATE_FILE` або `--state`). Не видаляйте цей файл, якщо хочете зберегти дедуплікацію. Він не має містити секретів.

## Параметри

```text
--source URL              URL джерела (або DBA_SOURCE_URL)
--mode auto|feed|html      Тип джерела
--state PATH               Файл стану
--interval SECONDS         Інтервал опитування; 0 = один запуск
--timeout SECONDS          Тайм-аут HTTP-запиту
--webhook URL              JSON webhook
--notify-existing          Сповістити про поточні записи під час першого запуску
--item-selector CSS        CSS-селектор матеріалів у HTML
--title-selector CSS       CSS-селектор заголовка
--link-selector CSS        CSS-селектор посилання
--date-selector CSS        CSS-селектор дати
--help                     Показати довідку
```

Ліміти: HTTP-відповідь до 2 MiB, не більше трьох перенаправлень, не більше 5 000 ID у файлі стану.

## Тести

```sh
bundle exec rake test
```
