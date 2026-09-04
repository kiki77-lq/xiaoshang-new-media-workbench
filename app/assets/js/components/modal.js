export function openModal({ title, content }) {
  const root = document.querySelector("#modal-root");
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-modal-close><section class="modal" role="dialog" aria-modal="true" aria-label="${title}"><header><h2>${title}</h2><button class="icon-button" type="button" data-modal-close aria-label="关闭">×</button></header><div class="modal-body">${content}</div></section></div>`;
  root.querySelectorAll("[data-modal-close]").forEach((element) => element.addEventListener("click", (event) => {
    if (event.target === element) closeModal();
  }));
}

export function closeModal() {
  const root = document.querySelector("#modal-root");
  if (root) root.innerHTML = "";
}
