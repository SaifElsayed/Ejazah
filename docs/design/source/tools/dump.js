// Dumps the visible text of every board (from frags/) into source/alltext.md, in canvas order.
const fs=require('fs'),path=require('path');
const c=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','frames','canvas.json'),'utf8'));
let out='';
for(const k of c.order){const b=k.replace('.dc.html','');const f=path.join(__dirname,'..','frags',b+'.html');if(!fs.existsSync(f))continue;
let s=fs.readFileSync(f,'utf8');
const title=(c.boards[k]&&c.boards[k].title)||'';
s=s.replace(/\{\{icon:[^}]*\}\}/g,'').replace(/\{\{SB\}\}/g,'').replace(/\{\{TABS:[^}]*\}\}/g,'[tabbar]').replace(/\{\{ADMINNAV:[^}]*\}\}/g,'[adminnav]');
s=s.replace(/<a [^>]*href="([^"]+)\.dc\.html"[^>]*>/g,(m,h)=>' →'+h+' ');
s=s.replace(/<(input|textarea|select)([^>]*)>/g,(m,t,a)=>{const p=/placeholder="([^"]*)"/.exec(a),v=/value="([^"]*)"/.exec(a);return ' ['+(v?'='+v[1]:'')+(p?' ?'+p[1]:'')+'] ';});
s=s.replace(/aria-label="([^"]*)"/g,(m,x)=>' (aria: '+x+') ');
s=s.replace(/class="[^"]*\b(badge|chip|tag)\b[^"]*"[^>]*>([^<]*)</g,(m,t,x)=>'>‹'+x.trim()+'›<');
s=s.replace(/ disabled\b/g,' (disabled)');
s=s.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
out+='\n\n##### '+b+' — '+title+'\n'+s;}
fs.writeFileSync(path.join(__dirname,'..','alltext.md'),out);console.log(out.length,out.split('\n').length);
