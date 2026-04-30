# Uncord - Minimal Desktop Voice Chat

Минимальный аналог Discord на стеке React + Electron + mediasoup.

## Структура проекта
- `server/`: Сигнальный сервер на Node.js и SFU (mediasoup).
- `client/`: Десктопное приложение на React и Electron.

## Особенности
- Подключение по нику без регистрации.
- Комнаты для общения.
- Голосовой чат (Opus).
- Индикация активного спикера.
- Кнопка Mute.

## Запуск

### Сервер
```bash
cd server
npm install
node index.js
```

### Клиент
```bash
cd client
npm install
npm run dev
```
