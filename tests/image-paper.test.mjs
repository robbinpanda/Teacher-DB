import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { imagePageBoxes, jpegPagesToPdf, isPaperImage } from '../lib/image-paper.ts';
function raster(w,h,color=255){const pixels=new Uint8ClampedArray(w*h*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=color;pixels[i+3]=255;}return pixels;}
function fill(p,w,x,y,width,height,color){for(let row=y;row<y+height;row++)for(let col=x;col<x+width;col++){const i=(row*w+col)*4;p[i]=p[i+1]=p[i+2]=color;}}

test('拼接截图识别独立纸页，去掉页间灰底而不丢失页内内容',()=>{
 const p=raster(320,1900,242);
 for(let i=0;i<5;i++){fill(p,320,20,50+i*370,280,350,255);fill(p,320,60,90+i*370,180,12,0);}
 const boxes=imagePageBoxes(p,320,1900);
 assert.equal(boxes.length,5);
 boxes.forEach((b,i)=>{assert.ok(b.x<=20 && b.x+b.width>=300);assert.ok(b.y<=50+i*370 && b.y+b.height>=400+i*370);});
});
test('普通多页长图只在空白行切分；找不到安全边界时保留整图',()=>{
 const p=raster(300,1100);fill(p,300,30,380,240,40,0);fill(p,300,30,790,240,40,0);
 const boxes=imagePageBoxes(p,300,1100);
 assert.ok(boxes.length>1);
 assert.equal(boxes.reduce((n,b)=>n+b.height,0),1100);
 assert.ok(boxes.slice(1).every(b=>!(b.y>=380&&b.y<=420)&&!(b.y>=790&&b.y<=830)));
 assert.deepEqual(imagePageBoxes(raster(300,1100,0),300,1100),[{x:0,y:0,width:300,height:1100}]);
});
test('单张普通试卷不裁剪；支持三种图片格式并拒绝非图片',()=>{
 assert.deepEqual(imagePageBoxes(raster(300,420),300,420),[{x:0,y:0,width:300,height:420}]);
 for(const name of ['a.JPG','a.jpeg','a.png','a.webp'])assert.equal(isPaperImage({name,type:''}),true);
 assert.equal(isPaperImage({name:'a.pdf',type:'application/pdf'}),false);
});
test('多张图片生成可重读的多页PDF，顺序、比例及图像数据完整',async()=>{
 const sizes=[[320,420],[500,300],[250,600]];
 const pages=[];
 for(const [width,height] of sizes)pages.push({width,height,bytes:await sharp({create:{width,height,channels:3,background:'#ffffff'}}).jpeg().toBuffer()});
 const bytes=jpegPagesToPdf(pages);
 const task=getDocument({data:bytes});const pdf=await task.promise;
 assert.equal(pdf.numPages,3);
 for(let i=0;i<3;i++){const page=await pdf.getPage(i+1),v=page.getViewport({scale:1});assert.ok(Math.abs(v.width/v.height-sizes[i][0]/sizes[i][1])<.001);assert.ok((await page.getOperatorList()).fnArray.length>0);}
 await task.destroy();
 assert.throws(()=>jpegPagesToPdf([]),/1–100/);
});
