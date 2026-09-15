# Свой signaling- и TURN-сервер для LIBO

По умолчанию LIBO использует публичный PeerJS-сервер `0.peerjs.com` и публичные
STUN-серверы. Это удобно, но доступность чужого сервиса не гарантирована, а его
оператор видит метаданные соединений (кто и когда устанавливал связь, но не содержимое
сообщений: трафик WebRTC шифруется DTLS между устройствами). Свой сервер убирает обе
проблемы.

Сигнальный сервер передаёт только служебные адреса для установления P2P-соединения.
TURN нужен лишь тогда, когда прямой канал невозможен (строгий NAT, часть мобильных
сетей и корпоративных VPN); при наличии TURN трафик идёт через него в шифрованном виде.

## 1. Сигнальный сервер PeerJS

Нужен домен с TLS: LIBO принимает только `https://` (и `wss://`) для signaling.

### Вариант А: systemd-служба и Caddy

```sh
# На сервере (Debian/Ubuntu)
sudo apt install nodejs npm caddy
sudo npm install --global peer
sudo useradd --system --home /srv/peerjs peerjs
```

Файл службы `/etc/systemd/system/peerjs.service`:

```ini
[Unit]
Description=PeerJS signaling for LIBO
After=network.target

[Service]
User=peerjs
ExecStart=/usr/local/bin/peerjs --port 9000 --path /peerjs --key peerjs --allow_discovery false
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now peerjs
```

Файл Caddy `/etc/caddy/Caddyfile` (TLS выдаётся автоматически):

```text
signal.example.org {
    reverse_proxy /peerjs/* localhost:9000
}
```

```sh
sudo systemctl reload caddy
```

Проверка: `curl -fsS https://signal.example.org/peerjs` отвечает строкой вида
`{"name":"PeerJS Server",...}`.

### Вариант Б: docker compose

```yaml
services:
  peerjs:
    image: peerjs/peerjs-server:latest
    command: ["-port", "9000", "-path", "/peerjs", "-key", "peerjs"]
    ports:
      - "127.0.0.1:9000:9000"
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped
volumes:
  caddy_data:
```

Тот же `Caddyfile`, что в варианте А.

## 2. TURN-сервер (coturn)

```sh
sudo apt install coturn
```

`/etc/turnserver.conf` (минимально безопасный набор):

```text
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=<внутренний IP сервера>
external-ip=<публичный IP>/<внутренний IP>
min-port=49152
max-port=49252
realm=turn.example.org
cert=/etc/letsencrypt/live/turn.example.org/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.org/privkey.pem
no-cli
no-tcp-relay
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
use-auth-secret
static-auth-secret=<сгенерируйте: openssl rand -hex 32>
```

```sh
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
# Откройте в фаерволе: 3478/tcp+udp, 5349/tcp, 49152-49252/udp
```

Учётные данные с общим секретом выдаются командой (срок 24 часа):

```sh
TURN_USER=$(date -u +%s --date='+24 hours'):libo
TURN_PASSWORD=$(echo -n "$TURN_USER" | openssl dgst -sha1 -hmac "<static-auth-secret>" -binary | base64)
echo "turns:turn.example.org:5349?transport=tcp  $TURN_USER  $TURN_PASSWORD"
```

Блоки `denied-peer-ip` не дают TURN-серверу стать прокси во внутреннюю сеть. Для
постоянных пользователей удобнее выдавать отдельные пары логин/пароль (`turnadmin -a`)
и ротировать их.

## 3. Настройка LIBO

На обоих устройствах: «Настройки → Подключение».

- Адрес signaling: `https://signal.example.org/peerjs/` (обязательно с завершающим
  `/` и без логина, параметров и `#` — приложение отклонит такой адрес).
- TURN: `turns:turn.example.org:5349?transport=tcp`, имя пользователя и пароль из
  шага 2. Поля TURN обязательны все три, иначе настройка не сохранится.
- Сохраните и дождитесь статуса «Вы в сети». Повторите на втором устройстве.

## 4. Проверка

1. Signaling: оба устройства показывают «Вы в сети» с вашим адресом; код сверки в меню
   чата совпадает на обеих сторонах.
2. TURN: откройте страницу проверки TURN (например, «Trickle ICE» на
   `webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`), добавьте ваш
   `turns:`-адрес с учётными данными — в списке кандидатов должны появиться записи типа
   `relay`.
3. Строгий NAT: подключите одно устройство через мобильную сеть без Wi-Fi. Если чат
   работает при выключенном Wi-Fi с обеих сторон, TURN подобран верно.

## 5. Частые ошибки

- «Сигнальному серверу нужен адрес HTTPS» — указан `http://` или адрес без домена TLS.
- Код не совпадает у собеседников — устройства используют разные настройки signaling
  (проверьте оба) или один из них остался на публичном сервере.
- Соединение «Ищем собеседника…» бесконечно при разных сетях — не хватает TURN или
  закрыты UDP-порты реле; включите `turns:` с `?transport=tcp`.
- 404 от signaling — в адресе нет завершающего `/` или путь не совпадает с `--path`.
