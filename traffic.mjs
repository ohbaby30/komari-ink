import {TODAY_TRAFFIC_METRIC_KEYS,TODAY_TRAFFIC_AGGREGATION,summarizeTodayTrafficMetrics,buildTodayTrafficMetricSamples,summarizeTodayTrafficRecords,buildTodayTrafficRecordSamples} from './lib/trafficStats.mjs';
import {getMetricBoundaryRepairRange,hasMetricBoundaryGap,fillMetricBoundaryGaps} from './lib/metricBoundaryRepair.mjs';
export function dayRange(now=Date.now()){const start=new Date(now);start.setHours(0,0,0,0);return {start:start.getTime(),end:now};}
const normalize=(payload,uuids,start,end)=>(payload.series||[]).filter(s=>uuids.includes(s.entity_id)).map(s=>({metricKey:s.metric_key,client:s.entity_id,tags:s.tags||{},intervalSeconds:s.interval_seconds,points:(s.points||[]).filter(p=>{const t=Date.parse(p.time);return t>=start&&t<=end;})}));
export async function loadTraffic(api,uuids,start,end,signal){
 const range={start:new Date(start).toISOString(),end:new Date(end).toISOString()},base={entity_ids:uuids,metric_keys:TODAY_TRAFFIC_METRIC_KEYS,aggregation_by_metric:TODAY_TRAFFIC_AGGREGATION,fill_empty:false};
 if(!uuids.length)return {rows:[],samples:{},start,end,source:'metrics'};
 try{
  const payload=await api.rpc('public:queryMetrics',{...base,...range,max_points:Math.max(1,Math.ceil((end-start)/300000))},signal,8000);
  if(!Array.isArray(payload?.series))throw Error('流量响应格式错误');
  let series=normalize(payload,uuids,start,end);const boundary=getMetricBoundaryRepairRange(start,end);
  if(boundary&&hasMetricBoundaryGap(series,boundary)){
   const repair=await api.rpc('public:queryMetrics',{...base,start:new Date(boundary.startMs).toISOString(),end:new Date(boundary.endMs).toISOString(),max_points:10000},signal,8000);
   series=fillMetricBoundaryGaps(series,normalize(repair,uuids,boundary.startMs,boundary.endMs),TODAY_TRAFFIC_AGGREGATION).series;
  }
  const rows=summarizeTodayTrafficMetrics(series,uuids).map(row=>{const has=key=>series.some(s=>s.client===row.uuid&&s.metricKey===key&&s.points.some(p=>p.count>0&&p.value!==null&&Number.isFinite(p.value)));return {...row,trafficUp:has('traffic.up')?row.trafficUp:null,trafficDown:has('traffic.down')?row.trafficDown:null,peakUp:has('net.out.rate')?row.peakUp:null,peakDown:has('net.in.rate')?row.peakDown:null};});
  return {rows,samples:Object.fromEntries(uuids.map(uuid=>[uuid,buildTodayTrafficMetricSamples(series,uuid)])),start,end,source:'metrics'};
 }catch(error){if(signal?.aborted||[401,403].includes(error.code))throw error;
  const rows=[],samples={};
  // Bound compatibility concurrency. It is only used if the metric API is unavailable.
  for(let i=0;i<uuids.length;i+=4)await Promise.all(uuids.slice(i,i+4).map(async uuid=>{
   const result=await api.rpc('common:getRecords',{uuid,type:'load',hours:(end-start)/3600000+1,maxCount:3000},signal,10000);
   const records=Array.isArray(result?.records)?result.records:result?.records?.[uuid];if(!Array.isArray(records))throw Error('流量兼容记录格式错误');
   const own=records.filter(r=>!r.client||r.client===uuid);const row=summarizeTodayTrafficRecords(uuid,own,start,end),hasBaseline=own.some(r=>Date.parse(r.time)<=start);row.partial=!hasBaseline;for(const [key,field] of [['trafficUp','net_total_up'],['trafficDown','net_total_down']])if(own.filter(r=>typeof r[field]==='number'&&Number.isFinite(r[field])&&r[field]>=0).length<2)row[key]=null;rows.push(row);samples[uuid]=buildTodayTrafficRecordSamples(own,start,end);
  }));
  return {rows,samples,start,end,source:'records'};
 }
}
