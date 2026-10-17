// node compose.js Target Background  -> frags/Target.html = Background body (inert) + parts/Target.html (scrim + dialog)
const fs=require('fs'),path=require('path');
const S=path.join(__dirname,'..');
const [target,bg]=process.argv.slice(2);
const b=fs.readFileSync(path.join(S,'frags',bg+'.html'),'utf8').trimEnd().split('\n');
const first=b[0], last=b[b.length-1];
if(!/^<div class="console"/.test(first)||last!=='</div>') throw new Error('unexpected bg shape');
const inner=b.slice(1,-1).map(l=>l?'  '+l:l).join('\n');
const part=fs.readFileSync(path.join(__dirname,'..','parts',target+'.html'),'utf8').trimEnd();
fs.writeFileSync(path.join(S,'frags',target+'.html'),`${first}\n  <div class="behind-sheet" aria-hidden="true" inert>\n${inner}\n  </div>\n\n${part}\n</div>\n`);
console.log('composed',target,'over',bg);
