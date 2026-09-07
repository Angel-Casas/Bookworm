<div align="center">

<img src="public/landing/Library.png" alt="" width="340">

# Bookworm

**A bookshelf that lives in your browser, with a reader inside every book.**

Load your own PDFs and EPUBs, read them anywhere, and ask the book itself what
it means. Nothing is uploaded. There is no account, and there is no server —
Bookworm is a static site that runs entirely on your device.

[![Licence: MIT](https://img.shields.io/badge/licence-MIT-f0ae2f?style=flat-square)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-f0ae2f?style=flat-square)](https://vuejs.org)
[![Backend: none](https://img.shields.io/badge/backend-none-f0ae2f?style=flat-square)](#where-your-things-live)
[![Languages: 11](https://img.shields.io/badge/languages-11-f0ae2f?style=flat-square)](#eleven-languages)

</div>

---

Every reader has had the same small disappointment: you finish a chapter with a
question and there is no one to ask. The author is not available. The internet
knows the ending. Bookworm puts an assistant inside each book that has read
exactly as much of it as you have — and not one page more, unless you say so.

It is free, open source, and yours. You bring a
[NanoGPT](https://nano-gpt.com/r/BnfJfghE) key and pay per token — fractions of
a cent per question — with no subscription and no middleman. Bookworm never
sees it: the key is stored in your browser and sent only to NanoGPT.

<table>
<tr>
<td width="180" valign="top" align="center"><img src="public/landing/Library.png" alt="" width="150"></td>
<td valign="top">
<h3>Your shelf</h3>
<p>Drop in any PDF or EPUB and it stays. Covers, titles and authors are read out
of the file; a book without a cover gets one drawn from its title. The shelf
sorts by what you are reading, what you have finished, when you added it, or
format — and it remembers where you were in every book, down to the paragraph.</p>
<p>Your whole library exports to a single file and reads back on another
machine: books, positions, marks, conversations and spend, together.</p>
</td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top" align="center"><img src="public/landing/Ink.png" alt="" width="150"></td>
<td valign="top">
<h3>Reading, and marking</h3>
<p>Two pages side by side or one at a time; on a phone, one long strip you
scroll. Text size and typeface are yours, and the page has its own light and
dark, separate from the app around it. Focus mode hides everything but the
book.</p>
<p>Pull the lamp's chain to bookmark a spot and the page corner folds, the way a
paper one does. Highlight a passage in one of five inks. Keep an answer you
liked. Everything you marked exports as a clean Markdown file — quotes,
places and notes, in reading order.</p>
</td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top" align="center"><img src="public/landing/Dream.png" alt="" width="150"></td>
<td valign="top">
<h3>Ask the book</h3>
<p>The assistant answers from the pages you send it, and you choose how many:
the passage you highlighted, this chapter, everything you have read so far, or
the whole book. <strong>Spoilers are a decision, not an accident</strong> — send
only what you have read and nothing later can be revealed. There is no second
setting to forget.</p>
<p>Answers stream in and cite the passages they came from; click a citation to
jump there. Select a single word to ask what it means <em>in this sentence</em>,
in this book. Or ask to be quizzed on the chapter you just finished — it asks
first, and waits for your answers before showing you how you did.</p>
</td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top" align="center"><img src="public/landing/Market.png" alt="" width="150"></td>
<td valign="top">
<h3>What it costs, before you spend it</h3>
<p>Every model's real price is read from NanoGPT and shown beside its name.
Before you send a question the panel says how large it is and what it will
cost, to the fraction of a cent — to be read before pressing send, not after.
Spend is counted per book and in total, and your account balance is one click
away in settings.</p>
<p>Any book can be given its own model: a difficult one deserves a better reader
than a light one.</p>
</td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top" align="center"><img src="public/landing/Lens.png" alt="" width="150"></td>
<td valign="top">
<h3>Finding things again</h3>
<p>Search inside a book, with excerpts that jump to the exact match. Or search
the whole shelf at once — titles and authors first, then every passage you ever
marked, then the text of the books themselves.</p>
</td>
</tr>
</table>

## Eleven languages

Bookworm speaks English, Español, Français, Deutsch, Português, Italiano,
Русский, 中文, 日本語, हिन्दी and العربية. Not translated strings in an English
layout: numbers, dates, prices and plurals are formed by each language's own
rules, and the whole interface mirrors for Arabic — right to left, from the
shelf to the reader's toolbar to the assistant's composer.

A first visit is met by a short tour that walks the shelf and goes into a book,
bringing a small one of its own so there is something to try it on. It runs
once, and lives in settings afterwards.

## Where your things live

| What | Where it is kept | Does it leave your device? |
|---|---|---|
| Books, covers, reading positions | IndexedDB, in your browser | No |
| Highlights, bookmarks, kept answers | IndexedDB | No |
| Conversations and spend records | IndexedDB | No |
| Your NanoGPT API key | `localStorage`, on this device | Only to NanoGPT, with your questions |
| The passages you choose to send | — | To NanoGPT, only when you press send |

There is no backend to talk to, no analytics, no telemetry and no account.
Installed as a PWA, Bookworm opens and reads offline; only the assistant needs
the network. Clearing the browser's data for the site deletes everything, so
export a backup first.

## Running it

```bash
git clone https://github.com/Angel-Casas/Bookworm.git
cd Bookworm
npm install
npm run dev
```

Node 22.18+ or 24.12+. Then open the app, go to **Settings**, and paste a
NanoGPT API key — [make an account](https://nano-gpt.com/r/BnfJfghE), add a
small balance, copy the key. The shelf, the reader and everything you mark work
without one; only the assistant needs it.

> Those NanoGPT links carry the project owner's referral code. Your tokens cost
> exactly the same either way — NanoGPT returns a small share to the project,
> and it is the only support Bookworm asks for. The app says as much beside the
> link in Settings. If you would rather not, [nano-gpt.com](https://nano-gpt.com)
> works the same.

```bash
npm run build       # type-check + production build into dist/
npm run preview     # serve that build
npm run test:unit   # unit tests
npm run lint        # oxlint + eslint
```

`dist/` is a static site. Any host that serves files will do.

## How it is built

Vue 3 with `<script setup>`, TypeScript in strict mode, Pinia, Vue Router, Vite,
and a service worker from `vite-plugin-pwa`. EPUBs are rendered by
[epub.js](https://github.com/futurepress/epub.js), PDFs by
[pdf.js](https://mozilla.github.io/pdf.js/), storage is
[idb](https://github.com/jakearchibald/idb), and the backup file is zipped with
[fflate](https://github.com/101arrowz/fflate).

The source is arranged so the interesting parts can be tested without a browser:

```
src/lib/         pure functions — cost maths, prompt building, CFI and citation
                 handling, the tour's geometry, i18n. No side effects; tested.
src/services/    everything that touches the world — IndexedDB, file parsing,
                 the NanoGPT HTTP calls.
src/stores/      Pinia stores: they orchestrate services and lib, hold UI state.
src/views/       the library, the reader, the landing page.
src/components/  presentation, kept thin.
src/i18n/        one catalogue per language, held to English by a test.
```

Two rules hold the shape: anything in `src/lib` is deterministic and has tests,
and no component talks to the database or the network directly.

## Contributing

Issues and pull requests are welcome — the app's **Support** menu opens a
pre-labelled issue for a bug, a question or a feature request. If you are
reporting something visual, the browser, the screen size and a screenshot save
a great deal of guessing.

## Licence

MIT — see [LICENSE](LICENSE). Do what you like with it.

Built on [NanoGPT](https://nano-gpt.com/r/BnfJfghE) for the models, and on
[epub.js](https://github.com/futurepress/epub.js) and
[pdf.js](https://mozilla.github.io/pdf.js/), which do the hard part of turning a
file into a page. The engravings are Bookworm's own.

<div align="center">
<br>
<img src="public/landing/Somewhere.png" alt="" width="220">
<br><br>
<em>Somewhere on your shelf, a worm is waiting to dream of you.</em>
</div>
