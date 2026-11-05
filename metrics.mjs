import {number,nonnegative,timestamp,escapeHTML as esc,bytes,rate,percent} from './core.mjs';
// Keys and query parameters follow the official Komari metric API.
export const METRICS=[
 ['cpu.usage','CPU','%',n=>n.cpu],['gpu.usage','GPU','%',n=>n.gpu],
 ['gpu.device.usage','GPU 使用率','%'],['gpu.memory.used','显存使用','bytes'],['gpu.memory.total','显存总量','bytes'],['gpu.temperature','GPU 温度','degC'],
 ['memory.used','内存使用','bytes',n=>n.ramUsed],['memory.total','内存总量','bytes',n=>n.ramTotal],
 ['swap.used','Swap 使用','bytes',n=>n.swapUsed],['swap.total','Swap 总量','bytes',n=>n.swapTotal],
 ['load.average','Load','',n=>n.load],['temperature','温度','degC',n=>n.temperature],
 ['disk.used','磁盘使用','bytes',n=>n.diskUsed],['disk.total','磁盘总量','bytes',n=>n.diskTotal],
 ['net.in.rate','下行','bytes/s',n=>n.down],['net.out.rate','上行','bytes/s',n=>n.up],
 ['net.total.up','累计上行','bytes',n=>n.upTotal],['net.total.down','累计下行','bytes',n=>n.downTotal],
 ['traffic.up','区间上行','bytes'],['traffic.down','区间下行','bytes'],
 ['process.count','进程数','',n=>n.processes],['connections.tcp','TCP','',n=>n.tcp],['connections.udp','UDP','',n=>n.udp],
 ['ping.latency_ms','延迟','ms'],
].map(([key,label,unit,read])=>({key,label,unit,read}));
export const AGGREGATIONS=['avg','min','max','first','last','stddev','p70','p95','p99'];
export const DEFAULT_CHARTS=[
 {id:'cpu',title:'CPU',metrics:['cpu.usage','load.average'],size:'small'},
 {id:'memory',title:'内存',metrics:['memory.used','swap.used'],size:'small'},
 {id:'disk',title:'磁盘',metrics:['disk.used'],size:'small'},
 {id:'network',title:'网络',metrics:['net.in.rate','net.out.rate','net.total.up','net.total.down'],size:'large'},
 {id:'ping',title:'线路',metrics:['ping.latency_ms'],size:'large'},
];
export function dashboardTemplate(value){
 try{if(typeof value==='string')value=JSON.parse(value);}catch{value=null;}
 if(!Array.isArray(value))value=DEFAULT_CHARTS;
 const ids=new Set();
 return value.filter(c=>c&&typeof c==='object').map((c,i)=>{
  let id=typeof c.id==='string'&&c.id?c.id:`chart-${i}`;while(ids.has(id))id+='-';ids.add(id);
  return {id,title:typeof c.title==='string'&&c.title?c.title:`图表 ${i+1}`,metrics:[...new Set((Array.isArray(c.metrics)?c.metrics:[]).filter(k=>typeof k==='string'&&k))],size:['medium','large'].includes(c.size)?c.size:'small'};
 });
}
export function catalog(definitions=[]){
 const map=new Map(METRICS.map(m=>[m.key,m]));
 for(const d of definitions||[])if(d&&typeof d.name==='string')map.set(d.name,{...map.get(d.name),key:d.name,label:map.get(d.name)?.label||String(d.description||d.name),unit:d.unit||map.get(d.name)?.unit||'',retention_days:number(d.retention_days)});
 return [...map.values()];
}
export function queryRange(value,start,end){
 if(value==='custom'){
  const a=timestamp(start),b=timestamp(end);if(a===null||b===null||b<=a)throw new Error('请选择有效的起止时间');
  return {start:new Date(a).toISOString(),end:new Date(b).toISOString()};
 }
 const hours=number(value);if(hours===null||hours<=0)throw new Error('请选择时间范围');return {hours};
}
const tagsKey=tags=>JSON.stringify(Object.entries(tags||{}).sort(([a],[b])=>a.localeCompare(b)));
export const seriesKey=s=>`${s.metric_key}|${tagsKey(s.tags)}`;
export function normalizeSeries(series,uuid){
 if(!Array.isArray(series))throw new Error('指标响应格式错误');
 // Some backends attach tags to each point. Keep devices/tasks as distinct series.
 const grouped=new Map();
 for(const s of series){
  if(!s||typeof s.metric_key!=='string'||s.entity_id&&s.entity_id!==uuid)continue;
  for(const p of s.points||[]){const time=timestamp(p.time);if(time===null)continue;const tags={...s.tags,...p.tags},key=seriesKey({...s,tags});
   if(!grouped.has(key))grouped.set(key,{metric_key:s.metric_key,entity_id:uuid,unit:s.unit||'',tags,points:[]});
   grouped.get(key).points.push({time:new Date(time).toISOString(),value:s.metric_key==='ping.latency_ms'?nonnegative(p.value):number(p.value),count:p.count});
  }
 }
 return [...grouped.values()].map(s=>({...s,points:s.points.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time))}));
}
export function realtimeSeries(node){
 if(!node)return [];
 const time=node.updatedAt??Date.now(),make=(key,value,unit='',tags={})=>({metric_key:key,entity_id:node.uuid,unit,tags,points:[{time:new Date(time).toISOString(),value:node.online===true?number(value):null}]});
 const result=METRICS.filter(m=>m.read).map(m=>make(m.key,m.read(node),m.unit));
 for(const [index,g] of Object.entries(node.gpuDetails||{})){
  if(!g||typeof g!=='object')continue;
  const tags={device_index:String(g.device_index??index),device_name:String(g.device_name||`GPU ${Number(index)+1}`)};
  for(const [key,field,unit] of [['gpu.device.usage','usage','%'],['gpu.memory.used','mem_used','bytes'],['gpu.memory.total','mem_total','bytes'],['gpu.temperature','temperature','degC']])result.push(make(key,g[field],unit,tags));
 }
 return result;
}
export function mergeRealtime(previous,current,limit=150){
 const map=new Map(previous.map(s=>[seriesKey(s),s]));
 for(const s of current){const key=seriesKey(s),old=map.get(key),point=s.points[0];if(old){const points=old.points.filter(p=>p.time!==point.time);points.push(point);map.set(key,{...s,points:points.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).slice(-limit)});}else map.set(key,s);}
 return [...map.values()];
}
export function smoothPoints(points,enabled){
 let last=null;return points.map(p=>{const value=number(p.value);if(value===null){last=null;return {...p,value:null};}last=enabled&&last!==null?.3*value+.7*last:value;return {...p,value:last};});
}
export function seriesLabel(s,definitions=[],tasks=[]){
 const m=catalog(definitions).find(m=>m.key===s.metric_key),tags=s.tags||{},task=tasks?.find(t=>String(t.id)===String(tags.task_id));
 return [m?.label||s.metric_key,task?.name||tags.task_name||tags.device_name||tags.device_index||(tags.task_id?`任务 ${tags.task_id}`:null),...Object.entries(tags).filter(([k])=>!['task_id','task_name','device_name','device_index'].includes(k)).map(([k,v])=>`${k}=${v}`)].filter(Boolean).join(' · ');
}
export function metricValue(value,unit){const n=number(value);if(n===null)return '—';if(unit==='bytes')return bytes(n);if(unit==='bytes/s')return rate(n);if(unit==='%')return percent(n);return `${Number(n.toFixed(3))}${unit?' '+(unit==='degC'?'°C':unit):''}`;}
export function seriesSVG(series,{label='',ewma=false,width=680}={}){
 const points=smoothPoints(series.points,ewma),valid=points.filter(p=>p.value!==null);
 if(!valid.length)return '<p>无有效样本</p>';
 const first=timestamp(points[0].time),last=timestamp(points.at(-1).time),low=Math.min(0,...valid.map(p=>p.value)),high=Math.max(1,...valid.map(p=>p.value));
 const w=Math.max(240,number(width)??680),right=w-24;
 const x=t=>48+(timestamp(t)-first)/(last-first||1)*(right-48),y=v=>134-(v-low)/(high-low||1)*110;
 const segments=[];let segment=[];
 for(const p of points){if(p.value===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(p);}if(segment.length)segments.push(segment);
 const local=t=>new Date(t).toLocaleString('zh-CN',{hour12:false});
 return `<svg class="trend" viewBox="0 0 ${w} 174" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><path d="M48 20V134H${right}" fill="none" stroke="currentColor"/>${segments.map(part=>part.length===1?`<circle cx="${x(part[0].time).toFixed(1)}" cy="${y(part[0].value).toFixed(1)}" r="2" fill="currentColor"/>`:`<polyline points="${part.map(p=>`${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('')}<text x="48" y="157">${esc(local(first))}</text><text x="${right}" y="172" text-anchor="end">${esc(local(last))}</text><text x="48" y="13">${esc(metricValue(high,series.unit))}</text><text x="${right}" y="13" text-anchor="end">${esc(metricValue(valid.at(-1).value,series.unit))}</text></svg>`;
}
// Build once per changed batch; lookup cost depends on selected tasks, not node count.
export function createLineLookup(stats,tasks,selected){
 const samples=new Map();for(const s of stats){const {uuid,...sample}=s;if(!samples.has(uuid))samples.set(uuid,new Map());samples.get(uuid).set(String(s.id),{...sample,uuid});}
 const taskMap=new Map((tasks||[]).map(t=>[String(t.id),{...t,members:new Set(t.clients||[])}])),cache=new Map();
 return uuid=>{if(!cache.has(uuid))cache.set(uuid,selected.map(id=>{const key=String(id),task=taskMap.get(key),sample=samples.get(uuid)?.get(key);return {...(sample||{id:key,name:task?.name||`任务 ${key}`,latency:null,loss:null}),assigned:tasks===null||Boolean(task?.members.has(uuid))};}));return cache.get(uuid);};
}
export function instanceRoute(path){const match=/^\/instance\/([^/]+)\/?$/.exec(path);try{return match?decodeURIComponent(match[1]):null;}catch{return null;}}
