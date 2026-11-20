/*
 * المحلل اللغوي المحلي: يحوّل وصف حالة مكلف بالعربية إلى مدخلات المحرك.
 * يعمل بلا إنترنت، بقواعد وكلمات مفتاحية. وضع Claude (اختياري) في app.js يعطي فهماً أعمق.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaxParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORD_NUM = { 'واحد': 1, 'واحده': 1, 'اثنين': 2, 'اثنان': 2, 'ابنين': 2, 'ولدين': 2, 'طالبين': 2, 'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4, 'خمس': 5, 'خمسه': 5 };

  function prep(text) {
    return String(text || '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/٫/g, '.').replace(/[٬،](?=\d{3}\b)/g, '')
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/(\d+(?:\.\d+)?)\s*(?:الف|الاف)(?![ء-ي])/g, (m, x) => String(Number(x) * 1000))
      .replace(/(\d+(?:\.\d+)?)\s*مليون(?![ء-ي])/g, (m, x) => String(Number(x) * 1e6))
      .replace(/[ \t]+/g, ' ');
  }

  const isYear = (v, after) => v >= 1950 && v <= 2099 && Number.isInteger(v) && !/^\s*(شيكل|ش\b|دولار)/.test(after);

  /** أول مبلغ بعد موضع الكلمة المفتاحية ضمن نافذة، متجاهلاً السنوات والنسب. */
  function amountAfter(t, re, win) {
    win = win || 70;
    const m = re.exec(t);
    if (!m) return null;
    const seg = t.slice(m.index + m[0].length, m.index + m[0].length + win);
    const numRe = /(\d+(?:\.\d+)?)(\s*%)?/g;
    let k;
    while ((k = numRe.exec(seg))) {
      const v = Number(k[1]);
      if (k[2]) continue;
      const before = seg.slice(Math.max(0, k.index - 9), k.index);
      if (isYear(v, seg.slice(k.index + k[0].length)) && /(?:عام|سنه|لعام|لسنه|منذ|\/|-)\s*$/.test(before)) continue;
      if (/\/\s*$/.test(before) || /^\s*\//.test(seg.slice(k.index + k[0].length))) continue; // أجزاء تاريخ
      return { value: v, at: m.index, tail: seg };
    }
    return null;
  }

  function yearNear(t, re) {
    const m = re.exec(t);
    if (!m) return null;
    const seg = t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 80);
    const y = /(19[5-9]\d|20\d\d)/.exec(seg);
    return y ? Number(y[1]) : null;
  }

  function countWord(s) {
    const d = /(\d+)/.exec(s);
    if (d) return Number(d[1]);
    for (const w in WORD_NUM) if (s.includes(w)) return WORD_NUM[w];
    return null;
  }

  function parse(text) {
    const t = prep(text);
    const found = [];
    const note = (field, label, value) => found.push({ field, label, value });
    const input = { resident: !/غير مقيم/.test(t) };
    if (!input.resident) note('resident', 'غير مقيم: لا إعفاء مقيم', false);

    const y = /(?:لعام|لسنه|عام|سنه|خلال)\s+(20\d\d)/.exec(t);
    if (y) { input.year = Number(y[1]); note('year', 'السنة الضريبية', input.year); }

    // الراتب
    const sal = amountAfter(t, /راتب(?:ه|ها)?(?!\s*التقاعدي|\s*تقاعدي)(?:\s+(?:الشهري|شهري|السنوي|سنوي|الاجمالي|اجمالي|مقداره|قدره|بقيمه|يبلغ))*/);
    let monthly = null;
    if (sal) {
      const annual = /سنوي/.test(sal.tail.slice(0, 25)) || /راتب(?:ه)? السنوي/.test(t) || sal.value > 40000;
      monthly = annual ? sal.value / 12 : sal.value;
      const job = { sector: 'private', monthlySalary: Math.round(monthly * 100) / 100 };
      const mo = /(\d+)\s*(?:اشهر|شهور|شهرا)/.exec(t);
      if (mo && Number(mo[1]) < 12) job.months = Number(mo[1]);
      else if (/استقال|ترك العمل|انتهت خدمته/.test(t)) {
        const d = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(20\d\d)/.exec(t);
        if (d) job.months = Number(d[2]);
      }
      if (/حكوم|وزار|قطاع عام|القطاع العام|بلديه|موظف عام/.test(t)) job.sector = 'public';
      else if (/جامعه|الجامعه/.test(t) && /(?:يعمل|موظف|محاضر|استاذ)[^.]{0,20}جامع/.test(t)) job.sector = 'university';
      const tr = amountAfter(t, /مواصلات(?:\s+(?:فعليه|الفعليه|بقيمه|قيمتها))*/);
      if (tr) {
        if (job.sector === 'public' && /بدل مواصلات/.test(t)) { job.transportAllowanceMonthly = tr.value; note('transport', 'بدل مواصلات شهري (قطاع عام)', tr.value); }
        else { job.transportActual = tr.value; note('transport', 'مواصلات فعلية', tr.value); }
      }
      const pc = amountAfter(t, /(?:مساهمه|اشتراك|اقتطاع)[^.]{0,15}(?:صندوق\s+)?التقاعد/);
      if (pc) { job.pensionContrib = pc.value; note('pensionContrib', 'مساهمة صندوق التقاعد', pc.value); }
      const hc = amountAfter(t, /تامين(?:ه|ها)?\s*(?:ال)?صحي/);
      if (hc) { job.healthContrib = hc.value; note('healthContrib', 'تأمين صحي', hc.value); }
      const wh = amountAfter(t, /(?:يقتطع|اقتطاع|مقتطع|تقتطع)(?:\s+(?:منه|عنه|منها))?(?:\s+ضريبه)?(?:\s+رواتب)?/);
      if (wh) { job.withheldMonthly = wh.value; note('withheld', 'ضريبة مقتطعة شهرياً', wh.value); }
      input.jobs = [job];
      note('salary', 'الراتب الشهري', job.monthlySalary);
      if (job.months) note('months', 'أشهر العمل', job.months);
      note('sector', 'القطاع', { private: 'خاص', public: 'عام', university: 'جامعة' }[job.sector]);
    }

    const pen = amountAfter(t, /راتب(?:ه)?\s*(?:ال)?تقاعدي/);
    if (pen) { input.pension = pen.value; note('pension', 'راتب تقاعدي (معفى)', pen.value); }

    const eos = amountAfter(t, /مكافاه\s+نهايه\s+(?:ال)?خدمه/);
    if (eos) {
      const yrs = /(\d+)\s*(?:سنه|سنوات|عام|عاما|اعوام)/.exec(t);
      input.endOfService = { amount: eos.value, years: yrs ? Number(yrs[1]) : 0, lastMonthlySalary: monthly || 0,
        university: /جامع/.test(t) && /(?:يعمل|موظف|محاضر)[^.]{0,20}جامع/.test(t) };
      note('endOfService', 'مكافأة نهاية الخدمة', eos.value);
      if (yrs) note('years', 'سنوات الخدمة', Number(yrs[1]));
    }

    const rep = amountAfter(t, /بدل\s+(?:ال)?(?:تمثيل|سفر)|مهمه\s+سفر/);
    if (rep) {
      const sp = amountAfter(t, /(?:انفق|صرف|انفاق)(?:\s+(?:منه|منها|فعلا))*/);
      input.representation = { received: rep.value, spent: sp ? sp.value : 0 };
      note('representation', 'بدل تمثيل أو سفر', rep.value);
    }

    const bus = amountAfter(t, /(?:صافي\s+)?(?:ربح|ارباح|دخل)(?:ه)?\s+(?:من\s+)?(?:ال)?(?:محل|تجار|مهنه|عياده|مكتب|مصنع|نشاط|بقاله|مطعم)[^\d]{0,15}/);
    if (bus) { input.business = bus.value; note('business', 'صافي دخل تجاري أو مهني', bus.value); }

    if (/شريك/.test(t)) {
      const pr = amountAfter(t, /(?:ارباح|ربح)\s+(?:ال)?شركه/, 90);
      if (pr) {
        let share = null;
        const pct = /(\d+(?:\.\d+)?)\s*%\s*(?:من\s+)?(?:الارباح|الربح|حصه)?/.exec(t);
        if (/بالتساوي/.test(t)) {
          const m = /(?:مع|بين)\s+([^.]{0,30})/.exec(t);
          let k = 2;
          if (m) {
            const c = countWord(m[1]);
            if (c) k = /بين/.test(m[0]) ? c : c + 1;
            else if (/\s(?:و)\S+/.test(m[1])) k = 3;
            else if (/شقيقي|اخوي|شريكي|اشقائه/.test(m[1])) k = 3;
          }
          share = 1 / k;
        } else if (pct) share = Number(pct[1]) / 100;
        input.partnerships = [{ label: 'شركة التضامن', profit: pr.value, share: share || 0.5 }];
        note('partnership', 'حصة في شركة أشخاص', `${pr.value} × ${Math.round((share || 0.5) * 1000) / 10}%`);
      }
    }

    const rent = amountAfter(t, /(?:ايراد|دخل)?\s*(?:ال)?(?:ايجار|اجره|عقار(?:ات)?\s+مؤجر[هة]?|املاك\s+مؤجر[هة]?)(?!\s*سكن)/);
    if (rent && !/(?:ضريبه\s*(?:ال)?املاك)$/.test(t.slice(Math.max(0, rent.at - 20), rent.at + 4))) {
      input.rental = { gross: rent.value, propertyTaxPaid: 0 };
      note('rental', 'إيراد الإيجار', rent.value);
    }
    const pt = amountAfter(t, /ضريبه\s+(?:ال)?(?:املاك|مسقفات|الابنيه)(?:\s+(?:المدفوعه|مدفوعه|دفع))*/);
    if (pt) {
      input.rental = input.rental || { gross: 0 };
      input.rental.propertyTaxPaid = pt.value;
      note('propertyTax', 'ضريبة الأملاك المدفوعة', pt.value);
    }

    // الجامعيون
    let st = null;
    const sm = /(\d+|[^\s]+)\s+(?:من\s+)?(?:طلاب|طالب|ابناء|اولاد|ابن|ولد)[^.]{0,15}(?:جامع|الجامعه)/.exec(t);
    if (/طالبين|ابنين|ولدين/.test(t) && /جامع/.test(t)) st = 2;
    else if (sm) st = countWord(sm[1]) || 1;
    else if (/(?:طالب|ابن|ابنه|ولد)[^.]{0,12}جامع/.test(t)) st = 1;
    if (st && /منحه/.test(t) && st > 0) { const g = /(\d+|احدهم|الثاني|واحد)[^.]{0,10}منحه/.exec(t); if (g) st -= 1; }
    if (st) { input.students = st; note('students', 'طلاب جامعيون', st); }

    const hi = amountAfter(t, /فوائد\s+(?:ال)?قرض\s+(?:ال)?(?:سكن|اسكان|شقه|بيت|منزل)/);
    if (hi) {
      input.housing = { kind: 'interest', amount: hi.value };
      const sy = yearNear(t, /قرض\s+(?:ال)?(?:سكن|اسكان)/);
      if (sy && sy !== input.year) input.housing.startYear = sy;
      note('housing', 'فوائد قرض السكن', hi.value);
    } else if (/(?:اشتري|شراء|بني|بناء)\s+(?:شقه|مسكن|بيت|منزل)/.test(t)) {
      input.housing = { kind: 'purchase', amount: 30000 };
      note('housing', 'شراء أو بناء مسكن', 30000);
    }

    const don = amountAfter(t, /تبرع(?:ات)?(?:ه)?/);
    if (don) { input.donations = don.value; note('donations', 'التبرعات', don.value); }

    const loss = amountAfter(t, /خساره(?:\s+(?:مدوره|سابقه|مقبوله))*/);
    if (loss) { input.lossCarried = loss.value; note('loss', 'خسارة مدورة', loss.value); }

    input.exemptIncome = [];
    const ag = amountAfter(t, /(?:دخل|ربح|ارباح|انتاج)\s+(?:ال)?زراع/);
    if (ag) { input.exemptIncome.push({ label: 'دخل زراعي لشخص طبيعي', amount: ag.value, reason: 'معفى (المادة 7)' }); note('agri', 'دخل زراعي (معفى)', ag.value); }
    const sh = amountAfter(t, /(?:ربح|ارباح)\s+(?:بيع\s+)?(?:ال)?اسهم/);
    if (sh) { input.exemptIncome.push({ label: 'ربح بيع أسهم', amount: sh.value, reason: 'الأرباح الرأسمالية من بيع الأوراق المالية في محفظة استثمارية معفاة' }); note('shares', 'ربح أسهم (معفى)', sh.value); }
    const inh = amountAfter(t, /(?:ورث|ميراث|ارث)/);
    if (inh) { input.exemptIncome.push({ label: 'ميراث', amount: inh.value, reason: 'الإرث معفى، أما عائده السنوي فيخضع' }); note('inheritance', 'ميراث (معفى)', inh.value); }
    const dv = amountAfter(t, /(?:توزيعات|ارباح\s+موزعه|حصص\s+ارباح)/);
    if (dv) { input.dividends = dv.value; note('dividends', 'أرباح موزعة', dv.value); }

    const adv = amountAfter(t, /سلف(?:ه|ات)?(?:\s+(?:مدفوعه|مقدما))*/);
    if (adv) { input.advances = adv.value; note('advances', 'سلف مدفوعة', adv.value); }

    return { input, found };
  }

  return { parse, prep };
});
