// Generates the four proposal Discovery boards (default, filter open, filtered, search).
const fs=require('fs');
const T={
 ahmed:{a:'أ',cls:'avatar--primary',n:'الشيخ أحمد المصري',sub:'حفظ القرآن · حفص عن عاصم · 12 سنة',q:'أدرّس الحفظ والمراجعة للكبار منذ اثني عشر عامًا، بالتسميع المتدرّج وجهًا بوجه.',tracks:['تسميع','مسار إجازة'],r:'4.9',rc:'86',next:'الأحد 7:30 م',p:'150'},
 mahmoud:{a:'م',cls:'',n:'الشيخ محمود فتحي',sub:'حفظ القرآن والتجويد · حفص عن عاصم · 8 سنوات',q:'نبدأ من مخارج الحروف، ثم نبني التلاوة آيةً آية.',tracks:['تسميع'],r:'4.7',rc:'41',next:'الأحد 7:00 م',p:'120'},
 khaled:{a:'خ',cls:'',n:'الشيخ خالد عبد العزيز',sub:'القراءات · القراءات العشر · 20 سنة',q:'عشرون عامًا في إقراء القراءات العشر.',tracks:['مسار إجازة'],r:'5.0',rc:'12',next:'السبت 11:00 ص',p:'180'}};
const card=(t,hl)=>{const name=hl?t.n.replace(hl,'<mark class="match">'+hl+'</mark>'):t.n;return `    <a href="TeacherProfile.dc.html" class="card gap-3">
      <span class="row gap-3 items-start">
        <span class="avatar avatar--xl ${t.cls}">${t.a}</span>
        <span class="stack gap-1 grow">
          <strong class="text-headline">${name}</strong>
          <span class="text-caption tone-muted">${t.sub}</span>
          <span class="row gap-1 wrap">${t.tracks.map(x=>`<span class="badge ${x==='مسار إجازة'?'badge--accent':'badge--neutral'}">${x}</span>`).join('')}</span>
        </span>
      </span>
      <span class="story-card__quote story-card__quote--two">«${t.q}»</span>
      <span class="story-card__foot"><span class="rating">{{icon:star:xs:filled}}${t.r} · ${t.rc}</span><span>أقرب موعد ${t.next}</span><span class="text-callout text-bold tone-default">من ${t.p} ج.م</span></span>
    </a>`;};
const tabs=sel=>`    <div class="category-tabs" role="tablist" aria-label="القسم">
${[['الكل','3'],['حفظ القرآن','2'],['التجويد','1'],['القراءات','1']].map(([l,c])=>`      <button type="button" class="category-tabs__item${l===sel?' category-tabs__item--selected':''}" role="tab" aria-selected="${l===sel}">${l}<span class="category-tabs__count">${c}</span></button>`).join('\n')}
    </div>`;
// trigger: 'link' = a link to the open-dropdown board; 'open' = expanded button.
const search=(q,count,trigger,dropdown)=>{
  const active=count||trigger==='open';
  const cls=`icon-btn icon-btn--surface filter-trigger${active?' filter-trigger--active':''}`;
  const label=`الفلاتر${count?' · '+count+' مفعّلة':''}`;
  const inner=`{{icon:filter:md}}${count?`<span class="filter-trigger__count">${count}</span>`:''}`;
  const btn=trigger==='open'
    ?`<button type="button" class="${cls}" aria-label="${label}" aria-expanded="true">${inner}</button>`
    :`<a href="DiscoveryFilter.dc.html" class="${cls}" aria-label="${label}">${inner}</a>`;
  return `    <div class="search-row${trigger==='open'?' search-row--open':''}">
      <label class="input-group${q?' input-group--focused':''}">
        {{icon:search:md}}
        <input class="input-group__control" type="search" placeholder="ابحث باسم الشيخ أو المادة" aria-label="ابحث باسم الشيخ أو المادة"${q?` value="${q}"`:''}>
        ${q?'<a href="Discovery.dc.html" class="icon-btn icon-btn--muted" aria-label="مسح البحث">{{icon:x:sm}}</a>':''}
      </label>
      ${btn}
${dropdown||''}
    </div>`;};
const dd="      <div class=\"dropdown\" role=\"dialog\" aria-label=\"الفلاتر\">\n        <div class=\"dropdown__group\" role=\"radiogroup\" aria-labelledby=\"f-rate\">\n          <span class=\"dropdown__title\" id=\"f-rate\">التقييم</span>\n          <div class=\"option-grid\">\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\"><span class=\"option__mark\"></span>الكل</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\" aria-label=\"5 نجوم فأعلى\"><span class=\"option__mark\"></span>{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}</button>\n            <button type=\"button\" class=\"option option--selected\" role=\"radio\" aria-checked=\"true\" aria-label=\"4 نجوم فأعلى\"><span class=\"option__mark\"></span>{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\" aria-label=\"3 نجوم فأعلى\"><span class=\"option__mark\"></span>{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\" aria-label=\"2 نجوم فأعلى\"><span class=\"option__mark\"></span>{{icon:star:xs:filled}}{{icon:star:xs:filled}}</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\" aria-label=\"1 نجمة فأعلى\"><span class=\"option__mark\"></span>{{icon:star:xs:filled}}</button>\n          </div>\n        </div>\n        <div class=\"dropdown__group\" role=\"radiogroup\" aria-labelledby=\"f-riw\">\n          <span class=\"dropdown__title\" id=\"f-riw\">الرواية · داخل حفظ القرآن</span>\n          <div class=\"option-grid\">\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\"><span class=\"option__mark\"></span>الكل</button>\n            <button type=\"button\" class=\"option option--selected\" role=\"radio\" aria-checked=\"true\"><span class=\"option__mark\"></span>حفص عن عاصم</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\"><span class=\"option__mark\"></span>ورش عن نافع</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\"><span class=\"option__mark\"></span>قالون عن نافع</button>\n          </div>\n        </div>\n        <div class=\"dropdown__group\" role=\"radiogroup\" aria-labelledby=\"f-track\">\n          <span class=\"dropdown__title\" id=\"f-track\">المسار</span>\n          <div class=\"option-grid\">\n            <button type=\"button\" class=\"option option--selected\" role=\"radio\" aria-checked=\"true\"><span class=\"option__mark\"></span>الكل</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\"><span class=\"option__mark\"></span>تسميع</button>\n            <button type=\"button\" class=\"option\" role=\"radio\" aria-checked=\"false\"><span class=\"option__mark\"></span>مسار إجازة</button>\n          </div>\n        </div>\n        <div class=\"dropdown__footer\">\n          <a href=\"DiscoveryFiltered.dc.html\" class=\"btn btn--primary btn--md btn--grow\">عرض معلمَين</a>\n          <a href=\"Discovery.dc.html\" class=\"btn btn--ghost btn--md\">مسح</a>\n        </div>\n      </div>";
const page=body=>`<div class="screen screen--long" dir="rtl" data-theme="light">
{{SB}}

  <header class="app-header">
    <h1 class="app-header__title">استكشف</h1>
    <div class="app-header__actions">
      <a href="Notifications.dc.html" class="icon-btn icon-btn--surface" aria-label="الإشعارات">{{icon:bell:lg}}<span class="icon-btn__dot"></span></a>
    </div>
  </header>

  <main class="screen__body screen__body--scroll gap-4">
${body.join('\n\n')}
  </main>

  {{TABS:student:Discovery}}
</div>
`;
const W=(n,s)=>fs.writeFileSync(path.join(__dirname,'..','frags',`${n}.html`),n==='Discovery'?s:s.replace('<div class="screen screen--long"','<div class="screen"'));
W('Discovery',page([search('',0,'link'),tabs('الكل'),card(T.ahmed),card(T.mahmoud),card(T.khaled)]));
W('DiscoveryFilter',page([search('',0,'open',dd),tabs('حفظ القرآن'),card(T.ahmed),card(T.mahmoud)]).replace('\n  </main>','\n  </main>\n  <div class="scrim scrim--soft"></div>'));
W('DiscoveryFiltered',page([search('',2,'link'),tabs('حفظ القرآن'),`    <div class="filter-chips" aria-label="الفلاتر المفعّلة">
      <button type="button" class="chip chip--selected chip--removable" aria-label="إزالة فلتر التقييم: 4 نجوم فأعلى">{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:star:xs:filled}}{{icon:x:xs}}</button>
      <button type="button" class="chip chip--selected chip--removable" aria-label="إزالة فلتر الرواية">حفص عن عاصم{{icon:x:xs}}</button>
      <a href="Discovery.dc.html" class="link">مسح الكل</a>
    </div>
    <span class="text-caption tone-muted">معلمان</span>`,card(T.ahmed),card(T.mahmoud)]));
W('DiscoverySearch',page([search('أحمد',0,'link'),`    <span class="text-caption tone-muted">نتيجة واحدة لـ «أحمد» · في كل الأقسام</span>`,card(T.ahmed,'أحمد'),`    <div class="card card--surface card--row">
      <span class="icon-tile icon-tile--round">{{icon:search:md}}</span>
      <span class="stack grow"><strong class="text-body text-bold">جرّب البحث باسم المادة</strong><span class="text-caption tone-muted">مثل: التجويد، القراءات</span></span>
    </div>`]));
console.log('ok');
