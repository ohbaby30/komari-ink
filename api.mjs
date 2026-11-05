import {nodesFromPayload,statusMap,normalizeStats,legacyStats,publicTasks,themeSettings} from './core.mjs';
export class ApiError extends Error { constructor(message,code){super(message);this.code=code;} }
export class Api {
  constructor({fetcher=(...args)=>globalThis.fetch(...args),timeout=12000,clock=Date.now}={}) {this.fetcher=fetcher;this.timeout=timeout;this.clock=clock;this.id=0;this.metricSupported=true;this.tasksSupported=true;this.metadata=null;this.metadataAt=-Infinity;this.stats=[];this.statsAt=-Infinity;this.pingError=null;this.extrasAt=-Infinity;this.extrasFlight=null;this.onAuxiliary=()=>{};this.definitions=null;this.definitionsAt=-Infinity;}
  async request(path,options={},signal) {
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted) controller.abort(); else signal?.addEventListener('abort',abort,{once:true});
    const {timeoutMs=this.timeout,...fetchOptions}=options;
    const timer=setTimeout(abort,timeoutMs);
    try {
      const response=await this.fetcher(path,{credentials:'same-origin',cache:'no-store',...fetchOptions,signal:controller.signal});
      if(!response.ok) throw new ApiError(response.status===401||response.status===403?'需要登录或无访问权限':`请求失败 (${response.status})`,response.status);
      return await response.json();
    } catch(error) {
      if(controller.signal.aborted) {if(signal?.aborted)throw new DOMException('Aborted','AbortError');throw new ApiError('请求超时','TIMEOUT');}
      throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async rpc(method,params={},signal,timeoutMs=this.timeout) {
    const id=++this.id;
    const result=await this.request('/api/rpc2',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),timeoutMs},signal);
    if(!result || result.id!==id) throw new ApiError('RPC 响应不匹配','FORMAT');
    if(result.error)throw new ApiError(String(result.error.message||'接口错误'),result.error.code);
    if(!Object.prototype.hasOwnProperty.call(result,'result'))throw new ApiError('RPC 响应格式错误','FORMAT');
    return result.result;
  }
  async config(signal) {
    const data=await this.request('/api/public',{},signal);
    return data?.data ?? data;
  }
  async metadataSnapshot(signal,force=false){
    if(!force&&this.metadata&&this.clock()-this.metadataAt<30000)return this.metadata;
    const nodes=nodesFromPayload(await this.rpc('common:getNodes',{},signal));
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(nodes.map(n=>n.uuid).join(',')!==this.metadata?.nodes.map(n=>n.uuid).join(','))this.statsAt=-Infinity;
    this.metadata={...this.metadata,nodes,config:this.metadata?.config??{},tasks:this.metadata?.tasks??null};
    this.metadataAt=this.clock();return this.metadata;
  }
  auxiliary(){return {config:this.metadata?.config??{},tasks:this.metadata?.tasks??null,stats:this.stats,pingError:this.pingError||this.metadata?.taskError||null};}
  refreshExtras(signal,{force=false,ping=true}={}){
    if(this.extrasFlight)return this.extrasFlight;
    const notify=()=>{if(!signal?.aborted)this.onAuxiliary(this.auxiliary());};
    const jobs=[];let configuration=Promise.resolve();
    if(force||this.clock()-this.extrasAt>=30000){
      configuration=this.config(signal).then(config=>{if(!signal?.aborted){this.metadata={...this.metadata,config};notify();}});jobs.push(configuration);
      if(this.tasksSupported)jobs.push(this.rpc('public:getPublicPingTasks',{},signal).then(publicTasks).then(tasks=>{if(!signal?.aborted){this.metadata={...this.metadata,tasks,taskError:null};notify();}}).catch(e=>{if(signal?.aborted)return;if(e.code===-32601)this.tasksSupported=false;else{this.metadata={...this.metadata,taskError:e};notify();}}));
      this.extrasAt=this.clock();
    }
    if(ping&&this.metadata?.nodes.length&&(force||this.clock()-this.statsAt>=30000)){
      const ids=this.metadata.nodes.map(n=>n.uuid);
      jobs.push((async()=>{await configuration.catch(()=>{});if(signal?.aborted||!themeSettings(this.metadata?.config).showPing)return;try{
        const stats=this.metricSupported?normalizeStats(await this.rpc('public:getPingMetricStats',{hours:1,entity_ids:ids,max_points:60},signal)):legacyStats(this.latestRecords??{});
        if(signal?.aborted)return;this.stats=stats;this.pingError=null;
      }catch(e){if(signal?.aborted)return;if(e.code===-32601){this.metricSupported=false;this.stats=legacyStats(this.latestRecords??{});this.pingError=null;}else this.pingError=e;}
      if(!signal?.aborted){this.statsAt=this.clock();notify();}})());
    }
    if(!jobs.length)return Promise.resolve();
    const flight=Promise.allSettled(jobs).finally(()=>{if(this.extrasFlight===flight)this.extrasFlight=null;});this.extrasFlight=flight;return flight;
  }
  async snapshot(signal,{force=false,ping=true}={}) {
    // Only essential node metadata and telemetry participate in the foreground poll.
    const results=await Promise.allSettled([this.metadataSnapshot(signal,force),this.rpc('common:getNodesLatestStatus',{},signal)]);
    for(const result of results)if(result.status==='rejected')throw result.reason;
    const [meta,raw]=results.map(result=>result.value),records=statusMap(raw);this.latestRecords=records;
    void this.refreshExtras(signal,{force,ping});
    return {nodes:meta.nodes,records,...this.auxiliary()};
  }
  async metricDefinitions(signal){
    if(this.definitions&&this.clock()-this.definitionsAt<300000)return this.definitions;
    const result=await this.rpc('public:listMetricDefinitions',{},signal);
    if(!Array.isArray(result))throw new ApiError('指标定义格式错误','FORMAT');
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    this.definitions=result;this.definitionsAt=this.clock();return result;
  }
  async history(uuid,type,hours,signal) {
    const result=await this.rpc('common:getRecords',{uuid,type,hours,task_id:-1,maxCount:120},signal);
    if(!result||!result.records||typeof result.records!=='object')throw new ApiError('历史数据格式错误','FORMAT');
    const records=Array.isArray(result.records)?result.records:Object.values(result.records).flatMap(v=>Array.isArray(v)?v:[]);
    return {records:records.filter(r=>r && typeof r==='object' && (!r.client||r.client===uuid)).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).slice(0,120),tasks:Array.isArray(result.tasks)?result.tasks:[]};
  }
  async queryMetrics(uuid,keys,range,aggregation='avg',signal){
    const result=await this.rpc('public:queryMetrics',{metric_keys:[...new Set(keys)],entity_id:uuid,...range,max_points:700,aggregation,fill_empty:true},signal,30000);
    if(!result||!Array.isArray(result.series))throw new ApiError('指标响应格式错误','FORMAT');return result;
  }
  async saveTemplate(config,charts,signal){
    if(typeof config.theme!=='string'||!config.theme)throw new Error('未获取当前主题');
    return this.request('/api/admin/theme/settings?theme='+encodeURIComponent(config.theme),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config.theme_settings,chartDashboardTemplate:JSON.stringify(charts)})},signal);
  }
}
