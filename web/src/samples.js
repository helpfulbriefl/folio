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

// English versions of the demo documents (self-test with --selftest-lang=en: the README / site screenshots).
// Keyed by the Russian file name; the old letter in Windows-1251 and stats.js stay as they are (they show encodings / code).
const SAMPLES_EN = {
  'Планы на неделю.md': {
    path: 'C:\\Users\\Demo\\Documents\\Notes\\Weekly plan.md',
    text: `# Weekly plan

A short list of what really has to be done by Friday. Everything else — if there is time.

## Work
- [x] Send the quarterly report
- [ ] Team call on Wednesday, 11:00
- [ ] Clear the inbox and **reply to Anna** about the mockups
- [ ] Update the README — add a section on ==keyboard shortcuts==

## Home
- Groceries: milk, bread, apples
- Book a dentist appointment
- Call mum on Sunday

## Ideas
1. Make a template for meeting notes
2. Try the reader for long AI chats
3. Press \`Ctrl\`+\`K\` and look through all the commands

> Less, but every day.
`,
  },
  'Черновик статьи.txt': {
    path: 'C:\\Users\\Demo\\Documents\\Article draft.txt',
    text: `How I stopped being afraid of long texts

Basicaly, writing every day is not that hard. The main thing is not to wait for inspiration , but to just sit down and write.

For a long time I thought I needed the perfect editor. It turned out I needed something else: silence,  half an hour and a clear goal.

Now I write in the mornings while everyone is asleep. Sometimes it is a page, sometimes a paragraph — and that is fine.

PS. I recieve a lot of feedbak from teh readers, and it really helps.
`,
  },
  'Диалог с ChatGPT.md': {
    path: 'C:\\Users\\Demo\\Downloads\\Chat with ChatGPT.md',
    text: `You said:
How do I stop losing my notes? They are everywhere: on my phone, in a notebook, in chats.

ChatGPT said:
The key is **one place for everything incoming**. Whatever comes to mind goes there right away, and once a day you sort it out.

A simple scheme:
1. **Inbox** — one file or folder where everything lands.
2. **Review** — 10 minutes in the evening: delete the noise, file the rest by topic.
3. **Archive** — everything that is done but may come in handy.

You said:
How do I jot things down quickly when I am at the computer and do not want to switch windows?

ChatGPT said:
A global hotkey helps. In Folio it is \`Ctrl+Alt+N\`: a small window pops up, you type the thought and press \`Enter\` — the note is appended to the end of a file with the date.

If you want to automate it, here is a PowerShell example:

\`\`\`powershell
$note = Read-Host "Note"
$line = "- $(Get-Date -Format 'HH:mm') $note"
Add-Content -Path "$HOME\\Documents\\Inbox.md" -Value $line -Encoding utf8
\`\`\`

You said:
Thanks! How much time should the review take?

ChatGPT said:
Usually **10–15 minutes a day** is enough. If there are many notes, review twice: at lunch and in the evening. Regularity matters more than length.

You said:
Can you sum it up as a list?

ChatGPT said:
Sure:
- one place for everything incoming;
- quick capture with a hotkey;
- a 10–15 minute review every day;
- everything done goes to the archive.
`,
  },
};

/** The demo documents for a UI language; each has .key = its Russian file name (the self-test refers to them by it). */
export function samplesFor(l) {
  return SAMPLES.map(s => {
    const key = s.path.split('\\').pop();
    const en = l !== 'ru' ? SAMPLES_EN[key] : null;
    return { ...s, ...(en || {}), key };
  });
}

/** Replacements the demo AI (browser mock and self-test server) applies for "fix". */
export const DEMO_FIXES = [['Впринципе', 'В принципе'], ['вдохновения ,', 'вдохновения,'], ['тишина,  полчаса', 'тишина, полчаса'], ['по утрам пока', 'по утрам, пока'],
  ['Basicaly', 'Basically'], ['inspiration ,', 'inspiration,'], ['silence,  half', 'silence, half'], ['recieve', 'receive'], ['feedbak', 'feedback'], ['teh', 'the']];
