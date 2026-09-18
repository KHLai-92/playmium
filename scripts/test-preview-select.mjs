import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectControls } from '../src/preview-select.ts';

function scenario(run) {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const handlers = new Map(), changes = [];
  class Element {
    children = []; attributes = {}; style = {}; hidden = false; textContent = ''; disabled = false;
    classList = { toggle() {} };
    setAttribute(k,v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; }
    append(x) { this.children.push(x); }
    replaceChildren(...children) { this.children = children; }
    after(trigger) { this.trigger = trigger; }
    scrollIntoView() {}
    focus() { this.focused = true; }
    getBoundingClientRect() { return {left:700,top:240,right:890,bottom:276,width:190,height:36}; }
  }
  const select = new Element(); select.id = 'translation'; select.setAttribute('aria-label','Subtitle translation');
  select.options = [{value:'',textContent:'Off'}, {value:'zh-Hant',textContent:'中文（繁體）'}, {value:'fr',textContent:'French'},
    ...Array.from({length:153},(_,i)=>({value:String(i),textContent:`Language ${i}`}))];
  Object.defineProperty(select,'selectedIndex',{get() {return this.options.findIndex(o=>o.selected);},set(i) {this.options.forEach((o,n)=>o.selected=n===i);}});
  Object.defineProperty(select,'selectedOptions',{get() {return this.options.filter(o=>o.selected);}});
  select.selectedIndex = 0;
  select.dispatchEvent = () => changes.push(select.selectedOptions[0].value);
  const controls = {hidden:false};
  const shadow = new Element(); shadow.querySelectorAll = () => [select]; shadow.querySelector = () => controls;
  const panel = {getBoundingClientRect:()=>({left:200,top:20,width:1080,height:607})};
  globalThis.document = {createElement:()=>new Element()};
  globalThis.window = {addEventListener:(name,fn)=>handlers.set(name,fn)};
  try {
    const api = createSelectControls(shadow,panel); api.sync();
    const press = key => {let prevented=false,stopped=false; handlers.get('keydown')({key,composedPath:()=>[select.trigger],preventDefault:()=>prevented=true,stopImmediatePropagation:()=>stopped=true});return {prevented,stopped};};
    run({api,select,trigger:select.trigger,popup:shadow.children[0],changes,press,controls});
  } finally {globalThis.document=oldDocument;globalThis.window=oldWindow;}
}

test('long native language lists render inside a bounded, scrollable menu with intact labels',()=>scenario(s=>{
  s.trigger.onclick();
  assert.equal(s.popup.hidden,false); assert.equal(s.popup.children.length,156);
  assert.equal(s.popup.children[1].textContent,'中文（繁體）');
  assert.equal(s.popup.style.maxHeight,'240px');
  assert.ok(parseFloat(s.popup.style.top)>=12 && parseFloat(s.popup.style.top)+240<=607);
  assert.equal(s.trigger.getAttribute('aria-expanded'),'true');
  s.popup.children[1].onclick();
  assert.deepEqual(s.changes,['zh-Hant']);assert.equal(s.trigger.textContent,'中文（繁體）');assert.equal(s.popup.hidden,true);
}));

test('menu keyboard navigation cancels with Escape and commits only on Enter',()=>scenario(s=>{
  assert.deepEqual(s.press('Enter'),{prevented:true,stopped:true});
  s.press('ArrowDown');s.press('Escape');assert.deepEqual(s.changes,[]);assert.equal(s.select.selectedIndex,0);
  s.press('Enter');s.press('ArrowDown');s.press('ArrowDown');assert.equal(s.trigger.getAttribute('aria-activedescendant'),'preview-option-2');
  s.press('Enter');assert.deepEqual(s.changes,['fr']);
}));

test('unavailable or newly disabled options close the menu without changing native selection',()=>scenario(s=>{
  s.select.disabled=true;s.api.sync();s.trigger.onclick();assert.equal(s.popup.hidden,true);assert.equal(s.trigger.disabled,true);
  s.select.disabled=false;s.api.sync();s.trigger.onclick();assert.equal(s.popup.hidden,false);
  s.select.disabled=true;s.api.sync();assert.equal(s.popup.hidden,true);assert.deepEqual(s.changes,[]);
}));

test('player shortcuts never reopen a closed translation menu or get swallowed by an open one',()=>scenario(s=>{
  for (const key of ['c','f','k','m','j','l','5',' ','<','>']) {
    s.trigger.onclick(); s.popup.children[1].onclick();
    assert.deepEqual(s.press(key),{prevented:false,stopped:false}, `Closed menu swallowed ${key}`);
    assert.equal(s.popup.hidden,true, `Shortcut ${key} reopened the menu`);
    s.trigger.onclick();
    assert.deepEqual(s.press(key),{prevented:false,stopped:false}, `Open menu swallowed ${key}`);
    assert.equal(s.popup.hidden,true);
  }
}));
