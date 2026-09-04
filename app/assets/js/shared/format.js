export function shortSha(value) {
  return value ? String(value).slice(0, 8) : "—";
}

export function formatMonth(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}
