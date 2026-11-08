const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { safeName, pageLayout, writePdf } = require('../miniprogram/utils/pdf');
const jpeg = fs.readFileSync(__dirname + '/fixtures/photo.jpg');
async function build(count, mode='a4') {
 const parts=[], releases=[];
 await writePdf(count, async i=>({width:1200,height:900,bytes:jpeg,release:()=>releases.push(i)}), async bytes=>parts.push(Buffer.from(bytes)), mode);
 return { bytes:Buffer.concat(parts), releases };
}
test('PDF file names cannot escape their working directory', () => {
 assert.equal(safeName(' ../材料/报名.pdf '),'_材料_报名.pdf');
 assert.equal(safeName(''),'图片合集.pdf');assert.equal(safeName('报告.PDF'),'报告.pdf');
 assert(!/[\\/:*?"<>|]/.test(safeName('a:b?c|d')));
});
test('A4 fit preserves aspect ratio and margins for portrait and landscape', () => {
 for(const [w,h] of [[1200,900],[900,1200],[1,4000]]) {
  const l=pageLayout(w,h,'a4');assert(Math.abs(l.width/l.height-w/h)<1e-8);
  assert(l.x>=23.999 && l.y>=23.999);assert(l.x+l.width<=l.pageWidth-23.999);assert(l.y+l.height<=l.pageHeight-23.999);
 }
 const l=pageLayout(1200,900,'image');assert.equal(l.pageWidth,900);assert.equal(l.pageHeight,675);assert.equal(l.x,0);assert.equal(l.y,0);
});
test('PDF has correct page count, xref byte offsets, JPEG lengths and EOF', async()=>{
 const {bytes,releases}=await build(9);const text=bytes.toString('latin1');assert.equal(releases.length,9);
 assert(text.startsWith('%PDF-1.4'));assert(text.endsWith('%%EOF\n'));assert(text.includes('/Count 9'));
 const start=Number(/startxref\n(\d+)/.exec(text)[1]);assert.equal(bytes.subarray(start,start+4).toString(),'xref');
 const lines=text.slice(start).split('\n');const count=Number(lines[1].split(' ')[1]);assert.equal(count,30);
 for(let id=1;id<count;id++) {const pos=Number(lines[2+id].slice(0,10));assert(text.slice(pos).startsWith(id+' 0 obj\n'));}
 assert.equal((text.match(/\/Subtype \/Image/g)||[]).length,9);
 assert.equal((text.match(new RegExp('/Length '+jpeg.length+' >>','g'))||[]).length,9);
});
test('image-sized pages use image dimensions without margins',async()=>{
 const {bytes}=await build(1,'image');assert(bytes.toString('latin1').includes('/MediaBox [0 0 900 675]'));
});
test('PDF rejects invalid image bytes, invalid mode and page counts',async()=>{
 for(const count of [0,10,1.5])await assert.rejects(()=>writePdf(count,()=>{},()=>{},'a4'));
 await assert.rejects(()=>writePdf(1,()=>{},()=>{},'bad'));
 let released=false;
 await assert.rejects(()=>writePdf(1,async()=>({width:10,height:10,bytes:new Uint8Array([1,2,3]),release:()=>released=true}),async()=>{},'a4'),/编码失败/);
 assert(released);
});
test('PDF stops streaming after sink failure and releases native temporary image',async()=>{
 let released=false, calls=0;
 await assert.rejects(()=>writePdf(1,async()=>({width:1200,height:900,bytes:jpeg,release:()=>released=true}),async()=>{if(++calls===6)throw Error('disk full');},'a4'),/disk full/);
 assert(released);assert.equal(calls,6);
});
test('PDF cancellation prevents further pages being loaded',async()=>{
 let loaded=0,cancel=false;
 await assert.rejects(()=>writePdf(2,async()=>{loaded++;return{width:1200,height:900,bytes:jpeg,release:()=>cancel=true};},async()=>{},'a4',()=>cancel),/取消/);
 assert.equal(loaded,1);
});
let definition;global.Page=v=>definition=v;
require('../miniprogram/pages/pdf/pdf');
function page(){const p=Object.assign({},definition);p.data=structuredClone(definition.data);p.setData=patch=>Object.assign(p.data,patch);p.onLoad();global.wx={getFileSystemManager:()=>({unlink(){}})};return p;}
test('page ordering and removal use stable IDs and invalidate old PDFs',()=>{
 const p=page();p.data.items=[{id:1},{id:2},{id:3}];p.move({currentTarget:{dataset:{id:2,step:-1}}});assert.deepEqual(p.data.items.map(i=>i.id),[2,1,3]);
 p.remove({currentTarget:{dataset:{id:1}}});assert.deepEqual(p.data.items.map(i=>i.id),[2,3]);
 p.move({currentTarget:{dataset:{id:2,step:-1}}});assert.deepEqual(p.data.items.map(i=>i.id),[2,3]);
});
test('empty and full page selection are rejected clearly',async()=>{
 const p=page();await p.generate();assert.match(p.data.notice,/先选择/);
 p.data.items=Array.from({length:9},(_,i)=>({id:i}));await p.choose();assert.match(p.data.notice,/最多 9/);
});
test('cancelled PDF sharing is not reported as success or error',async()=>{
 const p=page();p.data.output={path:'example.pdf',filename:'example.pdf'};global.wx.shareFileMessage=o=>o.fail({errMsg:'shareFileMessage:fail cancel'});
 await p.share();assert.equal(p.data.sharing,false);assert.equal(p.data.notice,'');
});
test('page can regenerate PDF in its existing directory and cleans failed writes',async()=>{
 const p=page(),files=new Map(),dirs=new Set();let temp=0;
 const native={
  access(o){(dirs.has(o.path)||files.has(o.path)?o.success:o.fail)({});},
  mkdir(o){if(dirs.has(o.dirPath))o.fail({errMsg:'already exists'});else{dirs.add(o.dirPath);o.success({});}},
  writeFile(o){files.set(o.filePath,Buffer.from(o.data));o.success({});},
  appendFile(o){files.set(o.filePath,Buffer.concat([files.get(o.filePath),Buffer.from(o.data)]));o.success({});},
  readFile(o){if(files.has(o.filePath))o.success({data:files.get(o.filePath)});else o.fail({});},
  getFileInfo(o){o.success({size:files.get(o.filePath).length});},
  unlink(o){files.delete(o.filePath);if(o.success)o.success({});}
 };
 const canvas={getContext:()=>({clearRect(){},fillRect(){},drawImage(){}}),createImage(){const img={};Object.defineProperty(img,'src',{set(path){path==='bad'?img.onerror():img.onload();}});return img;}};
 p.createSelectorQuery=()=>({select(){return this;},fields(){return this;},exec(cb){cb([{node:canvas}]);}});
 global.wx={env:{USER_DATA_PATH:'user'},getFileSystemManager:()=>native,pageScrollTo(){},canvasToTempFilePath(o){const path='temp'+(++temp);files.set(path,jpeg);o.success({tempFilePath:path});}};
 p.data.items=[{id:1,path:'source',width:1200,height:900}];
 await p.generate();assert(p.data.output);const first=p.data.output.path;
 p.editAgain();p.setMode({currentTarget:{dataset:{mode:'image'}}});await p.generate();assert(p.data.output);assert.equal(dirs.size,1);assert(files.get(p.data.output.path).toString('latin1').includes('/MediaBox [0 0 900 675]'));
 p.editAgain();p.data.items=[{id:1,path:'bad',width:1200,height:900}];await p.generate();assert.equal(p.data.output,null);assert.equal(p.data.busy,false);assert.match(p.data.notice,/第 1 张处理失败/);
 assert(!files.has(first));assert(!Array.from(files.keys()).some(k=>k.endsWith('.pdf')));
});
