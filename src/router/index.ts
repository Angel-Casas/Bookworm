import { createRouter, createWebHistory, START_LOCATION } from 'vue-router'
import { acceptHandoff, isStandalone, landingSeen } from '@/services/firstRun'

// Before the history below reads the address, and before any store reads its
// preferences: the installed app's first launch may be carrying answers from
// Safari in its URL. Here rather than in main.ts because imports run first —
// by the time main.ts's own lines run, the router has already read the URL.
acceptHandoff()

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'landing', component: () => import('@/views/LandingView.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue') },
    {
      path: '/book/:id',
      name: 'reader',
      component: () => import('@/views/ReaderView.vue'),
      props: true,
    },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
})

/**
 * Opening the app lands on the shelf; the landing page is shown once.
 *
 * The film is an introduction, and an introduction every morning is a reason
 * to stop opening the app. So only the FIRST navigation is redirected — the
 * app being opened at its root, from a bookmark or the Home Screen icon —
 * and only once the landing page has had its turn, or when this is the
 * installed app. Walking to `/` from inside (the medallion in the nav) is
 * never redirected: that is the reader asking for it.
 */
router.beforeEach((to, from) => {
  if (from !== START_LOCATION || to.name !== 'landing') return true
  if (!landingSeen() && !isStandalone()) return true
  return { name: 'library', query: to.query, hash: to.hash, replace: true }
})

export default router
