/**
 * Every word Bookworm says, in English.
 *
 * This file is the reference: the other ten languages are checked against it,
 * and any key they are missing falls through to what is written here. So it is
 * the one catalogue that must always be complete, and the one place a new
 * string is added first.
 *
 * Conventions a translator should know:
 *
 *   `{name}` is a value filled in at run time. Keep them, move them where the
 *   sentence needs them, and never translate what is inside the braces.
 *
 *   A message written as `{ one: …, other: … }` changes with a count. Give
 *   your language the forms it actually has — `other` is required because
 *   every language has one, and `zero`, `two`, `few` and `many` are there for
 *   the languages that need them. The count itself is `{count}`.
 *
 *   Numbers, dates, percentages and money are NOT in here: they are shaped by
 *   `Intl` from the reader's language (see src/lib/format.ts). Only words.
 */
import type { Catalogue } from '@/lib/i18n'

const en = {
  // ————————————————————————— the bar at the top —————————————————————————
  'nav.library': 'Bookworm library',
  'nav.home': 'Bookworm — home',
  'nav.actions': 'Application',
  'nav.support': 'Support',
  'nav.supportClose': 'Close support',
  'nav.language': 'Language',
  'nav.languageClose': 'Close language menu',
  'nav.toLight': 'Switch to light mode',
  'nav.toDark': 'Switch to dark mode',
  'nav.settings': 'Settings',
  'nav.settingsClose': 'Close settings',
  'nav.langHint': 'Change the language from here, whenever you like.',
  'nav.dismiss': 'Dismiss',

  // ————————————————————————————— the shelf —————————————————————————————
  'library.title': 'Library',
  'library.totalSpent': 'Total spent: {amount}',
  // Spent and left, side by side. The balance is a button: the only thing
  // anyone wants from a figure like that is a fresher one.
  'library.balance': 'Balance: {amount}',
  'library.balanceLoading': 'Balance: …',
  'library.balanceUnknown': 'Balance: —',
  'library.balanceRefresh': 'Check your NanoGPT balance again',
  'library.add': 'Add books',
  'library.adding': 'Importing books',
  'library.addingShort': 'Importing…',
  'library.viewCompact': 'Switch to compact view with book details',
  'library.viewBig': 'Switch to big covers view',
  'library.viewCompactShort': 'Compact view',
  'library.viewBigShort': 'Big covers',
  'library.search': 'Search every book and everything you marked',
  'library.searchShort': 'Search the shelf',
  'library.sort': 'Sort books',
  'library.sortBy': 'Sort books by',
  'library.export': 'Export library',
  'library.import': 'Import backup',
  'library.dismissErrors': 'Dismiss',
  'library.exportFailed': 'Export failed.',
  'library.importFailed': 'Import failed.',
  'library.unsupported': 'Bookworm reads PDF and EPUB. “{file}” is neither.',
  'library.cannotRead': '“{file}” could not be read.',
  'library.emptyLine': 'No books yet. Add a PDF or EPUB to start your shelf.',
  'library.emptySub': 'Somewhere on your shelf, a worm is waiting to dream of you.',

  'sort.reading': 'Reading',
  'sort.finished': 'Finished',
  'sort.added': 'Date added',
  'sort.format': 'Format',

  // ————————————————————————— a book on the shelf —————————————————————————
  'card.cover': 'Cover of {title}',
  'card.finished': 'Finished',
  'card.markFinished': 'Mark finished',
  'card.finishedTick': 'Finished ✓',
  'card.remove': 'Remove',
  'card.progressOf': 'Progress through {title}',
  'card.read': '{duration} read',
  'card.pageTurns': { one: '{count} page turn', other: '{count} page turns' },

  // Heads the strip of everything on the go, said once for all of them.
  'continue.eyebrow': 'Continue reading',
  'continue.progress': 'Progress through this book',
  'continue.uncounted': 'Not counted yet',
  'continue.justOpened': 'Just opened',

  // ———————————————————— units, for the number layer ————————————————————
  // Appended to a number: "3h 12m". Keep them short — they sit in a shelf card.
  'time.hour': 'h',
  'time.minute': 'm',
  'time.underAMinute': '<1m',
  'time.unknown': '—',

  // ————————————— when the assistant cannot answer —————————————
  // Two of these keep phrasing a reader would search the web with; translate
  // the sense, not the wording, and keep the product names as they are.
  'failure.no-key':
    'The assistant runs on your own NanoGPT key — Bookworm has no server and no account of its own. Add one and this book can talk.',
  'failure.no-key.action': 'Open settings',
  'failure.no-model': 'Choose which model should answer, and the assistant is ready.',
  'failure.no-model.action': 'Open settings',
  'failure.bad-key':
    'Your NanoGPT API key was rejected. It may have been revoked, or copied with a character missing.',
  'failure.bad-key.action': 'Open settings',
  'failure.no-balance':
    'Your NanoGPT balance appears to be empty. Top it up and the assistant carries on from here — nothing has been lost.',
  'failure.no-balance.action': 'Open settings',
  'failure.offline':
    'Bookworm could not reach NanoGPT. Check your internet connection and try again — your books and everything you marked are on this device and need no connection at all.',
  'failure.offline.action': 'Try again',
  'failure.busy': 'NanoGPT is asking for a moment’s pause. Wait a few seconds and try again.',
  'failure.busy.action': 'Try again',
  'failure.server':
    'NanoGPT had trouble at its end (HTTP {status}). That is not something Bookworm can fix from here — it is usually over in a minute.',
  'failure.server.action': 'Try again',
  'failure.unknown':
    'The request failed{status}. Try it again; if it keeps happening, check your key and model in settings.',
  'failure.unknown.action': 'Try again',

  // ————————————— the file a reader saves their marks to —————————————
  'marks.bookmark': 'Bookmark',
  'marks.highlight': 'Highlight',
  'marks.note': 'Kept answer',
  'marks.countOne': 'mark',
  'marks.countOther': 'marks',
  'marks.savedOn': 'Saved from Bookworm on {date}',
  'marks.page': 'Page {n}',
  'marks.nothing': 'Nothing was marked in this book.',

  // ————————————————————————— overlays —————————————————————————
  'overlay.settings': 'Settings',
  'overlay.support': 'Support',
  'overlay.language': 'Language',
  'overlay.close': 'Close',

  'settings.keyTitle': 'NanoGPT API key',
  'settings.keyIntro1':
    'Bookworm’s assistant runs on {link}: you pay only for the tokens you use, with no subscription.',
  // Three steps, in the order they happen. The reader is not short of an
  // explanation of what a key is; they are short of knowing there are exactly
  // three things to do.
  'settings.setup1Title': 'Open NanoGPT',
  'settings.setup1':
    'Go to {link} and sign in — create an account, or use it without one: NanoGPT works with no account at all.',
  'settings.setup2Title': 'Add some balance',
  'settings.setup2':
    'Top it up by card, Apple Pay or Google Pay, or with digital currency — Bitcoin, Monero, Solana and others. A dollar or two lasts a long time.',
  'settings.setup3Title': 'Create a key, and paste it here',
  'settings.setup3':
    'At {link}, create an API key and paste it in the box below. It is kept in this browser only, and sent only to NanoGPT.',
  // Said plainly, beside the link itself: an invitation passed off as a plain
  // URL is the kind of small dishonesty this project has no use for. It is
  // also worth something to the reader, and that half is said first.
  'settings.referral':
    'The link above is our invitation link: going through it takes 5% off every model call you ever make, for as long as the account lasts. It also returns a small share to the project — the only support Bookworm asks for.',
  'settings.keyPlaceholder': 'Paste your NanoGPT API key',
  'settings.keyLabel': 'NanoGPT API key',
  'settings.show': 'Show',
  'settings.hide': 'Hide',
  'settings.keySaved': 'Key saved on this device.',
  'settings.noKey': 'No key yet — the chat assistant is disabled.',
  'settings.checkBalance': 'Check balance',
  'settings.checking': 'Checking…',
  'settings.balance': 'Balance: {amount}',
  'settings.modelTitle': 'Model',
  'settings.modelHint':
    'This is the model every book starts with. Pin the ones you return to and they rise to the top here and in the assistant, where any book can be given a model of its own.',

  'support.lead':
    'Bookworm is free and open source; its source code lives on GitHub. Choose a request — each opens a new issue in the repository, no account data attached.',
  'support.bugLabel': 'Report a problem',
  'support.bugDesc': 'Something misbehaves — a page, a book, an answer.',
  'support.questionLabel': 'Ask a question',
  'support.questionDesc': 'Anything unclear about keys, models, or your shelf.',
  'support.featureLabel': 'Request a feature',
  'support.featureDesc': 'Tell us what the worm should learn next.',
  'support.fine': 'Free & open source · MIT · powered by NanoGPT',

  'firstRun.lede': 'Choose the language you would like Bookworm in.',
  'firstRun.state':
    'Bookworm speaks all of these. Where a translation is still short of a word, English stands in for it.',
  'firstRun.after': 'You can change this any time from the globe in the top bar.',

  // —————————————————————————— the reader ——————————————————————————
  'reader.notFound': 'Book not found.',
  'reader.backToLibrary': 'Back to library',
  'reader.loading': 'Loading…',
  'reader.readInPages': 'Read in pages',
  'reader.scrollWholeBook': 'Scroll the whole book',
  'reader.singlePage': 'Single page',
  'reader.twoPage': 'Two-page spread',
  'reader.type': 'Text size and font',
  'reader.typeSettings': 'Text settings',
  'reader.size': 'Size',
  'reader.smaller': 'Smaller text',
  'reader.larger': 'Larger text',
  'reader.font': 'Font',
  'reader.fontBook': 'Book’s own',
  'reader.fontSerif': 'Serif',
  'reader.fontSans': 'Sans',
  'reader.focusEnter': 'Focus mode',
  'reader.focusLeave': 'Leave focus mode',
  'reader.pageLight': 'Light page',
  'reader.pageDark': 'Dark page',
  'reader.lookUp': 'What does “{word}” mean here?',
  'reader.markPassage': 'Mark this passage',
  'reader.ink': 'Highlight ink',
  'reader.inkGroup': 'Ink',
  'reader.highlightIn': 'Highlight in {colour}',
  'reader.useInk': 'Use {colour} ink',
  'reader.highlightWith': 'Highlight · {colour}',
  'reader.inkWith': 'Ink · {colour}',
  'reader.marksPanel': 'Bookmarks, highlights and notes',
  'reader.searchBook': 'Search this book',
  'reader.bookmark': 'Bookmark',
  'reader.bookmarkAdd': 'Bookmark this spot',
  'reader.bookmarkRemove': 'Remove bookmark',
  'reader.page': 'Page ',
  'reader.editHighlight': 'Edit highlight',
  'reader.recolour': 'Recolor · {colour}',
  'reader.recolourTo': 'Recolor to {colour}',
  'reader.removeHighlight': 'Remove highlight',
  'reader.sectionLabel': 'Section {n}',
  'reader.pageLabel': 'Page {n}',
  'reader.pageOf': 'Page {current} of {total}',

  // The pastel inks, named. Short words: they appear inside a tooltip.
  'ink.butter': 'Butter',
  'ink.mint': 'Mint',
  'ink.sky': 'Sky',
  'ink.rose': 'Rose',
  'ink.lavender': 'Lavender',

  // ————————————————————— pager, contents, in-book search —————————————————————
  'pager.previous': '← Previous',
  'pager.next': 'Next →',
  'pager.pageOf': 'Page {current} of {total}',
  'pager.goTo': 'Go to…',
  'pager.goToPage': 'Go to page',
  'pager.go': 'Go',
  'toc.title': 'Table of contents',
  'toc.word': 'Contents',
  'toc.chapters': 'Chapters',
  'toc.close': 'Close the contents',
  'search.title': 'Search in book',
  'search.close': 'Close search',
  'search.placeholder': 'Search this book…',
  'search.label': 'Search query',
  'search.go': 'Search',
  'search.searching': 'Searching…',
  'search.failed': 'Search failed.',
  'search.noMatches': 'No matches found.',
  'reader.pdfFailed': 'This PDF could not be opened.',
  'reader.pdfPageFailed': 'This page could not be drawn.',
  'reader.epubFailed': 'This EPUB could not be opened.',

  // ————————————————————— bookmarks, highlights, kept answers —————————————————————
  'panel.marks': 'Bookmarks, highlights and kept answers',
  'panel.marksTitle': 'Marks in this book',
  'panel.save': 'Save these marks as a markdown file',
  'panel.saveShort': 'Save as markdown',
  'panel.close': 'Close panel',
  'panel.filter': 'Filter saved items',
  'panel.all': 'All',
  'panel.bookmarks': 'Bookmarks',
  'panel.highlights': 'Highlights',
  'panel.notes': 'Notes',
  'panel.emptyAll':
    'Nothing saved yet. Bookmark your spot or highlight text in the book, then save it here.',
  'panel.emptyBookmarks': 'No bookmarks yet.',
  'panel.emptyHighlights': 'No highlights yet.',
  'panel.emptyNotes': 'No kept answers yet. Keep one from the assistant and it lands here.',
  'panel.elsewhere': { one: '{count} other mark saved', other: '{count} other marks saved' },
  'panel.goTo': 'Go to {label}',
  'panel.removeBookmark': 'Remove bookmark',
  'panel.removeHighlight': 'Remove highlight',
  'panel.removeNote': 'Remove kept answer',
  'panel.remove': 'Remove',
  'panel.expand': 'Expand',
  'panel.collapse': 'Collapse',
  'panel.askAbout': 'Ask about this',

  // —————————————————————————— a word looked up ——————————————————————————
  'lookup.of': 'Meaning of {word}',
  'lookup.close': 'Close',
  'lookup.working': 'Looking it up…',
  'lookup.askMore': 'Ask the book about this',

  // ————————————————————————— the assistant —————————————————————————
  'chat.open': 'Ask the book',
  'chat.close': 'Close the assistant',
  'chat.resize': 'Resize the assistant',
  'chat.spoilersOn': 'spoilers on',
  'chat.spoilerSafe': 'spoiler-safe',
  'chat.clear': 'Clear',
  'chat.clearTitle': 'Clear this conversation',
  'chat.toSide': 'Move to the side',
  'chat.toBottom': 'Lay across the bottom',
  'chat.lede':
    'Ask anything about this book — or start with one of these. What travels with your question is set just above; nothing else leaves your device.',
  'chat.placeholder': 'Ask about this book…   (Enter to send, Shift+Enter for a new line)',
  // No keyboard hint where there is no keyboard: on a phone the
  // parenthetical is three lines of placeholder nobody can act on.
  'chat.placeholderTouch': 'Ask about this book…',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.stopTitle': 'Stop and keep what has arrived',
  'chat.dropSelection': 'Don’t send the highlighted passage',
  'chat.remove': 'Remove',
  'chat.sends': 'Sends',
  'chat.scopeNone': 'Nothing but the question',
  'chat.scopeSelection': 'The highlighted passage',
  'chat.scopeSectionPage': 'This page',
  'chat.scopeSectionChapter': 'This chapter',
  'chat.scopeSoFar': 'Everything I’ve read',
  'chat.scopeWhole': 'The whole book · spoilers',
  'chat.estimate': 'Estimated size and price of this message',
  'chat.overBudget': 'Larger than this model can take — the tail will be trimmed.',
  'chat.wontFit': 'won’t fit · ',
  'chat.tokens': 'tokens',
  'chat.model': 'Model',
  'chat.modelForBook': 'Model for this book',
  'chat.modelDefault': 'Default',
  'chat.modelNoneYet': 'none chosen yet',
  'chat.selectionLabel': 'Highlighted text',
  'chat.trimmed': 'That scope did not fit the model; the tail was trimmed.',
  'chat.noText': 'Could not read the book text; sending the question on its own.',
  'chat.keptAnswer': 'Kept answer',

  // The four things a reader actually wants from a book that can talk. Only
  // the buttons are translated: what is SENT to the model stays in English,
  // where models follow instructions best, and the answer comes back in the
  // reader's language because the system prompt says so.
  'opening.recap': 'Where was I?',
  'opening.explain': 'Explain this passage',
  'opening.summary': 'Make a summary',
  'opening.who': 'Who is this again?',
  'opening.quiz': 'Quiz me',

  // ————————————————————————— setting up a quiz —————————————————————————
  'quiz.setup': 'Set up a quiz',
  'quiz.title': 'Quiz me',
  'quiz.lede': 'on what you have read',
  'quiz.close': 'Close the quiz setup',
  'quiz.howMany': 'How many',
  'quiz.count': 'Number of questions',
  'quiz.howItRuns': 'How it runs',
  'quiz.oneAtATime': 'One question at a time',
  'quiz.oneAtATimeHint': 'Marked as you go, rather than handed over as a sheet',
  'quiz.cite': 'Answers name their passage',
  'quiz.citeHint': 'A wrong answer becomes a page you can turn to',
  'quiz.overWhat': 'Over what',
  'quiz.whatKind': 'What kind',
  'quiz.instruction': 'The instruction sent to the assistant',
  'quiz.yours': 'Yours now — the controls above have stopped rewriting it.',
  'quiz.notYours': 'Edit this and it becomes yours; the controls will leave it alone.',
  'quiz.estimate': 'Estimated size and price of this quiz',
  'quiz.scopeSection': 'This chapter',
  'quiz.scopeSectionHint': 'what you are reading now',
  'quiz.scopeSoFar': 'Everything I’ve read',
  'quiz.scopeSoFarHint': 'up to where you are',
  'quiz.scopeWhole': 'The whole book',
  'quiz.scopeWholeHint': 'spoilers — including what you have not reached',
  'quiz.kindRecall': 'What happened',
  'quiz.kindRecallHint': 'events, people, the order of things',
  'quiz.kindWhy': 'Why it happened',
  'quiz.kindWhyHint': 'motives, causes, what a passage implies',
  'quiz.kindQuotes': 'Place the quote',
  'quiz.kindQuotesHint': 'a line is quoted; you say who or where',
  'quiz.kindMixed': 'A mix',
  'quiz.kindMixedHint': 'some of each',

  // ————————————————— a message in the conversation —————————————————
  'message.goTo': 'Go to {label}',
  'message.kept': 'Kept in your marks',
  'message.keep': 'Keep this answer with your marks',

  // ———————————————————————— choosing a model ————————————————————————
  'model.choose': 'Choose a model',
  'model.list': 'Models',
  'model.searchPlaceholder': 'Search models…',
  'model.search': 'Search models',
  'model.close': 'Close the model list',
  'model.favourite': 'A favourite',
  'model.addFavourite': 'Add to favourites',

  // ————————————————————— searching the whole shelf —————————————————————
  'shelf.title': 'Search the shelf',
  'shelf.label': 'Search every book, and everything you marked',
  'shelf.placeholder': 'A title, a name, a sentence you remember…',
  'shelf.hint':
    'Type two letters or more. Titles, authors and everything you have marked answer as you type; the books themselves are read when you ask.',
  'shelf.books': 'Books',
  'shelf.marks': 'Your marks',
  'shelf.passages': 'In the books',
  'shelf.nothing':
    'Nothing on the shelf goes by that name, and nothing you marked says it. The words may still be inside a book.',
  'shelf.deep': 'Search inside every book',
  'shelf.deepRunning': 'Reading the books…',
  'shelf.progress': { one: '{done} of {count} book', other: '{done} of {count} books' },
  'shelf.unreadable': 'Could not read: {titles}.',

  // ————————————————————————— the landing film —————————————————————————
  // Each headline leans on ONE word, which is drawn with a hand-made swash
  // under it. `{swash}` is where that word goes — put it wherever your
  // language wants it, and write the word itself in the matching …Word key.
  'landing.tag': 'Of the many creatures a book may hold, only one {swash}.',
  'landing.tagWord': 'answers',
  'landing.descend': 'descend',

  'landing.importHead': 'Every library deserves a {swash}; yours finally has one.',
  'landing.importWord': 'librarian',
  'landing.importBody':
    'Bring your PDFs and EPUBs and read each one with a personal LLM at your side — a librarian for a single book, ready to talk about it whenever you are.',

  'landing.readHead': 'To read is to dream with your {swash} open.',
  'landing.readWord': 'eyes',
  'landing.readBody':
    'Bookmarks, highlights, discussions with your personal LLM assistant, everything saved. Each book remembers exactly where you left the dream.',

  'landing.contextHead': 'Half the adventure is not knowing what the next page {swash}.',
  'landing.contextWord': 'holds',
  'landing.contextBody':
    'Choose a sentence, a chapter, everything read so far or the entire book, and let your LLM assistant answer your questions with this as the base. You draw the line, and nothing beyond your selection is ever revealed to your LLM assistant.',

  'landing.groundHead': 'Nothing is answered that your pages did not {swash}.',
  'landing.groundWord': 'write',
  'landing.groundBody':
    'Your question travels with the very passage that raised it, and the reply is drawn from those lines — your book’s actual words, not a summary from somewhere else.',

  'landing.mindsHead': 'One book, many {swash} to read it with.',
  'landing.mindsWord': 'minds',
  'landing.mindsBody':
    'Bring a small NanoGPT key and choose among many minds — a different one for each book, if you like. You pay by the token, never by the month.',

  'landing.converseHead': 'A book read twice is two books; a book {swash} is a thousand.',
  'landing.converseWord': 'questioned',
  'landing.converseBody':
    'Converse, dispute, demand a quiz on last night’s chapter — the conversation is saved inside the book.',

  'landing.costHead': 'In this market, every answer shows its {swash}.',
  'landing.costWord': 'receipt',
  'landing.costBody1': 'Every reply is priced ',
  'landing.costEm': 'to the fraction of a cent',
  'landing.costBody2':
    ' and tallied per book, your balance always in sight. No subscription — only the tokens you spend.',

  'landing.closeHead': 'Somewhere on your shelf, a worm is {swash} of you.',
  'landing.closeWord': 'dreaming',
  'landing.openLibrary': 'Open your library',
  'landing.readSource': 'Read the source',
  'landing.fine': 'Free & open source · MIT · powered by NanoGPT',
  'landing.filmAlt': 'A glowing open book alone in darkness',

  // ————————————————————— a newer Bookworm is waiting —————————————————————
  // Shown only when a new version has been fetched and is waiting to take
  // over. It is an offer, never an announcement of something already done.
  'update.ready': 'A new version of Bookworm is ready.',
  'update.take': 'Reload',
  'update.taking': 'Reloading…',
  'update.later': 'Not now',

  // ———————————————————————— the first-run tour ————————————————————————
  // The tour points at ROWS, not buttons: one card per row, with a line for
  // each control in it. Keep the lines short — they are read at a glance,
  // beside the thing they describe.
  // ————————————————————— living on the device —————————————————————
  // Said once, under the nav, and then only ever in settings. A browser hands
  // over the install dialogue unannounced and exactly once; this is the app
  // asking in its own words rather than letting a strip of browser chrome ask
  // over the book.
  'install.hint': 'Bookworm can live on this device like an app.',
  // The same offer where there is no button to make it with.
  'install.hintByHand':
    'Bookworm can live on this device like an app: Share, then “Add to Home Screen”.',
  'install.action': 'Install',
  'install.dismiss': 'Not now',
  'install.title': 'Install Bookworm',
  'install.settingsHint':
    'Installed, it opens in a window of its own and keeps working with no connection. Your books do not move: they are already on this device.',
  'install.already': 'Bookworm is installed on this device.',
  'install.manual':
    'Your browser keeps this in its own menu: an install icon at the end of the address bar, or on an iPhone or iPad, Share and then “Add to Home Screen”.',

  'tour.next': 'Next',
  'tour.back': 'Back',
  'tour.skip': 'Skip the tour',
  'tour.finish': 'Done',
  'tour.count': '{n} of {total}',
  'tour.settingsTitle': 'The tour',
  'tour.settingsHint':
    'A walk through the shelf and the reader, pointing at each row of controls in turn. It runs once on a first visit; from here you can run it again whenever you like.',
  'tour.settingsButton': 'Take the tour',

  // The first card is a question: the long way round, or the short one. Keep
  // both answers to a line — they are read standing in a doorway.
  'tour.choose.title': 'Welcome to Bookworm',
  'tour.choose.lead':
    'Your books live on this device, and each one comes with an assistant that has read it. Two ways to begin:',
  // A name and a number of steps, and nothing else: the two buttons are read
  // in the second before a reader decides, and a sentence in each is a
  // sentence neither of them gets.
  'tour.choose.quickTitle': 'Quick start',
  'tour.choose.fullTitle': 'The whole tour',
  'tour.choose.steps': '{n} steps',

  'tour.quick.shelf.title': 'This is your shelf',
  'tour.quick.shelf.b1': 'Adds books — any PDF or EPUB on your device.',
  'tour.quick.shelf.b2':
    'A cover opens the book. Underneath it: the format, how far in you are, and what it has cost.',
  'tour.quick.shelf.b3':
    'Everything stays on this device. Nothing is uploaded, and there is no account.',

  'tour.quick.chat.title': 'The book, and the assistant',
  'tour.quick.chat.b1':
    'Every book opens with the LLM assistant’s chat beside it: ask about a passage, a chapter, or the whole thing.',
  'tour.quick.chat.b2':
    'The dropdown “Sends” decides how much of the book travels with your question — send only what you have read and nothing later can be spoiled.',
  'tour.quick.chat.b3': 'Beside it, the price of the answer, worked out before you send it.',

  'tour.quick.key.title': 'Three steps to a working assistant',
  'tour.quick.key.b1': 'Open NanoGPT and sign in — or use it without an account, which it allows.',
  'tour.quick.key.b2':
    'Add a little balance: card, Apple Pay or Google Pay, or Bitcoin, Monero, Solana and others.',
  'tour.quick.key.b3':
    'Create an API key and paste it in the box below this. You are done — the assistant answers from then on.',
  'tour.quick.key.b4':
    'Our invitation link takes 5% off every model call, forever. It is the link in step one.',

  'tour.welcome.title': 'Welcome to Bookworm',
  'tour.welcome.b1':
    'Your books live on this device, in this browser. Nothing is uploaded, and there is no account.',
  'tour.welcome.b2':
    'Each book comes with an assistant that has read it — it answers from your pages, not from somewhere else.',
  'tour.welcome.b3':
    'We have put a short book on your shelf to try all this on. Remove it whenever you like.',

  'tour.controls.title': 'The shelf’s controls',
  'tour.controls.b1': 'Adds books — any PDF or EPUB on your device.',
  'tour.controls.b2': 'Switches between big covers and covers with details.',
  'tour.controls.b3': 'Searches every book at once, and everything you have marked in them.',
  'tour.controls.b4': 'Sorts the shelf: reading, finished, date added, format.',
  'tour.controls.b5':
    'Export your whole library to a file, and read one back — your books, marks and conversations together.',

  'tour.card.title': 'A book on the shelf',
  'tour.card.b1': 'The cover opens it. A book with no cover art gets one drawn from its title.',
  'tour.card.b2':
    'Underneath: the format, the size, how far in you are, and how long you have read.',
  'tour.card.b3': 'Mark it finished when you are done, or remove it from the shelf entirely.',

  'tour.nav.title': 'The top bar',
  'tour.nav.b1': 'Opens support — every link opens an issue on GitHub.',
  'tour.nav.b2': 'Changes the language, any time.',
  'tour.nav.b3': 'Switch between light and dark.',
  'tour.nav.b4': 'Holds your NanoGPT key, your model, and this tour if you want it again.',

  'tour.open.title': 'Let’s open it',
  'tour.open.b1': 'Press Next and we will go inside the book, where most of Bookworm lives.',

  'tour.toolbar.title': 'The reader’s tools',
  'tour.toolbar.b1':
    'Pages side by side, or one at a time — on a phone, a single strip you scroll.',
  'tour.toolbar.b2': 'Sets the size and the typeface.',
  'tour.toolbar.b3': 'Hides everything but the book.',
  'tour.toolbar.b4': 'Lights the page itself, apart from the app around it.',
  'tour.toolbar.b5': 'Chooses your highlighter, and marks the passage you have selected.',
  'tour.toolbar.b6': 'Everything you have saved in this book, and a search through it.',

  'tour.page.title': 'Your place in the book',
  'tour.page.b1': 'Pull its chain to bookmark this spot. Pull it again to remove the bookmark.',
  'tour.page.b2': 'The corner folds over when a page is bookmarked.',
  'tour.page.b3':
    'Above the page: the book’s name, where you are in it, and what it has cost you so far.',

  'tour.selection.title': 'Select any words',
  'tour.selection.b1': 'Highlight a passage and this offers five colours for it.',
  'tour.selection.b2':
    'Select a single word and this appears beside it: ask what it means, here, in this sentence.',
  'tour.selection.b3': 'Tap the left or right edge of the page to turn it. Swipe works too.',

  'tour.pager.title': 'Moving through it',
  'tour.pager.b1':
    'Previous and Next, or the arrow keys — on a phone, a tap or a swipe at the page’s edge.',
  'tour.pager.b2': 'Contents lists the chapters and shows your current position.',
  'tour.pager.b3': 'In a PDF you can also type a page number and jump straight to it.',

  'tour.assistant.title': 'Ask the book',
  'tour.assistant.b1':
    'It answers from the pages you send it — a passage, this chapter, everything you have read, or the whole book.',
  'tour.assistant.b2':
    'Spoilers are yours to allow: send only what you have read and nothing later can be revealed.',
  'tour.assistant.b3':
    'Every answer is priced to the fraction of a cent, before you send the request.',

  'tour.chat.title': 'This is the assistant',
  'tour.chat.b1':
    'I have opened the chat so you can see it: the conversation above, the box you write in below, and the book still there beside it.',
  'tour.chat.b2':
    'Under the box, “Sends” decides how much of the book travels with your question, and beside it, the total cost — ready for you to check the price before you hit send.',
  'tour.chat.b3':
    'The model is chosen per book, so a difficult one can be given a better reader than a light one.',
  'tour.chat.b4':
    'Drag the edge to give the book more room, or move the panel to the side; the header keeps your place in the book and says whether spoilers are allowed.',
  'tour.chat.b5':
    'It is empty until you have a NanoGPT key — nothing is sent, and nothing is charged, until you ask something.',

  'tour.done.title': 'That is the end of the tour',
  'tour.done.b1': 'The book you were just in waits here, at the page you left.',
  'tour.done.b2':
    'To talk to a book you will need a NanoGPT key — the settings menu accessible from the top explains how, this tour can also be taken again through there if you need to. Enjoy your stay!',

  // —————————————————— the short book the tour brings ——————————————————
  // A book, not an instruction manual: it is there to be read, marked and
  // asked about. Translate it as prose — it is the first thing a reader sees
  // inside the reader, and it should sound like a book in their language.
  'sample.title': 'The Worm in the Library',
  'sample.author': 'A resident worm',
  'sample.ch1.title': 'In which a worm is introduced',
  'sample.ch1.p1':
    'There was once a worm who lived in a library, which is a common enough arrangement and rarely remarked upon. He had been born between the endpapers of an atlas and had eaten his way outward in every direction, so that by the time he was grown he knew the shape of the world without ever having seen any of it.',
  'sample.ch1.p2':
    'The librarians never troubled him. Worms are quiet tenants, and this one paid his rent by keeping the paper from growing too still. He had opinions about every book he had passed through, and no one at all to tell them to.',
  'sample.ch1.p3':
    'This is the ordinary tragedy of a reading life, and it is not usually thought of as a tragedy at all: you finish a book, you close it, and the only person who has read exactly what you have read is you.',
  'sample.ch2.title': 'In which a book answers back',
  'sample.ch2.p1':
    'One evening — and it is always one evening, in stories of this kind — the worm reached the last page of a long novel and found, written under the final line, a question. Not a printed question. A question addressed to him, about the book he had just finished.',
  'sample.ch2.p2':
    'He answered it, because it would have been rude not to. The book answered his answer. They argued about the middle chapters until the reading lamps went out, and by morning the worm understood the novel rather better than its author had.',
  'sample.ch2.p3':
    'It was not that the book knew more than he did. It knew exactly what he knew — it had only the same pages he had — but it was willing to be asked, and no book had ever been willing before.',
  'sample.ch3.title': 'In which you are, apparently, expected',
  'sample.ch3.p1':
    'The worm has been in the library a long while now, and he has grown used to being asked things. What he has never grown used to is how much a book will give up when someone finally puts a question to it.',
  'sample.ch3.p2':
    'So: this is a book. It is short, and it is yours, and you may delete it the moment it has served its purpose. But while you are here — highlight a line of it, bookmark this page, and ask it something. That is the whole of what Bookworm is for.',

  'landing.medallion':
    'Bookworm medallion: a worm tied into an endless knot, hung as a gold charm with a tassel',
} satisfies Catalogue

export default en
