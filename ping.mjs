import {mergePingMetricSeries} from './lib/pingMetrics.mjs';
import {escapeHTML as esc,number} from './core.mjs';
export function correctPingAverages(series){
 const rows=mergePingMetricSeries(series.map(s=>({metricKey:s.metric_key,client:s.entity_id,tags:s.tags||{},points:(s.points||[]).map(p=>({...p,count:number(p.count)??(p.value===null?0:1)}))})));
 const corrected=new Map(rows.map(r=>[r.client+'|'+r.task_id+'|'+Date.parse(r.time),r.value]));
 return series.map(s=>s.metric_key==='ping.latency_ms'?{...s,points:s.points.map(p=>({...p,value:corrected.get(s.entity_id+'|'+Number(s.tags?.task_id)+'|'+Date.parse(p.time))??p.value}))}:s);
}

// Compact, real-sample history strips. Loss points are percentages after normalization.
export function pingStripSVG(points=[],kind='latency'){
 const samples=points.slice(-24),slots=Array(24-samples.length).fill(null).concat(samples),max=Math.max(1,...samples.map(p=>number(p?.value)??0));
 const label=kind==='loss'?'丢包历史':'延迟历史';
 return `<svg class="ping-strip" viewBox="0 0 240 18" preserveAspectRatio="none" role="img" aria-label="${label}">${slots.map((p,i)=>{const value=number(p?.value),valid=value!==null&&value>=0&&(kind!=='loss'||value<=100),height=valid?(kind==='loss'?15:Math.max(4,18*value/max)):4,opacity=kind==='loss'&&valid ? .22+.78*Math.sqrt(value/100):.88,title=(p?.time?new Date(p.time).toLocaleString('zh-CN',{hour12:false})+' · ':'')+(valid?Number(value.toFixed(2))+(kind==='loss'?'%':' ms'):'无样本');return `<rect x="${i*10}" y="${18-height}" width="8" height="${height}" rx="1.5" fill="${valid?'currentColor':'none'}"${valid?` fill-opacity="${opacity}"`:' stroke="currentColor" stroke-opacity=".3" stroke-dasharray="1 1"'}><title>${esc(title)}</title></rect>`;}).join('')}</svg>`;
}
