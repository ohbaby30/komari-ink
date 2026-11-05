import {nodesFromPayload,statusMap,normalizeStats,legacyStats} from './core.mjs';
export class ApiError extends Error { constructor(message,code){super(message);this.code=code;} }
export class Api {
  constructor({fetcher=(...args)=>globalThis.fetch(...args),timeout=12000}={}) {this.fetcher=fetcher;this.timeout=timeout;this.id=0;this.metricSupported=true;}
  async request(path,options={},signal) {
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted) controller.abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,this.timeout);
    try {
      const response=await this.fetcher(path,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
      if(!response.ok) throw new ApiError(response.status===401||response.status===403?'需要登录或无访问权限':`请求失败 (${response.status})`,response.status);
      return await response.json();
    } catch(error) {
      if(controller.signal.aborted) {if(signal?.aborted)throw new DOMException('Aborted','AbortError');throw new ApiError('请求超时','TIMEOUT');}
      throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async rpc(method,params={},signal) {
    const id=++this.id;
    const result=await this.request('/api/rpc2',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})},signal);
    if(!result || result.id!==id) throw new ApiError('RPC 响应不匹配','FORMAT');
    if(result.error)throw new ApiError(String(result.error.message||'接口错误'),result.error.code);
    if(!Object.prototype.hasOwnProperty.call(result,'result'))throw new ApiError('RPC 响应格式错误','FORMAT');
    return result.result;
  }
  async config(signal) {
    const data=await this.request('/api/public',{},signal);
    return data?.data ?? data;
  }
  async snapshot(signal) {
    const results=await Promise.allSettled([this.rpc('common:getNodes',{},signal),this.rpc('common:getNodesLatestStatus',{},signal)]);
    for(const result of results)if(result.status==='rejected')throw result.reason;
    const [meta,raw]=results.map(result=>result.value);
    const nodes=nodesFromPayload(meta),records=statusMap(raw);
    let stats=[],pingError=null;
    if(nodes.length) {
      if(this.metricSupported) {
        try {stats=normalizeStats(await this.rpc('public:getPingMetricStats',{hours:1,entity_ids:nodes.map(n=>n.uuid),max_points:60},signal));}
        catch(e){if(signal?.aborted)throw e;if(e.code===-32601)this.metricSupported=false;else pingError=e;}
      }
      if(!this.metricSupported)stats=legacyStats(records);
    }
    return {nodes,records,stats,pingError};
  }
  async history(uuid,type,hours,signal) {
    const result=await this.rpc('common:getRecords',{uuid,type,hours,task_id:-1,maxCount:120},signal);
    if(!result||typeof result.records!=='object')throw new ApiError('历史数据格式错误','FORMAT');
    const records=Array.isArray(result.records)?result.records:Object.values(result.records).flatMap(v=>Array.isArray(v)?v:[]);
    return {records:records.filter(r=>r && typeof r==='object' && (!r.client||r.client===uuid)).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).slice(0,120),tasks:Array.isArray(result.tasks)?result.tasks:[]};
  }
}
