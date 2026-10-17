const fs=require('fs'),path=require('path');
const src=path.join(__dirname,'..','..','frames');
const canvas=JSON.parse(fs.readFileSync(path.join(src,'canvas.json'),'utf8'));
const map=new Map();
for(const name of canvas.order){let s=fs.readFileSync(path.join(src,name),'utf8');
 s=s.replace(/<div aria-hidden="true" style="position: absolute; top: 0; inset-inline: 0; height: 47px[\s\S]*?<\/span>\s*<\/div>/,'');
 for(const m of s.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)){const vb=(m[1].match(/viewBox="([^"]*)"/)||[])[1];const inner=m[2].replace(/\s+/g,' ').trim();const k=vb+'|'+inner;
  const ctx=s.slice(Math.max(0,m.index-160),m.index).replace(/\s+/g,' ');const lab=(ctx.match(/aria-label="([^"]*)"[^<]*$/)||[])[1]||'';
  const after=s.slice(m.index+m[0].length,m.index+m[0].length+60).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,24);
  if(!map.has(k))map.set(k,{n:0,where:new Set(),hint:new Set()});const o=map.get(k);o.n++;o.where.add(name.replace('.dc.html',''));o.hint.add(lab||after);}}
let i=0;for(const [k,o] of map){console.log(`#${i++} n=${o.n} [${[...o.where].slice(0,4).join(',')}] hint=${[...o.hint].slice(0,3).join(' / ')}\n   ${k.slice(0,230)}`);}
