# Folio

**Блокнот для Windows, в котором приятно писать и читать.** Живёт в трее, открывает любые кодировки, проверяет орфографию, умеет «читалку» для Markdown и выгрузок чатов с ИИ, а по <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> принимает быструю заметку из любого места Windows.

[**⬇ Скачать Folio.exe**](https://github.com/helpfulbriefl/folio/releases/latest/download/Folio.exe) · Windows 10/11 x64 · один файл, без установки · [все версии](https://github.com/helpfulbriefl/folio/releases) · [English](#english)

![Folio](https://github.com/helpfulbriefl/folio/releases/latest/download/folio.png)

## Что умеет

- **Вкладки, сессия и «горячий выход».** Закрыли окно с несохранённым текстом — при следующем запуске всё на месте. Перед каждой перезаписью файла Folio кладёт копию прошлой версии в историю (*Файл → Версии файла*).
- **Кодировки без сюрпризов.** Сам распознаёт UTF-8/16/32, Windows-1251, CP866, KOI8-R, Windows-1252, GB18030, Shift-JIS и ещё два десятка; показывает, как выглядит файл в каждой из них; переводит старые файлы в UTF-8 в один клик и предупреждает, если символы не влезут в выбранную кодировку. Концы строк CRLF/LF/CR сохраняются.
- **Три режима письма.** *Обычный* — спокойная страница для текста; *Кодер* — номера строк, подсветка ~20 языков, мини-карта; *Корректор* — проверка орфографии словарями Windows, подсказки, личный словарь и подсказки по пунктуации (двойные пробелы, пробел перед запятой, запятая перед «что», «чтобы», «но», тире вместо дефиса).
- **Читалка.** <kbd>Ctrl</kbd>+<kbd>2</kbd> превращает Markdown, заметки и выгрузки диалогов с ChatGPT/Claude в книжную страницу или ленту, с оглавлением и выбором блоков для копирования.
- **ИИ со своим ключом.** Исправить ошибки, сократить, сделать вежливее, перевести, продолжить, объяснить код — правки показываются как рецензия: принять или отклонить каждую. Работает с OpenAI, OpenRouter, DeepSeek, Groq, Mistral и локальными Ollama / LM Studio (любой OpenAI-совместимый адрес). Ключ хранится зашифрованным (DPAPI) только на вашем компьютере.
- **Быстрые заметки.** <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> — маленькое окно поверх всего: написали, нажали Enter, мысль ушла в файл заметок с датой и временем. <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> — показать или спрятать Folio.
- **Темы.** Бумага, Графит (тёмная), Сепия, Стекло (мягкий градиент), или «как в системе». Шрифты, ширина строки, межстрочный интервал, масштаб интерфейса.
- **Языки интерфейса:** русский, English, 中文 — и свои переводы (*Настройки → Дополнительно → Шаблон перевода*).
- **Палитра команд** <kbd>Ctrl</kbd>+<kbd>K</kbd>, все сочетания клавиш настраиваются, журнал событий (*Справка → Журнал*), проверка обновлений с GitHub с проверкой SHA-256.

<a id="screenshots" name="screenshots"></a>
## Скриншоты

| | |
| --- | --- |
| ![Читалка: диалог с ChatGPT книжной страницей](https://github.com/helpfulbriefl/folio/releases/latest/download/folio-reader.png) | ![Старое письмо в Windows-1251 и меню кодировок](https://github.com/helpfulbriefl/folio/releases/latest/download/folio-encodings.png) |
| Читалка: длинный диалог с ChatGPT как книга | Кодировки: как файл выглядит в каждой из них |
| ![Режим «Кодер» в теме «Графит»](https://github.com/helpfulbriefl/folio/releases/latest/download/folio-dark.png) | ![Тема «Стекло» и живой Markdown](https://github.com/helpfulbriefl/folio/releases/latest/download/folio-glass.png) |
| «Кодер» в тёмной теме «Графит» | Тема «Стекло» и живой Markdown |

Скриншоты снимает сам Folio во время самопроверки в CI (`Folio.exe --selftest`) на чистой Windows — это настоящая программа, а не макет.

## Установка

1. Скачайте [Folio.exe](https://github.com/helpfulbriefl/folio/releases/latest/download/Folio.exe) и положите куда удобно (например, в `C:\Users\<вы>\Apps\Folio`).
2. Запустите. Windows SmartScreen может предупредить, что издатель неизвестен (файл не подписан сертификатом) — нажмите **Подробнее → Выполнить в любом случае**. Контрольная сумма — в `SHA256SUMS.txt` рядом с релизом.
3. Для работы нужен **Microsoft Edge WebView2 Runtime** — в Windows 11 он встроен, в Windows 10 обычно тоже есть. Если его нет, Folio предложит открыть страницу загрузки.

**Проверка орфографии** использует словари Windows: для русского языка в *Параметры → Время и язык → Язык* должен быть добавлен «Русский» (с ним ставится и словарь).

**Переносная версия.** Создайте рядом с `Folio.exe` пустой файл `folio.portable` — тогда настройки, сессия и история будут храниться в папке `FolioData` рядом с программой.

### Где лежат данные

| Что | Где |
| --- | --- |
| Настройки, сессия, список недавних, личный словарь, ключи ИИ (зашифрованы) | `%AppData%\Folio` |
| Журнал, резервные копии несохранённых вкладок, история версий файлов, WebView2 | `%LocalAppData%\Folio` |
| Быстрые заметки (по умолчанию) | `Документы\Folio\Быстрые заметки.md` |

Folio ничего не отправляет «домой»: в сеть он ходит только за обновлениями (GitHub API) и к тому ИИ-сервису, который вы сами настроили.

## Клавиши

| | |
| --- | --- |
| Новая вкладка / окно | <kbd>Ctrl</kbd>+<kbd>N</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> |
| Открыть, сохранить, сохранить как | <kbd>Ctrl</kbd>+<kbd>O</kbd>, <kbd>Ctrl</kbd>+<kbd>S</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> |
| Вернуть закрытую вкладку | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> |
| Писать / читать | <kbd>Ctrl</kbd>+<kbd>1</kbd> / <kbd>Ctrl</kbd>+<kbd>2</kbd> |
| Обычный / Кодер / Корректор | <kbd>Alt</kbd>+<kbd>1</kbd> / <kbd>Alt</kbd>+<kbd>2</kbd> / <kbd>Alt</kbd>+<kbd>3</kbd> |
| Найти, заменить, перейти к строке | <kbd>Ctrl</kbd>+<kbd>F</kbd>, <kbd>Ctrl</kbd>+<kbd>H</kbd>, <kbd>Ctrl</kbd>+<kbd>G</kbd> |
| Палитра команд | <kbd>Ctrl</kbd>+<kbd>K</kbd> |
| Панель ИИ / исправить ошибки | <kbd>Ctrl</kbd>+<kbd>I</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> |
| Панель корректора, следующая ошибка | <kbd>F7</kbd>, <kbd>F8</kbd> |
| Фокус, полный экран, поверх окон | <kbd>F9</kbd>, <kbd>F11</kbd>, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> |
| Спрятать в трей | <kbd>Esc</kbd> |
| Все сочетания | <kbd>Ctrl</kbd>+<kbd>/</kbd> |

### Командная строка

```
Folio.exe [файлы…]      открыть файлы (в уже запущенном Folio)
  --new-window          в новом окне
  --quick-note          сразу окно быстрой заметки
  --tray                запуститься в трее
  --selftest[=папка]    самопроверка: сценарий по всему интерфейсу + скриншоты и report.json
```

## Сборка из исходников

Нужны Node.js 20+ и .NET 8 SDK.

```
cd web && npm ci && node build.mjs && cd ..
dotnet test tests/Folio.Core.Tests
dotnet publish src/Folio/Folio.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o out
```

Интерфейс (`web/`) — обычный JavaScript + CodeMirror 6, собирается esbuild в `web/dist` и вшивается в exe. Оболочка (`src/Folio`) — WinForms + WebView2: окно без системного заголовка, трей, горячие клавиши, быстрые заметки, проверка орфографии через Windows Spell Checking API. `src/Folio.Core` — кодировки, сохранение, сессия, история версий, ИИ-клиент, обновления (покрыто тестами). Каждый коммит собирается на GitHub Actions и проходит самопроверку на Windows со скриншотами.

## Лицензия

[MIT](LICENSE) © 2026 [@yumi_acess](https://helpfulbriefl.github.io/). Иконки — [Lucide](https://lucide.dev) (ISC), редактор — [CodeMirror](https://codemirror.net) (MIT), шрифты — Inter, Literata, JetBrains Mono (OFL).

---

## English

**Folio is a calm notepad for Windows** that lives in the tray: tabs with hot exit and file version history, reliable encoding detection (UTF-8/16/32, Windows-1251, CP866, KOI8-R, GB18030, Shift-JIS…) with one-click conversion to UTF-8, three writing modes (plain page, code with syntax highlighting, proofreading with the Windows spell checker), a reader view for Markdown and AI chat exports, AI editing with your own key (OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Ollama, LM Studio or any OpenAI-compatible endpoint) shown as reviewable changes, and a global quick-note hotkey (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>).

[**Download Folio.exe**](https://github.com/helpfulbriefl/folio/releases/latest/download/Folio.exe) — Windows 10/11 x64, a single file, no installer. It is not code-signed, so SmartScreen may ask you to confirm (*More info → Run anyway*). Requires the Microsoft Edge WebView2 Runtime (built into Windows 11). Create an empty `folio.portable` file next to the exe for portable mode. The interface is available in Russian, English and Chinese; custom translations can be added from a template.
