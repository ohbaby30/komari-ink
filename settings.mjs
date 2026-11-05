import {themeSettings,object,number} from './core.mjs';
import {normalizeNodeIdentityList,nodeMatchesIdentitySet,buildNodeIdentitySet} from './lib/nodeIdentity.mjs';
export {normalizeNodeIdentityList,nodeMatchesIdentitySet,buildNodeIdentitySet};
// Native Komari managed settings are the source of site configuration.
export const FIELDS=[
 ['defaultAppearance','外观','select','light',['light','dark','system']],
 ['desktopNodeViewMode','桌面布局','select','cards',['cards','compact','mini','list','board']],['mobileNodeViewMode','手机布局','select','cards',['cards','compact','mini','list','board']],
 ['showOverview','总览','bool',true],['showGroupTabs','分组筛选','bool',true],['showRegionBar','地区筛选','bool',true],['showCardGroup','卡片分组','bool',true],['enableHomeSort','排序','bool',true],
 ['homeSortField','默认排序','select','default',['default','name','speed','traffic','price','cpu','latency','expiry']],['homeSortDirection','排序方向','select','asc',['asc','desc']],
 ['compactShowTrafficTotal','紧凑流量','bool',true],['compactShowBilling','紧凑费用','bool',true],['showTraffic','节点流量','bool',true],['showBilling','费用与到期','bool',true],['compactShowUptime','紧凑运行时长','bool',true],['showConnections','连接数','bool',false],['showIpTagsInCard','IP 标签','bool',true],
 ['showPing','首页线路','bool',true],['showPingChart','历史线路','bool',true],['showServerListInDetails','详情节点切换','bool',true],['enableHomepageMultiPing','首页多线路','bool',true],['fakePingForUnbound','未分配节点显示模拟延迟','bool',false],
 ['showCostSummary','资产统计','bool',true],['showCostSummaryFloatingButton','资产入口','bool',true],['showRenewalReminder','续费提醒','bool',true],['enableAdminButton','管理入口','bool',true],
 ['showOverviewRatings','概况评级','bool',false],['showTrafficRating','流量评级','bool',true],['showBandwidthRating','带宽评级','bool',true],['showAssetRating','资产评级','bool',true],
 ['trafficRatingLabels','流量评级名称','text',''],['bandwidthRatingLabels','带宽评级名称','text',''],['assetRatingLabels','资产评级名称','text',''],
 ['enableBackgroundImage','背景图片','bool',false],['backgroundImage','桌面背景','url',''],['backgroundImageMobile','手机背景','url',''],['backgroundAlignment','背景排布','select','cover center',['cover top','cover center','cover bottom','contain top','contain center','contain bottom','auto center']],['surfaceOpacity','卡片不透明度（%）','number',100],
 ['darkDepth','深色浓度','number',100],['costRateApiUrl','汇率地址','url','https://api.frankfurter.dev/v2/rates?base=USD'],['customFooterHtml','页脚','textarea',''],
];
const aliases={showOverview:'showHomeOverview',backgroundImage:'backgroundImageUrlDesktop',backgroundImageMobile:'backgroundImageUrlMobile'};
export function configObject(value){if(typeof value==='string'){try{return object(JSON.parse(value));}catch{return {};}}return object(value);}
export function settings(config={}){
 const raw=object(config.theme_settings),out={...themeSettings(config)};
 for(const [key,,type,initial,values] of FIELDS){const v=raw[key]??raw[aliases[key]];out[key]=type==='bool'?typeof v==='boolean'?v:initial:type==='number'?number(v)??initial:type==='select'?values.includes(v)?v:initial:typeof v==='string'?v:initial;}
 const modes={large:'cards',compact:'compact',mini:'mini',list:'list',cards:'cards',board:'board'};
 out.desktopNodeViewMode=modes[raw.desktopNodeViewMode]??modes[raw.defaultView]??out.desktopNodeViewMode;out.mobileNodeViewMode=modes[raw.mobileNodeViewMode]??modes[raw.defaultView]??out.mobileNodeViewMode;
 out.metricColors=configObject(raw.metricColors);out.darkDepth=Math.max(0,Math.min(100,out.darkDepth));
 out.surfaceOpacity=Math.max(0,Math.min(100,out.surfaceOpacity));const alignment=String(raw.backgroundAlignment||'').replace(',',' ').replace(/\s+/g,' ').trim();if(FIELDS.find(f=>f[0]==='backgroundAlignment')[4].includes(alignment))out.backgroundAlignment=alignment;out.backgroundImage=normalizeBackgroundUrl(out.backgroundImage);out.backgroundImageMobile=normalizeBackgroundUrl(out.backgroundImageMobile);try{const url=new URL(out.costRateApiUrl);if(!['http:','https:'].includes(url.protocol))throw Error();out.costRateApiUrl=url.href;}catch{out.costRateApiUrl=FIELDS.find(f=>f[0]==='costRateApiUrl')[3];}if(!['asc','desc'].includes(raw.homeSortDirection))out.homeSortDirection=['default','name','expiry','latency'].includes(out.homeSortField)?'asc':'desc';
 out.hiddenNodes=normalizeNodeIdentityList(raw.hiddenNodes);out.costIgnoredNodes=normalizeNodeIdentityList(raw.costIgnoredNodes);out.homeGroupOrder=normalizeNodeIdentityList(raw.homeGroupOrder);
 out.costPremiums=configObject(raw.costPremiums);out.homepagePingBindings=configObject(raw.homepagePingBindings);
 const ids=raw.homepagePingTaskIds?.length?raw.homepagePingTaskIds:raw.homepageMultiPingTaskIds;if(Array.isArray(ids)&&ids.length)out.homepagePingTaskIds=ids.map(String).slice(0,6);
 return out;
}
export function visibleNodes(nodes,config){const hidden=buildNodeIdentitySet(settings(config).hiddenNodes);return nodes.filter(n=>!nodeMatchesIdentitySet(n,hidden));}
export const labelValue=value=>value.includes(' ')?value.split(' ').map(v=>({cover:'填满',contain:'完整',auto:'原始',top:'顶部',center:'居中',bottom:'底部'}[v]||v)).join(' · '):({light:'浅色',dark:'深色',system:'跟随系统',cards:'卡片',large:'卡片',compact:'紧凑',mini:'迷你',list:'列表',board:'看板',default:'权重',name:'名称',speed:'实时速率',traffic:'累计流量',price:'月化价格',cpu:'CPU',latency:'延迟',expiry:'到期',asc:'升序',desc:'降序'}[value]||value);
export function cpuModel(node){return [node.cpu_name,node.cpu_model,node.cpuName].find(v=>typeof v==='string'&&v.trim())?.trim()||'—';}
export function systemFields(node){return [['CPU 型号',cpuModel(node)],['CPU 核心',node.cpu_cores??'—'],['架构',node.arch||'—'],['虚拟化',node.virtualization||'—'],['显卡',node.gpu_name||'—'],['操作系统',node.os||'—'],['内核',node.kernel_version||'—'],['Agent',node.version||'—'],['IPv4',node.ipv4||'—'],['IPv6',node.ipv6||'—'],['公开标签',Array.isArray(node.tags)?node.tags.join(' · '):node.tags||'—'],['公开备注',node.public_remark||'—']];}
export function pluginPath(path){const match=/^\/plugin\/([^/]+)\/(.+)$/.exec(path);if(!match)return null;try{const parts=[decodeURIComponent(match[1]),...match[2].split('/').map(decodeURIComponent)];if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('/')||p.includes('\\')))return null;return '/api/plugin/'+parts.map(encodeURIComponent).join('/');}catch{return null;}}

export function normalizeBackgroundUrl(raw){if(typeof raw!=='string')return '';const [light='',dark='']=raw.split('|').map(v=>v.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,2048));return dark&&dark!==light?light+'|'+dark:light;}
export function resolveBackgroundUrl(raw,appearance){const [light='',dark]=normalizeBackgroundUrl(raw).split('|');return appearance==='dark'&&dark!==undefined?dark:light;}
