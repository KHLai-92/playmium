import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/preview-info-viewer.ts'],bundle:true,write:false,format:'iife',globalName:'InfoViewerModule',platform:'browser'});
const code=built.outputFiles[0].text;
const flush=()=>new Promise(setImmediate);
function scenario(){
 class Element extends EventTarget{
  children=[];attributes={};dataset={};hidden=false;style={};classList={add(){},toggle(){return false;}};
  constructor(){super();this.textContent='';}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  setAttribute(k,v){this.attributes[k]=v;}
  querySelectorAll(){return this.children.flatMap(c=>[...(c.dataset?.commentId?[c]:[]),...(c.querySelectorAll?.()??[])]);}
  focus(){}
 }
 class CustomEvent extends Event {constructor(type,options){super(type);this.detail=options.detail;}}
 const shadow=new Element(),requests=[],seeks=[],timers=new Map(),pending=[];let timerId=0;
 const newOwner=()=>{const video=new Element();video.currentSrc='fixture-source';return {video,host:{querySelector:()=>({href:'https://www.youtube.com/watch?v=sample00001'})},events:new AbortController()};};
 let owner=newOwner();
 const pageBridge={request(video,operation,request,{signal}={}){requests.push({video,request});return new Promise((resolve,reject)=>{pending.push({resolve,reject});signal?.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});}};
 const context={
  document:{createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text})},window:{addEventListener(){}},shadow,getOwner:()=>owner,seek:t=>seeks.push(t),
  pageBridge,safeUrl:x=>x,safeImage:x=>x,CustomEvent,URL,
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
 };
 vm.runInNewContext(code,context);
 const api=context.InfoViewerModule.createInfoViewer(shadow,context.getOwner,context.seek,pageBridge);
 const nodes=()=>{const all=n=>[n,...n.children.flatMap(all)];return all(shadow)};
 const respond=(i,payload)=>pending[i].resolve({requestId:requests[i].request.requestId,error:'',...payload});
 return {api,requests,seeks,timers,respond,find:id=>nodes().find(n=>n.id===id),button:text=>nodes().find(n=>n.textContent===text),resetOwner:()=>{owner.events.abort();owner=newOwner();api.sync();},text:()=>nodes().map(n=>n.textContent).join(' ')};
}
const description={title:'Native title',author:'Creator',views:'123 views',published:'Today',runs:[{text:'1:23',seek:83}]};
test('bubble opens description, timestamp seeks, and tabs request comments separately',async()=>{
 const s=scenario();s.api.toggle();assert.equal(s.find('info-panel').hidden,false);assert.equal(s.requests[0].request.kind,'description');
 s.respond(0,{description});await flush();assert.match(s.text(),/Native title/);s.button('1:23').onclick();assert.deepEqual(s.seeks,[83]);
 s.find('info-comments-tab').onclick();assert.equal(s.requests[1].request.kind,'comments');assert.equal(s.find('info-description').hidden,true);
 s.respond(1,{comments:{items:[],sorts:[],count:'',message:'Comments disabled'}});await flush();assert.match(s.text(),/Comments disabled/);assert.equal(s.timers.size,0);
});
test('a closed preview cancels pending requests and late data cannot overwrite a new preview',async()=>{
 const s=scenario();s.api.toggle();s.resetOwner();assert.equal(s.timers.size,0);s.api.toggle();assert.equal(s.requests.length,2);
 s.respond(0,{description:{...description,title:'Stale title'}});await flush();assert.doesNotMatch(s.text(),/Stale title/);
 s.respond(1,{description});await flush();assert.match(s.text(),/Native title/);assert.equal(s.timers.size,0);
});
