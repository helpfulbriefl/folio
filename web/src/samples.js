// Welcome document and demo files (used by the browser mock and by the self-test).
import { lang } from './i18n.js';

const WELCOME_RU = `# Добро пожаловать в Folio

Folio — быстрый блокнот для Windows: заметки, код, старые файлы в любой кодировке и удобное чтение длинных диалогов с ИИ.

## С чего начать
- [ ] Открой файл — \`Ctrl\`+\`O\` или просто перетащи его в окно
- [ ] Переключи вид: \`Ctrl\`+\`1\` — писать, \`Ctrl\`+\`2\` — читать
- [ ] Попробуй режимы: \`Alt\`+\`1\` обычный, \`Alt\`+\`2\` кодер, \`Alt\`+\`3\` проверка
- [x] Закрыть окно без сохранения не страшно — всё вернётся при следующем запуске

## Полезные клавиши
- \`Ctrl\`+\`K\` — палитра команд: найдёт любую функцию
- \`Ctrl\`+\`I\` — ИИ-помощник (нужен свой ключ API)
- \`Ctrl\`+\`Alt\`+\`N\` — быстрая заметка из любого места Windows
- \`Esc\` — свернуть в трей, \`Win\`+\`Alt\`+\`F\` — вернуть окно

## Кодировки
Folio сам узнаёт **Windows-1251**, **CP866**, **KOI8-R**, UTF-16 и китайские кодировки. Если файл открылся «кракозябрами», нажми на кодировку в строке состояния и выбери другую — рядом с каждой видно превью текста.

> Совет: ==выделяй== важное двумя знаками равенства, а в режиме чтения \`Ctrl\`+\`Shift\`+\`C\` копирует выбранные сообщения.
`;

const WELCOME_EN = `# Welcome to Folio

Folio is a fast notepad for Windows: notes, code, old files in any encoding and comfortable reading of long AI chats.

## Getting started
- [ ] Open a file with \`Ctrl\`+\`O\` or just drop it onto the window
- [ ] Switch the view: \`Ctrl\`+\`1\` to write, \`Ctrl\`+\`2\` to read
- [ ] Try the modes: \`Alt\`+\`1\` standard, \`Alt\`+\`2\` coder, \`Alt\`+\`3\` proofreading
- [x] Closing without saving is fine — everything comes back on the next start

## Handy shortcuts
- \`Ctrl\`+\`K\` — command palette: finds any feature
- \`Ctrl\`+\`I\` — AI assistant (bring your own API key)
- \`Ctrl\`+\`Alt\`+\`N\` — quick note from anywhere in Windows
- \`Esc\` — hide to the tray, \`Win\`+\`Alt\`+\`F\` — bring the window back

## Encodings
Folio detects **Windows-1251**, **CP866**, **KOI8-R**, UTF-16 and Chinese encodings on its own. If a file shows gibberish, click the encoding in the status bar and pick another one — every option shows a preview.

> Tip: ==highlight== with double equals signs; in the reader \`Ctrl\`+\`Shift\`+\`C\` copies the selected messages.
`;

export const welcomeText = () => (lang() === 'ru' ? WELCOME_RU : WELCOME_EN);
export const welcomeName = () => (lang() === 'ru' ? 'Добро пожаловать.md' : lang() === 'zh' ? '欢迎.md' : 'Welcome.md');

export const SAMPLES = [
  {
    path: 'C:\\Users\\Demo\\Documents\\Заметки\\Планы на неделю.md', encoding: 'utf-8',
    text: `# Планы на неделю

Короткий список того, что важно успеть до пятницы. Остальное — по возможности.

## Работа
- [x] Отправить отчёт за квартал
- [ ] Созвон с командой в среду, 11:00
- [ ] Разобрать почту и **ответить Ане** про макеты
- [ ] Обновить README — добавить раздел про ==горячие клавиши==

## Дом
- Купить продукты: молоко, хлеб, яблоки
- Записаться к стоматологу
- Позвонить маме в воскресенье

## Идеи
1. Сделать шаблон для заметок со встреч
2. Попробовать режим чтения для длинных чатов
3. Нажать \`Ctrl\`+\`K\` и посмотреть все команды

> Лучше меньше, но каждый день.
`,
  },
  {
    path: 'C:\\Users\\Demo\\Documents\\Старое\\письмо.txt', encoding: 'windows-1251',
    text: `Здравствуйте, Ирина Сергеевна!\r\n\r\nНаправляю вам отчёт о работе отдела за март. Все показатели в пределах плана,\r\nпо двум направлениям есть небольшое перевыполнение.\r\n\r\nПодробности — во вложении. Если будут вопросы, звоните в любое время.\r\n\r\nС уважением,\r\nАлексей Петров\r\nтел. 8 (495) 123-45-67\r\n`,
  },
  {
    path: 'C:\\Users\\Demo\\Projects\\folio-demo\\src\\stats.js', encoding: 'utf-8',
    text: `// Folio — a tiny demo for the coder mode
import { readFile } from 'node:fs/promises';

const WORDS = /[\\p{L}\\p{N}]+/gu;

/** Counts words and lines in a text file. */
export async function stats(path, { encoding = 'utf8' } = {}) {
  const text = await readFile(path, { encoding });
  const words = text.match(WORDS)?.length ?? 0;
  const lines = text.split(/\\r?\\n/).length;
  return { path, words, lines, chars: text.length };
}

class Cache {
  #items = new Map();
  constructor(limit = 100) {
    this.limit = limit;
  }
  get(key) {
    return this.#items.get(key);
  }
  set(key, value) {
    if (this.#items.size >= this.limit) {
      this.#items.delete(this.#items.keys().next().value);
    }
    this.#items.set(key, value);
    return this;
  }
}

export const cache = new Cache(256);
`,
  },
  {
    path: 'C:\\Users\\Demo\\Documents\\Черновик статьи.txt', encoding: 'utf-8',
    text: `Как я перестал бояться длинных текстов

Впринципе, писать каждый день не так сложно. Главное — не ждать вдохновения , а просто садиться и писать.

Я долго думал, что для этого нужен идеальный редактор. Оказалось, нужно совсем другое: тишина,  полчаса времени и понятная цель.

Сейчас я пишу по утрам пока все спят. Иногда получается страница, иногда абзац — и это нормально.

PS. I recieve a lot of feedbak from teh readers, and it really helps.
`,
  },
  {
    path: 'C:\\Users\\Demo\\Downloads\\Диалог с ChatGPT.md', encoding: 'utf-8',
    text: `Вы сказали:
Как сделать, чтобы заметки не терялись? У меня они везде: в телефоне, в блокноте, в чатах.

ChatGPT сказал:
Главное — **одно место для входящих**. Всё, что приходит в голову, сразу записывайте туда, а раз в день разбирайте.

Простая схема:
1. **Входящие** — один файл или папка, куда попадает всё подряд.
2. **Разбор** — вечером 10 минут: удалить лишнее, остальное разложить по темам.
3. **Архив** — всё, что сделано, но может пригодиться.

Вы сказали:
А как быстро записывать, если я за компьютером и не хочу переключаться?

ChatGPT сказал:
Помогает глобальная горячая клавиша. Например, в Folio это \`Ctrl+Alt+N\`: появляется маленькое окно, пишете мысль и нажимаете \`Enter\` — заметка добавляется в конец файла с датой.

Если хочется автоматизировать, вот пример на PowerShell:

\`\`\`powershell
$note = Read-Host "Заметка"
$line = "- $(Get-Date -Format 'HH:mm') $note"
Add-Content -Path "$HOME\\Documents\\Входящие.md" -Value $line -Encoding utf8
\`\`\`

Вы сказали:
Спасибо! А сколько времени тратить на разбор?

ChatGPT сказал:
Обычно хватает **10–15 минут в день**. Если заметок много, разбирайте дважды: в обед и вечером. Главное — регулярность, а не длительность.

Вы сказали:
Можно коротко, списком?

ChatGPT сказал:
Конечно:
- одно место для входящих;
- быстрый ввод по горячей клавише;
- разбор 10–15 минут в день;
- всё сделанное — в архив.
`,
  },
];

/** Replacements the demo AI (browser mock and self-test server) applies for "fix". */
export const DEMO_FIXES = [['Впринципе', 'В принципе'], ['вдохновения ,', 'вдохновения,'], ['тишина,  полчаса', 'тишина, полчаса'], ['по утрам пока', 'по утрам, пока'], ['recieve', 'receive'], ['feedbak', 'feedback'], ['teh', 'the']];
