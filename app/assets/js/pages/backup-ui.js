import { escapeHtml, emptyState } from '../shared/dom.js';
import { displayShanghai } from '../shared/format.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { showFormError } from '../shared/forms.js';

export function renderBackups(items=[]) {
return items.length?`<div class="backup-list">${items.map(b=>`<article class="backup-item" data-backup="${escapeHtml(b.id)}"><div><strong>${escapeHtml(displayShanghai(b.createdAt))}</strong><span class="status-badge ${b.verified?'badge-success':'status-muted'}">${b.restorable===false?'版本不兼容 / 不可恢复':b.verified?'校验通过':'尚未通过校验'}</span></div><p>版本 ${escapeHtml(b.appVersion)} · Schema ${escapeHtml(b.schemaVersion)} · ${Number(b.sizeBytes).toLocaleString('zh-CN')} 字节 · ${escapeHtml(b.reason || '')}</p><p>完整性：${escapeHtml(b.integrity || '未检查')}</p><details><summary>SHA-256 校验和</summary><code>${escapeHtml(b.sha256 || '—')}</code></details><button class="btn btn-secondary" data-verify-backup="${escapeHtml(b.id)}"${b.restorable===false?' disabled':''}>核验并准备恢复</button></article>`).join('')}</div>`:emptyState('尚无备份','点击立即备份创建一份本地一致性副本。','◫');
}
export function attachBackups(root,controls) {
  root.querySelector('[data-create-backup]')?.addEventListener('click',async e=>{
    const button=e.currentTarget;button.disabled=true;
    try {await controls.api.post('/backups',{}, {idempotencyKey:crypto.randomUUID()});await controls.reload();showToast('备份已创建并核验。','success');}
    catch(error){button.disabled=false;showToast(`${error.message} ${error.requestId || ''}`,'danger');}
  });
  root.querySelectorAll('[data-verify-backup]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    try {
      const id=button.dataset.verifyBackup;
      const {data}=await controls.api.post(`/backups/${encodeURIComponent(id)}/verify`,{}, {idempotencyKey:crypto.randomUUID()});
      if(!data.verification?.ok || !data.confirmationToken)throw new Error('备份未通过核验或不兼容，不能恢复。当前数据未修改。');
      const b=data.backup;
      openModal({title:'确认恢复备份',content:`<form class="workbench-form" data-restore-form><div class="form-field-wide quality-warning"><strong>第二次确认：这会替换当前业务数据库</strong><p>备份时间：${escapeHtml(displayShanghai(b.createdAt))}</p><p>Schema ${escapeHtml(b.schemaVersion)} · 完整性 ${escapeHtml(data.verification.integrity)}</p><p class="backup-checksum">SHA-256：${escapeHtml(b.sha256)}</p><p>恢复前会自动备份当前数据。恢复失败会尝试回滚，Token 文件不会被替换。确认有效期至 ${escapeHtml(displayShanghai(data.expiresAt))}。</p></div><label class="check-field"><input type="checkbox" name="acknowledged" required>我确认选择了正确备份，并理解当前数据将被替换</label><label class="form-field form-field-wide"><span>输入“恢复”以确认</span><input name="confirmText" required autocomplete="off" pattern="恢复"></label><div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div><footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-danger" type="submit" disabled>确认恢复</button></footer></form>`});
      const form=document.querySelector('[data-restore-form]'), submit=form.querySelector('[type="submit"]'), key=crypto.randomUUID();
      const enable=()=>{submit.disabled=!form.elements.acknowledged.checked || form.elements.confirmText.value!=='恢复';};form.addEventListener('input',enable);form.addEventListener('change',enable);
      form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try {const result=await controls.api.post(`/backups/${encodeURIComponent(id)}/restore`,{confirmationToken:data.confirmationToken,confirmText:form.elements.confirmText.value},{idempotencyKey:key});if(!result.data.restored || result.data.health?.database!=='ok')throw new Error('恢复未获得健康确认，请核查本地服务。');closeModal();await controls.reload();showToast('恢复完成，数据库健康检查通过。','success');}catch(error){showFormError(form,error);submit.disabled=true;}});
    }catch(error){showToast(`${error.message} ${error.requestId || ''}`,'danger');}finally{button.disabled=false;}
  }));
}
