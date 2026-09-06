import { platformMark } from '../components/platform-mark.js';
import { disabledButton, escapeHtml, pageHeader, icon } from '../shared/dom.js';
import { shortSha, displayShanghai } from '../shared/format.js';
import { openModal, closeModal } from '../components/modal.js';
import { showFormError } from '../shared/forms.js';
import { showToast } from '../components/toast.js';
import { renderBackups, attachBackups } from './backup-ui.js';

const value=v=>escapeHtml(v ?? '—');
function title(iconName,heading,sub) {return `<div class="setting-title"><span>${icon(iconName)}</span><div><h2>${heading}</h2><p>${sub}</p></div></div>`;}
export function renderSettings({health,meta,apiError,data,error,loading}={}) {
  const connected=health?.status==='ok' && health?.database==='ok';
  const wb=data?.workbuddy || {};
  return `<section class="page page-settings">${pageHeader('设置','连接、备份与基础配置','<button class="btn btn-secondary" data-refresh-settings>刷新状态</button>')}${error?`<p role="alert" class="quality-warning">${value(error.message)} ${value(error.requestId)}</p>`:''}${loading?'<p role="status">正在读取设置与备份…</p>':''}
    <div class="settings-grid"><section class="setting-card">${title('↗','WorkBuddy 连接状态','本地 Token 可用，不代表 WorkBuddy 正在运行')}<div class="connection-status ${connected?'is-online':''}"><i></i><strong>${apiError?'连接异常':connected?'本地服务正常':'正在检测…'}</strong></div><dl><div><dt>本地 Token</dt><dd>${wb.tokenConfigured?'已配置（不显示密钥）':'未确认'}</dd></div><div><dt>最近已认证请求</dt><dd>${wb.lastRequestAt?value(displayShanghai(wb.lastRequestAt)):'尚无已认证请求'}</dd></div><div><dt>数据库</dt><dd>${value(health?.database)}</dd></div><div><dt>Request ID</dt><dd>${value(health?.requestId)}</dd></div></dl><p>WorkBuddy 只通过本机 API 读写；网页不会读取 Token，也不保存平台密码。</p></section>
    <section class="setting-card">${title('◫','数据备份与恢复','真实数据保留在本机，恢复必须再次确认')}<p class="setting-copy">备份包含 SQLite 业务数据及校验清单。Token 独立保管，不随数据库恢复覆盖。请定期将备份目录复制到安全位置。</p><div class="setting-actions"><button class="btn btn-primary" data-create-backup${data?'':' disabled'}>立即备份</button></div><p>恢复顺序：核验 → 二次确认 → 保护性备份 → 恢复 → 健康检查；失败回滚。</p></section>
    <section class="setting-card">${title('▦','四平台配置','这里只配置展示信息，不连接平台官方 API')}<div class="config-list">${(data?.platforms || []).map(p=>`<div><span><span class="platform-name">${platformMark(p.name)}${escapeHtml(p.name)}</span><small>${escapeHtml(p.handle || '未填写账号')}</small></span><span class="status-badge status-muted">${p.enabled?'启用':'停用'}</span><button class="btn btn-secondary" data-edit-platform="${escapeHtml(p.code)}">编辑</button></div>`).join('')}</div></section>
    <section class="setting-card">${title('♨','热点关注关键词','人工维护关注方向，不会自动联网搜索')}<div class="keyword-list">${data?.keywords?.length?data.keywords.map(k=>`<span>${escapeHtml(k)}</span>`).join(''):'<p>尚未设置关键词</p>'}</div><button class="btn btn-secondary" data-edit-keywords${data?'':' disabled'}>编辑关键词</button></section>
    <section class="setting-card setting-version">${title('↻','版本与更新','来自 /api/v1/meta 的真实运行信息')}<dl class="version-grid"><div><dt>应用版本</dt><dd>${value(meta?.appVersion)}</dd></div><div><dt>Git SHA</dt><dd title="${value(meta?.gitSha)}">${shortSha(meta?.gitSha)}</dd></div><div><dt>Schema Version</dt><dd>${value(meta?.schemaVersion)}</dd></div><div><dt>Upstream SHA</dt><dd title="${value(meta?.upstreamSha)}">${shortSha(meta?.upstreamSha)}</dd></div></dl>${disabledButton('在线检查更新')}<p>代码更新通过本地受控更新脚本执行，不覆盖 data/。</p></section>
    <section class="setting-card setting-version">${title('◫','备份记录','仅显示元数据，不通过网页下载数据库或密钥')}${(data?.backupWarnings || []).map(w=>`<p role="alert" class="quality-warning">${escapeHtml(w)}</p>`).join('')}${renderBackups(data?.backups || [])}</section></div></section>`;
}
export function attachSettings(root,controls) {
  attachBackups(root,controls);
  root.querySelector('[data-refresh-settings]')?.addEventListener('click',()=>controls.reload());
  const bindSave=(form,body)=>form.addEventListener('submit',async event=>{event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;try {await controls.api.patch('/settings',body(),{version:controls.data.version});closeModal();await controls.reload();showToast('设置已保存。','success');}catch(error){submit.disabled=false;showFormError(form,error,async()=>{closeModal();await controls.reload();showToast('已重新加载最新设置，请再次打开编辑。');});}});
  root.querySelector('[data-edit-keywords]')?.addEventListener('click',()=>{
    openModal({title:'编辑关注关键词',content:`<form class="workbench-form" data-keyword-form><label class="form-field form-field-wide"><span>关键词（每行一个）</span><textarea name="keywords" rows="6">${escapeHtml(controls.data.keywords.join('\n'))}</textarea></label><div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div><footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">保存关键词</button></footer></form>`});
    const form=document.querySelector('[data-keyword-form]');bindSave(form,()=>({keywords:form.elements.keywords.value.split('\n').map(k=>k.trim()).filter(Boolean)}));
  });
  root.querySelectorAll('[data-edit-platform]').forEach(button=>button.addEventListener('click',()=>{
    const p=controls.data.platforms.find(p=>p.code===button.dataset.editPlatform);
    openModal({title:`配置${p.name}`,content:`<form class="workbench-form" data-platform-form><label class="form-field"><span>账号展示名称</span><input name="handle" value="${escapeHtml(p.handle || '')}" maxlength="120"></label><label class="form-field"><span>账号主页链接</span><input type="url" name="profileUrl" value="${escapeHtml(p.profileUrl || '')}"></label><label class="check-field"><input type="checkbox" name="enabled"${p.enabled?' checked':''}>启用此平台展示</label><p class="form-field-wide">不保存账号密码，不会向平台登录或发布。</p><div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div><footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">保存平台配置</button></footer></form>`});
    const form=document.querySelector('[data-platform-form]');bindSave(form,()=>({platforms:[{code:p.code,version:p.version,handle:form.elements.handle.value,profileUrl:form.elements.profileUrl.value,enabled:form.elements.enabled.checked}]}));
  }));
}
