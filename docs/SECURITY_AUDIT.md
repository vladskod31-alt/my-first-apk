# LIBO 2.8.3 — самопроверка безопасности

Чек-лист составлен по требованиям к «профессиональной архитектуре безопасности».
Статусы: **✅ реализовано**, **⚠️ частично**, **➖ не применимо к P2P-сборке / в плане**.
Каждый пункт ✅ подтверждён тестом или файлом кода — ссылки в колонке «Доказательство».

## Криптография

| Требование | Статус | Доказательство |
| --- | --- | --- |
| Только проверенные примитивы, без самодельной криптографии | ✅ | `web/lib/security.mjs` (imports `@noble/curves`, `@noble/ciphers`, WebCrypto); тест «primitives use OS CSPRNG…» |
| X25519 для обмена ключами | ✅ | `Ratchet`, `SecureSession.hello/acceptHello`; тест «key exchange derives the same root…» |
| Ed25519 для подписи | ✅ | `Identity.sign`, проверка в `acceptHello`/`openNow`; тесты «a third identity cannot join…», «invalid ciphertext…» |
| ChaCha20-Poly1305 (или проверенный AES-GCM) для сообщений | ✅ | `sealNow/openNow`; тест «encryption and decryption roundtrip…» |
| SHA-256/512, HKDF | ✅ | `sha256/sha512/hkdf`; тест «KDF is deterministic per input…» |
| Только CSPRNG ОС, без `Math.random` | ✅ | `randomBytes`, `x25519.utils.randomSecretKey`; тест «primitives use OS CSPRNG…» (проверяет отсутствие повторов) |
| Эфемерные ключи на чат/цепочку | ✅ | `SecureSession.ephemeral`, `Ratchet.newPair`, DH-шаг |
| Ротация ключей, срок жизни, rekey | ✅ | `LIMITS.MAX_CHAIN` (200), `CHAIN_MAX_AGE_MS` (12 ч), `rotateForSend/rotateForRecv`; тест «ratchet rotates the chain after the limit…» |
| Новый ключ после смены устройства | ✅ | новая идентичность → `IDENTITY_CHANGED` → `COMPROMISED`; тест «identity change stops the session…» |
| Forward secrecy через документированный Double Ratchet | ✅ | `Ratchet` (DH-шаг + цепочки ключей сообщений); тест «forward secrecy — old keys cannot decrypt…» |
| Поля конверта: version, messageId, conversationId, senderKeyId, recipientKeyId, timestamp, nonce, ciphertext, authenticationTag, signature | ✅ | `ENVELOPE_FIELDS`, `sealNow`; тест core «e2ee session seals, rejects replays and tampering…» |
| Открытый текст не уходит в сеть | ✅ | `transport.send()` возвращает `false`, пока сессия не установлена (пакет остаётся в очереди устройства) |
| Шифрование данных на устройстве, ключи не в открытом виде | ✅ | `web/lib/storage.mjs` (`RecordCipher`, AAD `libo/db/v3|<id>`), `KeyVault` |
| Мастер-ключ → ключ базы → зашифрованная база; мастер-ключа нет в APK | ⚠️ | `KeyVault` + Android Keystore (`MainActivity.sealLocalSecret/openLocalSecret`) — в APK ключей нет; **нужно проверить на устройстве** (в песочнице нет Android) |
| Argon2id для пароля вместо SHA256(password) | ⚠️ | `Password` использует PBKDF2-SHA-256 (600 000) — Argon2id недоступен в WebCrypto; план в `KNOWN_ISSUES.md` |
| Ограничение попыток и защита от перебора | ✅ | `RateLimiter`; тест «brute force protection limits attempts per key» (5/60 с для PIN, 60/60 с для отправки) |

## Аутентификация и сессии

| Требование | Статус | Доказательство |
| --- | --- | --- |
| Регистрация/вход/сессия/refresh/выход/управление устройствами | ➖ | серверной части в P2P-сборке нет; примитивы (`Password`, `RateLimiter`, `SessionState`) готовы |
| Короткоживущий access-токен, ротация refresh, отзыв | ➖ | то же; в клиенте есть отзыв сессии (`dropSession`, кнопка «Отозвать все сессии») |
| Управление устройствами (список, последняя активность, отзыв) | ➖ | серверный этап |
| Безопасные сообщения об ошибках пользователю | ✅ | `sanitizeError`; тест «user-facing errors never leak internals» |
| Не логировать секреты; отладка выключена в релизе | ✅ | `SecureLogger`; тест «secure logger redacts secrets and stays quiet in release» |

## Транспорт и приватность

| Требование | Статус | Доказательство |
| --- | --- | --- |
| HTTPS/WSS/TLS | ✅ | WebView грузит только `https://appassets.androidplatform.net`, `mixedContentMode = NEVER_ALLOW`, CSP запрещает `object/frame/form` извне |
| Отсутствие секретов в URL | ✅ | ключи передаются только внутри подписанного конверта; в URL — ничего |
| Безопасный pinning без «вечного» блокирования | ➖ | pinning сертификатов не реализован (нет собственного сервера) |
| Опциональный Tor/приватный транспорт | ➖ | в плане; E2EE работает и без него |
| Минимизация метаданных | ⚠️ | в конверт входит только необходимый минимум (см. `ENVELOPE_FIELDS`); сигнальный сервер всё ещё видит пары адресов |
| FLAG_SECURE для экранов с ключами/секретными чатами | ✅ | `MainActivity.setSecureScreen`, переключатель в настройках |
| QR только с одноразовым токеном сопряжения | ✅ | `PairingToken`; тест «pairing tokens are single use, expire and keep secrets out of the QR» |
| Проверка контакта (код/отпечаток, предупреждение при смене ключа) | ✅ | `fingerprintOf`, `securityCodeOf`, диалог безопасности; тесты «identity change…», «fingerprints and key labels…» |

## Данные и доверие

| Требование | Статус | Доказательство |
| --- | --- | --- |
| Сервер не доверяет данным клиента (роль, права, владение) | ✅ | серверных решений нет; клиент валидирует все входящие пакеты (`validatePacket`) |
| Отдельный админ-API и MFA | ➖ | серверный этап |
| Состояния сессии CONNECTING/CONNECTED/RECONNECTING/DISCONNECTED/REVOKED/COMPROMISED | ✅ | `SESSION_STATES`, `ALLOWED_TRANSITIONS`; тест «session states follow the documented transitions…» |
| Защита от повреждённых и чрезмерных конвертов | ✅ | `validatePacket`, `LIMITS`; тесты «malformed and oversized envelopes…», «invalid ciphertext…» |
| Защита от повторов | ✅ | `ReplayGuard`; тест «replay of a delivered envelope is refused» |

## Процесс

| Требование | Статус | Доказательство |
| --- | --- | --- |
| Автоматические тесты безопасности (шифрование, обмен, MITM, повторы, перебор, отзыв, чужие данные) | ✅ | `tests/security.test.mjs` — 25 тестов, `npm test` — 55/55 |
| Модель угроз «угроза/атака/защита/остаточный риск» | ✅ | `docs/THREAT_MODEL.md` |
| Таблица доказательств по функциям | ✅ | `docs/SECURITY_EVIDENCE.md` |
| Итоговые схемы архитектуры | ✅ | `SECURITY_ARCHITECTURE.md` §3–§4 |
| Не заявлять «система безопасна» до аудита | ✅ | формулировки в документах и UI соответствуют; внешний аудит не проводился |

## Как воспроизвести самопроверку

```bash
npm ci
npm test                 # 55 тестов (30 core + 25 security)
npm run test:e2e         # 11 сценариев, включая E2EE между двумя клиентами
```

Ожидаемый результат: все тесты зелёные. Если тест безопасности падает — релиз не
публикуется: `.github/workflows/android-ci.yml` запускает тесты перед сборкой APK.
