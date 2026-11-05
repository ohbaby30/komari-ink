import {escapeHTML as esc,historyPolicy,number} from './core.mjs';
import {METRICS,AGGREGATIONS,dashboardTemplate,catalog,queryRange,normalizeSeries,realtimeSeries,mergeRealtime,seriesKey,seriesLabel,seriesSVG,metricValue} from './metrics.mjs';
const STORE='komari-ink-dashboard-v1';
export class Dashboard {
 constructor(element,{api,node,config,tasks}){
  Object.assign(this,{element,api,node,config,tasks});this.uuid=null;this.openSequence=0;this.controller=null;this.token=0;this.definitions=[];this.series=[];this.live=[];this.lastRemote=0;this.loading=false;this.hidden=new Set();this.saved=null;
  try{const saved=JSON.parse(localStorage.getItem(STORE)||'null');if(saved&&typeof saved==='object'){this.saved=saved.charts;this.aggregation=AGGREGATIONS.includes(saved.aggregation)?saved.aggregation:'avg';this.ewma=saved.ewma===true;this.hidden=new Set(Array.isArray(saved.hidden)?saved.hidden.filter(v=>typeof v==='string'):[]);}}catch{}
  this.aggregation??='avg';this.charts=dashboardTemplate(this.saved??this.config().theme_settings?.chartDashboardTemplate);
  element.innerHTML=`<div class="history-tools"><h3>历史 / 实时</h3><select data-range aria-label="时间范围"><option value="live">实时</option></select><select data-aggregation aria-label="聚合方式">${AGGREGATIONS.map(k=>`<option value="${k}">${{avg:'平均值',min:'最小值',max:'最大值',first:'首值',last:'末值',stddev:'标准差'}[k]||k.toUpperCase()}</option>`).join('')}</select><label><input type="checkbox" data-ewma> EWMA</label><button data-load>加载</button></div><div class="history-tools" data-custom hidden><label>开始 <input type="datetime-local" data-start aria-label="开始时间"></label><label>结束 <input type="datetime-local" data-end aria-label="结束时间"></label></div><div class="history-tools"><button data-add>添加图表</button><button data-reset>跟随站点模板</button><button data-save>保存站点模板</button></div><p data-result role="status"></p><div class="chart-grid"></div>`;
  this.$('[data-aggregation]').value=this.aggregation;this.$('[data-ewma]').checked=!!this.ewma;
  const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);this.$('[data-start]').value=local(new Date(Date.now()-86400000));this.$('[data-end]').value=local(new Date());
  this.$('[data-range]').onchange=()=>{this.cancel();this.message('');this.series=[];this.$('[data-custom]').hidden=this.range!=='custom';this.renderContent();if(this.range==='live')void this.load();};
  this.$('[data-load]').onclick=()=>void this.load();
  this.$('[data-aggregation]').onchange=()=>{this.aggregation=this.$('[data-aggregation]').value;this.persist(false);void this.load();};
  this.$('[data-ewma]').onchange=()=>{this.ewma=this.$('[data-ewma]').checked;this.persist(false);this.renderContent();};
  this.$('[data-add]').onclick=()=>{this.charts.push({id:crypto.randomUUID(),title:'图表',metrics:['cpu.usage'],size:'small'});this.changed();};
  this.$('[data-reset]').onclick=()=>{this.saved=null;this.charts=dashboardTemplate(this.config().theme_settings?.chartDashboardTemplate);this.persist(false);this.refreshRanges();this.renderCharts();void this.load();};
  this.$('[data-save]').onclick=async()=>{const button=this.$('[data-save]');button.disabled=true;try{await this.api.saveTemplate(this.config(),this.charts);const config=this.config();config.theme_settings={...config.theme_settings,chartDashboardTemplate:JSON.stringify(this.charts)};this.message('模板已保存');}catch(e){this.message('保存失败：'+e.message);}finally{button.disabled=false;}};
  if(typeof ResizeObserver!=='undefined'){this.resizeObserver=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width>0&&width!==this.width){this.width=width;if(this.uuid)this.renderContent();}});this.resizeObserver.observe(element);}
  element.addEventListener('change',event=>this.edit(event));element.addEventListener('click',event=>this.action(event));this.renderCharts();
 }
 $(selector){return this.element.querySelector(selector);}
 get range(){return this.$('[data-range]').value;}
 message(text){this.$('[data-result]').textContent=text;}
 persist(charts=true){if(charts)this.saved=this.charts;try{localStorage.setItem(STORE,JSON.stringify({charts:this.saved,aggregation:this.aggregation,ewma:this.ewma,hidden:[...this.hidden]}));}catch{this.message('浏览器无法保存图表设置');}}
 refreshRanges(){const select=this.$('[data-range]'),previous=select.value,keys=new Set(this.charts.flatMap(c=>c.metrics));
  const definitions=this.definitions.filter(d=>keys.has(d.name)),policy=historyPolicy(this.config(),definitions.length?definitions:null,'all');
  select.innerHTML=`<option value="live">实时</option>${policy.ranges.map(h=>`<option value="${h}">${h<1?Math.round(h*60)+' 分钟':h<24?h+' 小时':h/24+' 天'}</option>`).join('')}<option value="custom">自定义</option>`;
  if([...select.options].some(o=>o.value===previous))select.value=previous;this.$('[data-custom]').hidden=this.range!=='custom';
 }
 cancel(){this.token++;this.controller?.abort();this.controller=null;this.loading=false;this.$('[data-load]').disabled=false;}
 close(){this.openSequence++;this.cancel();this.uuid=null;this.series=[];this.live=[];}
 async open(uuid){this.close();this.uuid=uuid;this.lastRemote=0;this.series=[];this.live=[];this.message('');this.refreshRanges();this.renderCharts();this.tick(this.node());
  const opened=this.openSequence;try{const defs=await this.api.metricDefinitions();if(this.uuid!==uuid||opened!==this.openSequence)return;this.definitions=defs;this.refreshRanges();this.renderCharts();}catch(e){if(this.uuid===uuid&&opened===this.openSequence)this.message('指标定义获取失败：'+e.message);}
  if(this.uuid===uuid&&opened===this.openSequence)void this.load();
 }
 settingsChanged(){if(this.saved==null){this.charts=dashboardTemplate(this.config().theme_settings?.chartDashboardTemplate);this.refreshRanges();this.renderCharts();}}
 changed(){this.persist();this.refreshRanges();this.renderCharts();void this.load();}
 edit(event){const panel=event.target.closest('[data-chart]');if(!panel)return;const chart=this.charts.find(c=>c.id===panel.dataset.chart);if(!chart)return;
  if(event.target.matches('[data-title]'))chart.title=event.target.value||'图表';
  else if(event.target.matches('[data-size]'))chart.size=event.target.value;
  else if(event.target.matches('[data-metric]'))chart.metrics=[...panel.querySelectorAll('[data-metric]:checked')].map(i=>i.value);
  else if(event.target.matches('[data-visible]')){const key=event.target.value;if(event.target.checked)this.hidden.delete(key);else this.hidden.add(key);this.persist(false);this.renderContent();return;}
  else if(event.target.matches('[data-view]')){panel.dataset.view=event.target.value;this.renderContent();return;}else return;
  this.changed();
 }
 action(event){const button=event.target.closest('[data-move],[data-remove]'),panel=button?.closest('[data-chart]');if(!panel)return;const index=this.charts.findIndex(c=>c.id===panel.dataset.chart);if(index<0)return;
  if(button.hasAttribute('data-remove'))this.charts.splice(index,1);else {const next=index+Number(button.dataset.move);if(next<0||next>=this.charts.length)return;[this.charts[index],this.charts[next]]=[this.charts[next],this.charts[index]];}this.changed();
 }
 renderCharts(){const container=this.$('.chart-grid'),open=new Set([...container.querySelectorAll('details[open]')].map(d=>d.closest('[data-chart]').dataset.chart)),views=new Map([...container.children].map(c=>[c.dataset.chart,c.dataset.view]));
  const options=catalog(this.definitions),known=new Set(options.map(m=>m.key));for(const key of this.charts.flatMap(c=>c.metrics))if(!known.has(key)){options.push({key,label:key});known.add(key);}
  container.innerHTML=this.charts.map((c,i)=>`<article class="metric-chart size-${c.size}" data-chart="${esc(c.id)}" data-view="${views.get(c.id)==='table'?'table':'chart'}"><div class="chart-head"><h3>${esc(c.title)}</h3><select data-view aria-label="${esc(c.title)}显示方式"><option value="chart">图表</option><option value="table">数据</option></select></div><details${open.has(c.id)?' open':''}><summary>编辑</summary><div class="chart-editor"><label>标题 <input data-title aria-label="图表标题" value="${esc(c.title)}"></label><label>尺寸 <select data-size aria-label="图表尺寸">${['small','medium','large'].map((s,i)=>`<option value="${s}"${s===c.size?' selected':''}>${['小','中','大'][i]}</option>`).join('')}</select></label><fieldset><legend>指标</legend>${options.map(m=>`<label><input type="checkbox" data-metric value="${esc(m.key)}"${c.metrics.includes(m.key)?' checked':''}>${esc(m.label)}</label>`).join('')}</fieldset><div class="history-tools"><button data-move="-1" aria-label="上移图表"${i===0?' disabled':''}>↑</button><button data-move="1" aria-label="下移图表"${i===this.charts.length-1?' disabled':''}>↓</button><button data-remove>移除图表</button></div></div></details><div class="series-content"></div></article>`).join('');
  for(const panel of container.children)panel.querySelector('[data-view]').value=panel.dataset.view;this.renderContent();
 }
 renderContent(){const data=this.range==='live'?[...this.live,...this.series.filter(s=>!this.live.some(l=>seriesKey(l)===seriesKey(s)))]:this.series;
  const definitions=new Map(this.definitions.map(d=>[d.name,d]));
  for(const panel of this.$('.chart-grid').children){const chart=this.charts.find(c=>c.id===panel.dataset.chart),content=panel.querySelector('.series-content');
   content.innerHTML=chart.metrics.map(key=>{const items=data.filter(s=>s.metric_key===key),definition=definitions.get(key);
    if(!items.length)return `<p>${esc(catalog(this.definitions).find(m=>m.key===key)?.label||key)} · ${this.range!=='live'&&number(definition?.retention_days)===0?'未保留历史':'无数据'}</p>`;
    return items.map(s=>{const id=seriesKey(s),label=seriesLabel(s,this.definitions,this.tasks()),unit=s.unit||catalog(this.definitions).find(m=>m.key===key)?.unit||'',visible=!this.hidden.has(id),series={...s,unit};
     const body=!visible?'':panel.dataset.view==='table'?`<div class="table-wrap"><table><thead><tr><th>时间</th><th>${esc(unit||'数值')}</th></tr></thead><tbody>${s.points.map(p=>`<tr><td>${esc(new Date(p.time).toLocaleString('zh-CN',{hour12:false}))}</td><td>${esc(metricValue(p.value,unit))}</td></tr>`).join('')}</tbody></table></div>`:seriesSVG(series,{label,ewma:this.ewma,width:content.clientWidth});
     return `<section class="metric-series"><label class="series-label"><input type="checkbox" data-visible value="${esc(id)}"${visible?' checked':''}>${esc(label)}</label>${body}</section>`;
    }).join('');
   }).join('')||'<p>请选择指标</p>';
  }
 }
 tick(node){if(!this.uuid||node?.uuid!==this.uuid)return;this.live=mergeRealtime(this.live,realtimeSeries(node));if(this.range==='live'){this.renderContent();if(!this.loading&&Date.now()-this.lastRemote>=30000)void this.load();}}
 async load(){if(!this.uuid)return;this.cancel();const controller=new AbortController(),token=this.token,uuid=this.uuid;this.controller=controller;
  let range,keys=[...new Set(this.charts.flatMap(c=>c.metrics))];
  try{range=this.range==='live'?{hours:1}:queryRange(this.range,this.$('[data-start]').value,this.$('[data-end]').value);}catch(e){this.message(e.message);return;}
  if(this.range==='live'){const reads=new Set(METRICS.filter(m=>m.read||m.key.startsWith('gpu.')&&m.key!=='gpu.usage').map(m=>m.key));keys=keys.filter(k=>!reads.has(k));}
  this.loading=true;this.$('[data-load]').disabled=true;this.message('加载中');
  try{const result=keys.length?await this.api.queryMetrics(uuid,keys,range,this.aggregation,controller.signal):{series:[]};if(controller.signal.aborted||token!==this.token||uuid!==this.uuid)return;
   this.series=normalizeSeries(result.series,uuid);this.lastRemote=Date.now();this.renderContent();this.message('');
  }catch(e){if(!controller.signal.aborted&&token===this.token)this.message('指标获取失败：'+e.message);}
  finally{if(token===this.token){this.loading=false;this.$('[data-load]').disabled=false;}}
 }
}
