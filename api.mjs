import {nodesFromPayload,statusMap,normalizeStats,legacyStats,publicTasks,themeSettings} from './core.mjs';
export class ApiError extends Error { constructor(message,code){super(message);this.code=code;} }
export class Api {
  constructor({fetcher=(...args)=>globalThis.fetch(...args),timeout=12000,clock=Date.now}={}) {this.fetcher=fetcher;this.timeout=timeout;this.clock=clock;this.id=0;this.metricSupported=true;this.tasksSupported=true;this.metadata=null;this.metadataAt=-Infinity;this.stats=[];this.statsAt=-Infinity;this.pingError=null;this.definitions=null;this.definitionsAt=-Infinity;}
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
  async metadataSnapshot(signal,force=false){
    if(!force&&this.metadata&&this.clock()-this.metadataAt<30000)return this.metadata;
    const [nodes,config,tasks]=await Promise.allSettled([
      this.rpc('common:getNodes',{},signal),this.config(signal),
      this.tasksSupported?this.rpc('public:getPublicPingTasks',{},signal).then(publicTasks):Promise.resolve(null),
    ]);
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(nodes.status==='rejected')throw nodes.reason;
    const list=nodesFromPayload(nodes.value);
    if(list.map(n=>n.uuid).join(',')!==this.metadata?.nodes.map(n=>n.uuid).join(','))this.statsAt=-Infinity;
    if(tasks.status==='rejected'&&tasks.reason.code===-32601)this.tasksSupported=false;
    this.metadata={nodes:list,config:config.status==='fulfilled'?config.value:this.metadata?.config??{},tasks:tasks.status==='fulfilled'?tasks.value:this.metadata?.tasks??null,taskError:tasks.status==='rejected'&&tasks.reason.code!==-32601?tasks.reason:null};
    this.metadataAt=this.clock();return this.metadata;
  }
  async snapshot(signal,{force=false,ping=true}={}) {
    const results=await Promise.allSettled([this.metadataSnapshot(signal,force),this.rpc('common:getNodesLatestStatus',{},signal)]);
    for(const result of results)if(result.status==='rejected')throw result.reason;
    const [meta,raw]=results.map(result=>result.value),records=statusMap(raw);
    const enabled=ping&&themeSettings(meta.config).showPing;
    if(enabled&&meta.nodes.length&&(force||this.clock()-this.statsAt>=30000)){
      try {
        const stats=this.metricSupported?normalizeStats(await this.rpc('public:getPingMetricStats',{hours:1,entity_ids:meta.nodes.map(n=>n.uuid),max_points:60},signal)):legacyStats(records);
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        this.stats=stats;this.pingError=null;
      }catch(e){if(signal?.aborted)throw e;if(e.code===-32601){this.metricSupported=false;this.stats=legacyStats(records);this.pingError=null;}else this.pingError=e;}
      this.statsAt=this.clock();
    }
    return {...meta,records,stats:enabled?this.stats:[],pingError:enabled?this.pingError||meta.taskError:null};
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
}
