import {mergePingMetricSeries} from './lib/pingMetrics.mjs';
import {escapeHTML as esc,number} from './core.mjs';
export function correctPingAverages(series){
 const rows=mergePingMetricSeries(series.map(s=>({metricKey:s.metric_key,client:s.entity_id,tags:s.tags||{},points:(s.points||[]).map(p=>({...p,count:number(p.count)??(p.value===null?0:1)}))})));
 const corrected=new Map(rows.map(r=>[r.client+'|'+r.task_id+'|'+Date.parse(r.time),r.value]));
 return series.map(s=>s.metric_key==='ping.latency_ms'?{...s,points:s.points.map(p=>({...p,value:corrected.get(s.entity_id+'|'+Number(s.tags?.task_id)+'|'+Date.parse(p.time))??p.value}))}:s);
}

// Fixed-size history cells; loss values are percentages after normalization.
export function pingStripHTML(points=[],kind='latency',{key='',lossPoints=[],intervalSeconds=0,endAt=Infinity}={}){
 const samples=points.slice(-20),slots=Array(20-samples.length).fill(null).concat(samples),lossByTime=new Map(lossPoints.map(p=>[p.time,number(p.value)]));
 const maximum=Math.max(1,...samples.map(p=>number(p?.value)??0));
 return `<div class="ping-strip" data-ping-history data-ping-key="${esc(key)}" data-kind="${kind}" tabindex="0" role="img" aria-label="${kind==='loss'?'丢包':'延迟'}历史">${slots.map(p=>{let value=number(p?.value);const loss=kind==='loss'?value:lossByTime.get(p?.time)??null;if(value!==null&&(value<0||kind==='loss'&&value>100)||kind==='latency'&&loss===100)value=null;const knownLoss=loss!==null&&loss>=0&&loss<=100,state=knownLoss&&loss===100?'down':value===null?'unknown':knownLoss&&loss>0?'partial':'ok',height=state==='unknown'?3:kind==='loss'||state==='down'?7:Math.max(3,Math.min(8,8*value/maximum));const start=p?.time||'',end=start&&intervalSeconds>0&&Math.min(Date.parse(start)+intervalSeconds*1000,endAt)-Date.parse(start)>=1000?new Date(Math.min(Date.parse(start)+intervalSeconds*1000,endAt)).toISOString():'';return `<span class="ping-cell" data-value="${value??''}" data-state="${state}" data-start="${esc(start)}" data-end="${esc(end)}" style="--cell-height:${height}px"></span>`;}).join('')}</div>`;
}
