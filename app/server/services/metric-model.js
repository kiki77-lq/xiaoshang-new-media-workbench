import { HttpError } from '../http/errors.js';
import { assertObject, enumValue, optionalString, requiredString } from './validation.js';

export const METRICS = [
  ['views','播放量','count'], ['likes','点赞数','count'], ['comments','评论数','count'],
  ['shares','分享数','count'], ['saves','收藏数','count'], ['followers_total','粉丝总数','count'],
  ['followers_gained','新增粉丝','count'], ['followers_lost','流失粉丝','count'],
  ['net_followers','净增粉丝','count'], ['completion_rate','完播率','ratio'],
  ['two_second_bounce_rate','2秒跳出率','ratio'], ['five_second_retention_rate','5秒留存率','ratio'],
  ['average_watch_seconds','平均观看时长','seconds']
].map(([key,label,unit]) => ({ key, label, unit }));
export const METRIC_KEYS = METRICS.map(m => m.key);
export const ROW_FIELDS = ['platformCode','contentId','sourceReference','capturedAt','notes',
  'periodStart','periodEnd','metrics','series','review', ...METRIC_KEYS];
export const DEFAULT_MAPPING = Object.fromEntries([
  ...ROW_FIELDS.map(k => [k,k]), ...METRICS.map(m => [m.label,m.key]),
  ['平台','platformCode'], ['平台代码','platformCode'], ['内容ID','contentId'], ['作品ID','contentId'],
  ['来源引用','sourceReference'], ['采集时间','capturedAt'], ['备注','notes'],
  ['周期开始','periodStart'], ['周期结束','periodEnd'], ['阅读量','views'],
  ['点赞量','likes'], ['评论量','comments'], ['转发量','shares'], ['涨粉数','followers_gained'],
  ['掉粉数','followers_lost'], ['净涨粉','net_followers'], ['指标','metrics'], ['序列','series'], ['复盘','review']
]);
export const LIMITS = { rows: 1000, columns: 64, bytes: 1024 * 1024, uncompressed: 16 * 1024 * 1024,
  cell: 100000, series: 1000, findings: 100 };
export const blank = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
export function invalid(message) { throw new HttpError(400, 'VALIDATION_ERROR', message); }
export function dateOnly(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value < '1900-01-01' || value > '9998-12-31'
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) {
    invalid(`${field} must be a valid YYYY-MM-DD date (1900–9998).`);
  }
  return value;
}
export function period(start, end) {
  dateOnly(start, 'periodStart'); dateOnly(end, 'periodEnd');
  if (end < start) invalid('periodEnd must not precede periodStart.');
  return { periodStart: start, periodEnd: end };
}
export function metricNumber(value, unit, signed = false) {
  let number = value;
  if (typeof value === 'string') {
    if (value.trim().length > 100) invalid('Numeric display value is too long.');
    const match = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([%％万亿]?)$/.exec(value.trim());
    if (!match) invalid('Metric must be a number, valid grouped number, percentage, 万 or 亿 display value.');
    if (match[2] && (unit === 'ratio' ? !['%','％'].includes(match[2]) : ['%','％'].includes(match[2]))) {
      invalid('Metric display unit does not match metric unit.');
    }
    number = Number(match[1].replaceAll(',', '')) * ({ '%': 0.01, '％': 0.01, '万': 10000, '亿': 100000000 }[match[2]] ?? 1);
    if (unit === 'count') {
      const raw = match[1].replaceAll(',', '');
      const decimals = raw.split('.')[1]?.length ?? 0;
      const numerator = BigInt(raw.replace('.', '')) * BigInt(match[2] === '万' ? 10000 : match[2] === '亿' ? 100000000 : 1);
      const denominator = 10n ** BigInt(decimals);
      if (numerator % denominator !== 0n) invalid('Count must be an exact integer.');
      number = Number(numerator / denominator);
    }
  }
  if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER
    || (!signed && number < 0) || (unit === 'ratio' && (number < 0 || number > 1))
    || (unit === 'count' && !Number.isSafeInteger(number))) invalid(`Invalid ${unit} value.`);
  return number;
}
function hasEvidence(value, depth = 0) {
  if (depth > 16) return false;
  if (typeof value === 'string') return !!value.trim();
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0 && value.every(x => hasEvidence(x, depth + 1));
  if (value && typeof value === 'object') return Object.keys(value).length > 0
    && Object.values(value).every(x => hasEvidence(x, depth + 1));
  return false;
}
export function evidenceFields(input) {
  if (input.evidenceLevel === null) invalid('evidenceLevel cannot be null.');
  const evidenceLevel = enumValue(input.evidenceLevel, 'evidenceLevel', ['observed','derived','inferred'], 'observed');
  const calculationNote = optionalString(input.calculationNote, 'calculationNote', 5000);
  const evidence = input.evidence ?? null;
  if (JSON.stringify(evidence).length > 20000) invalid('evidence is too large.');
  if (evidence !== null && !hasEvidence(evidence)) invalid('evidence must contain nonempty references or values.');
  if (evidenceLevel !== 'observed' && (!calculationNote || !hasEvidence(evidence))) {
    invalid('derived/inferred requires calculationNote and nonempty evidence.');
  }
  return { evidenceLevel, calculationNote, evidence };
}
export function normalizeMetrics(row) {
  const values = {};
  if (row.metrics !== undefined) assertObject(row.metrics, METRIC_KEYS);
  for (const { key, unit } of METRICS) {
    if (!blank(row[key]) && !blank(row.metrics?.[key])) invalid(`Duplicate metric ${key}.`);
    const raw = !blank(row[key]) ? row[key] : row.metrics?.[key];
    if (blank(raw)) continue;
    const value = typeof raw === 'object' ? raw : { value: raw };
    assertObject(value, ['value','evidenceLevel','calculationNote','evidence']);
    values[key] = { value: metricNumber(value.value, unit, key === 'net_followers'), unit, ...evidenceFields(value) };
  }
  return values;
}
export function normalizeSeries(input = []) {
  if (!Array.isArray(input) || input.length > LIMITS.series) invalid('series must contain at most 1000 points.');
  const seen = new Set();
  const units = new Map();
  return input.map(point => {
    assertObject(point, ['seriesKey','position','label','value','unit','evidenceLevel','calculationNote','evidence']);
    const seriesKey = enumValue(point.seriesKey, 'seriesKey', ['traffic_lifecycle','retention','engagement_timeline','traffic_source']);
    const unit = enumValue(point.unit, 'unit', ['count','ratio','seconds']);
    if ((seriesKey === 'retention' && unit !== 'ratio')
      || (['traffic_lifecycle','engagement_timeline'].includes(seriesKey) && unit !== 'count')
      || (seriesKey === 'traffic_source' && !['count','ratio'].includes(unit))) invalid('Series unit does not match seriesKey.');
    if (units.has(seriesKey) && units.get(seriesKey) !== unit) invalid('One seriesKey cannot mix measurement units.');
    units.set(seriesKey, unit);
    if (typeof point.position !== 'number' || !Number.isFinite(point.position) || point.position < 0
      || point.position > Number.MAX_SAFE_INTEGER) invalid('series position must be finite and nonnegative.');
    const key = `${seriesKey}:${point.position}`;
    if (seen.has(key)) invalid('Duplicate series position.');
    seen.add(key);
    return { seriesKey, position: point.position, label: requiredString(point.label, 'label', 240),
      value: metricNumber(point.value, unit), unit, ...evidenceFields(point) };
  });
}
export function normalizeReview(input) {
  if (input === undefined) return null;
  assertObject(input, ['summary','dataQuality','generatedBy','findings']);
  if (!Array.isArray(input.findings) || input.findings.length > LIMITS.findings) invalid('findings must contain at most 100 findings.');
  return { summary: requiredString(input.summary, 'summary', 5000),
    dataQuality: enumValue(input.dataQuality, 'dataQuality', ['complete','partial','proxy_based']),
    generatedBy: enumValue(input.generatedBy, 'generatedBy', ['human','workbuddy','ai']),
    findings: input.findings.map(f => {
      assertObject(f, ['findingType','title','body','evidenceLevel','calculationNote','evidence']);
      return { findingType: enumValue(f.findingType, 'findingType', ['strength','issue','recommendation','high_engagement_segment']),
        title: requiredString(f.title, 'title', 240), body: requiredString(f.body, 'body', 5000), ...evidenceFields(f) };
    }) };
}
