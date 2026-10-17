// Refuses any design value that does not come from tokens. Run: node tools/lint.js [Board ...]
const fs=require('fs'),path=require('path');
const src=path.join(__dirname,'..','..','frames');
const errs=[];const icons={};
const registry=JSON.parse(fs.readFileSync(path.join(src,'ds/ijazah/icons.json'),'utf8'));
const norm=x=>x.replace(/s+/g,' ').replace(/> </g,'><').trim();
const LITERAL=/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b\d+(\.\d+)?(px|em|rem|pt|ms|s)\b/i;
const BANNED_INLINE=/^(color|background(-color)?|border.*|box-shadow|font.*|line-height|letter-spacing|opacity|padding.*|margin(?!-top$|-inline-start$)|.*radius|gap|row-gap|column-gap|fill|stroke.*|accent-color)$/;
// components.css: tokens only.
const css=fs.readFileSync(path.join(src,'ds/ijazah/components.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
css.split('\n').forEach((l,i)=>{const v=l.replace(/calc\(var\(--[a-z0-9-]+\) \* -1\)/g,'');
  if(LITERAL.test(v)) errs.push(`components.css:${i+1} literal: ${l.trim()}`);
  if(/--palette-/.test(l)) errs.push(`components.css:${i+1} palette step used directly: ${l.trim()}`);});
const defined=new Set([...fs.readFileSync(path.join(src,'ds/ijazah/tokens.css'),'utf8').matchAll(/--([a-z0-9-]+):/g)].map(m=>m[1]));
for(const m of css.matchAll(/var\(--([a-z0-9-]+)\)/g)) if(!defined.has(m[1])) errs.push(`components.css uses undefined token --${m[1]}`);
const classes=new Set([...css.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map(m=>m[1]));
const canvas=JSON.parse(fs.readFileSync(path.join(src,'canvas.json'),'utf8'));
const names=process.argv.slice(2).length?process.argv.slice(2).map(n=>n.endsWith('.html')?n:n+'.dc.html'):canvas.order;
for(const name of names){
  const s=fs.readFileSync(path.join(src,name),'utf8');
  const e=m=>errs.push(`${name}: ${m}`);
  if(!s.includes('href="ds/ijazah/tokens.css"')||!s.includes('href="ds/ijazah/components.css"')) e('does not link tokens.css and components.css');
  const helmet=(s.match(/<helmet>([\s\S]*?)<\/helmet>/)||[,''])[1];
  if(/<style/.test(helmet)) e('has a <style> block; styles belong in components.css');
  const body=s.match(/<x-dc>([\s\S]*)<\/x-dc>/)[1].replace(/<helmet>[\s\S]*?<\/helmet>/,'');
  const root=body.match(/<(div|nav)\b[^>]*>/)[0];
  if(!/class="(screen|board|tabbar|console)\b/.test(root)) e('root is not .screen, .board or .tabbar');
  if(!/data-theme="(light|dark)"/.test(root)) e('root has no data-theme');
  // Strip device chrome (status bar) before checking.
  const b=body.replace(/<div class="status-bar"[\s\S]*?<\/span>\s*<\/div>/,'');
  for(const m of b.matchAll(/<[a-z][a-z0-9-]*([^>]*?)style="([^"]*)"/g)){
    // A swatch on a documentation board shows a token by painting it: background: var(--token) only.
    const isSwatch=/class="[^"]*swatch/.test(m[1]);
    for(const d of m[2].split(';').map(x=>x.trim()).filter(Boolean)){
      if(isSwatch&&/^(background|font-size|line-height|font-family|width|height|border-radius|box-shadow):s*var(--[a-z0-9-]+)$/.test(d)) continue;
      const [p,...rest]=d.split(':');const prop=p.trim(),val=rest.join(':').trim();
      if(LITERAL.test(val)) e(`literal in style: ${d}`);
      else if(BANNED_INLINE.test(prop)&&!/^var\(--color-brand-google/.test(val)) e(`inline ${prop} belongs in a component class: ${d}`);
    }
  }
  for(const m of b.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)){
    const a=m[1];
    if(/\b(width|height|stroke-width)="/.test(a)) e(`svg sizes come from .icon classes: <svg${a.slice(0,60)}>`);
    if(/(fill|stroke)="#/.test(m[0])) e('svg has a literal colour');
    const cls=(a.match(/class="([^"]*)"/)||[,''])[1];
    if(!/\bicon\b/.test(cls)) e(`svg without .icon: <svg${a.slice(0,60)}>`);
    const n=(a.match(/data-icon="([^"]+)"/)||[])[1];
    if(!n) e(`svg without data-icon name: <svg${a.slice(0,60)}>`);
    else if(!registry[n]) e(`icon "${n}" is not in icons.json`);
    else if(norm(m[2])!==norm(registry[n])) e(`icon "${n}" is drawn differently from icons.json`);
    else { const inner=m[2].replace(/\s+/g,' ').trim(); (icons[n]=icons[n]||new Map()); const mm=icons[n]; mm.set(inner,(mm.get(inner)||[]).concat(name.replace('.dc.html',''))); }
  }
  for(const m of b.matchAll(/class="([^"{]*)"/g)) for(const c of m[1].split(/\s+/).filter(Boolean)) if(!classes.has(c)) e(`unknown class .${c}`);
  if(/\b(width|height)="\d/.test(b.replace(/<svg[\s\S]*?<\/svg>/g,''))) e('width/height attribute outside svg');
}
for(const [n,m] of Object.entries(icons)) if(m.size>1) errs.push(`icon "${n}" has ${m.size} different drawings: `+[...m.values()].map(v=>v.join(',')).join(' | '));
if(errs.length){console.log(errs.join('\n'));console.log(`\n${errs.length} problems`);process.exitCode=1;} else console.log('lint: clean,',names.length,'boards,',Object.keys(icons).length,'icons');
