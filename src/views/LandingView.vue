<script setup lang="ts">
/**
 * "Filigrana" — the landing page is a scroll-scrubbed film dressed as a
 * jeweler's vitrine: fine gold frames, an endless-knot medallion, charm
 * emblems on double threads. Scrolling maps to the film's currentTime; copy
 * beats surface at times defined in src/lib/reel.ts, and all entrance
 * choreography is CSS driven by three hooks this component sets per beat:
 * the --k custom property (0..1), data-state="in|out", and .live.
 * Falls back to a static page for reduced-motion visitors or when the video
 * cannot load.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { GITHUB_REPO_URL } from '@/config'
import { markLandingSeen } from '@/services/firstRun'
import { useI18n } from '@/i18n'
import SwashText from '@/components/ui/SwashText.vue'
import {
  beatOpacity,
  chooseReelSource,
  expBlend,
  quantizeToFilmFrame,
  REEL_BEATS,
  REEL_FALLBACK_DURATION,
  trackHeight,
} from '@/lib/reel'

const { t } = useI18n()

const film = ref<HTMLVideoElement | null>(null)
const reelRoot = ref<HTMLDivElement | null>(null)
const trackEl = ref<HTMLDivElement | null>(null)
const beatRefs = ref<Record<string, HTMLElement | null>>({})

const staticMode = ref(false)
const veiled = ref(true)
const chromeOn = ref(false)
const filmSrc = ref('')

/**
 * A file from `public/`, addressed from wherever the app is served.
 *
 * Bookworm is not always at the root of a domain — on GitHub Pages it lives
 * under /Bookworm/ — so an absolute `/landing/…` is a 404 there and the whole
 * film goes blank. `BASE_URL` is whatever the build was given, and it always
 * ends in a slash.
 */
const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`

function setBeatRef(id: string) {
  return (el: unknown) => {
    beatRefs.value[id] = el instanceof HTMLElement ? el : null
  }
}

let duration = REEL_FALLBACK_DURATION
let shown = 0
let rafId = 0
let revealed = false
let revealTimer: ReturnType<typeof setTimeout> | null = null

// Scrub smoothing state
let lastTs = 0

function layoutTrack(): void {
  if (trackEl.value) {
    trackEl.value.style.height = `${trackHeight(duration, window.innerHeight)}px`
  }
}

function render(t: number): void {
  REEL_BEATS.forEach((beat) => {
    const el = beatRefs.value[beat.id]
    if (!el) return
    const k = beatOpacity(t, beat)
    el.style.setProperty('--k', k.toFixed(3))
    el.dataset.state = k > 0.02 ? 'in' : 'out'
    el.classList.toggle('live', k > 0.5)
  })
}

function frame(ts: number): void {
  if (staticMode.value) return
  const video = film.value
  const track = trackEl.value
  if (!video || !track) return
  const dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60
  lastTs = ts
  const max = track.offsetHeight - window.innerHeight
  const progress = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0
  const target = progress * duration

  const delta = target - shown
  // Frame-rate-independent smoothing: identical feel at 60Hz and 120Hz.
  shown = Math.abs(delta) < 0.004 ? target : shown + delta * expBlend(dt)

  // Browsers coalesce rapid currentTime writes safely; gating on 'seeked'
  // can deadlock some decoders (see Docs/LESSONS.md). Seeks land on the
  // film's own 30fps frame grid to avoid wasted sub-frame decodes.
  const quantized = quantizeToFilmFrame(shown)
  if (revealed && Math.abs(video.currentTime - quantized) > 1 / 90) {
    video.currentTime = Math.min(Math.max(quantized, 0), duration - 0.05)
  }
  render(shown)
  stepSwingers(dt)
  rafId = requestAnimationFrame(frame)
}

function reveal(): void {
  if (revealed) return
  revealed = true
  veiled.value = false
  chromeOn.value = true
  render(0)
}

function goStatic(): void {
  staticMode.value = true
  veiled.value = false
}

/**
 * Hanging things obey the cursor: each charm (and the hero medallion) is a
 * tiny damped pendulum. When the pointer drifts near, it pushes the bob away
 * like a physical object; the spring swings it back with decaying oscillation.
 * theta/omega are integrated per frame in the existing rAF loop.
 */
interface Swinger {
  el: HTMLElement
  sect: HTMLElement | null
  theta: number
  omega: number
  spring: number
  damping: number
  push: number
  radius: number
  maxTheta: number
}
let swingers: Swinger[] = []
let mouseX = -1e4
let mouseY = -1e4

function onMouseMove(event: MouseEvent): void {
  mouseX = event.clientX
  mouseY = event.clientY
}

function collectSwingers(): void {
  const root = reelRoot.value
  if (!root) return
  const charms = Array.from(root.querySelectorAll<HTMLElement>('.charm .sw')).map((el) => ({
    el,
    sect: el.closest('section'),
    theta: 0,
    omega: 0,
    spring: 64,
    damping: 1.7,
    push: 20,
    radius: 90,
    maxTheta: 0.5,
  }))
  const pend = root.querySelector<HTMLElement>('.pend')
  swingers = pend
    ? [
        ...charms,
        {
          el: pend,
          sect: pend.closest('section'),
          theta: 0,
          omega: 0,
          spring: 22,
          damping: 1.0,
          push: 3,
          radius: 170,
          maxTheta: 0.13,
        },
      ]
    : charms
}

function stepSwingers(dt: number): void {
  const pdt = Math.min(dt, 0.05)
  for (const s of swingers) {
    if (s.sect?.dataset.state === 'in') {
      const rect = s.el.getBoundingClientRect()
      const bobX = rect.left + rect.width / 2
      const bobY = rect.top + rect.height * 0.7
      const dx = bobX - mouseX
      const dy = bobY - mouseY
      const dist = Math.hypot(dx, dy)
      if (dist < s.radius && dist > 0.001) {
        const falloff = 1 - dist / s.radius
        s.omega += Math.sign(dx || 1) * s.push * falloff * falloff * pdt
      }
    }
    s.omega += (-s.spring * s.theta - s.damping * s.omega) * pdt
    s.theta += s.omega * pdt
    if (s.theta > s.maxTheta) {
      s.theta = s.maxTheta
      if (s.omega > 0) s.omega = 0
    } else if (s.theta < -s.maxTheta) {
      s.theta = -s.maxTheta
      if (s.omega < 0) s.omega = 0
    }
    if (Math.abs(s.theta) > 0.0004 || Math.abs(s.omega) > 0.0004) {
      s.el.style.transform = `rotate(${((s.theta * 180) / Math.PI).toFixed(3)}deg)`
    } else if (s.el.style.transform) {
      s.el.style.transform = ''
      s.theta = 0
      s.omega = 0
    }
  }
}

/** A word-art title that fails to load (e.g. not yet exported) collapses quietly. */
function hideArt(event: Event): void {
  const el = event.target
  if (el instanceof HTMLElement) el.style.display = 'none'
}

// Paint the document itself black while the landing is mounted, so
// rubber-band overscroll past the top or bottom never flashes the app's
// default background — the bounce stays seamless with the film's void.
let prevHtmlBg = ''
let prevBodyBg = ''

onMounted(() => {
  // Seen once is enough: from here on the app opens on the shelf, and the
  // medallion in the nav is the way back here.
  markLandingSeen()
  prevHtmlBg = document.documentElement.style.background
  prevBodyBg = document.body.style.background
  document.documentElement.style.background = '#050506'
  document.body.style.background = '#050506'

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    goStatic()
    return
  }
  const video = film.value
  if (!video) {
    goStatic()
    return
  }
  const small = Math.min(window.innerWidth, window.innerHeight) < 700 && window.innerWidth < 761
  const canH264 = video.canPlayType('video/mp4; codecs="avc1.42E01E"') !== ''
  filmSrc.value = asset(chooseReelSource(small, canH264))

  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration) && video.duration > 1) duration = video.duration
    layoutTrack()
  })
  video.addEventListener('canplaythrough', reveal)
  video.addEventListener('canplay', () => setTimeout(reveal, 600))
  video.addEventListener('error', goStatic)
  revealTimer = setTimeout(() => {
    if (!revealed) reveal()
  }, 9000)

  window.addEventListener('resize', layoutTrack)
  window.addEventListener('mousemove', onMouseMove, { passive: true })
  collectSwingers()
  layoutTrack()
  rafId = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  document.documentElement.style.background = prevHtmlBg
  document.body.style.background = prevBodyBg
  cancelAnimationFrame(rafId)
  if (revealTimer) clearTimeout(revealTimer)
  window.removeEventListener('resize', layoutTrack)
  window.removeEventListener('mousemove', onMouseMove)
})
</script>

<template>
  <div ref="reelRoot" class="reel" :class="{ static: staticMode }">
    <!-- goldwork catalog: key-fret corner + eight charm emblems, fine gold line-work -->
    <svg width="0" height="0" class="defs" aria-hidden="true">
      <defs>
        <symbol id="fret" viewBox="0 0 48 48">
          <g fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path
              pathLength="1"
              stroke="#d1921e"
              stroke-width="1.3"
              style="stroke-dasharray: 1; stroke-dashoffset: var(--f1, 0)"
              d="M48 2.5H10.5Q2.5 2.5 2.5 10.5V48"
            />
            <path
              pathLength="1"
              stroke="#8a5f18"
              stroke-width="1"
              style="stroke-dasharray: 1; stroke-dashoffset: var(--f2, 0)"
              d="M48 8.5H14v5.5M8.5 48V14h5.5"
            />
            <path
              pathLength="1"
              stroke="#d1921e"
              stroke-width="1.1"
              style="stroke-dasharray: 1; stroke-dashoffset: var(--f3, 0)"
              d="M14 14h9v6h-5.2v-3.2"
            />
            <path
              pathLength="1"
              stroke="#f0ae2f"
              stroke-width="1"
              style="stroke-dasharray: 1; stroke-dashoffset: var(--f4, 0)"
              d="M25.5 21.5q7 1.8 9.8 8M28 23q3.5-3.2 8-3.4M23 26q-.4 4.8 2.8 8.6"
            />
          </g>
        </symbol>
        <symbol id="em-import" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <g
            fill="none"
            stroke="#f0ae2f"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="13.5" y="22" width="13" height="12" rx="1.2" />
            <path d="M17 22v12M20.5 26h4M20.5 29h4" />
          </g>
        </symbol>
        <symbol id="em-read" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <g
            fill="none"
            stroke="#f0ae2f"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14.5 26h11l-2.6-6.5h-5.8z M20 26v5.5M16 33.5h8" />
          </g>
        </symbol>
        <symbol id="em-context" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <g
            fill="none"
            stroke="#f0ae2f"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 20.5v15M26 20.5v15M10.5 28q4.75-2.6 9.5 0t9.5 0" />
          </g>
        </symbol>
        <symbol id="em-ink" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <g
            fill="none"
            stroke="#f0ae2f"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M13.5 34h13M16.5 30v-7.5M20 30V18.5M23.5 30v-6" />
          </g>
        </symbol>
        <symbol id="em-minds" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <g fill="none" stroke="#f0ae2f" stroke-width="1.4">
            <circle cx="20" cy="20.8" r="2.3" />
            <circle cx="13" cy="25.9" r="2.3" />
            <circle cx="15.7" cy="34.2" r="2.3" />
            <circle cx="24.3" cy="34.2" r="2.3" />
            <circle cx="27" cy="25.9" r="2.3" />
          </g>
          <circle cx="20" cy="28.2" r="1.2" fill="#f0ae2f" />
        </symbol>
        <symbol id="em-ask" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <path
            d="M15.8 24.5a4.4 4.4 0 1 1 6.9 3.6q-2.7 1.7-2.7 3.9"
            fill="none"
            stroke="#f0ae2f"
            stroke-width="1.7"
            stroke-linecap="round"
          />
          <circle cx="20" cy="35.2" r="1.4" fill="#f0ae2f" />
        </symbol>
        <symbol id="em-price" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <g fill="none" stroke="#f0ae2f" stroke-width="1.5" stroke-linejoin="round">
            <circle cx="20" cy="28" r="8.2" />
            <rect x="16.6" y="24.6" width="6.8" height="6.8" />
          </g>
        </symbol>
        <symbol id="em-final" viewBox="0 0 40 48">
          <g
            fill="none"
            stroke="#d1921e"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="20" cy="5" r="2.8" />
            <path d="M20 7.8v4.7" />
            <circle cx="20" cy="28" r="15.5" />
          </g>
          <path
            d="M27.5 28a7.5 7.5 0 1 1-7.5-7.5 4.5 4.5 0 1 1 0 9 1.9 1.9 0 1 1 0-3.8"
            fill="none"
            stroke="#f0ae2f"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <circle cx="27.5" cy="28" r="1.5" fill="#f0ae2f" />
        </symbol>
      </defs>
    </svg>

    <div v-if="veiled" class="veil" aria-hidden="true">
      <div class="veil-mark">Bookworm</div>
      <div class="veil-thread"><i></i></div>
      <div class="veil-sub">threading the reel</div>
    </div>

    <RouterLink v-if="!staticMode" class="skip" :class="{ on: chromeOn }" to="/library">
      {{ t('library.title') }}
      <!-- The arrow points the way OUT of the film, which is not the same
           direction in every language. -->
      <span class="skip-arrow" aria-hidden="true">→</span>
    </RouterLink>

    <div ref="trackEl" class="track">
      <div class="stage">
        <video
          v-if="!staticMode"
          ref="film"
          class="film"
          :src="filmSrc || undefined"
          muted
          playsinline
          preload="auto"
          :poster="asset('landing/poster.jpg')"
        ></video>
        <img
          v-else
          class="poster"
          :src="asset('landing/poster.jpg')"
          :alt="t('landing.filmAlt')"
        />

        <!-- I — the medallion descends -->
        <section :ref="setBeatRef('hero')" class="beat st-hero" data-state="out">
          <div class="pend">
            <div class="psw">
              <i class="drawline" aria-hidden="true"></i>
              <svg
                class="logo"
                viewBox="0 0 120 132"
                role="img"
                :aria-label="t('landing.medallion')"
              >
                <g fill="none" stroke="#d1921e" stroke-linecap="round" stroke-linejoin="round">
                  <circle
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.02; --ad: 0.1s"
                    cx="60"
                    cy="7"
                    r="3.2"
                    stroke-width="1.5"
                  />
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.06; --ad: 0.22s"
                    d="M60 10.2v3.4"
                    stroke-width="1.5"
                  />
                  <circle
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.1; --ad: 0.3s"
                    cx="60"
                    cy="56"
                    r="38.5"
                    stroke-width="1.4"
                  />
                  <circle
                    class="beads"
                    cx="60"
                    cy="56"
                    r="43.5"
                    stroke-width="2.6"
                    stroke-dasharray="0 5.2"
                  />
                </g>
                <g fill="none" stroke="#f0ae2f" stroke-width="2" stroke-linecap="round">
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.24; --ad: 0.5s"
                    d="M60 56C51 46 51 30 60 30C69 30 69 46 60 56"
                  />
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.3; --ad: 0.62s"
                    d="M60 56C51 46 51 30 60 30C69 30 69 46 60 56"
                    transform="rotate(90 60 56)"
                  />
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.36; --ad: 0.74s"
                    d="M60 56C51 46 51 30 60 30C69 30 69 46 60 56"
                    transform="rotate(180 60 56)"
                  />
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.42; --ad: 0.86s"
                    d="M60 56C51 46 51 30 60 30C69 30 69 46 60 56"
                    transform="rotate(270 60 56)"
                  />
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.5; --ad: 1s"
                    stroke-width="1.4"
                    d="M75.6 40.4l5.6-5.6M44.4 40.4l-5.6-5.6M75.6 71.6l5.6 5.6M44.4 71.6l-5.6 5.6"
                  />
                </g>
                <g class="hd">
                  <circle cx="60" cy="27.5" r="2.6" fill="#f0ae2f" />
                  <circle cx="61" cy="27" r="0.9" fill="#050506" />
                </g>
                <g fill="none" stroke="#d1921e" stroke-linecap="round" stroke-linejoin="round">
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.56; --ad: 1.1s"
                    d="M60 94.5v3"
                    stroke-width="1.4"
                  />
                  <rect
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.6; --ad: 1.18s"
                    x="57"
                    y="98"
                    width="6"
                    height="6"
                    transform="rotate(45 60 101)"
                    stroke-width="1.4"
                  />
                  <path
                    class="tr"
                    pathLength="1"
                    style="--w0: 0.66; --ad: 1.3s"
                    stroke-width="1.3"
                    d="M55.5 106.5L52.8 126M60 107.5V128M64.5 106.5L67.2 126"
                  />
                </g>
              </svg>
            </div>
          </div>
          <div class="markrow">
            <i class="rule rl" aria-hidden="true"></i>
            <h1 class="mark">Bookworm</h1>
            <i class="rule rr" aria-hidden="true"></i>
          </div>
          <p class="tag">
            <SwashText
              :text="t('landing.tag')"
              :word="t('landing.tagWord')"
              path="M3 6.8Q26 3.2 51 5.6T97 4.6"
            />
          </p>
          <span class="cue">{{ t('landing.descend') }}</span>
        </section>

        <!-- II -->
        <section :ref="setBeatRef('import')" class="beat side-l" data-state="out" style="--y: 36%">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Library.png')" alt="Library" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.importHead')"
                  :word="t('landing.importWord')"
                  path="M3 6.8Q26 3.2 51 5.6T97 4.6"
                />
              </span>
            </h2>
            <p class="bd">{{ t('landing.importBody') }}</p>
          </div>
        </section>

        <!-- III -->
        <section :ref="setBeatRef('read')" class="beat side-r" data-state="out" style="--y: 60%">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Dream.png')" alt="Dream" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.readHead')"
                  :word="t('landing.readWord')"
                  path="M3 6.2Q30 3.8 55 5.8T97 4.2"
                />
              </span>
            </h2>
            <p class="bd">{{ t('landing.readBody') }}</p>
          </div>
        </section>

        <!-- IV -->
        <section :ref="setBeatRef('context')" class="beat side-l" data-state="out" style="--y: 28%">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Adventure.png')" alt="Adventure" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.contextHead')"
                  :word="t('landing.contextWord')"
                  path="M3 5.6Q28 3 52 5.4T97 4.8"
                />
              </span>
            </h2>
            <p class="bd">{{ t('landing.contextBody') }}</p>
          </div>
        </section>

        <!-- V -->
        <section :ref="setBeatRef('ink')" class="beat side-r" data-state="out" style="--y: 64%">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Ink.png')" alt="Ink" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.groundHead')"
                  :word="t('landing.groundWord')"
                  path="M4 6.5Q35 3.5 60 5.5T96 4.4"
                />
              </span>
            </h2>
            <p class="bd">{{ t('landing.groundBody') }}</p>
          </div>
        </section>

        <!-- VI -->
        <section :ref="setBeatRef('models')" class="beat low-l" data-state="out">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Lens.png')" alt="Lens" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.mindsHead')"
                  :word="t('landing.mindsWord')"
                  path="M3 6Q27 3.4 53 5.7T97 4.3"
                />
              </span>
            </h2>
            <p class="bd">{{ t('landing.mindsBody') }}</p>
          </div>
        </section>

        <!-- VII -->
        <section :ref="setBeatRef('ask')" class="beat side-r" data-state="out" style="--y: 32%">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Time.png')" alt="Time" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.converseHead')"
                  :word="t('landing.converseWord')"
                  path="M3 6.6Q29 3 54 5.4T97 4.7"
                />
              </span>
            </h2>
            <p class="bd">{{ t('landing.converseBody') }}</p>
          </div>
        </section>

        <!-- VIII -->
        <section
          :ref="setBeatRef('receipts')"
          class="beat side-l"
          data-state="out"
          style="--y: 56%"
        >
          <div class="frame">
            <img class="wordart" :src="asset('landing/Market.png')" alt="Market" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.costHead')"
                  :word="t('landing.costWord')"
                  path="M3 5.8Q30 3.2 54 5.6T97 4.5"
                />
              </span>
            </h2>
            <p class="bd">
              {{ t('landing.costBody1') }}<em>{{ t('landing.costEm') }}</em
              >{{ t('landing.costBody2') }}
            </p>
          </div>
        </section>

        <!-- IX — colophon: the charms come home to one string -->
        <section :ref="setBeatRef('final')" class="beat st-final" data-state="out">
          <div class="frame">
            <img class="wordart" :src="asset('landing/Somewhere.png')" alt="Somewhere" @error="hideArt" />
            <svg class="fc c1" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c2" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c3" aria-hidden="true"><use href="#fret" /></svg>
            <svg class="fc c4" aria-hidden="true"><use href="#fret" /></svg>
            <i class="hl hl-t1" aria-hidden="true"></i><i class="hl hl-t2" aria-hidden="true"></i>
            <i class="hl hl-b1" aria-hidden="true"></i><i class="hl hl-b2" aria-hidden="true"></i>
            <i class="hl hl-l1" aria-hidden="true"></i><i class="hl hl-l2" aria-hidden="true"></i>
            <i class="hl hl-r1" aria-hidden="true"></i><i class="hl hl-r2" aria-hidden="true"></i>
            <i class="dot dot-t" aria-hidden="true"></i><i class="dot dot-b" aria-hidden="true"></i>
            <i class="dot dot-l" aria-hidden="true"></i><i class="dot dot-r" aria-hidden="true"></i>
            <h2 class="aph">
              <span class="l">
                <SwashText
                  :text="t('landing.closeHead')"
                  :word="t('landing.closeWord')"
                  path="M3 6.4Q28 3.4 52 5.6T97 4.4"
                />
              </span>
            </h2>
            <div class="string" aria-hidden="true">
              <i class="strline"></i>
              <span class="charm" style="--i: 0; left: 7.5%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-import" /></svg></span
              ></span>
              <span class="charm" style="--i: 1; left: 20%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-read" /></svg></span
              ></span>
              <span class="charm" style="--i: 2; left: 32.5%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-context" /></svg></span
              ></span>
              <span class="charm" style="--i: 3; left: 45%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-ink" /></svg></span
              ></span>
              <span class="charm" style="--i: 4; left: 57.5%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-minds" /></svg></span
              ></span>
              <span class="charm" style="--i: 5; left: 70%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-ask" /></svg></span
              ></span>
              <span class="charm" style="--i: 6; left: 82.5%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-price" /></svg></span
              ></span>
              <span class="charm" style="--i: 7; left: 95%"
                ><span class="sw"
                  ><i class="th"></i><svg viewBox="0 0 40 48"><use href="#em-final" /></svg></span
              ></span>
            </div>
            <nav class="cta-row">
              <RouterLink class="cta primary" to="/library">{{
                t('landing.openLibrary')
              }}</RouterLink>
              <a class="cta ghost" :href="GITHUB_REPO_URL" target="_blank" rel="noopener">
                {{ t('landing.readSource') }}
              </a>
            </nav>
            <p class="fine">{{ t('landing.fine') }}</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reel {
  --void: #050506;
  --paper: #ede7db;
  --silver: #c2c9d2;
  --silver-dim: #8a919c;
  --gold: #d1921e;
  --goldhi: #f0ae2f;
  --golddim: #8a5f18;
  --goldhair: rgba(209, 146, 30, 0.55);
  --goldhair2: rgba(209, 146, 30, 0.34);
  --ease-wipe: cubic-bezier(0.22, 0.61, 0.2, 1);
  background: var(--void);
  color: var(--paper);
  font-family: 'Spectral', Georgia, serif;
}
.reel ::selection {
  background: rgba(240, 174, 47, 0.35);
}
.defs {
  position: absolute;
}

.track {
  position: relative;
}
.stage {
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100svh;
  overflow: hidden;
}
.film,
.poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 50%;
}

.veil {
  position: fixed;
  inset: 0;
  background: var(--void);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.2rem;
  z-index: 40;
}
.veil-mark {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 1.3rem;
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  text-transform: uppercase;
}
.veil-thread {
  width: 9rem;
  height: 1px;
  background: var(--goldhair2);
  overflow: hidden;
}
.veil-thread i {
  display: block;
  height: 100%;
  width: 40%;
  background: var(--goldhi);
  animation: thread 1.4s ease-in-out infinite;
}
@keyframes thread {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(260%);
  }
}
.veil-sub {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--silver-dim);
}

/* ————— library skip ————— */
.skip {
  position: fixed;
  top: 1.2rem;
  right: 1.2rem;
  z-index: 30;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--paper);
  opacity: 0;
  transition:
    opacity 0.6s ease,
    color 0.25s ease;
}
.skip.on {
  opacity: 1;
}
[dir='rtl'] .skip-arrow {
  display: inline-block;
  transform: scaleX(-1);
}
.skip:hover,
.skip:focus-visible {
  color: var(--goldhi);
}

/* ————— beats: small, precise vitrine cards ————— */
.beat {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  width: min(17.5rem, 23vw);
  visibility: hidden;
  transition: visibility 0s linear 0.7s;
}
.beat[data-state='in'] {
  visibility: visible;
  transition-delay: 0s;
}
.beat::before {
  content: '';
  position: absolute;
  inset: -2.8rem -3.2rem;
  z-index: -1;
  background: radial-gradient(ellipse at 50% 50%, rgba(5, 5, 6, 0.76), rgba(5, 5, 6, 0) 74%);
  opacity: var(--k, 0);
}
.st-hero {
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  text-align: center;
  width: min(30rem, 86vw);
}
.side-l {
  left: 3.5vw;
  top: var(--y, 50%);
  transform: translateY(-50%);
}
.side-r {
  right: 3.5vw;
  top: var(--y, 50%);
  transform: translateY(-50%);
}
.low-l {
  left: 3.5vw;
  top: auto;
  bottom: 7vh;
  transform: none;
}
.st-final {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(25rem, 86vw);
  text-align: center;
}
.st-hero::before {
  inset: -2rem -5rem -4rem;
  background: radial-gradient(ellipse at 50% 20%, rgba(5, 5, 6, 0.8), rgba(5, 5, 6, 0) 76%);
}
.st-final::before {
  inset: -6rem -7rem;
  background: radial-gradient(ellipse at 50% 50%, rgba(5, 5, 6, 0.74), rgba(5, 5, 6, 0) 74%);
}

/* ————— richest frame of the set: four fret corners, paired hairlines
       that nearly meet, each ending in a tiny gold bead ————— */
.frame {
  position: relative;
  padding: 1.5rem 1.5rem 1.5rem;
  text-align: start;
}
.fc {
  position: absolute;
  width: 40px;
  height: 40px;
  overflow: visible;
  filter: drop-shadow(0 1px 8px rgba(5, 5, 6, 0.7));
  --f1: calc(1 - clamp(0, var(--k, 0) * 2.6, 1));
  --f2: calc(1 - clamp(0, (var(--k, 0) - 0.14) * 2.6, 1));
  --f3: calc(1 - clamp(0, (var(--k, 0) - 0.3) * 2.8, 1));
  --f4: calc(1 - clamp(0, (var(--k, 0) - 0.46) * 2.8, 1));
}
.c1 {
  top: -11px;
  left: -11px;
}
.c2 {
  top: -11px;
  right: -11px;
  transform: scaleX(-1);
}
.c3 {
  bottom: -11px;
  left: -11px;
  transform: scaleY(-1);
}
.c4 {
  bottom: -11px;
  right: -11px;
  transform: rotate(180deg);
}
.hl {
  position: absolute;
  background: var(--goldhair2);
}
.hl-t1 {
  top: -8.5px;
  left: 30px;
  width: 33%;
  height: 1px;
  transform-origin: left;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.2) * 2.1, 1));
}
.hl-t2 {
  top: -8.5px;
  right: 30px;
  width: 33%;
  height: 1px;
  transform-origin: right;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.2) * 2.1, 1));
}
.hl-b1 {
  bottom: -8.5px;
  left: 30px;
  width: 33%;
  height: 1px;
  transform-origin: left;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.26) * 2.1, 1));
}
.hl-b2 {
  bottom: -8.5px;
  right: 30px;
  width: 33%;
  height: 1px;
  transform-origin: right;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.26) * 2.1, 1));
}
.hl-l1 {
  left: -8.5px;
  top: 30px;
  width: 1px;
  height: 30%;
  transform-origin: top;
  transform: scaleY(clamp(0, (var(--k, 0) - 0.32) * 2.1, 1));
}
.hl-l2 {
  left: -8.5px;
  bottom: 30px;
  width: 1px;
  height: 30%;
  transform-origin: bottom;
  transform: scaleY(clamp(0, (var(--k, 0) - 0.32) * 2.1, 1));
}
.hl-r1 {
  right: -8.5px;
  top: 30px;
  width: 1px;
  height: 30%;
  transform-origin: top;
  transform: scaleY(clamp(0, (var(--k, 0) - 0.38) * 2.1, 1));
}
.hl-r2 {
  right: -8.5px;
  bottom: 30px;
  width: 1px;
  height: 30%;
  transform-origin: bottom;
  transform: scaleY(clamp(0, (var(--k, 0) - 0.38) * 2.1, 1));
}
.dot {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--goldhi);
  opacity: clamp(0, (var(--k, 0) - 0.6) * 3, 1);
}
.dot-t {
  top: -9.5px;
  left: 50%;
  margin-inline-start: -1.5px;
}
.dot-b {
  bottom: -9.5px;
  left: 50%;
  margin-inline-start: -1.5px;
}
.dot-l {
  left: -9.5px;
  top: 50%;
  margin-top: -1.5px;
}
.dot-r {
  right: -9.5px;
  top: 50%;
  margin-top: -1.5px;
}

/* ————— illuminated word-art titles, in Angel's hand ————— */
.wordart {
  display: block;
  width: calc(100% + 1.4rem);
  max-width: none;
  height: auto;
  margin: 0 -0.7rem 0.85rem;
  opacity: var(--k, 0);
  transform: translateY(calc((1 - var(--k, 0)) * 12px));
  filter: drop-shadow(0 3px 14px rgba(5, 5, 6, 0.75));
  pointer-events: none;
}
.st-final .wordart {
  width: min(16rem, 72%);
  margin: 0 auto 0.7rem;
}
.aph {
  font-family: 'EB Garamond', Georgia, serif;
  font-weight: 600;
  font-size: clamp(1.15rem, 1.6vw, 1.5rem);
  line-height: 1.3;
  margin: 0 0 0.7rem;
  color: var(--paper);
  text-shadow:
    0 1px 22px rgba(5, 5, 6, 0.85),
    0 0 4px rgba(5, 5, 6, 0.6);
}
.aph .l {
  display: block;
  opacity: 0;
  clip-path: inset(0 100% 0 0);
  transition:
    clip-path 0.6s var(--ease-wipe),
    opacity 0.35s ease;
}
.side-r .aph .l {
  clip-path: inset(0 0 0 100%);
}
.st-final .aph .l,
.st-hero .aph .l {
  clip-path: inset(0 0 100% 0);
}
.beat[data-state='in'] .aph .l {
  clip-path: inset(-18% -4%);
  opacity: 1;
}
.beat[data-state='in'] .aph .l:nth-child(1) {
  transition-delay: 0.22s, 0.22s;
}
.beat[data-state='in'] .aph .l:nth-child(2) {
  transition-delay: 0.36s, 0.36s;
}
.bd {
  font-weight: 300;
  font-size: 0.78rem;
  line-height: 1.7;
  color: var(--paper);
  margin: 0;
  max-width: 36ch;
  text-shadow: 0 1px 14px rgba(5, 5, 6, 0.9);
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.55s ease 0.55s,
    transform 0.55s ease 0.55s;
}
.beat[data-state='in'] .bd {
  opacity: 1;
  transform: none;
}
.bd em {
  font-style: normal;
  color: var(--goldhi);
}

/* The swash under one word per headline lives in SwashText.vue, which
   draws it; --k reaches it by inheritance, like every other beat variable. */

/* ————— hero: the hanging medallion, beaded ring at its densest ————— */
.pend {
  position: relative;
  width: 112px;
  margin: 11vh auto 0.9rem;
  transform-origin: 50% -11vh;
}
.psw {
  transform-origin: 50% -11vh;
}
.beat[data-state='in'] .psw {
  animation: msway 3s ease 1.7s 1 both;
}
@keyframes msway {
  0% {
    transform: rotate(0deg);
  }
  30% {
    transform: rotate(2deg);
  }
  65% {
    transform: rotate(-1deg);
  }
  85% {
    transform: rotate(0.4deg);
  }
  100% {
    transform: rotate(0deg);
  }
}
.drawline {
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: 1px;
  height: 11vh;
  background: linear-gradient(to bottom, rgba(209, 146, 30, 0.1), var(--goldhair));
  transform-origin: top;
  transform: scaleY(clamp(0, var(--k, 0) * 1.9, 1));
}
.logo {
  display: block;
  width: 112px;
  height: auto;
  overflow: visible;
  filter: drop-shadow(0 3px 16px rgba(5, 5, 6, 0.7));
}
.logo .tr {
  stroke-dasharray: 1;
  stroke-dashoffset: calc(1 - clamp(0, (var(--k, 0) - var(--w0, 0)) * 3, 1));
  animation: trace 0.85s ease var(--ad, 0.2s) backwards;
}
@keyframes trace {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}
.logo .beads {
  opacity: clamp(0, (var(--k, 0) - 0.2) * 2.2, 1);
  animation: bfade 1s ease 0.5s backwards;
}
.logo .hd {
  opacity: clamp(0, (var(--k, 0) - 0.45) * 3, 1);
  animation: bfade 0.7s ease 1s backwards;
}
@keyframes bfade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.markrow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin: 0 0 0.55rem;
}
.rule {
  height: 1px;
  flex: 0 0 3.2rem;
}
.rule.rl {
  background: linear-gradient(to left, var(--gold), transparent);
  transform-origin: right;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.45) * 2.4, 1));
}
.rule.rr {
  background: linear-gradient(to right, var(--gold), transparent);
  transform-origin: left;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.45) * 2.4, 1));
}
.mark {
  font-family: 'Cinzel', Georgia, serif;
  font-weight: 500;
  font-size: clamp(1.5rem, 2.9vw, 2.1rem);
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  margin: 0;
  color: var(--paper);
  text-shadow: 0 1px 24px rgba(5, 5, 6, 0.85);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 0.7s ease 0.5s,
    transform 0.7s ease 0.5s;
}
.beat[data-state='in'] .mark {
  opacity: 1;
  transform: none;
}
.tag {
  font-family: 'EB Garamond', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: clamp(1rem, 1.35vw, 1.25rem);
  line-height: 1.4;
  color: var(--paper);
  margin: 0;
  text-shadow: 0 1px 18px rgba(5, 5, 6, 0.9);
  opacity: 0;
  transition: opacity 0.7s ease 0.7s;
}
.beat[data-state='in'] .tag {
  opacity: 1;
}
.cue {
  display: inline-block;
  margin-top: 1.3rem;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--silver-dim);
  opacity: 0;
  transition: opacity 0.6s ease 1.1s;
}
.beat[data-state='in'] .cue {
  opacity: 1;
  animation: breathe 3.2s ease-in-out 2s infinite;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* ————— finale: eight charms on one string above the CTAs ————— */
.st-final .frame {
  text-align: center;
  padding-top: 1.5rem;
}
.st-final .aph {
  text-align: start;
  display: inline-block;
}
.st-final .bd {
  margin-inline: auto;
}
.st-final .aph {
  font-size: clamp(1.35rem, 2vw, 1.85rem);
}
.string {
  position: relative;
  height: 52px;
  margin: 1.15rem 4% 0.35rem;
}
.strline {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--goldhair);
  transform-origin: center;
  transform: scaleX(clamp(0, (var(--k, 0) - 0.1) * 1.8, 1));
}
.charm {
  position: absolute;
  top: 0;
  width: 24px;
  margin-inline-start: -12px;
  transform-origin: 50% 0;
  opacity: 0;
  filter: drop-shadow(0 2px 8px rgba(5, 5, 6, 0.65));
}
.charm .th {
  display: block;
  width: 5px;
  height: 11px;
  margin: 0 auto;
  background: none;
  border-left: 1px solid var(--goldhair2);
  border-right: 1px solid var(--goldhair2);
}
.charm svg {
  display: block;
  width: 24px;
  height: 29px;
}
.charm .sw {
  display: block;
  transform-origin: 50% 0;
  will-change: transform;
}
.beat[data-state='in'] .charm {
  animation: charmin 1.9s ease both;
  animation-delay: calc(0.55s + var(--i, 0) * 0.13s);
}
@keyframes charmin {
  0% {
    opacity: 0;
    transform: translateY(-12px) rotate(-2.4deg);
  }
  42% {
    opacity: 1;
    transform: translateY(0) rotate(2.6deg);
  }
  68% {
    opacity: 1;
    transform: translateY(0) rotate(-1.3deg);
  }
  86% {
    opacity: 1;
    transform: translateY(0) rotate(0.5deg);
  }
  100% {
    opacity: 1;
    transform: translateY(0) rotate(0deg);
  }
}
.st-final {
  pointer-events: none;
}
.st-final[data-state='in'] .cta-row {
  pointer-events: auto;
}
.cta-row {
  display: flex;
  gap: 0.9rem;
  justify-content: center;
  flex-wrap: wrap;
  margin: 1rem 0 1rem;
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.55s ease 0.7s,
    transform 0.55s ease 0.7s;
}
.beat[data-state='in'] .cta-row {
  opacity: 1;
  transform: none;
}
.cta {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-decoration: none;
  padding: 0.78em 1.5em;
  border-radius: 2px;
  transition:
    background 0.25s ease,
    color 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}
.cta.primary {
  background: var(--gold);
  color: #171208;
  border: 1px solid var(--gold);
  box-shadow:
    inset 0 0 0 3px var(--gold),
    inset 0 0 0 4px rgba(23, 18, 8, 0.55);
}
.cta.primary:hover {
  background: var(--goldhi);
  border-color: var(--goldhi);
  box-shadow:
    inset 0 0 0 3px var(--goldhi),
    inset 0 0 0 4px rgba(23, 18, 8, 0.55);
}
.cta.ghost {
  color: var(--paper);
  border: 1px solid var(--silver-dim);
  background: rgba(5, 5, 6, 0.35);
}
.cta.ghost:hover {
  border-color: var(--gold);
  color: var(--goldhi);
}
.cta:focus-visible {
  outline: 2px solid var(--goldhi);
  outline-offset: 3px;
}
.fine {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.56rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--paper);
  margin: 0;
  opacity: 0;
  transition: opacity 0.6s ease 0.95s;
}
.beat[data-state='in'] .fine {
  opacity: 1;
}

/* ————— static fallback: the same beats, linearized ————— */
.reel.static .track {
  height: auto !important;
}
.reel.static .stage {
  position: static;
  height: auto;
  overflow: visible;
  max-width: 38rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 5rem;
}
.reel.static .poster {
  position: static;
  width: 100%;
  height: auto;
  display: block;
  margin-bottom: 3rem;
}
.reel.static .beat {
  --k: 1 !important;
  position: static;
  visibility: visible;
  width: auto;
  max-width: none;
  transform: none;
  margin: 0 0 3.6rem;
  pointer-events: auto;
}
.reel.static .beat::before {
  display: none;
}
.reel.static .pend {
  margin-top: 0;
  animation: none;
}
.reel.static .psw {
  animation: none;
}
.reel.static .drawline {
  display: none;
}
.reel.static .logo .tr,
.reel.static .logo .beads,
.reel.static .logo .hd {
  animation: none;
}
.reel.static .charm {
  opacity: 1;
  animation: none;
  transform: none;
}
.reel.static .wordart {
  opacity: 1;
  transform: none;
}
.reel.static .hl,
.reel.static .rule,
.reel.static .strline {
  transform: none;
}
.reel.static .dot {
  opacity: 1;
}
.reel.static :deep(.usvg path) {
  stroke-dashoffset: 0;
}
.reel.static .mark,
.reel.static .tag,
.reel.static .bd,
.reel.static .cue,
.reel.static .cta-row,
.reel.static .fine,
.reel.static .aph .l {
  opacity: 1;
  transform: none;
  transition: none;
  clip-path: none;
  animation: none;
}
.reel.static .st-final .bd {
  margin-inline: auto;
}

/* ————— narrow screens: bottom-anchored blocks over a scrim ————— */
@media (max-width: 760px) {
  .beat {
    left: 1rem;
    right: 1rem;
    top: auto;
    bottom: 3.2rem;
    transform: none;
    width: auto;
    text-align: start;
  }
  .beat::before {
    inset: -4rem -1.5rem -3.6rem;
    background: linear-gradient(to top, rgba(5, 5, 6, 0.92) 58%, rgba(5, 5, 6, 0));
  }
  .st-hero {
    top: 0;
    bottom: auto;
    left: 1rem;
    right: 1rem;
    text-align: center;
  }
  .st-hero::before {
    inset: 0 -1.5rem -3rem;
    background: linear-gradient(to bottom, rgba(5, 5, 6, 0.9) 55%, rgba(5, 5, 6, 0));
  }
  .st-final {
    text-align: center;
  }
  .frame {
    padding: 1.3rem 1.15rem 1.25rem;
  }
  .hl-t1,
  .hl-b1 {
    left: 26px;
    width: 28%;
  }
  .hl-t2,
  .hl-b2 {
    right: 26px;
    width: 28%;
  }
  .hl-l1,
  .hl-r1 {
    top: 26px;
    height: 26%;
  }
  .hl-l2,
  .hl-r2 {
    bottom: 26px;
    height: 26%;
  }
  .aph {
    font-size: 1.2rem;
  }
  .wordart {
    width: auto;
    max-width: 100%;
    max-height: 23vh;
    margin: 0 0 0.6rem;
  }
  .bd {
    max-width: none;
  }
  .pend {
    width: 84px;
    margin: 5.5vh auto 0.7rem;
    transform-origin: 50% -5.5vh;
  }
  .psw {
    transform-origin: 50% -5.5vh;
  }
  .drawline {
    height: 5.5vh;
  }
  .logo {
    width: 84px;
  }
  .string {
    margin: 1rem 0 0.3rem;
  }
  .charm svg {
    width: 20px;
    height: 24px;
  }
  .charm {
    width: 20px;
    margin-inline-start: -10px;
  }
}
</style>
