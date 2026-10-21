# AgroRadar AI — MVP 0.1

Демонстрационная платформа мониторинга полей для IT-спринта (кейс Русагро).

## Важно о данных
- Все 4 поля, культуры, площади и координаты — **вымышленные демонстрационные объекты**.
- Без API-ключа погода — **вымышленные демонстрационные значения**.
- С ключом OpenWeather выводится **текущая погода**, а НЕ прогноз будущих заморозков.
- Цветовой индикатор — **демонстрационный температурный скрининг**, не подтверждённая агрономическая модель повреждения растений.

## Запуск в Windows 10

Требуется Python 3.12 и Node.js LTS (с npm).

### Терминал №1: backend
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```
Backend: http://127.0.0.1:8000/docs

### Терминал №2: frontend
```powershell
cd frontend
npm install
npm run dev
```
Frontend: http://127.0.0.1:5173

### Подключение настоящей погоды
Скопируйте `backend/.env.example` в `backend/.env`, добавьте `OPENWEATHER_API_KEY=...`.
Не публикуйте `.env` в GitHub. При ошибке погодного сервиса API возвращает 503, не подменяя реальные данные демонстрационными.

## API
- GET /api/health
- GET /api/fields
- GET /api/fields/{id}
- GET /api/fields/{id}/weather
- GET /api/fields/{id}/risks
- GET /api/dashboard

## План следующих версий
Настоящие контуры полей, сохранение в БД, прогноз погоды на несколько дней, риск засухи, база знаний и ИИ-агроном, тестирование на исторических данных.
