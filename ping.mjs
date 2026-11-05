import {mergePingMetricSeries} from './lib/pingMetrics.mjs';
import {number} from './core.mjs';
export function correctPingAverages(series){
 const rows=mergePingMetricSeries(series.map(s=>({metricKey:s.metric_key,client:s.entity_id,tags:s.tags||{},points:(s.points||[]).map(p=>({...p,count:number(p.count)??(p.value===null?0:1)}))})));
 const corrected=new Map(rows.map(r=>[r.client+'|'+r.task_id+'|'+Date.parse(r.time),r.value]));
 return series.map(s=>s.metric_key==='ping.latency_ms'?{...s,points:s.points.map(p=>({...p,value:corrected.get(s.entity_id+'|'+Number(s.tags?.task_id)+'|'+Date.parse(p.time))??p.value}))}:s);
}
