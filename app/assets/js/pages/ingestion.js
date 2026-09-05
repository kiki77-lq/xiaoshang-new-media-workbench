import { openModal } from '../components/modal.js';
import { escapeHtml } from '../shared/dom.js';
import { showFormError } from '../shared/forms.js';
import { currentMonth, METRICS, PLATFORMS } from '../shared/metrics.js';

function monthEnd(month) {
  const [year,m]=month.split('-').map(Number);
  return new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
}

export function openImportMetrics({api, data, reload, month = currentMonth()}) {
  const choices=data?.contents || [];
  openModal({title:'导入运营数据',content:`<form class="workbench-form" data-ingestion-form>
    <p class="form-field-wide">只导入你确认的数据。账号总量与作品指标分开保存，空字段不会补成 0。日期按上海时间，包含首尾日。</p>
    <label class="form-field"><span>输入方式</span><select name="sourceType"><option value="manual">手动录入</option><option value="csv">CSV 文件</option><option value="excel">Excel 文件</option></select></label>
    <label class="form-field"><span>平台</span><select name="platformCode">${PLATFORMS.map(([code,name])=>`<option value="${code}">${name}</option>`).join('')}</select></label>
    <label class="form-field form-field-wide"><span>数据对象</span><select name="contentId"><option value="">平台账号整体（不是某条作品）</option>${choices.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('')}</select></label>
    <label class="form-field"><span>周期开始</span><input type="date" name="periodStart" required value="${month}-01"></label><label class="form-field"><span>周期结束</span><input type="date" name="periodEnd" required value="${monthEnd(month)}"></label>
    <label class="form-field form-field-wide"><span>来源名称</span><input name="sourceName" required maxlength="200" value="手动录入" placeholder="例如：平台后台导出"></label>
    <div class="form-field-wide manual-metrics" data-source-manual>${Object.entries(METRICS).map(([key,[label,unit]])=>`<label class="form-field"><span>${label}${unit==='ratio'?'（如 23.5%）':unit==='seconds'?'（秒）':''}</span><input name="metric_${key}" inputmode="decimal" placeholder="未提供" autocomplete="off"></label>`).join('')}</div>
    <div class="form-field-wide" data-source-file hidden><label class="form-field"><span>选择文件（最大 1 MB）</span><input type="file" name="metricsFile" accept=".csv"></label><p>首行为字段名；支持中文表头、引号、换行、百分比、万 / 亿。Excel 读取首个工作表。文件内的平台 / 内容 ID 优先于上方选择。</p><details><summary>字段映射与高级输入</summary><p>英文指标键与常见中文表头自动映射。特殊列可填写 JSON，例如 {"阅读次数":"views"}。series 和 review 列可以保存结构化 JSON；非原始数据必须带计算说明和证据。</p><textarea name="mapping" rows="3" aria-label="自定义字段映射" placeholder="{}"></textarea><p>支持指标：${Object.entries(METRICS).map(([k,[label]])=>`${label} = ${k}`).join('；')}</p></details></div>
    <div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div>
    <div role="status" class="ingestion-result form-field-wide" data-ingestion-result hidden></div>
    <footer class="form-actions"><button type="button" class="btn btn-secondary" data-modal-close>返回看板</button><button type="submit" class="btn btn-primary">确认导入</button></footer>
  </form>`});
  const form=document.querySelector('[data-ingestion-form]'), fields=form.elements;
  let key=crypto.randomUUID(), successful=false;
  form.addEventListener('input',()=>{if(successful){key=crypto.randomUUID();successful=false;}});
  fields.sourceType.addEventListener('change',()=>{
    const manual=fields.sourceType.value==='manual';
    form.querySelector('[data-source-manual]').hidden=!manual;
    form.querySelector('[data-source-file]').hidden=manual;
    fields.metricsFile.required=!manual;
    fields.metricsFile.accept=fields.sourceType.value==='csv'?'.csv':'.xlsx,.xls';
    if(successful){key=crypto.randomUUID();successful=false;}
  });
  fields.metricsFile.addEventListener('change',()=>{if(fields.metricsFile.files[0]) fields.sourceName.value=fields.metricsFile.files[0].name;});
  form.addEventListener('submit',async event=>{
    event.preventDefault(); const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    form.querySelector('[data-form-error]').hidden=true;
    try {
      const sourceType=fields.sourceType.value;
      const body={sourceType,sourceName:fields.sourceName.value,periodStart:fields.periodStart.value,periodEnd:fields.periodEnd.value};
      const target={platformCode:fields.platformCode.value,...(fields.contentId.value?{contentId:fields.contentId.value}:{})};
      if(sourceType==='manual') {
        const metrics=Object.fromEntries(Object.keys(METRICS).map(k=>[k,fields[`metric_${k}`].value.trim()]).filter(([,v])=>v!==''));
        if(!Object.keys(metrics).length)throw new Error('请至少填写一个指标，未知数据请保持空白。');
        body.rows=[{...target,metrics}];
      } else {
        const file=fields.metricsFile.files[0];
        if(!file || file.size>1024*1024)throw new Error('请选择不超过 1 MB 的文件，较大数据请按周期拆分。');
        body.defaults=target;
        if(fields.mapping.value.trim())body.mapping=JSON.parse(fields.mapping.value);
        if(sourceType==='csv')body.csvText=await file.text();
        else {const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);body.fileBase64=btoa(binary);}
      }
      const {data:result,requestId}=await api.post('/ingestion',body,{idempotencyKey:key});
      successful=true;
      const panel=form.querySelector('[data-ingestion-result]');panel.hidden=false;
      panel.innerHTML=`<strong>${result.status==='imported'?'导入完成':result.status==='partial_failure'?'部分导入成功':'导入未成功'}</strong><p>共 ${Number(result.rowsTotal)} 行 · 成功 ${Number(result.rowsImported)} 行 · 失败 ${Number(result.rowsRejected)} 行</p>${(result.errors || []).map(e=>`<p>第 ${Number(e.row)} 行：${escapeHtml(e.message)}</p>`).join('')}<small>批次 ${escapeHtml(result.id)} · 请求 ${escapeHtml(requestId)}</small>`;
      await reload();
    } catch(error) {showFormError(form,error);} finally {submit.disabled=false;}
  });
}
