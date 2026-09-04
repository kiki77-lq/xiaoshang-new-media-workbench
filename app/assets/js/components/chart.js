export function renderChart({ label = "趋势视觉占位", tone = "accent" } = {}) {
  return `<div class="chart-placeholder tone-${tone}" role="img" aria-label="${label}"><svg viewBox="0 0 640 180" preserveAspectRatio="none"><path class="chart-grid" d="M0 45H640M0 90H640M0 135H640"/><path class="chart-line" d="M0 138 C55 122 77 151 126 107 S205 39 254 88 S333 146 386 71 S471 44 514 98 S583 130 640 56"/></svg><span>${label} · 不写入 SQLite</span></div>`;
}
