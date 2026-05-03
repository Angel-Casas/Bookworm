# foliate-js notes (Phase 2.1)

Pinned version: **1.0.1** (added 2026-05-03)

We use foliate-js solely from `EpubReaderAdapter.ts`. This document records
which foliate-js exports we depend on and why, so a future engine swap or
foliate-js upgrade is bounded.

## Import path

foliate-js's `package.json` only declares `"exports": { "./*.js": "./*.js" }`.
There is **no** bare entry point — `import 'foliate-js'` will fail. We must
use the subpath:

```ts
import 'foliate-js/view.js';   // side-effectful: registers <foliate-view>
```

Importing `view.js` runs `customElements.define('foliate-view', View)` at the
bottom of the file, after which we create instances with
`document.createElement('foliate-view')`.

## Mapping `BookReader` methods → foliate-js APIs

| BookReader method        | foliate-js API used                                                          |
| ------------------------ | ---------------------------------------------------------------------------- |
| `open(blob, opts)`       | `view.open(blob)` then `view.init({ lastLocation })`                         |
| `getCurrentAnchor()`     | `view.lastLocation.cfi` (populated after the first `relocate` event)         |
| `goToAnchor(anchor)`     | `view.goTo(anchor.cfi)` for `kind: 'epub-cfi'`                               |
| `applyPreferences(prefs)`| `view.renderer.setStyles(css)` + `view.renderer.setAttribute('flow', ...)`   |
| `onLocationChange(fn)`   | `view.addEventListener('relocate', e => fn({ kind: 'epub-cfi', cfi: e.detail.cfi }))` |
| `destroy()`              | `view.close()` then `view.remove()`                                          |

## TOC shape

`view.book.toc` is an array of `{ label, href, subitems? }`. We flatten this
to our `TocEntry[]` (with `depth`) in the adapter. We use the `href` as the
TOC entry's stable `id`. For the entry's `LocationAnchor`, foliate-js accepts
hrefs in `view.goTo(href)` so we can store the href in the `cfi` field of an
`epub-cfi` anchor — but for cleanest semantics, after the first relocate we
prefer the actual CFI from `view.lastLocation`.

## Mode toggle (scroll vs paginated)

```ts
view.renderer.setAttribute('flow', 'scrolled');   // scroll mode
view.renderer.setAttribute('flow', 'paginated');  // default
```

## Styling

`view.renderer.setStyles(cssString)` injects the given CSS into the rendered
EPUB content (inside the renderer's iframe / shadow root). Best practice:
include `!important` on user typography rules to win against book stylesheets.
Color tokens (background, foreground) should be CSS variables that the
renderer reads from its host context, OR baked into the injected CSS.

## Things foliate-js does NOT do for us

- **Persistence** — we own that (`readingProgressRepo`).
- **Selection events** — Phase 3 (annotations) will add wiring; foliate-js
  exposes selection through the renderer but we don't need it now.
- **Theme tokens** — we map our `ReaderTheme` (`light` / `dark` / `sepia`)
  to CSS values in the adapter.
- **Sandboxing** — the renderer uses iframes; we do not interact directly
  with their content for v2.1.

## Known caveats

- `view.lastLocation` is `null` until the first `relocate` event fires (after
  `init` completes). Don't call `getCurrentAnchor()` before then; if you must,
  return a sentinel `epub-cfi` with empty `cfi` and let the next relocate
  event populate it.
- `view.open(blob)` internally calls `makeBook(blob)` which uses dynamic
  `import('./vendor/zip.js')` and friends. **Vite handles this fine in dev
  and prod**, but jsdom integration tests cannot exercise the rendering path
  — restrict adapter unit tests to lifecycle + TOC and let E2E cover render.
- foliate-js README explicitly says the API may break between releases. We've
  pinned to `1.0.1` and isolated the dependency to this adapter; upgrades go
  through the adapter test suite + a manual smoke pass.
- The `foliate-view` custom element attaches a closed shadow root; we cannot
  query into it from outside. All interaction is through the View's public API.
- **Paginator ResizeObserver leak on destroy.** `Paginator.destroy()` and
  the inner `View.destroy()` only call `unobserve(target)` — never
  `disconnect()`. Once the iframe is removed, queued callbacks fire against
  a null contentDocument and throw `TypeError: Cannot read properties of
  null (reading 'createTreeWalker')` repeatedly until the observer is GC'd.
  Our adapter monkey-patches `window.ResizeObserver` between `open()` and
  `destroy()` to track every observer foliate-js creates, then force-
  `disconnect()`s them in `destroy()`. The patch is bounded: only this
  adapter's lifetime, restored on destroy. This matters because some
  browser extensions (SES / lockdown-install.js, used by wallets like
  MetaMask) catch unhandled rejections at a level deeper than
  `event.preventDefault()` can suppress, so a one-second error swallower
  isn't enough — we have to stop the rejections from happening at all.
- **Iframe `<body onload="...">` handlers throw inside the sandbox.** Older
  EPUBs (e.g. Project Gutenberg's Pride and Prejudice) have legacy onload
  handlers calling functions defined in the EPUB's own scripts, which the
  sandbox blocks. The error is per-chapter noise (`Body_onLoad is not defined`)
  and doesn't break navigation. Modern EPUBs without onload handlers are clean.
- **React StrictMode dev-mode double-invocation.** In dev, `useEffect` runs
  mount → cleanup → mount, which destroys + recreates the adapter. The
  adapter's `open()` defensively clears any leftover `<foliate-view>` from
  the host before mounting its own; without that, the host could end up with
  two stacked views in dev mode.
- **`iframe sandbox` browser warning is unavoidable.** foliate-js sets
  `<iframe sandbox="allow-same-origin allow-scripts">` to render EPUB
  content, with an explicit comment in `paginator.js` referencing
  [WebKit bug #218086](https://bugs.webkit.org/show_bug.cgi?id=218086).
  Chrome warns that the combination defeats sandboxing — that's a dev
  console warning we cannot eliminate from this side.
- **Legacy EPUBs (e.g. Project Gutenberg's Pride and Prejudice) trigger
  one `Body_onLoad is not defined` error per chapter** because they have
  `<body onload="Body_onLoad()">` referencing a function defined elsewhere
  in the EPUB that doesn't load in foliate-js's iframe sandbox. The error
  itself is single-fire and harmless to navigation. **However:** if the
  user has an extension installed that hooks SES (MetaMask, Lavamoat-
  protected wallets, etc.), `lockdown-install.js` may amplify that single
  iframe error into a console flood of `SES_UNCAUGHT_EXCEPTION: null`.
  The flood disappears in incognito (no extension) and never appears with
  modern EPUBs (no inline onload handlers). It is a known
  [MetaMask quirk](https://github.com/MetaMask/metamask-extension/issues/20937),
  not a bug in our code or in foliate-js. Documented here so we don't
  chase it again.
