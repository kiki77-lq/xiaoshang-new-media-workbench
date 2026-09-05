export function shortSha(value) {
  return value ? String(value).slice(0, 8) : "—";
}

export function formatMonth(date) {
  const [year, month] = shanghaiDate(date).split('-');
  return `${year}年${Number(month)}月`;
}

// One date boundary for the browser and server; never use the host's local TZ.
export function normalizeTimestamp(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('时间必须为带时区的 ISO8601 日期时间');
  const [, y, m, d, h, min, sec, , offset] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (Number(y)<1000 || Number(m)<1 || Number(m)>12 || Number(d)<1 || Number(d)>days || Number(h)>23 || Number(min)>59 || Number(sec)>59 ||
    (offset !== 'Z' && (Number(offset.slice(1,3))>23 || Number(offset.slice(4))>59))) throw new Error('日期或时间不存在');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('日期或时间不存在');
  return parsed.toISOString();
}

export function shanghaiDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(date).map(({type,value:part})=>[type,part]));
  const millis = String(date.getUTCMilliseconds()).padStart(3,'0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${millis}`;
}

export function shanghaiDate(value = new Date()) { return shanghaiDateTime(value).slice(0,10); }

export function shanghaiInputToUtc(value) {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  // Compute the zone's actual offset, including historical Shanghai DST.
  const wallUtc = normalizeTimestamp(`${normalized}Z`);
  let instant = new Date(wallUtc).getTime() - 8*60*60*1000;
  for (let i=0; i<3; i+=1) {
    const displayed = Date.parse(`${shanghaiDateTime(instant)}Z`);
    const delta = Date.parse(wallUtc)-displayed;
    if (!delta) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new Error('该上海时间不存在');
}

export function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}

export function shanghaiMonthBounds(value = new Date()) {
  const [year, month] = shanghaiDate(value).split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0,10);
  return [shanghaiInputToUtc(`${year}-${String(month).padStart(2,'0')}-01T00:00`), shanghaiInputToUtc(`${next}T00:00`)];
}

export function displayShanghai(value) { return value ? `${shanghaiDateTime(value).slice(0,16).replace('T',' ')} 上海` : '未排期'; }
