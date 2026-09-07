import { createRouter, createWebHistory } from 'vue-router'

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

export default router
