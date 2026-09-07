<template>
  <!--
    A vitrine frame from the landing: hairline border with key-fret corners.
    Purely decorative chrome around whatever it is handed.
  -->
  <div class="oframe">
    <svg class="fc c1" viewBox="0 0 30 30" aria-hidden="true">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="var(--gold-mid)" stroke-width="1.2" d="M30 1.5H8Q1.5 1.5 1.5 8v22" />
        <path stroke="var(--gold-deep)" stroke-width="1" d="M30 6H9v3.5M6 30V9h3.5" />
      </g>
    </svg>
    <svg class="fc c2" viewBox="0 0 30 30" aria-hidden="true">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="var(--gold-mid)" stroke-width="1.2" d="M30 1.5H8Q1.5 1.5 1.5 8v22" />
        <path stroke="var(--gold-deep)" stroke-width="1" d="M30 6H9v3.5M6 30V9h3.5" />
      </g>
    </svg>
    <svg class="fc c3" viewBox="0 0 30 30" aria-hidden="true">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="var(--gold-mid)" stroke-width="1.2" d="M30 1.5H8Q1.5 1.5 1.5 8v22" />
        <path stroke="var(--gold-deep)" stroke-width="1" d="M30 6H9v3.5M6 30V9h3.5" />
      </g>
    </svg>
    <svg class="fc c4" viewBox="0 0 30 30" aria-hidden="true">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="var(--gold-mid)" stroke-width="1.2" d="M30 1.5H8Q1.5 1.5 1.5 8v22" />
        <path stroke="var(--gold-deep)" stroke-width="1" d="M30 6H9v3.5M6 30V9h3.5" />
      </g>
    </svg>
    <slot />
  </div>
</template>

<style scoped>
.oframe {
  position: relative;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: var(--bg-panel);
  box-shadow: var(--shadow);
}
.fc {
  position: absolute;
  width: 22px;
  height: 22px;
  pointer-events: none;
}
.c1 {
  top: -5px;
  left: -5px;
}
.c2 {
  top: -5px;
  right: -5px;
  transform: scaleX(-1);
}
.c3 {
  bottom: -5px;
  left: -5px;
  transform: scaleY(-1);
}
.c4 {
  bottom: -5px;
  right: -5px;
  transform: rotate(180deg);
}
</style>
