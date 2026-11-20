/* واجهة المقدّر الذكي. الحساب كله في engine.js، والفهم في parser.js أو Claude. */
const E = window.TaxEngine;
const P = window.TaxParser;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (x) => E.fmt(x);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } },
};

/* ---------------- التبويبات ---------------- */
$$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
function selectTab(id) {
  $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + id; });
  store.set('tab', id);
}
selectTab(store.get('tab') || 'person');

/* ---------------- النماذج العامة ---------------- */
function fieldHTML(f, value) {
  const id = 'f_' + f.k;
  if (f.type === 'check') {
    return `<div class="field check"><input type="checkbox" id="${id}" name="${f.k}" ${value ? 'checked' : ''}><label for="${id}">${f.label}</label></div>`;
  }
  if (f.type === 'select') {
    return `<div class="field"><label for="${id}">${f.label}</label><select id="${id}" name="${f.k}">${f.options
      .map(([v, l]) => `<option value="${v}" ${String(value) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  }
  return `<div class="field"><label for="${id}">${f.label}</label><input id="${id}" name="${f.k}" type="number" inputmode="decimal" step="any" min="0" value="${value ?? ''}"></div>`;
}
function buildForm(form, groups, values) {
  form.innerHTML = groups.map((g) => `<fieldset><legend>${g.title}</legend>${g.fields.map((f) => fieldHTML(f, values[f.k] ?? f.def ?? '')).join('')}</fieldset>`).join('');
}
function readForm(form, groups) {
  const out = {};
  groups.forEach((g) => g.fields.forEach((f) => {
    const el = form.elements[f.k];
    if (!el) return;
    out[f.k] = f.type === 'check' ? el.checked : f.type === 'select' ? el.value : (el.value === '' ? 0 : Number(el.value));
  }));
  return out;
}
function writeForm(form, groups, values) {
  groups.forEach((g) => g.fields.forEach((f) => {
    const el = form.elements[f.k];
    if (!el) return;
    const v = values[f.k] ?? f.def ?? (f.type === 'check' ? false : '');
    if (f.type === 'check') el.checked = !!v; else el.value = v === 0 && f.type !== 'select' ? '' : v;
  }));
}

/* ---------------- ورقة التقدير ---------------- */
function linesHTML(lines) {
  return `<table class="ledger"><tbody>${lines.map((l) => {
    const tag = l.kind === 'rejected' ? '<span class="tag rej">مرفوض</span>' : l.kind === 'partial' ? `<span class="tag part">مقبول جزئياً من ${fmt(l.claimed)}</span>` : '';
    return `<tr class="k-${l.kind}"><td class="what"><b>${esc(l.label)}</b>${tag}${l.ref ? `<span class="ref">${esc(l.ref)}</span>` : ''}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}</td><td class="amt">${fmt(l.amount)}</td></tr>`;
  }).join('')}</tbody></table>`;
}
let lastStamp = {};
function renderSheet(el, { title, meta, body, verdict, kpis }) {
  const key = el.id + ':' + (verdict ? verdict.value : '');
  const animate = lastStamp[el.id] !== key;
  lastStamp[el.id] = key;
  el.innerHTML = `
    <div class="head"><h2>${title}</h2><div class="meta">${meta || ''}</div></div>
    ${body}
    ${verdict ? `<div class="verdict">
      <div class="kpis">${(kpis || []).map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('')}</div>
      <div class="stamp ${animate ? 'landed' : ''}"><span class="k">${verdict.label}</span><span class="v">${fmt(verdict.value)}</span><span class="k">شيكل</span></div>
    </div>` : ''}
    <div class="sheet-actions"><button type="button" class="ghost" data-print>اطبع الورقة</button></div>`;
  $('[data-print]', el).addEventListener('click', () => window.print());
}

/* ================= شخص طبيعي ================= */
const SECTOR = [['private', 'قطاع خاص'], ['public', 'قطاع عام'], ['university', 'جامعة']];
const PERSON_GROUPS = [
  { title: 'عام', fields: [
    { k: 'resident', label: 'مقيم', type: 'check', def: true },
    { k: 'year', label: 'السنة الضريبية', def: 2024 } ] },
  { title: 'الوظيفة', fields: [
    { k: 'sector1', label: 'القطاع', type: 'select', options: SECTOR, def: 'private' },
    { k: 'salary1', label: 'الراتب الشهري' }, { k: 'months1', label: 'أشهر العمل', def: 12 },
    { k: 'transport1', label: 'مواصلات فعلية (للفترة)' }, { k: 'allowance1', label: 'بدل مواصلات شهري (عام)' },
    { k: 'pension1', label: 'مساهمة التقاعد' }, { k: 'health1', label: 'تأمين صحي' }, { k: 'withheld1', label: 'مقتطع شهرياً' } ] },
  { title: 'وظيفة ثانية (إن وجدت)', fields: [
    { k: 'sector2', label: 'القطاع', type: 'select', options: SECTOR, def: 'public' },
    { k: 'salary2', label: 'الراتب الشهري' }, { k: 'months2', label: 'أشهر العمل' },
    { k: 'transport2', label: 'مواصلات فعلية (للفترة)' }, { k: 'allowance2', label: 'بدل مواصلات شهري (عام)' },
    { k: 'pension2', label: 'مساهمة التقاعد' }, { k: 'health2', label: 'تأمين صحي' }, { k: 'withheld2', label: 'مقتطع شهرياً' } ] },
  { title: 'نهاية الخدمة والبدلات', fields: [
    { k: 'eosAmount', label: 'مكافأة نهاية الخدمة' }, { k: 'eosYears', label: 'سنوات الخدمة' },
    { k: 'eosLast', label: 'آخر راتب شهري' }, { k: 'eosUni', label: 'موظف جامعة (شهران/سنة)', type: 'check' },
    { k: 'repReceived', label: 'بدل تمثيل أو سفر' }, { k: 'repSpent', label: 'المنفَق منه فعلاً' },
    { k: 'pension', label: 'راتب تقاعدي (معفى)' } ] },
  { title: 'دخول أخرى', fields: [
    { k: 'business', label: 'صافي دخل تجاري أو مهني' },
    { k: 'partnerProfit', label: 'ربح شركة التضامن' }, { k: 'partnerShare', label: 'حصة المكلف %' },
    { k: 'rentalGross', label: 'إيراد الإيجار' }, { k: 'propertyTax', label: 'ضريبة الأملاك المدفوعة' },
    { k: 'agri', label: 'دخل زراعي (معفى)' }, { k: 'shares', label: 'ربح أسهم من محفظة (معفى)' },
    { k: 'dividends', label: 'أرباح موزعة من مساهمة' } ] },
  { title: 'الإعفاءات والتنزيلات', fields: [
    { k: 'students', label: 'طلاب جامعيون' },
    { k: 'housingKind', label: 'السكن', type: 'select', options: [['none', 'لا يوجد'], ['interest', 'فوائد قرض سكن'], ['purchase', 'شراء أو بناء مسكن']], def: 'none' },
    { k: 'housingAmount', label: 'المبلغ' }, { k: 'housingStart', label: 'سنة بداية القرض' },
    { k: 'donations', label: 'التبرعات' }, { k: 'loss', label: 'خسارة مدورة' },
    { k: 'lossExempt', label: 'الخسارة من نشاط معفى', type: 'check' }, { k: 'advances', label: 'سلف مدفوعة' } ] },
];

function personInputFromFlat(f) {
  const jobs = [];
  [1, 2].forEach((i) => {
    if (!(f['salary' + i] > 0)) return;
    jobs.push({ label: i === 1 ? (f.salary2 > 0 ? 'الوظيفة الأولى' : '') : 'الوظيفة الثانية', sector: f['sector' + i], monthlySalary: f['salary' + i],
      months: f['months' + i] || 12, transportActual: f['transport' + i], transportAllowanceMonthly: f['allowance' + i],
      pensionContrib: f['pension' + i], healthContrib: f['health' + i], withheldMonthly: f['withheld' + i] });
  });
  const ex = [];
  if (f.agri) ex.push({ label: 'دخل زراعي لشخص طبيعي', amount: f.agri, reason: 'معفى' });
  if (f.shares) ex.push({ label: 'ربح بيع أسهم من محفظة استثمارية', amount: f.shares, reason: 'الأرباح الرأسمالية من الأوراق المالية في محفظة استثمارية معفاة' });
  return {
    resident: f.resident, year: f.year, jobs,
    endOfService: f.eosAmount ? { amount: f.eosAmount, years: f.eosYears, lastMonthlySalary: f.eosLast || f.salary1, university: f.eosUni } : null,
    representation: f.repReceived ? { received: f.repReceived, spent: f.repSpent } : null,
    pension: f.pension, business: f.business || null,
    partnerships: f.partnerProfit ? [{ label: 'شركة التضامن', profit: f.partnerProfit, share: (f.partnerShare || 100) / 100 }] : [],
    rental: f.rentalGross || f.propertyTax ? { gross: f.rentalGross, propertyTaxPaid: f.propertyTax } : null,
    exemptIncome: ex, dividends: f.dividends, students: f.students,
    housing: f.housingKind !== 'none' && f.housingAmount ? { kind: f.housingKind, amount: f.housingAmount, startYear: f.housingStart || null } : null,
    donations: f.donations, lossCarried: f.loss, lossFromExemptActivity: f.lossExempt, advances: f.advances,
  };
}

function flatFromParsed(inp) {
  const f = { resident: inp.resident !== false, year: inp.year || 2024, housingKind: 'none', sector2: 'public' };
  (inp.jobs || []).slice(0, 2).forEach((j, i) => {
    const n = i + 1;
    Object.assign(f, { ['sector' + n]: j.sector || 'private', ['salary' + n]: j.monthlySalary, ['months' + n]: j.months || 12,
      ['transport' + n]: j.transportActual, ['allowance' + n]: j.transportAllowanceMonthly, ['pension' + n]: j.pensionContrib,
      ['health' + n]: j.healthContrib, ['withheld' + n]: j.withheldMonthly });
  });
  if (inp.endOfService) Object.assign(f, { eosAmount: inp.endOfService.amount, eosYears: inp.endOfService.years, eosLast: inp.endOfService.lastMonthlySalary, eosUni: inp.endOfService.university });
  if (inp.representation) Object.assign(f, { repReceived: inp.representation.received, repSpent: inp.representation.spent });
  f.pension = inp.pension; f.business = typeof inp.business === 'number' ? inp.business : 0;
  if (inp.partnerships && inp.partnerships[0]) Object.assign(f, { partnerProfit: inp.partnerships[0].profit, partnerShare: Math.round(inp.partnerships[0].share * 1e8) / 1e6 });
  if (inp.rental) Object.assign(f, { rentalGross: inp.rental.gross, propertyTax: inp.rental.propertyTaxPaid });
  (inp.exemptIncome || []).forEach((x) => { if (/زراع/.test(x.label)) f.agri = x.amount; else if (/اسهم|أسهم/.test(x.label)) f.shares = x.amount; });
  f.dividends = inp.dividends; f.students = inp.students;
  if (inp.housing) Object.assign(f, { housingKind: inp.housing.kind, housingAmount: inp.housing.amount, housingStart: inp.housing.startYear });
  Object.assign(f, { donations: inp.donations, loss: inp.lossCarried, lossExempt: inp.lossFromExemptActivity, advances: inp.advances });
  return f;
}

const personForm = $('#personForm');
buildForm(personForm, PERSON_GROUPS, {});
personForm.addEventListener('input', renderPerson);
personForm.addEventListener('change', renderPerson);

function renderPerson() {
  const flat = readForm(personForm, PERSON_GROUPS);
  const input = personInputFromFlat(flat);
  const has = input.jobs.length || input.business || input.partnerships.length || input.rental || input.endOfService || input.pension || input.representation;
  const el = $('#personSheet');
  if (!has) {
    el.innerHTML = `<div class="head"><h2>ورقة تقدير ضريبة الدخل</h2></div><p class="empty">اكتب حالة المكلف أو اختر مثالاً، وستظهر هنا ورقة التقدير سطراً بسطر.</p>`;
    return;
  }
  const r = E.individual(input);
  renderSheet(el, {
    title: 'ورقة تقدير ضريبة الدخل', meta: `شخص طبيعي${input.resident ? ' مقيم' : ' غير مقيم'}<br>السنة ${input.year || ''}`,
    body: linesHTML(r.lines),
    verdict: { label: r.payable >= 0 ? 'الضريبة الواجبة الدفع' : 'ضريبة مستردة', value: Math.abs(r.payable) },
    kpis: [['الدخل الخاضع', fmt(r.taxable)], ['الضريبة المستحقة', fmt(r.tax)], ['النسبة الفعلية', r.effectiveRate + '%']],
  });
}

const PERSON_EX = {
  mustafa: { text: 'مصطفى موظف في شركة مساهمة خاصة براتب اجمالي شهري 5,500 شيكل استقال من الشركة بتاريخ 30/6/2024 وحصل على مكافأة نهاية الخدمة بقيمة 120,000. عمل لدى الشركة لمدة 20 عام، مقيم وله طالب جامعي هو ابنه، وقيمة المواصلات الفعلية 9,000.' },
  ahmad: { text: 'المكلف احمد (مقيم) لعام 2024: يعمل موظف في شركة النجاح براتب شهري مقداره 8,000 شيكل. احمد شريك مع اشقائه سعيد وسمير في شركة تضامن، ارباح الشركة توزع بالتساوي حيث بلغت ارباح الشركة لعام 2024 بقيمة 450,000 شيكل. قدم اثباتات بقيمة المواصلات الفعلية 12,000 شيكل.' },
  mohammad: { text: 'محمد مواطن فلسطيني مقيم لعام 2024، راتبه الشهري 9,000، وله عقار مؤجر إيجاره السنوي 50,500، ودفع ضريبة الأملاك 10,000.' },
  full: { text: 'موظف مقيم راتبه السنوي 120000، وله ايجار 50000. مواصلاته الفعلية 8000، وتأمينه الصحي 3000، وفوائد قرض سكن 5000، وله 3 أبناء في الجامعة.' },
  hamdi: {
    text: 'حمدي (مقيم) عام 2025: عمل في شركة خاصة 6 أشهر براتب 3000 ومواصلات فعلية 500 شهرياً، ثم استقال وأخذ مكافأة نهاية خدمة 60000 عن 15 سنة. عمل بعدها في وزارة 5 أشهر براتب 4000 شاملاً بدل مواصلات 600، ويُقتطع منه 150 للتقاعد و75 للتأمين الصحي شهرياً. أخذ بدل تمثيل 10000 أنفق منه 8400. ربح محله التجاري 90000، وربح أسهم من محفظة استثمارية 20000. له ابن في الجامعة وآخر بمنحة، وفوائد قرض سكن 5000 منذ 2015، وتبرع بـ 25000.',
    flat: { resident: true, year: 2025, sector1: 'private', salary1: 3000, months1: 6, transport1: 3000, sector2: 'public', salary2: 4000, months2: 5, allowance2: 600,
      pension2: 750, health2: 375, eosAmount: 60000, eosYears: 15, eosLast: 3000, repReceived: 10000, repSpent: 8400, business: 90000, shares: 20000,
      students: 1, housingKind: 'interest', housingAmount: 5000, housingStart: 2015, donations: 25000 },
    assumptions: ['هذه الحالة فيها وظيفتان، فعُبّئت يدوياً. المحلل المحلي يفهم وظيفة واحدة، وClaude يفهم الاثنتين.', 'السنة 2025 هي السنة الحادية عشرة لقرض السكن (منذ 2015)، فلا إعفاء للفوائد.'],
  },
};
$$('[data-ex]').forEach((b) => b.addEventListener('click', () => {
  const ex = PERSON_EX[b.dataset.ex];
  $('#story').value = ex.text;
  if (ex.flat) { applyFlat(ex.flat, ex.assumptions, 'عُبّئت المعطيات من نص الامتحان.'); } else analyzeLocal();
}));

function applyFlat(flat, assumptions, statusText) {
  writeForm(personForm, PERSON_GROUPS, flat);
  const ul = $('#assumptions');
  if (assumptions && assumptions.length) { ul.innerHTML = assumptions.map((a) => `<li>${esc(a)}</li>`).join(''); ul.hidden = false; }
  else { ul.hidden = true; ul.innerHTML = ''; }
  setStatus(statusText || '');
  renderPerson();
}
function setStatus(t, err) { const s = $('#aiStatus'); s.textContent = t; s.classList.toggle('err', !!err); }

function analyzeLocal() {
  const text = $('#story').value.trim();
  if (!text) { setStatus('اكتب حالة المكلف أولاً، أو اختر مثالاً.', true); return; }
  const { input, found } = P.parse(text);
  const flat = flatFromParsed(input);
  applyFlat(flat, null, found.length ? `فهم المحلل المحلي ${found.length} معلومة. راجعها في «ما فهمه المقدّر».` : 'لم يجد المحلل المحلي أرقاماً واضحة. جرّب صياغة مثل «راتبه الشهري 8000» أو استخدم Claude.');
}
$('#analyzeLocal').addEventListener('click', analyzeLocal);

/* ---------- Claude ---------- */
const AI_KEYS = PERSON_GROUPS.flatMap((g) => g.fields);
const AI_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: [...AI_KEYS.map((f) => f.k), 'assumptions'],
  properties: Object.fromEntries([
    ...AI_KEYS.map((f) => [f.k, f.type === 'check' ? { type: 'boolean', description: f.label }
      : f.type === 'select' ? { type: 'string', enum: f.options.map((o) => o[0]), description: f.label }
        : { type: 'number', description: f.label }]),
    ['assumptions', { type: 'array', items: { type: 'string' }, description: 'افتراضات بالعربية لما لم يُذكر صراحة' }],
  ]),
};
const AI_SYSTEM = `أنت مساعد يستخرج معطيات حالة ضريبية فلسطينية (ضريبة دخل شخص طبيعي) من نص عربي، ويملأ الحقول فقط، ولا يحسب الضريبة.
قواعد التعبئة:
- كل مبلغ غير مذكور = 0، وكل خيار غير مذكور = القيمة الافتراضية (resident=true، housingKind=none، sector1=private، sector2=public).
- salary1/salary2 راتب شهري. إن ذُكر سنوي فاقسمه على 12. months = أشهر العمل في السنة (12 إن لم يُذكر).
- transport1/2 = مجموع المواصلات الفعلية للفترة كلها (شهري × عدد الأشهر). allowance1/2 = بدل المواصلات الشهري الثابت لموظف القطاع العام فقط.
- pension1/2 وhealth1/2 = مجموع مساهمة الموظف للفترة (شهري × الأشهر). withheld1/2 = الضريبة المقتطعة شهرياً.
- eosLast = آخر راتب شهري. partnerShare = نسبة المكلف المئوية من ربح شركة التضامن (بالتساوي بين 3 = 33.3333).
- students = عدد الطلاب الجامعيين الذين يستحقون الإعفاء (استبعد من له منحة كاملة).
- housingStart = سنة بداية قرض السكن إن ذُكرت.
- shares = ربح أسهم من محفظة استثمارية (معفى). agri = دخل زراعي لشخص طبيعي (معفى).
- اكتب في assumptions كل افتراض اضطررت إليه، بجمل قصيرة.`;

$('#analyzeAI').addEventListener('click', async () => {
  const text = $('#story').value.trim();
  if (!text) { setStatus('اكتب حالة المكلف أولاً.', true); return; }
  const key = store.get('anthropicKey');
  if (!key) { $('#settings').showModal(); return; }
  const btn = $('#analyzeAI');
  btn.disabled = true;
  setStatus('Claude يقرأ الحالة...');
  try {
    const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm');
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_SCHEMA } },
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    if (msg.stop_reason === 'refusal') throw new Error('رفض النموذج هذا الطلب.');
    if (msg.stop_reason === 'max_tokens') throw new Error('انقطع الرد قبل اكتماله. جرّب نصاً أقصر.');
    const block = msg.content.find((b) => b.type === 'text');
    const data = JSON.parse(block.text);
    const { assumptions, ...flat } = data;
    applyFlat(flat, assumptions, 'فهم Claude الحالة. الأرقام في الورقة من المحرك، لا من النموذج.');
  } catch (err) {
    const s = err && err.status;
    setStatus(s === 401 ? 'المفتاح غير صحيح. افتح «إعداد Claude» وأدخل مفتاحاً صالحاً.'
      : s === 429 ? 'تجاوزت حد الطلبات. انتظر قليلاً ثم أعد المحاولة.'
        : s >= 500 ? 'خدمة Claude لا ترد الآن. استخدم «حلّل الحالة» المحلي.'
          : 'تعذّر التحليل: ' + (err && err.message ? err.message : err), true);
  } finally { btn.disabled = false; }
});

/* إعداد المفتاح */
const dlg = $('#settings');
$('#openSettings').addEventListener('click', () => { $('#apiKey').value = store.get('anthropicKey') || ''; dlg.showModal(); });
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'save') { const v = $('#apiKey').value.trim(); store.set('anthropicKey', v || null); setStatus(v ? 'حُفظ المفتاح في هذا المتصفح.' : ''); }
  if (dlg.returnValue === 'clear') { store.set('anthropicKey', null); $('#apiKey').value = ''; setStatus('حُذف المفتاح.'); }
});

/* ================= شركة ================= */
const COMPANY_GROUPS = [{ title: 'بيانات الشركة', fields: [
  { k: 'companyType', label: 'نوع الشركة', type: 'select', options: [['private', 'مساهمة خصوصية'], ['public', 'مساهمة عامة'], ['telecom', 'اتصالات أو احتكار (20%)']], def: 'private' },
  { k: 'grossProfit', label: 'مجمل الربح' }, { k: 'agriculturalGross', label: 'دخل زراعي' },
  { k: 'lossCarried', label: 'خسارة مدورة' }, { k: 'lossFromExemptPeriod', label: 'الخسارة في فترة إعفاء', type: 'check' },
  { k: 'donations', label: 'التبرعات' }, { k: 'advances', label: 'السلف المدفوعة' } ] }];
const EXP_EXTRA = {
  salaries: [['withoutWithholding', 'منها بلا اقتطاع ضريبة']],
  rent: [['priorYear', 'يخص سنة سابقة'], ['prepaid', 'مدفوع مقدماً لسنة قادمة']],
  establishment: [['total', 'مجموع مصاريف التأسيس']],
  badDebts: [['provenPct', 'المثبت منها %']],
};
const companyForm = $('#companyForm');
buildForm(companyForm, COMPANY_GROUPS, {});
let expenses = [];
function expRowHTML(e, i) {
  const opts = Object.entries(E.EXPENSE_TYPES).map(([v, l]) => `<option value="${v}" ${e.type === v ? 'selected' : ''}>${l}</option>`).join('');
  const extra = (EXP_EXTRA[e.type] || []).map(([k, l]) => `<div class="field"><label for="x${i}${k}">${l}</label><input id="x${i}${k}" data-x="${k}" type="number" step="any" min="0" value="${e[k] ?? ''}"></div>`).join('');
  return `<div class="row" data-i="${i}">
    <div class="field"><label for="t${i}">نوع المصروف</label><select id="t${i}" data-f="type">${opts}</select></div>
    <div class="field"><label for="a${i}">المبلغ</label><input id="a${i}" data-f="amount" type="number" step="any" min="0" value="${e.amount ?? ''}"></div>
    <button type="button" class="del" aria-label="احذف المصروف">×</button>
    <div class="extra">${extra}</div></div>`;
}
function drawExpenses() { $('#expenseRows').innerHTML = expenses.map(expRowHTML).join(''); renderCompany(); }
$('#expenseRows').addEventListener('input', (ev) => {
  const row = ev.target.closest('.row'); if (!row) return;
  const e = expenses[row.dataset.i];
  if (ev.target.dataset.f === 'type') { e.type = ev.target.value; drawExpenses(); return; }
  if (ev.target.dataset.f) e[ev.target.dataset.f] = Number(ev.target.value);
  if (ev.target.dataset.x) e[ev.target.dataset.x] = Number(ev.target.value);
  renderCompany();
});
$('#expenseRows').addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('del')) return;
  expenses.splice(Number(ev.target.closest('.row').dataset.i), 1); drawExpenses();
});
$('#addExpense').addEventListener('click', () => { expenses.push({ type: 'admin', amount: 0 }); drawExpenses(); });
companyForm.addEventListener('input', renderCompany);
companyForm.addEventListener('change', renderCompany);

function renderCompany() {
  const f = readForm(companyForm, COMPANY_GROUPS);
  const el = $('#companySheet');
  if (!f.grossProfit && !f.agriculturalGross) { el.innerHTML = `<div class="head"><h2>ورقة تقدير شركة</h2></div><p class="empty">أدخل مجمل الربح والمصاريف، أو اختر مثالاً.</p>`; return; }
  const exps = expenses.map((e) => Object.assign({}, e, e.provenPct != null && e.provenPct !== '' ? { provenRatio: e.provenPct / 100 } : {}));
  const r = E.company(Object.assign({}, f, { expenses: exps }));
  renderSheet(el, {
    title: 'ورقة تقدير شركة', meta: { private: 'مساهمة خصوصية', public: 'مساهمة عامة', telecom: 'اتصالات' }[f.companyType],
    body: linesHTML(r.lines), verdict: { label: r.payable >= 0 ? 'الضريبة الواجبة الدفع' : 'ضريبة مستردة', value: Math.abs(r.payable) },
    kpis: [['الدخل الصافي المعدل', fmt(r.netAdjusted)], ['الدخل الخاضع', fmt(r.taxable)], ['النسبة', Math.round(r.rate * 100) + '%']],
  });
}
const COMPANY_EX = {
  public: { f: { companyType: 'public', grossProfit: 3000000, donations: 200000, advances: 100000 }, e: [
    { type: 'salaries', amount: 400000, withoutWithholding: 60000 }, { type: 'establishment', amount: 250000, total: 1000000 }, { type: 'rnd', amount: 90000 },
    { type: 'hospitality', amount: 50000 }, { type: 'provision', amount: 40000 }, { type: 'depreciation', amount: 150000 }, { type: 'admin', amount: 100000 },
    { type: 'fines', amount: 5000 }, { type: 'training', amount: 40000 }, { type: 'badDebts', amount: 120000 } ] },
  big: { f: { companyType: 'private', grossProfit: 20000000, donations: 3000000 }, e: [
    { type: 'salaries', amount: 3000000 }, { type: 'admin', amount: 1000000 }, { type: 'depreciation', amount: 600000 }, { type: 'hospitality', amount: 250000 },
    { type: 'rnd', amount: 700000 }, { type: 'fines', amount: 20000 }, { type: 'provision', amount: 100000 }, { type: 'training', amount: 250000 }, { type: 'badDebts', amount: 3500000 } ] },
  united: { f: { companyType: 'private', grossProfit: 110000, lossCarried: 50000, lossFromExemptPeriod: true }, e: [] },
};
$$('[data-cex]').forEach((b) => b.addEventListener('click', () => {
  const ex = COMPANY_EX[b.dataset.cex];
  writeForm(companyForm, COMPANY_GROUPS, ex.f);
  expenses = ex.e.map((x) => Object.assign({}, x));
  drawExpenses();
}));

/* ================= ض.ق.م ================= */
const VAT_TYPES = [['sale', 'بيع (16%)'], ['export', 'تصدير أو نسبة صفر'], ['exempt', 'بيع معفى'], ['saleReturn', 'مردودات مبيعات'], ['discountGiven', 'خصم مسموح به'],
  ['purchase', 'شراء بضاعة'], ['asset', 'شراء أصل ثابت'], ['expense', 'مصروف بفاتورة ضريبية'], ['purchaseReturn', 'مردودات مشتريات'], ['discountReceived', 'خصم مكتسب'], ['noInvoice', 'شراء بدون فاتورة ضريبية']];
const INPUT_T = ['purchase', 'asset', 'expense'];
let vatOps = [];
function vatRowHTML(o, i) {
  const opts = VAT_TYPES.map(([v, l]) => `<option value="${v}" ${o.type === v ? 'selected' : ''}>${l}</option>`).join('');
  const inc = ['export', 'exempt', 'noInvoice'].includes(o.type) ? '' : `<div class="field check"><input type="checkbox" id="inc${i}" data-c="inclusive" ${o.inclusive ? 'checked' : ''}><label for="inc${i}">شامل الضريبة</label></div>`;
  const inp = INPUT_T.includes(o.type) ? `<div class="field"><label for="age${i}">عمر الفاتورة بالأشهر</label><input id="age${i}" data-n="ageMonths" type="number" min="0" value="${o.ageMonths ?? ''}"></div>
    <div class="field check"><input type="checkbox" id="fe${i}" data-c="forExempt" ${o.forExempt ? 'checked' : ''}><label for="fe${i}">تخص صفقات معفاة</label></div>` : '';
  return `<div class="row" data-i="${i}">
    <div class="field"><label for="vt${i}">العملية</label><select id="vt${i}" data-t="1">${opts}</select></div>
    <div class="field"><label for="va${i}">المبلغ</label><input id="va${i}" data-n="amount" type="number" step="any" min="0" value="${o.amount ?? ''}"></div>
    <button type="button" class="del" aria-label="احذف العملية">×</button>
    <div class="extra">${inc}${inp}</div></div>`;
}
function drawVat() { $('#vatRows').innerHTML = vatOps.map(vatRowHTML).join(''); renderVat(); }
$('#vatRows').addEventListener('input', (ev) => {
  const row = ev.target.closest('.row'); if (!row) return;
  const o = vatOps[row.dataset.i];
  if (ev.target.dataset.t) { o.type = ev.target.value; drawVat(); return; }
  if (ev.target.dataset.n) o[ev.target.dataset.n] = Number(ev.target.value);
  if (ev.target.dataset.c) o[ev.target.dataset.c] = ev.target.checked;
  renderVat();
});
$('#vatRows').addEventListener('click', (ev) => { if (ev.target.classList.contains('del')) { vatOps.splice(Number(ev.target.closest('.row').dataset.i), 1); drawVat(); } });
$('#addVat').addEventListener('click', () => { vatOps.push({ type: 'sale', amount: 0 }); drawVat(); });
$('#turnover').addEventListener('input', renderVat);

function renderVat() {
  const c = E.vatTaxpayerClass(Number($('#turnover').value));
  $('#taxpayerClass').innerHTML = `<b>${c.label}</b>: ${esc(c.note)}`;
  const el = $('#vatSheet');
  if (!vatOps.length) { el.innerHTML = `<div class="head"><h2>الكشف الدوري لضريبة القيمة المضافة</h2></div><p class="empty">أضف عمليات الشهر، أو اختر مثالاً.</p>`; return; }
  const r = E.vatPeriod(vatOps);
  const j = r.entries.map((e) => {
    const rows = [...e.debit.map(([a, v]) => `<tr><td>من ح/ ${esc(a)}</td><td class="n">${fmt(v)}</td><td></td></tr>`),
      ...e.credit.map(([a, v]) => `<tr><td class="cr">إلى ح/ ${esc(a)}</td><td></td><td class="n">${fmt(v)}</td></tr>`)];
    rows[0] = rows[0].replace('<tr>', `<tr><td rowspan="${rows.length}">${e.no}</td>`);
    return rows.join('') + (e.note ? `<tr class="note"><td></td><td colspan="3">${esc(e.note)}</td></tr>` : '');
  }).join('');
  renderSheet(el, {
    title: 'الكشف الدوري لضريبة القيمة المضافة', meta: 'نسبة 16%',
    body: `<h3 class="h3s">قيود اليومية</h3><table class="journal"><thead><tr><th>#</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${j}</tbody></table>
      <h3 class="h3s">الكشف</h3>${linesHTML(r.lines)}`,
    verdict: { label: r.balance >= 0 ? 'رصيد الضريبة للدفع' : 'رصيد للإرجاع', value: Math.abs(r.balance) },
    kpis: [['ضريبة المخرجات', fmt(r.outputVat)], ['ضريبة المدخلات', fmt(r.inputVat)]],
  });
}
const VAT_EX = {
  samer: [{ type: 'purchase', amount: 26680, inclusive: true }, { type: 'asset', amount: 60000 }, { type: 'purchaseReturn', amount: 1160, inclusive: true },
    { type: 'sale', amount: 100000 }, { type: 'export', amount: 60000 }, { type: 'sale', amount: 52200, inclusive: true }, { type: 'discountGiven', amount: 3000 },
    { type: 'noInvoice', amount: 20000 }, { type: 'expense', amount: 696, inclusive: true }],
  t1: [{ type: 'export', amount: 30000 }, { type: 'sale', amount: 40000 }, { type: 'sale', amount: 30000 }, { type: 'purchase', amount: 20000, ageMonths: 4 },
    { type: 'purchase', amount: 30000, ageMonths: 3 }, { type: 'purchase', amount: 10000, ageMonths: 9 }],
  t3: [{ type: 'sale', amount: 300000 }, { type: 'export', amount: 40000 }, { type: 'exempt', amount: 20000 }, { type: 'purchase', amount: 240000 },
    { type: 'purchase', amount: 25000 }, { type: 'purchase', amount: 10000, forExempt: true }],
};
$$('[data-vex]').forEach((b) => b.addEventListener('click', () => { vatOps = VAT_EX[b.dataset.vex].map((o) => Object.assign({}, o)); drawVat(); }));

/* ================= الاستيراد ================= */
const IMPORT_GROUPS = [
  { title: 'سعر الاستيراد (CIF)', fields: [
    { k: 'goods', label: 'قيمة البضاعة بالشيكل' }, { k: 'foreignAmount', label: 'أو بالعملة الأجنبية' }, { k: 'exchangeRate', label: 'سعر الصرف' },
    { k: 'freight', label: 'الشحن الخارجي' }, { k: 'insurance', label: 'التأمين' }, { k: 'portCosts', label: 'مصاريف ميناء التفريغ' },
    { k: 'localCosts', label: 'نقل داخلي للمخازن' } ] },
  { title: 'النسب', fields: [
    { k: 'customsRate', label: 'الجمارك %' }, { k: 'customsPerUnit', label: 'رسم نوعي للوحدة' }, { k: 'units', label: 'عدد الوحدات' },
    { k: 'customsMinPerUnit', label: 'حد أدنى للوحدة' }, { k: 'upliftRate', label: 'تعلية السعر %' }, { k: 'protectionRate', label: 'دفعات إلزامية (حماية) %' },
    { k: 'purchaseRate', label: 'ضريبة الشراء %' }, { k: 'vatRate', label: 'ض.ق.م %', def: 16 } ] },
];
const importForm = $('#importForm');
buildForm(importForm, IMPORT_GROUPS, {});
importForm.addEventListener('input', renderImport);
const PCT = ['customsRate', 'upliftRate', 'protectionRate', 'purchaseRate', 'vatRate'];
function renderImport() {
  const f = readForm(importForm, IMPORT_GROUPS);
  const el = $('#importSheet');
  if (!f.goods && !f.foreignAmount) { el.innerHTML = `<div class="head"><h2>بيان الضرائب على الاستيراد</h2></div><p class="empty">أدخل قيمة البضاعة والنسب، أو اختر مثالاً.</p>`; return; }
  PCT.forEach((k) => { f[k] = (f[k] || 0) / 100; });
  if (!f.vatRate) f.vatRate = 0.16;
  const r = E.importDuties(f);
  renderSheet(el, { title: 'بيان الضرائب على الاستيراد', meta: 'الجمارك ثم الشراء ثم ض.ق.م', body: linesHTML(r.lines),
    verdict: { label: 'مجموع الضرائب المستحقة', value: r.totalTaxes }, kpis: [['سعر الاستيراد', fmt(r.customsValue)], ['الثمن شاملاً الضرائب', fmt(r.total)]] });
}
const IMPORT_EX = {
  said: { goods: 140000, freight: 50000, localCosts: 4000, customsRate: 20, purchaseRate: 30, vatRate: 16 },
  ex5: { goods: 20000, customsRate: 20, purchaseRate: 60, vatRate: 16 },
  oil: { goods: 8000, customsRate: 15, customsPerUnit: 4.4, units: 500, upliftRate: 40, purchaseRate: 20, vatRate: 17 },
  shirts: { goods: 15000, customsRate: 12, customsMinPerUnit: 1, units: 3000, vatRate: 16 },
};
$$('[data-iex]').forEach((b) => b.addEventListener('click', () => { writeForm(importForm, IMPORT_GROUPS, IMPORT_EX[b.dataset.iex]); renderImport(); }));

/* ================= التصنيف ================= */
function renderClassify() {
  const items = $('#classifyInput').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const rows = items.map((s) => { const c = E.classifyVat(s); return `<tr><td>${esc(s)}<span class="note">${esc(c.title)}${c.note ? '. ' + esc(c.note) : ''}</span></td><td class="amt"><span class="chip ${c.status}">${c.label}</span></td></tr>`; }).join('');
  renderSheet($('#classifySheet'), { title: 'تصنيف الصفقات في ض.ق.م', meta: 'حسب قوائم الكتاب ص 276-277',
    body: items.length ? `<table class="ledger"><tbody>${rows}</tbody></table>` : '<p class="empty">اكتب صفقة في كل سطر.</p>' });
}
$('#classifyInput').addEventListener('input', renderClassify);

/* بداية */
renderPerson(); renderCompany(); renderVat(); renderImport(); renderClassify();
