// Inventory of every board: id, title, section, kind, links out, tabs, canvas size. Feeds screens.md.
const fs=require('fs'),path=require('path');
const proj=path.join(__dirname,'..','..','frames');
const c=JSON.parse(fs.readFileSync(path.join(proj,'canvas.json'),'utf8'));
const out=[];
for(const k of c.order){const b=k.replace('.dc.html','');const bd=c.boards[k]||{};
 const f=path.join(__dirname,'..','frags',b+'.html');const s=fs.existsSync(f)?fs.readFileSync(f,'utf8'):'';
 const links=[...new Set([...s.matchAll(/href="([A-Za-z0-9]+)\.dc\.html"/g)].map(m=>m[1]))];
 const tabs=(/\{\{TABS:([a-z-]+)\|([A-Za-z0-9]+)\}\}/.exec(s)||[]);
 const admin=(/\{\{ADMINNAV:([A-Za-z0-9]+):(ar|en)\}\}/.exec(s)||[]);
 const kind=/class="console/.test(s)?'admin':/behind-sheet/.test(s)?(/class="dialog/.test(s)?'dialog':'sheet'):/class="board/.test(s)?'doc':'phone';
 const h1=(/class="(?:app-header__title|nav-header__title|page-intro__title)"[^>]*>([^<]*)</.exec(s)||[])[1]||'';
 out.push({id:b,title:bd.title||'',w:bd.w,h:bd.h,kind,tabs:tabs[2]?tabs[1]+':'+tabs[2]:'',adminNav:admin[1]?admin[1]+':'+admin[2]:'',heading:h1.trim(),links});}
fs.writeFileSync(path.join(__dirname,'..','inventory.json'),JSON.stringify(out,null,1));
console.log(out.length,'boards;',out.filter(b=>b.kind==='phone').length,'phone',out.filter(b=>b.kind==='sheet').length,'sheet',out.filter(b=>b.kind==='dialog').length,'dialog',out.filter(b=>b.kind==='admin').length,'admin',out.filter(b=>b.kind==='doc').length,'doc');
