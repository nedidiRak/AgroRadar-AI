# AgroRadar AI v1.1.1 — отображение Markdown в ответах DeepSeek

## Что меняется

- Ответы ИИ теперь показывают **жирный текст**, заголовки, списки, таблицы, цитаты и блоки кода, а не сырые `**` / `###`.
- Частый шаблон DeepSeek `1) **Краткий вывод**` превращается в аккуратный заголовок раздела.
- Текст ответа и история диалога сохраняются без изменений, на сервере ничего менять не требуется.
- Пользовательские сообщения остаются обычным текстом.
- Markdown обрабатывается через `react-markdown` + `remark-gfm` без выполнения HTML от модели.

## Установка на Windows

1. Сделайте коммит рабочей версии в GitHub Desktop.
2. Распакуйте этот ZIP, скопируйте папку `frontend` и файл `INSTALL_MARKDOWN.bat` в корень репозитория `C:\Users\domar\AgroRadar-AI` с заменой совпадающих файлов. Остальные файлы не удаляйте.
3. Дважды щёлкните `INSTALL_MARKDOWN.bat`. Он установит зависимости и сохранит их в `frontend/package.json` / `package-lock.json`.
4. Если Vite запущен, остановите его `Ctrl+C` и запустите снова через `npm.cmd run dev` из папки `frontend`.
5. Обновите `http://localhost:5173` и задайте вопрос ИИ-агроному.

Ручная альтернатива установщику:

```powershell
cd "C:\Users\domar\AgroRadar-AI\frontend"
npm.cmd install react-markdown@9.1.0 remark-gfm@4.0.1
npm.cmd run dev
```

**Не меняйте `backend/.env`, `frontend/.env.local`, карту и backend.** Патч состоит из двух компонентов frontend и инсталлятора.

Если PowerShell выдаёт `Cannot find module react-markdown`, значит установка зависимостей завершилась неуспешно — проверьте вывод `npm.cmd install`.
