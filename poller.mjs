// One shared snapshot request; pauses and cancels while hidden. No WebSocket or heartbeat.
export class Poller {
  constructor({load,onData,onError,onBusy=()=>{},interval=60000,hidden=()=>globalThis.document?.hidden??false,setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=id=>globalThis.clearTimeout(id)}) {
    Object.assign(this,{load,onData,onError,onBusy,interval,hidden,setTimer,clearTimer});this.failures=0;this.timer=null;this.flight=null;this.controller=null;this.stopped=true;this.resumePending=false;
  }
  start(){this.stopped=false;return this.refresh();}
  stop(){this.stopped=true;this.clear();this.controller?.abort();}
  clear(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
  setInterval(ms){this.interval=[0,30000,60000,300000].includes(ms)?ms:60000;this.clear();if(!this.flight)this.schedule();}
  schedule(){if(this.stopped||this.hidden()||!this.interval)return;const delay=Math.min(300000,this.interval*2**Math.min(this.failures,4));this.timer=this.setTimer(()=>{this.timer=null;void this.refresh();},delay);}
  visibility(){this.clear();if(this.hidden()){this.resumePending=false;this.controller?.abort();}else if(!this.stopped){if(this.flight)this.resumePending=true;else void this.refresh();}}
  refresh(){
    if(this.stopped||this.hidden())return Promise.resolve();
    if(this.flight)return this.flight;
    this.clear();const controller=new AbortController();this.controller=controller;this.onBusy(true);
    this.flight=Promise.resolve().then(async()=>{
      try{const data=await this.load(controller.signal);if(!controller.signal.aborted&&!this.stopped){this.failures=0;this.onData(data);}}
      catch(e){if(!controller.signal.aborted&&!this.stopped){this.failures++;this.onError(e);}}
      finally{this.flight=null;this.controller=null;this.onBusy(false);if(this.resumePending&&!this.hidden()&&!this.stopped){this.resumePending=false;void this.refresh();}else this.schedule();}
    });return this.flight;
  }
}
