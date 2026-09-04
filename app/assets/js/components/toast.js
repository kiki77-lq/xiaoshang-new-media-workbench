export function showToast(message, tone = "info") {
  const root = document.querySelector("#toast-root");
  if (!root) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  root.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}
