const test = require('node:test');
const assert = require('node:assert/strict');
const { PHOTO_SIZES, RATIOS, validateSize, ratioSize, centered, constrain, sourceCrop } = require('../miniprogram/utils/resize');
const { createRenderer } = require('../miniprogram/utils/canvas');
const image = { width: 1200, height: 900 };
test('photo presets have exact pixel dimensions and all fit device limits', () => {
 assert.deepEqual(PHOTO_SIZES.map(p => [p.width,p.height]), [[295,413],[413,579],[413,531]]);
 PHOTO_SIZES.forEach(p => validateSize(p.width,p.height));
});
test('invalid output sizes are rejected rather than silently modified', () => {
 for (const [w,h] of [[0,100],[-1,10],[1.5,20],[NaN,10],[4097,1],[4000,3000]]) assert.throws(() => validateSize(w,h));
 assert.deepEqual(validateSize(4000,2000), {width:4000,height:2000});
});
test('each ratio crops to the requested aspect while preserving source bounds', () => {
 for (const r of RATIOS.filter(r => r.a)) {
  const size = ratioSize(image,r.a,r.b);
  assert.equal(size.width/size.height, r.a/r.b);
  assert(size.width <= image.width && size.height <= image.height);
 }
});
test('drag and zoom cannot expose blank edges or sample outside source', () => {
 for (const dims of [[500,500],[350,500],[560,315]]) {
  const frame = {width:dims[0],height:dims[1]};
  const base = centered(frame,image);
  for (const scale of [0, base.scale,base.scale*2,base.scale*100]) for (const x of [-10000,0,10000]) for (const y of [-10000,0,10000]) {
   const t = constrain(frame,image,{scale,x,y});
   const c = sourceCrop(frame,image,t);
   assert(t.x <= 0 && t.y <= 0);
   assert(t.x+image.width*t.scale >= frame.width-1e-8);
   assert(t.y+image.height*t.scale >= frame.height-1e-8);
   assert(c.x >= 0 && c.y >= 0 && c.width > 0 && c.height > 0);
   assert(c.x+c.width <= image.width+1e-8 && c.y+c.height <= image.height+1e-8);
   assert(Math.abs(c.width/c.height-frame.width/frame.height)<1e-8);
  }
 }
});
test('canvas uses the selected source rectangle and exact PNG output dimensions', async () => {
 let args, exported;
 const ctx = {clearRect(){}, drawImage(...v){args=v;}};
 const canvas = {getContext:()=>ctx, createImage(){ const img={}; Object.defineProperty(img,'src',{set(){img.onload();}}); return img; }};
 global.wx = {
  canvasToTempFilePath(o){exported=o;o.success({tempFilePath:'output.png'});},
  getFileSystemManager:()=>({getFileInfo(o){o.success({size:1000});},unlink(){}})
 };
 const page={createSelectorQuery:()=>({select(){return this;},fields(){return this;},exec(cb){cb([{node:canvas}]);}})};
 const renderer=createRenderer(page,{path:'input.png',type:'png'},()=>false);
 const crop={x:100,y:30,width:600,height:840};
 const output=await renderer.encode({width:295,height:413,fileType:'png',quality:.95,crop});
 assert.deepEqual(args.slice(1),[100,30,600,840,0,0,295,413]);
 assert.equal(exported.fileType,'png'); assert.equal(exported.destWidth,295); assert.equal(exported.destHeight,413);
 assert.equal(output.width,295); renderer.dispose(output.path);
});
let definition;
global.Page = v => {definition=v;};
require('../miniprogram/pages/resize/resize');
function page(options={}) {
 const p=Object.assign({},definition);p.data=structuredClone(definition.data);p.setData=(patch,cb)=>{Object.assign(p.data,patch);if(cb)cb();};
 p.createSelectorQuery=()=>({select(){return this;},boundingClientRect(cb){cb({width:250,height:350,left:20,top:80});return this;},exec(){}});
 global.wx={setNavigationBarTitle(){},nextTick:cb=>cb(),getFileSystemManager:()=>({unlink(){}})};
 p.onLoad(options); return p;
}
test('home photo deep link selects correct preset before image selection', () => {
 const p=page({preset:'inch2'}); assert.equal(p.data.mode,'photo');assert.equal(p.data.width,'413');assert.equal(p.data.height,'579');
});
test('custom dimensions lock correctly, unlock permits independent width', () => {
 const p=page();p.data.image=image;p._lockRatio=4/3;
 p.inputSize({currentTarget:{dataset:{field:'width'}},detail:{value:'800'}});assert.equal(p.data.height,'600');
 p.toggleLock({detail:{value:false}});
 p.inputSize({currentTarget:{dataset:{field:'width'}},detail:{value:'300'}});assert.equal(p.data.height,'600');
});
test('invalid dimensions never start native rendering', async () => {
 const p=page();p.data.image=image;p.data.width='9000';p.data.height='100';await p.generate();assert.equal(p.data.busy,false);assert.match(p.data.notice,/4096/);
});
test('cancelled selection preserves existing image and settings', async () => {
 const p=page({preset:'inch1'});p.data.image=image;
 global.wx.chooseMedia=o=>o.fail({errMsg:'chooseMedia:fail cancel'});
 await p.choose();assert.equal(p.data.image,image);assert.equal(p.data.width,'295');assert.equal(p.data.choosing,false);assert.equal(p.data.notice,'');
});
test('denied album permission does not save resized output', async () => {
 const p=page();p.data.output={path:'output'};let saved=false;
 global.wx.getSetting=o=>o.success({authSetting:{'scope.writePhotosAlbum':false}});
 global.wx.showModal=o=>o.success({confirm:false});global.wx.saveImageToPhotosAlbum=()=>{saved=true;};
 await p.save();assert.equal(saved,false);assert.equal(p.data.saving,false);
});
test('drag after scrolling moves immediately and stays within image bounds', () => {
 const p=page({preset:'inch1'});p.data.image=image;p.setupFrame();p.onPageScroll({scrollTop:60});
 const before=p._transform.x;
 p.touchStart({touches:[{clientX:100,clientY:100}]});
 p.touchMove({touches:[{clientX:130,clientY:100}]});
 assert.equal(p._transform.x,before+30);assert.equal(p._frame.top,20);
 p.touchEnd({touches:[]});assert.equal(p._gesture,null);
});
test('pinch preserves the crop anchor and clamps zoom at four times', () => {
 const p=page({preset:'inch1'});p.data.image=image;p.setupFrame();const base=p._transform.scale;
 p.touchStart({touches:[{clientX:80,clientY:200},{clientX:180,clientY:200}]});
 p.touchMove({touches:[{clientX:30,clientY:200},{clientX:230,clientY:200}]});
 assert(Math.abs(p._transform.scale-base*2)<1e-10);assert.equal(p.data.zoom,200);
 p.touchMove({touches:[{clientX:-1000,clientY:200},{clientX:1000,clientY:200}]});assert(Math.abs(p._transform.scale-base*4)<1e-10);
});
