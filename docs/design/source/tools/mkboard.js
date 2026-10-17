// Wraps a body fragment into a .dc.html board: node tools/mkboard.js Name "Title" theme fragment.html [w h]
// In the fragment, {{SB}} is replaced by the status bar and {{icon:name:size[:extra classes]}} by the registry drawing.
const fs=require('fs'),path=require('path');
const [name,title,theme,frag,w='390',h='844']=process.argv.slice(2);
const proj=path.join(__dirname,'..','..','frames');
const icons=JSON.parse(fs.readFileSync(path.join(proj,'ds/ijazah/icons.json'),'utf8'));
let body=fs.readFileSync(frag,'utf8').replace('{{SB}}',fs.readFileSync(path.join(__dirname,'tpl/statusbar.html'),'utf8').trimEnd());
// {{TABS:student|teacher:ActiveBoard}} -> the role's TabBar. One definition for every screen.
const TABS={
  student:{label:'التنقل الرئيسي',items:[['Main','house','الرئيسية'],['Discovery','search','استكشف'],['Enrollments','book','اشتراكاتي'],['Credentials','award','إجازاتي'],['StudentAccount','user','حسابي']]},
  'student-en':{label:'Main navigation',items:[['MainEn','house','Home'],['Discovery','search','Explore'],['Enrollments','book','Enrollments'],['Credentials','award','Ijazahs'],['StudentAccount','user','Account']]},
  teacher:{label:'تنقل المعلم',items:[['TeacherHome','calendar','اليوم'],['TeacherStudents','users','طلابي'],['Availability','clock','المواعيد'],['Packages','layers','الباقات'],['TeacherAccount','user','حسابي']]},
};
body=body.replace(/\{\{TABS:(student|teacher|student-en):([A-Za-z]+)\}\}/g,(m,role,active)=>{
  const t=TABS[role];
  return `<nav class="tabbar" aria-label="${t.label}">\n`+t.items.map(([f,ic,l])=>`    <a href="${f}.dc.html" class="tabbar__item${f===active?' tabbar__item--active':''}"${f===active?' aria-current="page"':''}>{{icon:${ic}:lg}}<span>${l}</span></a>`).join('\n')+'\n  </nav>';
});
// {{ADMINNAV:ActiveBoard:ar|en}} -> the admin Sidebar. One definition for every admin page.
const NAVCOUNT={AdminQueueEmpty:{AdminReports:''}};
const self=name.replace(/En$/,'');
const ADMIN=[
  ['g','الطوابير','Queues'],
  ['AdminHome','house','نظرة عامة','Overview',''],
  ['AdminApplications','user-check','طلبات المعلمين','Applications','3'],
  ['AdminCredentials','file-text','مراجعة الإجازات','Credential review','3'],
  ['AdminIjazahRequests','mail','طلبات الإجازة','Ijazah requests','2'],
  ['AdminDisputes','alert-circle','النزاعات','Disputes','2'],
  ['AdminCompensation','scale','التعويضات','Compensation','3'],
  ['AdminGender','shield-check','بلاغات الجنس','Gender disputes','1'],
  ['AdminSessionReview','activity','مراجعة الجلسات','Session review','2'],
  ['AdminReports','flag','البلاغات','Reports','4'],
  ['g','السجلات والنظام','Records & system'],
  ['AdminUsers','users','المستخدمون','Users',''],
  ['AdminReviews','star','التقييمات','Reviews',''],
  ['AdminEnrollments','book','الاشتراكات والجلسات','Enrollments & sessions',''],
  ['AdminPayments','credit-card','المدفوعات','Payments',''],
  ['AdminIjazahs','award','الإجازات','Ijazahs',''],
  ['AdminSettings','sliders-horizontal','الإعدادات','Settings',''],
  ['AdminAudit','list','سجل التدقيق','Audit log',''],
];
body=body.replace(/\{\{ADMINNAV:([A-Za-z]+):(ar|en)\}\}/g,(mm,active,lang)=>{
  const ar=lang==='ar';
  const items=ADMIN.map(r=>{
    if(r[0]==='g') return `      <span class="sidebar__group">${ar?r[1]:r[2]}</span>`;
    const [f,ic,la,le,c0]=r;const on=f===active;const c=(NAVCOUNT[name]&&f in NAVCOUNT[name])?NAVCOUNT[name][f]:c0;
    return `      <a href="${f}.dc.html" class="nav-item${on?' nav-item--active':''}"${on?' aria-current="page"':''}>{{icon:${ic}:md}}<span>${ar?la:le}</span>${c?`<span class="badge ${on?'badge--success':'badge--neutral'} nav-item__count">${c}</span>`:''}</a>`;
  }).join('\n');
  return `<aside class="sidebar" aria-label="${ar?'لوحة الإدارة':'Admin panel'}">
    <span class="brand"><span class="brand-mark" aria-hidden="true">${ar?'إ':'I'}</span><span class="brand__name">${ar?'إجازة · الإدارة':'Ijazah · Admin'}</span></span>
    <nav class="sidebar__nav">
${items}
    </nav>
    <div class="sidebar__footer">
      <div class="row gap-3"><span class="avatar avatar--sm">${ar?'س':'S'}</span><span class="stack grow"><span class="text-callout text-medium">${ar?'سارة عادل':'Sara Adel'}</span><span class="text-caption tone-muted">${ar?'مشرفة':'Admin'}</span></span><a href="AdminSignIn.dc.html" class="icon-btn icon-btn--muted" aria-label="${ar?'تسجيل الخروج':'Sign out'}">{{icon:log-out:md}}</a></div>
      <div class="segmented" role="group" aria-label="${ar?'اللغة':'Language'}">
        <a href="${self}.dc.html" class="segmented__option${ar?' segmented__option--selected':''}" aria-pressed="${ar}">العربية</a>
        ${fs.existsSync(path.join(__dirname,'..','frags',self+'En.html'))?`<a href="${self}En.dc.html" class="segmented__option${ar?'':' segmented__option--selected'}" aria-pressed="${!ar}">English</a>`:`<button type="button" class="segmented__option${ar?'':' segmented__option--selected'}" aria-pressed="${!ar}">English</button>`}
      </div>
    </div>
  </aside>`;
});
body=body.replace(/\{\{icon:([a-z-]+):(xs|sm|md|lg|xl|2xl)((?::[a-z-]+)*)\}\}/g,(m,n,s,x)=>{if(!icons[n])throw new Error('no icon '+n);const extra=x?x.split(':').filter(Boolean).map(c=>' icon--'+c).join(''):'';return `<svg class="icon icon--${s}${extra}" data-icon="${n}" viewBox="0 0 24 24" aria-hidden="true">${icons[n]}</svg>`;});
if(/\{\{icon:/.test(body)) throw new Error('unresolved icon token');
// frags/Name.js, when present, holds the board's logic class; otherwise an empty one.
const jsFile=frag.replace(/\.html$/,'.js');
const logic=fs.existsSync(jsFile)?fs.readFileSync(jsFile,'utf8').trim():'class Component extends DCLogic {\n  renderVals() { return {}; }\n}';
const out=`<!doctype html>
<html lang="${/^\s*<div[^>]*dir="ltr"/.test(body)?'en':'ar'}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="ds/ijazah/tokens.css">
<link rel="stylesheet" href="ds/ijazah/components.css">
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&amp;family=Inter:wght@400;500;700&amp;family=Amiri+Quran&amp;display=swap">
</helmet>
${body.trim()}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
${logic}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(proj,name+'.dc.html'),out);
console.log('wrote',name);
