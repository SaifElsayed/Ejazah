const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..','..','frames');
const order=JSON.parse(fs.readFileSync(path.join(dir,'canvas.json'),'utf8'));
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.dc.html')&&f!=='SignIn.dc.html');
const tally={};
function add(k,v,f){tally[k]=tally[k]||{};const t=tally[k][v]=tally[k][v]||{n:0,f:new Set()};t.n++;t.f.add(f.replace('.dc.html',''));}
for(const f of files){
  let s=fs.readFileSync(path.join(dir,f),'utf8');
  s=s.replace(/<div aria-hidden="true" style="position: absolute; top: 0; inset-inline: 0; height: 47px[\s\S]*?<\/span>\s*<\/div>/,''); // status bar
  for(const m of s.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) add('color',m[0].toLowerCase(),f);
  for(const m of s.matchAll(/rgba?\([^)]*\)/g)) add('color',m[0],f);
  for(const m of s.matchAll(/font-size:\s*([\d.]+px)/g)) add('font-size',m[1],f);
  for(const m of s.matchAll(/font-weight:\s*(\d+)/g)) add('font-weight',m[1],f);
  for(const m of s.matchAll(/line-height:\s*([\d.]+(px)?)/g)) add('line-height',m[1],f);
  for(const m of s.matchAll(/border-radius:\s*([^;"]+)/g)) add('radius',m[1].trim(),f);
  for(const m of s.matchAll(/(?:^|[; "])(gap|row-gap|column-gap):\s*([^;"]+)/g)) add('gap',m[2].trim(),f);
  for(const m of s.matchAll(/(?:^|[; "])(padding[a-z-]*):\s*([^;"]+)/g)) for(const v of m[2].trim().split(/\s+/)) add('padding',v,f);
  for(const m of s.matchAll(/(?:^|[; "])(margin[a-z-]*):\s*([^;"]+)/g)) for(const v of m[2].trim().split(/\s+/)) add('margin',v,f);
  for(const m of s.matchAll(/(?:^|[; "])(height|min-height):\s*([\d.]+px)/g)) add('height',m[2],f);
  for(const m of s.matchAll(/(?:^|[; "])(width):\s*([\d.]+px)/g)) add('width',m[2],f);
  for(const m of s.matchAll(/box-shadow:\s*([^;"]+)/g)) add('shadow',m[1].trim(),f);
  for(const m of s.matchAll(/stroke-width="([\d.]+)"/g)) add('stroke',m[1],f);
  for(const m of s.matchAll(/<svg width="(\d+)"/g)) add('icon',m[1],f);
  for(const m of s.matchAll(/font-family:\s*([^;"]+)/g)) add('font-family',m[1].trim(),f);
}
const want=process.argv[2];
for(const k of Object.keys(tally)){ if(want&&k!==want) continue;
  console.log('== '+k);
  for(const [v,t] of Object.entries(tally[k]).sort((a,b)=>b[1].n-a[1].n)) console.log(String(t.n).padStart(5),v.padEnd(28),t.f.size<=6?[...t.f].join(','):t.f.size+' files');
}
