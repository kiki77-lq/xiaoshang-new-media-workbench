import { escapeHtml, icon } from '../shared/dom.js';

let returnFocus;
let background = [];
export function openModal({ title, content }) {
  const root = document.querySelector("#modal-root");
  if (!root) return;
  if (!root.contains(document.activeElement)) returnFocus = document.activeElement;
  if (!background.length) {
    background = [...root.parentElement.children].filter(element => element !== root && element.id !== 'toast-root').map(element => [element, element.inert]);
    for (const [element] of background) element.inert = true;
  }
  root.innerHTML = `<div class="modal-backdrop" data-modal-close><section class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="${escapeHtml(title)}"><header><h2>${escapeHtml(title)}</h2><button class="icon-button" type="button" data-modal-close aria-label="关闭">${icon('x')}</button></header><div class="modal-body">${content}</div></section></div>`;
  const dialog = root.querySelector('[role="dialog"]');
  const focusables = () => [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const elements = focusables(); const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  root.querySelectorAll("[data-modal-close]").forEach((element) => element.addEventListener("click", (event) => {
    if (event.target === element) closeModal();
  }));
  (focusables()[0] || dialog).focus();
}

export function closeModal() {
  const root = document.querySelector("#modal-root");
  if (root) root.innerHTML = "";
  for (const [element, wasInert] of background) element.inert = wasInert;
  background = [];
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}
