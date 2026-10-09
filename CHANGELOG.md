# Changelog

[Русский](CHANGELOG.ru.md)

## [1.1.2] — 2026-10-09

- English is the default for new installations and the initial UI/native menus. Saved language preferences and explicit automatic locale selection are preserved.
- English-first README with a separate Russian guide, live GitHub badges, provider/privacy notes and contribution information.
- Language regression tests and read-only pull-request checks for the UI build, core tests and Windows compilation.

## [1.1.1] — 2026-10-01

Updating while Folio is running.

- A newer `Folio.exe` now replaces an older running version instead of passing its command line to the old process. The older instance saves its session, including unsaved text, and quits. Works with earlier 1.0.x and 1.1.0 versions.
- If the old instance cannot be closed, for example because it is running as administrator, Folio explains how to quit it from the tray.
- The first-run welcome page no longer opens over restored tabs.
- The window title retains the **●** unsaved marker after switching tabs and after startup.
- The Windows self-test also checks replacement of a running instance and restoration of its unsaved text.

## [1.1.0] — 2026-10-01

API profiles, model selection, page zoom and an improved reader.

- Fixed `Index was out of range` errors caused by stream chunks with empty `choices: []`, including provider metadata chunks. Improved handling of array responses, non-streaming SSE and empty responses.
- Unsupported-model errors now include a clear explanation and a model-selection action.
- Model reasoning (`reasoning_content` and `<think>…</think>`) is displayed separately in a collapsible block rather than mixed into answers or edits. It can be disabled in settings.
- Added multiple API profiles, each with a provider, endpoint, model and its own locally DPAPI-encrypted key. The old single-profile configuration is migrated automatically.
- Added a searchable model list retrieved through `/models`, manual refresh and a warning when the configured model is not listed.
- Page zoom now scales layout, margins and spacing in the editor and reader, not just font size.
- The reader splits Markdown at headings, combines short sections and splits long sections between paragraphs. Cards default to a wider layout, with less empty space and improved scrolling.
- Added reader support for `<kbd>`, `<sup>`, `<sub>` and `<br>`.
- Added a choice between keeping multiple tabs and always using a single tab.
- Added per-user file associations and a shortcut to Windows Default Apps, without requiring administrator rights.
- Made the status bar thinner, especially in focus mode.
- Proofreading punctuation hints no longer wait for spell checking. Windows dictionaries are prepared at startup; other hints remain available if spell checking does not answer within 15 seconds.
- Added file-type icons and softer menu/panel animations; colored icons can be disabled.
- Added a Support settings section with the project GitHub link and an ETH support option.
- The Windows CI self-test runs with the English interface and English demo documents.

## [1.0.1] — 2026-09-30

Fix for the blank window at startup.

- Fixed a startup failure when another application had already registered one of Folio's global shortcuts. The host no longer silently drops the UI's first reply; delivery failures are logged and returned as errors.
- Added a startup screen and recovery actions: restart in compatibility mode, open logs or quit.
- Added compatibility mode without GPU acceleration. It can be activated automatically for renderer failures or manually with `--compat` or Settings → Advanced.
- Added startup diagnostics: WebView2 version, page loading time, startup stages, WebView2 process failures and early UI script errors.
- Extended the Windows self-test to cover a normal first run with a clean profile, tray and global shortcuts, including mouse and keyboard responsiveness.

## [1.0.0] — 2026-09-30

First release.

- Tabs, session and unsaved-text recovery, file version history and monitoring for external file changes.
- Encoding detection and conversion, one-click UTF-8 conversion, warnings before lossy saves and line-ending preservation.
- Standard, Coder and Proofreader modes; syntax highlighting, line numbers, minimap, Windows spell checking, a personal dictionary and punctuation hints.
- Markdown and AI chat reader with book/feed layouts, a table of contents and selectable blocks.
- Bring-your-own-key AI editing with reviewable changes: correction, shortening, translation, continuation and code explanation through OpenAI-compatible endpoints.
- System tray, global quick notes, a show/hide shortcut and Windows autostart.
- Paper, Graphite, Sepia and Glass themes, typography and interface zoom.
- Russian, English and Chinese interfaces, with custom translation templates.
- Command palette, configurable shortcuts, event log and GitHub updates with SHA-256 verification.
