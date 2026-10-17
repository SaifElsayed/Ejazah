// Rebuilds every board (or those named) from frags/, with title and size from canvas.json.
const fs=require('fs'),path=require('path');const {execFileSync}=require('child_process');const c=require(path.join(__dirname,'..','..','frames','canvas.json'));
const only=process.argv.slice(2);
let n=0;for(const k of c.order){const b=k.replace('.dc.html','');if(only.length&&!only.some(o=>b.startsWith(o)))continue;
const f=path.join(__dirname,'..','frags',b+'.html');if(!fs.existsSync(f)){console.log('NO FRAG',b);continue;}
const bd=c.boards[k];execFileSync('node',[path.join(__dirname,'mkboard.js'),b,bd.title,'light',f,String(bd.w),String(bd.h)]);n++;}
console.log('rebuilt',n);
