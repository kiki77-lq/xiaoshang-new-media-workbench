export function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function showFormError(form, error, reloadLatest) {
  const alert = form.querySelector('[data-form-error]');
  if (!alert) return;
  alert.hidden = false;
  alert.textContent = error?.code === 'VERSION_CONFLICT'
    ? '这条记录已更新。请重新加载最新记录后再修改。'
    : `${error?.message || '保存失败，请重试。'}${error?.requestId ? `（请求 ${error.requestId}）` : ''}`;
  if (reloadLatest && error?.code === 'VERSION_CONFLICT') {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-secondary'; button.textContent = '重新加载最新记录';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await reloadLatest(); } catch (failure) { button.disabled = false; showFormError(form, failure, reloadLatest); }
    });
    alert.append(button);
  }
  alert.focus();
}
