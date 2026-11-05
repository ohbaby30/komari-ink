// Pure presentation model. Missing telemetry stays null, including zero-report nodes.
export const number = value => !['number','string'].includes(typeof value) || typeof value === 'string' && value.trim() === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const nonnegative = value => { const n = number(value); return n !== null && n >= 0 ? n : null; };
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function timestamp(value) {
  if (value === null || value === undefined || value === '' || /^0001-/.test(String(value))) return null;
  const n = number(value), ms = n === null ? Date.parse(value) : n <= 0 ? NaN : n < 1e12 ? n * 1000 : n;
  return Number.isFinite(ms) ? ms : null;
}
export function expiry(value, now = Date.now()) {
  const ms = timestamp(value);
  if (ms === null) return {days:null,label:'—'};
  const days = Math.ceil((ms - now) / 86400000);
  return {days,label:ms <= now ? '已到期' : `${days} 天`};
}
export function bytes(value) {
  const n = nonnegative(value); if (n === null) return '—';
  if (n === 0) return '0 B';
  const units = ['B','KB','MB','GB','TB','PB'], i = Math.max(0,Math.min(5,Math.floor(Math.log(n)/Math.log(1024))));
  return `${Number((n / 1024 ** i).toFixed(i < 2 ? 0 : 2))} ${units[i]}`;
}
export const rate = value => value === null ? '—' : `${bytes(value)}/s`;
export const percent = value => value === null ? '—' : `${Number(value.toFixed(1))}%`;
export function ratio(used,total) { return used !== null && total !== null && total > 0 ? Math.max(0,Math.min(100,used/total*100)) : total === 0 && used === 0 ? 0 : null; }
export function quota(type,up,down,limit) {
  const cap = nonnegative(limit), unlimited = cap !== null && cap === 0;
  let used = null;
  if (type === 'up') used = up;
  else if (type === 'down') used = down;
  else if (up !== null && down !== null) used = type === 'sum' ? up+down : type === 'min' ? Math.min(up,down) : Math.max(up,down);
  return {used,limit:cap,unlimited,label:`${bytes(used)} / ${unlimited?'∞':bytes(cap)}`,remaining:cap !== null && used !== null && !unlimited ? Math.max(0,cap-used) : null,type:{up:'上行',down:'下行',sum:'双向',min:'上下取小',max:'上下取大'}[type] ?? '上下取大'};
}
export function price(meta) {
  const p = number(meta.price); if (p === null || p === 0 || p < -1) return '—'; if (p === -1) return '免费';
  const raw = String(meta.billing_cycle ?? '').trim(), n = number(raw);
  const words = {monthly:'月',month:'月',quarterly:'季',semiannual:'半年',yearly:'年',annually:'年',annual:'年',year:'年',lifetime:'永久',once:'永久'};
  const cycle = n === -1 ? '永久' : ({30:'月',90:'季',180:'半年',360:'年',365:'年'}[n] ?? (n > 0 ? `${n}天` : words[raw.toLowerCase()] ?? raw));
  return `${meta.currency || '¥'} ${p}${cycle ? ' / '+cycle : ''}`;
}
export function duration(value) {
  const s = nonnegative(value); if (s === null) return '—';
  return s >= 86400 ? `${Math.floor(s/86400)} 天` : s >= 3600 ? `${Math.floor(s/3600)} 小时` : `${Math.floor(s/60)} 分钟`;
}
export function nodesFromPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('节点数据格式错误');
  const items = Array.isArray(payload) ? payload : Object.values(payload);
  return items.filter(n => n && typeof n.uuid === 'string' && n.uuid && ![true,1,'1','true'].includes(n.hidden)).map(n=>({...n,name:String(n.name || n.uuid),group:String(n.group || '未分组'),region:String(n.region || '—')}));
}
export function statusMap(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('状态数据格式错误');
  return object(payload.records ?? payload.data ?? payload);
}
export function normalize(meta, record, now = Date.now()) {
  const raw = object(record), nested = typeof raw.cpu === 'object' && raw.cpu !== null;
  const online = record === false ? false : [true,1,'true','1'].includes(raw.online) ? true : [false,0,'false','0'].includes(raw.online) ? false : null;
  const field = (flat,section,key) => nonnegative(nested ? object(raw[section])[key] : raw[flat]);
  const total = (flat,section,fallback) => field(flat,section,'total') ?? nonnegative(meta[fallback]);
  const ramUsed = field('ram','ram','used'), ramTotal = total('ram_total','ram','mem_total');
  const swapUsed = field('swap','swap','used'), swapTotal = total('swap_total','swap','swap_total');
  const diskUsed = field('disk','disk','used'), diskTotal = total('disk_total','disk','disk_total');
  const upTotal=field('net_total_up','network','totalUp'),downTotal=field('net_total_down','network','totalDown');
  const connections = object(raw.connections), udp=nonnegative(nested?connections.udp:raw.connections_udp);
  const tcp=nested?nonnegative(connections.tcp):nonnegative(raw.connections_tcp) ?? (number(raw.connections)!==null && udp!==null ? Math.max(0,number(raw.connections)-udp):null);
  return {...meta,online,cpu:field('cpu','cpu','usage'),ramUsed,ramTotal,ram:ratio(ramUsed,ramTotal),swapUsed,swapTotal,swap:ratio(swapUsed,swapTotal),diskUsed,diskTotal,disk:ratio(diskUsed,diskTotal),load:field('load','load','load1'),load5:field('load5','load','load5'),load15:field('load15','load','load15'),up:field('net_out','network','up'),down:field('net_in','network','down'),upTotal,downTotal,tcp,udp,uptime:nonnegative(raw.uptime),updatedAt:timestamp(raw.updated_at ?? raw.time),traffic:quota(meta.traffic_limit_type,upTotal,downTotal,meta.traffic_limit),expiry:expiry(meta.expired_at,now),billing:price(meta)};
}
export function normalizeStats(payload) {
  if (!payload || !Array.isArray(payload.stats)) throw new Error('线路数据格式错误');
  return payload.stats.filter(s=>typeof s.entity_id==='string' && /^\d+$/.test(String(s.task_id))).map(s=>{
    const total=nonnegative(s.total),valid=nonnegative(s.valid);
    return {uuid:s.entity_id,id:String(s.task_id),name:String(s.name || `任务 ${s.task_id}`),latency:valid > 0 ? nonnegative(s.latest) : null,loss:total > 0 ? nonnegative(s.loss) : null,approximate:s.loss_approximate===true,total};
  });
}
export function legacyStats(records) {
  return Object.entries(records).flatMap(([uuid,record])=>Object.entries(object(object(record).ping)).filter(([id])=>/^\d+$/.test(id)).map(([id,p])=>({uuid,id,name:String(p.name||`任务 ${id}`),latency:nonnegative(p.latest),loss:nonnegative(p.loss),total:null})));
}
export function taskOptions(stats) { return [...new Map(stats.map(s=>[s.id,{id:s.id,name:s.name}])).values()].sort((a,b)=>Number(a.id)-Number(b.id)); }
export function selectedTasks(value) { return Array.isArray(value) ? [...new Set(value.filter(x=>/^\d+$/.test(String(x)) && Number(x)>0).map(String))].slice(0,6) : null; }
export function filterNodes(nodes,{query='',group='',region='',status='',sort='default'}={}) {
  const list=nodes.filter(n=>(!query || `${n.name} ${n.region} ${n.group}`.toLowerCase().includes(query.toLowerCase()))&&(!group||n.group===group)&&(!region||n.region===region)&&(!status||status==='online'&&n.online===true||status==='offline'&&n.online===false||status==='attention'&&(n.online===false||n.online===true&&n.cpu>=80||n.expiry.days!==null&&n.expiry.days<=7)));
  return list.sort((a,b)=>sort==='cpu'?(b.online===true?b.cpu??-1:-1)-(a.online===true?a.cpu??-1:-1):sort==='latency'?(a.latency??Infinity)-(b.latency??Infinity):sort==='expiry'?(a.expiry.days??Infinity)-(b.expiry.days??Infinity):sort==='name'?a.name.localeCompare(b.name):Number(b.weight||0)-Number(a.weight||0)||a.name.localeCompare(b.name));
}
