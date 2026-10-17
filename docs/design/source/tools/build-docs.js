// Generates frags/DesignLanguage.html from tokens.json and icons.json, so the reference board can never drift.
const fs=require('fs'),path=require('path');
const ds=path.join(__dirname,'..','..','frames','ds','ijazah');
const t=JSON.parse(fs.readFileSync(path.join(ds,'tokens.json'),'utf8'));
const icons=JSON.parse(fs.readFileSync(path.join(ds,'icons.json'),'utf8'));
const get=p=>p.split('.').reduce((o,k)=>o[k],t);
const res=v=>typeof v==='string'&&/^\{.+\}$/.test(v)?res(get(v.slice(1,-1))):v;
const ref=v=>typeof v==='string'&&/^\{.+\}$/.test(v)?v.slice(1,-1):'';
const colors=scheme=>Object.entries(t.color[scheme]).map(([k,v])=>`        <div class="doc-item"><span class="swatch" style="background: var(--color-${k})"></span><span class="doc-name">color.${k}</span><span class="spec">${ref(v)||res(v)}</span></div>`).join('\n');
const type=Object.entries(t.text).map(([k,v])=>`      <div class="row row--between gap-4"><span class="text-${k}">${k==='ayah'?'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ':'جلستك القادمة اليوم'}</span><span class="stack"><span class="doc-name">text.${k}</span><span class="spec">${v.size} / ${v.line}</span></span></div>`).join('\n');
const space=Object.entries(t.space).filter(([k])=>k!=='0').map(([k,v])=>`      <div class="row gap-4"><span class="doc-name grow">space.${k}</span><span class="spec">${v}</span><span class="swatch swatch--bar" style="width: var(--space-${k})"></span></div>`).join('\n');
const radius=Object.entries(t.radius).map(([k,v])=>`        <div class="doc-item items-center"><span class="swatch swatch--box" style="border-radius: var(--radius-${k})"></span><span class="doc-name">radius.${k}</span><span class="spec">${v}</span></div>`).join('\n');
const sizes=[...Object.entries(t.size).map(([k,v])=>['size.'+k,v]),...Object.entries(t.media).map(([k,v])=>['media.'+k,v]),...Object.entries(t.icon.size).map(([k,v])=>['icon.size.'+k,v]),...Object.entries(t.icon.stroke).map(([k,v])=>['icon.stroke.'+k,v]),...Object.entries(t.layout).map(([k,v])=>['layout.'+k,v]),...Object.entries(t.opacity).map(([k,v])=>['opacity.'+k,v]),...Object.entries(t.duration).map(([k,v])=>['duration.'+k,v]),...Object.entries(t.easing).map(([k,v])=>['easing.'+k,v]),...Object.entries(t.motion).map(([k,v])=>['motion.'+k,v]),...Object.entries(t.density.compact).map(([k,v])=>['density.compact.'+k,v]),...Object.entries(t['border-width']).map(([k,v])=>['border-width.'+k,v])];
const sizeRows=sizes.map(([k,v])=>`          <div class="list__row"><span class="doc-name">${k}</span><span class="spec">${v}</span></div>`);
const half=Math.ceil(sizeRows.length/2);
const iconCells=Object.keys(icons).filter(k=>!k.startsWith('$')).map(k=>`        <div class="doc-item items-center">{{icon:${k}:lg${k==='apple'||k==='google'?':solid':''}}}<span class="doc-name">${k}</span></div>`).join('\n');
const out=`<div class="board" dir="rtl" data-theme="light">
  <header class="doc-header">
    <h1 class="text-title-1">نظام التصميم — المرجع</h1>
    <p class="text-body tone-muted">كل قيمة في الشاشات تأتي من <span class="ltr">ds/ijazah/tokens.json</span>، وكل عنصر من مكوّن في <span class="ltr">components.css</span>، وكل أيقونة من <span class="ltr">icons.json</span>. هذه اللوحة تُولَّد من الملفات نفسها، فلا تختلف عنها. القيمة الحرفية في شاشة أو مكوّن توقف المراجعة.</p>
  </header>

  <div class="grid-2 gap-8">
    <section class="doc-section">
      <h2 class="doc-title">المبادئ</h2>
      <ul class="stack gap-2 text-body">
        <li>هادئة ومتأنية ومحترمة. مكان للتسميع، لا للإقناع أو البيع. لا إلحاح، ولا ذنب السلاسل اليومية، ولا احتفالات.</li>
        <li>العربية هي الأصل وRTL افتراضي. بداية ونهاية، لا يمين ويسار.</li>
        <li>الذهبي للإجازة والسند والشهادة فقط. نجوم التقييم بلون النص.</li>
        <li>الطالب مُرشَد: الخطوة التالية ظاهرة دائمًا. المعلم متحكّم: اليوم كله في نظرة.</li>
      </ul>
    </section>
    <section class="doc-section">
      <h2 class="doc-title">قواعد المكوّنات</h2>
      <ul class="stack gap-2 text-body">
        <li>جذر كل تبويب AppHeader: العنوان في البداية والإجراءات في النهاية. الشاشة الفرعية NavHeader: رجوع وعنوان وإجراء اختياري.</li>
        <li>لا خط فاصل تحت الهيدر حتى يُمرَّر المحتوى. ActionBar فقط فوق محتوى يُمرَّر.</li>
        <li>اختيار واحد من خيارين أو ثلاثة = Segmented دائمًا، ومنه تغيير اللغة. لا حالة اختيار سوداء.</li>
        <li>الشخص Avatar دائري، والشيء IconTile مربع. الحالة Badge.</li>
        <li>أصغر هدف لمس <span class="ltr">size.touch</span> (44)، ولا استثناء.</li>
      </ul>
    </section>
  </div>

  <section class="doc-section">
    <h2 class="doc-title">الألوان الدلالية — فاتح</h2>
    <div class="grid-6 gap-4">
${colors('light')}
    </div>
  </section>

  <section class="doc-panel" data-theme="dark">
    <h2 class="doc-title">الألوان الدلالية — داكن (تعيين مستقل، لا فلتر)</h2>
    <div class="grid-6 gap-4">
${colors('dark')}
    </div>
  </section>

  <div class="grid-2 gap-8">
    <section class="doc-section">
      <h2 class="doc-title">الخطوط</h2>
${type}
    </section>
    <section class="doc-section">
      <h2 class="doc-title">المسافات (أساس 4، إيقاع 8)</h2>
${space}
      <h2 class="doc-title">الانحناء</h2>
      <div class="grid-6 gap-3">
${radius}
      </div>
    </section>
  </div>

  <section class="doc-section">
    <h2 class="doc-title">المقاسات</h2>
    <div class="grid-2 gap-4 items-start">
      <div class="list">
${sizeRows.slice(0,half).join('\n')}
      </div>
      <div class="list">
${sizeRows.slice(half).join('\n')}
      </div>
    </div>
  </section>

  <section class="doc-section">
    <h2 class="doc-title">الأيقونات (أسماء Lucide)</h2>
    <div class="grid-6 gap-4">
${iconCells}
    </div>
  </section>
</div>
`;
fs.writeFileSync(path.join(__dirname,'..','frags','DesignLanguage.html'),out);
console.log('frags/DesignLanguage.html');
