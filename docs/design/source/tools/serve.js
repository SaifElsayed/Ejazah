const http=require('http'),fs=require('fs'),path=require('path');
const root=process.argv[2];
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'gallery.html');
fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);return r.end();}r.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});r.end(d);});}).listen(48731,'127.0.0.1',()=>console.log('up'));
