# AgroRadar AI v0.8 — OpenWeather timeline

This is a **patch** for a running AgroRadar v0.7.1 project. It **does not replace** the Yandex map component, your existing `.env` files, or saved field boundaries.

## Install

1. Create a backup commit in GitHub Desktop.
2. Copy all files from the ZIP into the root of `C:\Users\domar\AgroRadar-AI`, merging directories and replacing matching files.
3. In `backend\.env`, set `OPENWEATHER_API_KEY=<YOUR_OPENWEATHER_KEY>`; if you do not have an active key, leave it empty for clearly labeled demo mode.
4. Restart FastAPI and frontend, or double-click `START_AGRORADAR.bat` (requires existing backend `.venv` and frontend `node_modules`).
5. Open `http://localhost:5173` (use **localhost**, because the Yandex API key is restricted to localhost).
6. Verify `http://127.0.0.1:8000/api/health` returns weather_mode=live for a configured key and demo otherwise.

## What changes

- Three-hour temperature timeline and precipitation probability in the selected field detail, from OpenWeather `forecast` API.
- Real weather available via existing OpenWeather `weather` and `forecast` integration; 15-minute in-process cache.
- No API key stored or exposed in frontend code. Map Yandex code is untouched.
- The sampled minimum temperature rule is intentionally a **screening indicator**, not a probability of crop damage.
- Demo mode draws **explicitly labeled synthetic** example points; these are not historical or real weather.

## Troubleshooting

- If dashboard responds 503 after setting API key: check OpenWeather account email verification, key activation, and free subscription access to Current Weather and 5 Day / 3 Hour Forecast.
- If the script reports a missing `.venv` or `node_modules`, install dependencies first (read README.md).
- Never commit `backend/.env` or `frontend/.env.local`. Do not share API keys in screenshots or public archives.

## Validation

- `cd backend && python -m pytest -q` — 4 offline API/geometry tests pass.
- TypeScript files parsed/transpiled without syntax errors.
- Full frontend build and live OpenWeather API access must be verified locally; neither was run with a real key here.
