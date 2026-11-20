/*
 * محرك الضريبة الفلسطيني (Palestine Tax Engine)
 * قواعد مأخوذة من كتاب «المحاسبة الضريبية وتطبيقاتها في فلسطين»، الفصول 1-4 و8.
 * قرار بقانون ضريبة الدخل رقم 8 لسنة 2011 وتعديلاته.
 * أداة تعليمية، وليست استشارة ضريبية.
 *
 * كل دالة ترجع { lines: [...], ...totals }، وكل سطر فيه:
 *   label  : وصف البند
 *   amount : المبلغ (موجب، والإشارة تُفهم من kind)
 *   kind   : income | exempt | deduction | total | tax | offset | info | rejected
 *   ref    : المادة القانونية أو مرجع الكتاب
 *   note   : شرح كيف حُسب البند
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaxEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = {
    brackets: [
      { upTo: 75000, rate: 0.05 },
      { upTo: 150000, rate: 0.10 },
      { upTo: Infinity, rate: 0.15 },
    ],
    residentExemption: 36000,
    universityPerStudent: 6000,
    universityMaxStudents: 2,
    housingPurchase: 30000,
    housingInterestCap: 4000,
    housingInterestYears: 10,
    transportPrivateRate: 0.10,
    endOfServiceMonthsPerYear: 1,
    endOfServiceMonthsPerYearUniversity: 2,
    donationsCap: 0.20,
    propertyTaxExpense: 0.40,
    propertyTaxOffset: 0.60,
    propertyTaxRate: 0.17,
    lossCarryYears: 5,
    corporateRate: 0.15,
    telecomRate: 0.20,
    lifeInsuranceRate: 0.05,
    dividendsWithholding: 0.10,
    nonResidentWithholding: 0.10,
    hospitalityRate: 0.01,
    hospitalityCap: 150000,
    hospitalityCapPublic: 300000,
    rndRate: 0.02,
    rndCap: 500000,
    trainingRate: 0.02,
    badDebtFloor: 500000,
    badDebtRate: 0.20,
    establishmentYears: 5,
    legalPersonAgriExempt: 300000,
    vatRate: 0.16,
  };

  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : Number(x) || 0);
  const fmt = (x) => {
    const v = r2(x);
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  /* ---------------- الشرائح ---------------- */

  /** ضريبة الشرائح على دخل خاضع، مع تفصيل كل شريحة. start = دخل سبق ودخل الشرائح (للإيجار المكمّل). */
  function bracketTax(taxable, start) {
    start = n(start);
    let remaining = Math.max(0, n(taxable));
    let pos = start;
    let lower = 0;
    let tax = 0;
    const steps = [];
    for (const b of RULES.brackets) {
      const top = b.upTo;
      if (pos < top && remaining > 0) {
        const room = top - Math.max(pos, lower);
        const take = Math.min(room, remaining);
        if (take > 0) {
          const t = take * b.rate;
          steps.push({ amount: r2(take), rate: b.rate, tax: r2(t) });
          tax += t;
          remaining -= take;
          pos += take;
        }
      }
      lower = top;
    }
    return { tax: r2(tax), steps };
  }

  function stepsText(steps) {
    return steps.map((s) => `${Math.round(s.rate * 100)}% × ${fmt(s.amount)} = ${fmt(s.tax)}`).join(' + ');
  }

  /** عكس الشرائح: من مبلغ ضريبة إلى الدخل الخاضع (مثل سؤال «الضريبة 13450، كم الدخل؟»). */
  function incomeFromTax(tax) {
    tax = n(tax);
    let lower = 0;
    let acc = 0;
    for (const b of RULES.brackets) {
      const full = (b.upTo - lower) * b.rate;
      if (tax <= acc + full || b.upTo === Infinity) {
        return r2(lower + (tax - acc) / b.rate);
      }
      acc += full;
      lower = b.upTo;
    }
    return 0;
  }

  /* ---------------- الشخص الطبيعي ---------------- */

  /**
   * input = {
   *   resident: true, year: 2024,
   *   jobs: [{ label, sector: 'private'|'public'|'university', monthlySalary, months,
   *            transportActual, transportAllowanceMonthly, pensionContrib, healthContrib, withheldMonthly }],
   *   endOfService: { amount, years, lastMonthlySalary, university },
   *   representation: { received, spent },
   *   pension,                       // راتب تقاعدي (معفى)
   *   business: number | { taxableGross, exemptGross, expenses: [...] },
   *   partnerships: [{ label, profit, share }],   // share كنسبة (0.5) أو حصة جاهزة amount
   *   rental: { gross, propertyTaxPaid },
   *   otherTaxable: [{ label, amount }],
   *   exemptIncome: [{ label, amount, reason }],
   *   dividends,                     // أرباح موزعة من شركة مساهمة (تقتطع 10% من المصدر)
   *   lossCarried, lossYearsAgo, lossFromExemptActivity,
   *   students, housing: { kind: 'interest'|'purchase', amount, startYear },
   *   donations, withheld, advances
   * }
   */
  function individual(input) {
    const I = input || {};
    const lines = [];
    const year = n(I.year) || new Date().getFullYear();
    const add = (o) => lines.push(o);

    // 1) الدخل
    let income = 0;
    let salaryTotal = 0;
    const jobs = I.jobs || [];
    jobs.forEach((j, idx) => {
      const months = j.months == null ? 12 : n(j.months);
      const s = n(j.monthlySalary) * months;
      salaryTotal += s;
      income += s;
      add({ kind: 'income', label: `راتب ${j.label || (jobs.length > 1 ? 'الوظيفة ' + (idx + 1) : '')}`.trim(), amount: s,
        note: `${fmt(n(j.monthlySalary))} × ${months} شهر`, ref: 'المادة 3: الرواتب والأجور' });
    });

    if (I.endOfService && n(I.endOfService.amount) > 0) {
      const e = I.endOfService;
      const mpy = e.university ? RULES.endOfServiceMonthsPerYearUniversity : RULES.endOfServiceMonthsPerYear;
      const exempt = Math.min(n(e.amount), mpy * n(e.years) * n(e.lastMonthlySalary));
      const taxable = n(e.amount) - exempt;
      income += taxable;
      add({ kind: 'income', label: 'مكافأة نهاية الخدمة (الجزء الخاضع)', amount: taxable,
        note: `المكافأة ${fmt(e.amount)}، المعفى ${mpy === 2 ? 'شهران' : 'شهر'} عن كل سنة: ${n(e.years)} × ${mpy === 2 ? '2 × ' : ''}${fmt(e.lastMonthlySalary)} = ${fmt(exempt)}`,
        ref: 'المادة 7: إعفاء مكافأة نهاية الخدمة' });
    }

    if (I.representation && n(I.representation.received) > 0) {
      const rcv = n(I.representation.received);
      const spent = Math.min(rcv, n(I.representation.spent));
      income += rcv - spent;
      add({ kind: 'income', label: 'بدل التمثيل أو السفر (غير المنفَق)', amount: rcv - spent,
        note: `المقبوض ${fmt(rcv)} والمنفَق فعلاً في سبيل الوظيفة ${fmt(spent)} معفى`, ref: 'المادة 7' });
    }

    if (n(I.pension) > 0) {
      add({ kind: 'exempt', label: 'الراتب التقاعدي', amount: n(I.pension), note: 'معفى كاملاً، لا يدخل الدخل', ref: 'المادة 7' });
    }

    let businessNet = 0;
    if (I.business != null) {
      if (typeof I.business === 'number' || typeof I.business === 'string') {
        businessNet = n(I.business);
        add({ kind: 'income', label: 'صافي دخل النشاط التجاري أو المهني', amount: businessNet, ref: 'المادة 3' });
      } else {
        const b = businessExpenses(I.business, { legalPerson: false });
        b.lines.forEach((l) => add(l));
        businessNet = b.netTaxable;
      }
      income += businessNet;
    }

    (I.partnerships || []).forEach((p) => {
      const amt = p.amount != null ? n(p.amount) : n(p.profit) * n(p.share);
      income += amt;
      add({ kind: 'income', label: `حصة في ${p.label || 'شركة تضامن أو توصية'}`, amount: amt,
        note: p.amount != null ? '' : `${fmt(p.profit)} × ${r2(n(p.share) * 100)}%`,
        ref: 'شركات الأشخاص: يُوزَّع الربح ويُحاسب كل شريك كشخص طبيعي' });
    });

    let rentalNet = 0;
    let propTax = 0;
    if (I.rental && n(I.rental.gross) > 0) {
      propTax = n(I.rental.propertyTaxPaid);
      const exp = propTax * RULES.propertyTaxExpense;
      rentalNet = n(I.rental.gross) - exp;
      income += rentalNet;
      add({ kind: 'income', label: 'صافي دخل العقارات المؤجرة', amount: rentalNet,
        note: propTax ? `الإيجار ${fmt(I.rental.gross)} − 40% من ضريبة الأملاك (${fmt(propTax)} × 40% = ${fmt(exp)})` : '',
        ref: 'المادة 13: 40% من ضريبة الأملاك مصروف' });
    }

    (I.otherTaxable || []).forEach((o) => {
      income += n(o.amount);
      add({ kind: 'income', label: o.label || 'دخل آخر خاضع', amount: n(o.amount), ref: o.ref || 'المادة 3' });
    });

    (I.exemptIncome || []).forEach((o) => {
      add({ kind: 'exempt', label: o.label, amount: n(o.amount), note: o.reason || 'دخل معفى لا يُضاف', ref: o.ref || 'المادة 7' });
    });

    if (n(I.dividends) > 0) {
      add({ kind: 'info', label: 'أرباح موزعة من شركة مساهمة', amount: n(I.dividends),
        note: `لا تُضاف للدخل، وتُقتطع منها 10% عند المصدر = ${fmt(n(I.dividends) * RULES.dividendsWithholding)}`, ref: 'المادة 16: الاقتطاع من المصدر' });
    }

    add({ kind: 'total', label: 'إجمالي الدخل الخاضع قبل الخسائر والإعفاءات', amount: income });

    // 2) الخسارة المدورة
    let afterLoss = income;
    if (n(I.lossCarried) > 0) {
      if (I.lossFromExemptActivity) {
        add({ kind: 'rejected', label: 'خسارة سابقة', amount: n(I.lossCarried), note: 'خسارة نشاط معفى أو فترة إعفاء لا تُدوَّر', ref: 'المادة 10' });
      } else if (n(I.lossYearsAgo) > RULES.lossCarryYears) {
        add({ kind: 'rejected', label: 'خسارة سابقة', amount: n(I.lossCarried), note: 'مضى عليها أكثر من 5 فترات ضريبية فسقطت', ref: 'المادة 10' });
      } else {
        const used = Math.min(n(I.lossCarried), Math.max(0, income));
        afterLoss -= used;
        add({ kind: 'deduction', label: 'الخسارة المدورة', amount: used, note: used < n(I.lossCarried) ? `يُدوَّر الباقي ${fmt(n(I.lossCarried) - used)}` : '', ref: 'المادة 10' });
      }
    }

    // 3) الإعفاءات
    let ex = 0;
    const exLine = (label, amount, note, ref) => {
      if (amount <= 0) return;
      ex += amount;
      add({ kind: 'deduction', label, amount, note, ref });
    };
    if (I.resident !== false) exLine('إعفاء المقيم', RULES.residentExemption, 'مرة واحدة على مصدر دخل واحد', 'المادة 11');
    jobs.forEach((j, idx) => {
      const months = j.months == null ? 12 : n(j.months);
      const sal = n(j.monthlySalary) * months;
      const tag = jobs.length > 1 ? ` (${j.label || 'الوظيفة ' + (idx + 1)})` : '';
      if (j.sector === 'public' && n(j.transportAllowanceMonthly) > 0) {
        const a = n(j.transportAllowanceMonthly) * months;
        exLine('بدل مواصلات القطاع العام' + tag, a, `بدل ثابت ${fmt(j.transportAllowanceMonthly)} × ${months} معفى كاملاً`, 'المادة 11: المواصلات');
      } else if (n(j.transportActual) > 0) {
        const cap = sal * RULES.transportPrivateRate;
        const a = Math.min(n(j.transportActual), cap);
        exLine('مواصلات' + tag, a, `الأقل بين الفعلي ${fmt(j.transportActual)} و10% من الراتب ${fmt(cap)}`, 'المادة 11: المواصلات');
      }
      if (n(j.pensionContrib) > 0) exLine('مساهمة صندوق التقاعد' + tag, n(j.pensionContrib), '', 'المادة 11');
      if (n(j.healthContrib) > 0) exLine('مساهمة التأمين الصحي' + tag, n(j.healthContrib), '', 'المادة 11');
    });
    if (n(I.students) > 0) {
      const k = Math.min(n(I.students), RULES.universityMaxStudents);
      exLine('الإعفاء الجامعي', k * RULES.universityPerStudent, `${k} × 6000${n(I.students) > 2 ? ' (الحد طالبان)' : ''}`, 'المادة 11');
    }
    if (I.housing && n(I.housing.amount) > 0) {
      const h = I.housing;
      if (h.kind === 'purchase') {
        exLine('إعفاء شراء أو بناء مسكن', Math.min(n(h.amount), RULES.housingPurchase), 'مرة واحدة، بحد 30000', 'المادة 11');
      } else {
        const yearsUsed = h.startYear ? year - n(h.startYear) + 1 : 1;
        if (yearsUsed > RULES.housingInterestYears) {
          add({ kind: 'rejected', label: 'فوائد قرض السكن', amount: n(h.amount),
            note: `الإعفاء لمدة أقصاها 10 سنوات، و${year} هي السنة رقم ${yearsUsed} منذ ${h.startYear}`, ref: 'المادة 11' });
        } else {
          exLine('فوائد قرض السكن', Math.min(n(h.amount), RULES.housingInterestCap), `الأقل بين الفعلي ${fmt(h.amount)} و4000 سنوياً`, 'المادة 11');
        }
      }
    }
    add({ kind: 'total', label: 'مجموع الإعفاءات', amount: ex });

    const afterEx = Math.max(0, afterLoss - ex);
    add({ kind: 'total', label: 'الدخل بعد الإعفاءات', amount: afterEx });

    // 4) التبرعات
    let taxable = afterEx;
    if (n(I.donations) > 0) {
      const cap = afterEx * RULES.donationsCap;
      const d = Math.min(n(I.donations), cap);
      taxable -= d;
      add({ kind: 'deduction', label: 'التبرعات', amount: d, note: `الأقل بين الفعلي ${fmt(I.donations)} و20% × ${fmt(afterEx)} = ${fmt(cap)}`, ref: 'المادة 9' });
    }
    taxable = r2(Math.max(0, taxable));
    add({ kind: 'total', label: 'الدخل الخاضع للضريبة', amount: taxable });

    // 5) الضريبة
    const bt = bracketTax(taxable);
    add({ kind: 'tax', label: 'ضريبة الدخل المستحقة', amount: bt.tax, note: stepsText(bt.steps) || 'لا ضريبة', ref: 'المادة 16: الشرائح 5% و10% و15%' });

    // 6) التقاص
    let offsets = 0;
    let rentalTax = 0;
    if (rentalNet > 0) {
      const without = Math.max(0, taxable - rentalNet);
      rentalTax = r2(bt.tax - bracketTax(without).tax);
      const rt = bracketTax(taxable - without, without);
      add({ kind: 'info', label: 'منها ضريبة دخل الإيجار', amount: rentalTax, note: `تكملة للشرائح بعد بقية الدخل: ${stepsText(rt.steps)}`, ref: 'المادة 13' });
      if (propTax > 0) {
        const possible = propTax * RULES.propertyTaxOffset;
        const off = Math.min(possible, rentalTax);
        offsets += off;
        add({ kind: 'offset', label: 'تقاص ضريبة الأملاك', amount: off,
          note: off < possible ? `60% × ${fmt(propTax)} = ${fmt(possible)} لكنه يُحدّ بضريبة الإيجار ${fmt(rentalTax)}` : `60% × ${fmt(propTax)}`, ref: 'المادة 13' });
      }
    }
    let withheld = n(I.withheld);
    jobs.forEach((j) => { withheld += n(j.withheldMonthly) * (j.months == null ? 12 : n(j.months)); });
    if (withheld > 0) { offsets += withheld; add({ kind: 'offset', label: 'الضريبة المقتطعة من الراتب', amount: withheld, ref: 'التقاص' }); }
    if (n(I.advances) > 0) { offsets += n(I.advances); add({ kind: 'offset', label: 'السلف المدفوعة مقدماً', amount: n(I.advances), ref: 'التقاص' }); }

    const payable = r2(bt.tax - offsets);
    add({ kind: 'total', label: payable >= 0 ? 'الضريبة الواجبة الدفع' : 'ضريبة مستردة للمكلف', amount: Math.abs(payable) });

    return { lines, income: r2(income), exemptions: r2(ex), taxable, tax: bt.tax, rentalTax, offsets: r2(offsets), payable,
      effectiveRate: income > 0 ? r2((bt.tax / income) * 100) : 0 };
  }

  /* ---------------- المصاريف ---------------- */

  const EXPENSE_TYPES = {
    salaries: 'رواتب وأجور', depreciation: 'استهلاك', admin: 'مصاريف إدارية', selling: 'مصاريف بيع وتسويق',
    rent: 'إيجار', interest: 'فوائد قروض العمل', hospitality: 'ضيافة', rnd: 'بحث وتطوير', standards: 'تبنّي المواصفات والمعايير',
    exportMarkets: 'استطلاع أسواق التصدير', establishment: 'مصاريف التأسيس أو الخلو أو الشهرة', training: 'تدريب',
    badDebts: 'ديون معدومة', provision: 'مخصص ديون مشكوك فيها', fines: 'غرامات', incomeTax: 'ضريبة الدخل المدفوعة',
    revaluationLoss: 'خسارة إعادة تقييم الأصول', ownerSalary: 'راتب صاحب المنشأة أو الشريك', personal: 'مصاريف شخصية',
    employerPension: 'مساهمة صاحب العمل في التقاعد والتأمين', general: 'مصروف عام', other: 'مصروف آخر',
  };

  const REJECTED = {
    provision: 'المخصصات تقديرية وليست مصروفاً متحققاً',
    fines: 'الغرامات والعقوبات غير مقبولة',
    incomeTax: 'ضريبة الدخل نفسها ليست مصروفاً مقبولاً',
    revaluationLoss: 'خسائر إعادة التقييم غير محققة',
    ownerSalary: 'سحب من الربح وليس أجراً',
    personal: 'لا علاقة له بإنتاج الدخل',
  };

  /**
   * تقييم المصاريف قبل الدخل الصافي المعدل.
   * opts.legalPerson: الشركات (التدريب والديون تُطرح بعد الصافي)، opts.publicCompany: حد الضيافة 300000.
   */
  function evaluateExpenses(expenses, grossTotal, opts) {
    opts = opts || {};
    const lines = [];
    let accepted = 0;
    const later = [];
    (expenses || []).forEach((e) => {
      const t = e.type || 'general';
      const amt = n(e.amount);
      const name = e.label || EXPENSE_TYPES[t] || t;
      let ok = amt;
      let note = '';
      if (REJECTED[t]) {
        lines.push({ kind: 'rejected', label: name, amount: amt, note: REJECTED[t], ref: 'المادة 9: مصاريف غير مقبولة' });
        return;
      }
      if (opts.legalPerson && (t === 'training' || t === 'badDebts')) { later.push(e); return; }
      switch (t) {
        case 'salaries': {
          const bad = n(e.withoutWithholding);
          ok = amt - bad;
          if (bad) note = `يُرفض ${fmt(bad)} لم يُقتطع عنه ضريبة`;
          break;
        }
        case 'rent': {
          const bad = n(e.priorYear) + n(e.prepaid);
          ok = amt - bad;
          if (bad) note = `يُستبعد ${fmt(bad)} يخص سنة أخرى`;
          break;
        }
        case 'hospitality': {
          const cap = Math.min(grossTotal * RULES.hospitalityRate, opts.publicCompany ? RULES.hospitalityCapPublic : RULES.hospitalityCap);
          ok = Math.min(amt, cap);
          note = `الحد: الأقل بين 1% × ${fmt(grossTotal)} و${opts.publicCompany ? '300000' : '150000'} = ${fmt(cap)}`;
          break;
        }
        case 'rnd': case 'standards': case 'exportMarkets': {
          const cap = Math.min(grossTotal * RULES.rndRate, RULES.rndCap);
          ok = Math.min(amt, cap);
          note = `الحد: الأقل بين 2% × ${fmt(grossTotal)} و500000 = ${fmt(cap)}`;
          break;
        }
        case 'establishment': {
          const total = n(e.total) || amt;
          ok = Math.min(amt, total / RULES.establishmentYears);
          note = `تُوزَّع ${fmt(total)} على 5 سنوات = ${fmt(total / 5)} سنوياً`;
          break;
        }
        case 'badDebts': { // للأفراد: الجزء المثبت فقط
          const ratio = e.provenRatio == null ? 1 : n(e.provenRatio);
          ok = amt * ratio;
          if (ratio < 1) note = `يُقبل المثبت فقط ${r2(ratio * 100)}%`;
          break;
        }
        default: break;
      }
      ok = Math.max(0, ok);
      accepted += ok;
      lines.push({ kind: ok < amt ? 'partial' : 'deduction', label: name, amount: ok, claimed: amt, note, ref: 'المادة 8' });
    });
    return { lines, accepted: r2(accepted), later };
  }

  /** نشاط تجاري لفرد مع مصاريف مختلطة بين خاضع ومعفى (زراعي). */
  function businessExpenses(b, opts) {
    const lines = [];
    const tg = n(b.taxableGross);
    const eg = n(b.exemptGross);
    const total = tg + eg;
    const ev = evaluateExpenses(b.expenses, total, opts);
    lines.push({ kind: 'income', label: 'مجمل الربح الخاضع', amount: tg, ref: 'المادة 3' });
    if (eg) lines.push({ kind: 'exempt', label: b.exemptLabel || 'مجمل الربح المعفى (زراعي)', amount: eg, ref: 'المادة 7' });
    ev.lines.forEach((l) => lines.push(Object.assign({}, l, { label: 'مصروف: ' + l.label, kind: l.kind === 'rejected' ? 'rejected' : 'info' })));
    let share = ev.accepted;
    if (eg > 0 && total > 0) {
      share = ev.accepted * (tg / total);
      lines.push({ kind: 'info', label: 'توزيع المصاريف المختلطة', amount: r2(ev.accepted - share),
        note: `نصيب المعفى = ${fmt(eg)} ÷ ${fmt(total)} × ${fmt(ev.accepted)}، فيبقى للخاضع ${fmt(share)}`, ref: 'المصاريف المختلطة' });
    }
    lines.push({ kind: 'deduction', label: 'المصاريف المقبولة للنشاط الخاضع', amount: r2(share), ref: 'المادة 8' });
    return { lines, netTaxable: r2(tg - share) };
  }

  /* ---------------- الشركات ---------------- */

  /**
   * input = { companyType: 'private'|'public'|'telecom', grossProfit, agriculturalGross,
   *           expenses: [...], lossCarried, lossYearsAgo, lossFromExemptPeriod, donations, advances, exemptIncome: [] }
   */
  function company(input) {
    const C = input || {};
    const lines = [];
    const add = (o) => lines.push(o);
    const gross = n(C.grossProfit);
    const agri = n(C.agriculturalGross);
    const agriExempt = Math.min(agri, RULES.legalPersonAgriExempt);
    const total = gross + agri;
    add({ kind: 'income', label: 'مجمل الربح', amount: gross, ref: 'المادة 3' });
    if (agri) {
      add({ kind: 'income', label: 'دخل زراعي', amount: agri, note: `للشخص المعنوي يُعفى أول 300000، فالمعفى ${fmt(agriExempt)}`, ref: 'المادة 7' });
      add({ kind: 'exempt', label: 'المعفى من الدخل الزراعي', amount: agriExempt, ref: 'المادة 7' });
    }
    (C.exemptIncome || []).forEach((o) => add({ kind: 'exempt', label: o.label, amount: n(o.amount), note: o.reason, ref: o.ref || 'المادة 7' }));

    const ev = evaluateExpenses(C.expenses, total, { legalPerson: true, publicCompany: C.companyType === 'public' });
    ev.lines.forEach((l) => add(l));
    let accepted = ev.accepted;
    if (agriExempt > 0 && total > 0) {
      const ex = accepted * (agriExempt / total);
      accepted -= ex;
      add({ kind: 'info', label: 'نصيب الدخل المعفى من المصاريف', amount: r2(ex), note: `${fmt(agriExempt)} ÷ ${fmt(total)} × المصاريف المقبولة`, ref: 'المصاريف المختلطة' });
    }
    add({ kind: 'total', label: 'مجموع المصاريف المقبولة', amount: r2(accepted) });
    const net = r2(total - agriExempt - accepted);
    add({ kind: 'total', label: 'الدخل الصافي المعدل', amount: net });

    let x = net;
    ev.later.forEach((e) => {
      const amt = n(e.amount);
      if (e.type === 'training') {
        const cap = net * RULES.trainingRate;
        const ok = Math.min(amt, cap);
        x -= ok;
        add({ kind: ok < amt ? 'partial' : 'deduction', label: 'التدريب', amount: ok, claimed: amt, note: `الحد 2% × ${fmt(net)} = ${fmt(cap)}`, ref: 'المادة 8' });
      } else {
        const proven = amt * (e.provenRatio == null ? 1 : n(e.provenRatio));
        const cap = Math.max(RULES.badDebtFloor, net * RULES.badDebtRate);
        const ok = Math.min(proven, cap);
        x -= ok;
        add({ kind: ok < amt ? 'partial' : 'deduction', label: 'الديون المعدومة', amount: ok, claimed: amt, note: `الحد: الأكثر بين 500000 و20% × ${fmt(net)} = ${fmt(cap)}`, ref: 'المادة 8' });
      }
    });

    if (n(C.lossCarried) > 0) {
      if (C.lossFromExemptPeriod) {
        add({ kind: 'rejected', label: 'الخسارة المدورة', amount: n(C.lossCarried), note: 'تحققت في فترة إعفاء (تشجيع الاستثمار)، فلا تُدوَّر', ref: 'المادة 10' });
      } else if (n(C.lossYearsAgo) > RULES.lossCarryYears) {
        add({ kind: 'rejected', label: 'الخسارة المدورة', amount: n(C.lossCarried), note: 'مضى عليها أكثر من 5 فترات', ref: 'المادة 10' });
      } else {
        const used = Math.min(n(C.lossCarried), Math.max(0, x));
        x -= used;
        add({ kind: 'deduction', label: 'الخسارة المدورة', amount: used, ref: 'المادة 10' });
      }
    }
    x = Math.max(0, x);
    add({ kind: 'total', label: 'الدخل قبل التبرعات', amount: r2(x) });
    if (n(C.donations) > 0) {
      const cap = x * RULES.donationsCap;
      const d = Math.min(n(C.donations), cap);
      x -= d;
      add({ kind: d < n(C.donations) ? 'partial' : 'deduction', label: 'التبرعات', amount: d, claimed: n(C.donations), note: `الحد 20% × ${fmt(x + d)} = ${fmt(cap)}`, ref: 'المادة 9' });
    }
    const taxable = r2(Math.max(0, x));
    add({ kind: 'total', label: 'الدخل الخاضع للضريبة', amount: taxable });
    const rate = C.companyType === 'telecom' ? RULES.telecomRate : RULES.corporateRate;
    const tax = r2(taxable * rate);
    add({ kind: 'tax', label: 'ضريبة الدخل', amount: tax, note: `${Math.round(rate * 100)}% × ${fmt(taxable)}`, ref: rate === 0.2 ? 'المادة 16: شركات الاتصالات والاحتكار 20%' : 'المادة 16: الشخص المعنوي 15%' });
    let payable = tax;
    if (n(C.advances) > 0) { payable -= n(C.advances); add({ kind: 'offset', label: 'السلف المدفوعة', amount: n(C.advances), ref: 'التقاص' }); }
    payable = r2(payable);
    add({ kind: 'total', label: payable >= 0 ? 'الضريبة الواجبة الدفع' : 'ضريبة مستردة', amount: Math.abs(payable) });
    return { lines, netAdjusted: net, taxable, tax, payable, rate };
  }

  /** شركة تأمين على الحياة: 5% من أقساط الحياة + 15% من صافي دخل الاستثمار. */
  function lifeInsurer(input) {
    const p = n(input.lifePremiums), inv = n(input.investmentIncome);
    const a = p * RULES.lifeInsuranceRate, b = inv * RULES.corporateRate;
    return { tax: r2(a + b), lines: [
      { kind: 'tax', label: 'أقساط التأمين على الحياة', amount: r2(a), note: `5% × ${fmt(p)}`, ref: 'المادة 16' },
      { kind: 'tax', label: 'دخل الاستثمار', amount: r2(b), note: `15% × ${fmt(inv)}`, ref: 'المادة 16' },
      { kind: 'total', label: 'مجموع الضريبة', amount: r2(a + b) } ] };
  }

  /** الاقتطاع من المصدر. */
  function withholding(kind, amount) {
    const rate = kind === 'nonResident' ? RULES.nonResidentWithholding : RULES.dividendsWithholding;
    return { rate, tax: r2(n(amount) * rate) };
  }

  /* ---------------- ضريبة القيمة المضافة والجمارك (الفصل 8) ---------------- */

  /**
   * عمليات شهر واحد. op = { type, amount, inclusive, label }
   * type: purchase | asset | expense | purchaseReturn | sale | saleReturn | discountGiven | discountReceived | export | exempt | noInvoice
   */
  function vatPeriod(ops, rate) {
    rate = rate == null ? RULES.vatRate : n(rate);
    const lines = [];
    const entries = [];
    let out16 = 0, out0 = 0, outTax = 0, inTax = 0, exemptSales = 0;
    (ops || []).forEach((o, i) => {
      const amt = n(o.amount);
      const zero = o.type === 'export';
      const net = o.inclusive && !zero ? amt / (1 + rate) : amt;
      const vat = zero || o.type === 'noInvoice' || o.type === 'exempt' ? 0 : net * rate;
      const N = r2(net), V = r2(vat), G = r2(net + vat);
      const L = o.label || '';
      const e = { no: i + 1, label: L, debit: [], credit: [] };
      const isInput = o.type === 'purchase' || o.type === 'asset' || o.type === 'expense';
      if (isInput && (n(o.ageMonths) > 6 || o.forExempt)) {
        // مدخلات لا تُخصم: فاتورة عمرها أكثر من 6 شهور، أو مدخلات تخص صفقات معفاة (ص 278، 283، 310-311)
        e.debit.push([o.type === 'asset' ? (o.account || 'الأصول الثابتة') : o.type === 'expense' ? (o.account || 'المصروفات') : 'المشتريات', G]);
        e.credit.push(['الدائنون', G]);
        e.note = n(o.ageMonths) > 6 ? 'عمر الفاتورة أكثر من 6 شهور، فلا تُخصم ضريبتها وتُحمّل على الكلفة' : 'مدخلات تخص صفقات معفاة، فلا تُخصم ضريبتها';
        e.rejectedVat = V;
        entries.push(e);
        return;
      }
      switch (o.type) {
        case 'purchase': inTax += vat; e.debit.push(['المشتريات', N], ['ض.ق.م المدخلات', V]); e.credit.push(['الدائنون', G]); break;
        case 'asset': inTax += vat; e.debit.push([o.account || 'الأصول الثابتة (آلات)', N], ['ض.ق.م المدخلات', V]); e.credit.push(['الدائنون', G]); break;
        case 'expense': inTax += vat; e.debit.push([o.account || 'المصروفات', N], ['ض.ق.م المدخلات', V]); e.credit.push(['الدائنون', G]); break;
        case 'purchaseReturn': inTax -= vat; e.debit.push(['الدائنون', G]); e.credit.push(['مردودات المشتريات', N], ['ض.ق.م المدخلات', V]); break;
        case 'discountReceived': inTax -= vat; e.debit.push(['الدائنون', G]); e.credit.push(['خصم مكتسب', N], ['ض.ق.م المدخلات', V]); break;
        case 'sale': out16 += net; outTax += vat; e.debit.push(['المدينون', G]); e.credit.push(['المبيعات', N], ['ض.ق.م المخرجات', V]); break;
        case 'saleReturn': out16 -= net; outTax -= vat; e.debit.push(['مردودات المبيعات', N], ['ض.ق.م المخرجات', V]); e.credit.push(['المدينون', G]); break;
        case 'discountGiven': out16 -= net; outTax -= vat; e.debit.push(['خصم مسموح به', N], ['ض.ق.م المخرجات', V]); e.credit.push(['المدينون', G]); break;
        case 'export': out0 += net; e.debit.push(['المدينون', N]); e.credit.push(['المبيعات (تصدير بنسبة صفر)', N]); break;
        case 'exempt': exemptSales += net; e.debit.push(['المدينون', N]); e.credit.push(['مبيعات معفاة', N]); break;
        case 'noInvoice': e.debit.push([o.account || 'المشتريات', r2(amt)]); e.credit.push(['الدائنون', r2(amt)]); e.note = 'بدون فاتورة ضريبية، فلا تُقاصّ ضريبتها'; break;
        default: break;
      }
      if (o.cash) { const side = e.credit.find((c) => c[0] === 'الدائنون') || e.debit.find((d) => d[0] === 'المدينون'); if (side) side[0] = 'الصندوق'; }
      entries.push(e);
    });
    const res = {
      entries,
      sales16: r2(out16), sales0: r2(out0), exemptSales: r2(exemptSales),
      outputVat: r2(outTax), inputVat: r2(inTax), balance: r2(outTax - inTax),
    };
    lines.push({ kind: 'total', label: 'صافي قيمة الصفقات بنسبة 16%', amount: res.sales16 });
    lines.push({ kind: 'total', label: 'صافي قيمة الصفقات بنسبة 0%', amount: res.sales0 });
    if (exemptSales) lines.push({ kind: 'total', label: 'صفقات معفاة', amount: res.exemptSales });
    lines.push({ kind: 'tax', label: 'صافي ضريبة الصفقات (المخرجات)', amount: res.outputVat });
    lines.push({ kind: 'offset', label: 'صافي ضريبة المدخلات', amount: res.inputVat });
    lines.push({ kind: 'total', label: res.balance >= 0 ? 'رصيد الضريبة للدفع' : 'رصيد الضريبة للإرجاع', amount: Math.abs(res.balance) });
    res.lines = lines;
    return res;
  }

  /**
   * الاستيراد (الفصل 8، 7-3 وص 302-308):
   * { goods, foreignAmount, exchangeRate, freight, insurance, portCosts, localCosts,
   *   customsRate, customsPerUnit, units, customsMinPerUnit,
   *   upliftRate (تعلية السعر), protectionRate (الدفعات الإلزامية/الحماية) أو protectionAmount,
   *   purchaseRate, vatRate }
   * سعر الاستيراد (CIF) = سعر البضاعة في الخارج + الشحن + التأمين + مصاريف ميناء التفريغ.
   * الجمارك على سعر الاستيراد، ثم ضريبة الشراء على (الاستيراد + الجمارك + التعلية + الدفعات الإلزامية)،
   * ثم ض.ق.م على (الاستيراد + الجمارك + التعلية + الدفعات الإلزامية + ضريبة الشراء).
   * النقل الداخلي من الميناء إلى المخازن لا يدخل في أي من الأوعية.
   */
  function importDuties(input) {
    const I = input || {};
    const lines = [];
    let goods = n(I.goods);
    if (!goods && n(I.foreignAmount)) goods = n(I.foreignAmount) * (n(I.exchangeRate) || 1);
    const fr = n(I.freight), ins = n(I.insurance), port = n(I.portCosts), local = n(I.localCosts);
    const units = n(I.units);
    const vr = I.vatRate == null ? RULES.vatRate : n(I.vatRate);
    const cv = goods + fr + ins + port;
    const parts = [`البضاعة ${fmt(goods)}`];
    if (I.foreignAmount && !I.goods) parts[0] = `البضاعة ${fmt(I.foreignAmount)} × سعر الصرف ${I.exchangeRate} = ${fmt(goods)}`;
    if (fr) parts.push(`الشحن ${fmt(fr)}`);
    if (ins) parts.push(`التأمين ${fmt(ins)}`);
    if (port) parts.push(`مصاريف الميناء ${fmt(port)}`);
    lines.push({ kind: 'income', label: 'سعر الاستيراد (CIF)', amount: r2(cv), note: parts.join(' + '), ref: 'الفصل 8: 7-3 احتساب ضريبة الجمارك' });

    // الجمارك: نسبية، نوعية، مركبة، أو نسبية بحد أدنى للوحدة
    const pct = cv * n(I.customsRate);
    const specific = n(I.customsPerUnit) * units;
    let customs = pct + specific;
    let cnote = [];
    if (n(I.customsRate)) cnote.push(`نسبي ${r2(n(I.customsRate) * 100)}% × ${fmt(cv)} = ${fmt(pct)}`);
    if (specific) cnote.push(`نوعي ${n(I.customsPerUnit)} × ${fmt(units)} وحدة = ${fmt(specific)}`);
    if (n(I.customsMinPerUnit) && units) {
      const floor = n(I.customsMinPerUnit) * units;
      if (floor > customs) { cnote.push(`أقل من الحد الأدنى ${I.customsMinPerUnit} للوحدة، فيُؤخذ ${fmt(floor)}`); customs = floor; }
    }
    lines.push({ kind: 'tax', label: 'الرسوم الجمركية', amount: r2(customs), note: cnote.join(' + ') || 'معفاة أو نسبة صفر', ref: 'قانون الجمارك والمكوس رقم 1 لسنة 1962' });

    const uplift = n(I.upliftRate) * (cv + customs);
    if (uplift) lines.push({ kind: 'info', label: 'تعلية السعر', amount: r2(uplift), note: `${r2(n(I.upliftRate) * 100)}% × (${fmt(cv)} + ${fmt(customs)}): ترفع وعاء ضريبة الشراء ولا تظهر في البيان الجمركي`, ref: 'الفصل 8: ص 302' });
    const protection = I.protectionAmount != null ? n(I.protectionAmount) : n(I.protectionRate) * cv;
    if (protection) lines.push({ kind: 'tax', label: 'الدفعات الإلزامية (الحماية)', amount: r2(protection), note: I.protectionAmount != null ? '' : `${r2(n(I.protectionRate) * 100)}% × ${fmt(cv)}`, ref: 'الفصل 8: ص 305' });

    const pBase = cv + customs + uplift + protection;
    const purchase = pBase * n(I.purchaseRate);
    lines.push({ kind: 'tax', label: 'ضريبة الشراء', amount: r2(purchase), note: `${r2(n(I.purchaseRate) * 100)}% × ${fmt(pBase)}`, ref: 'الفصل 8: كيفية احتساب ضريبة الشراء' });

    const vatBase = pBase + purchase;
    const vat = vatBase * vr;
    lines.push({ kind: 'tax', label: 'ضريبة القيمة المضافة', amount: r2(vat), note: `${r2(vr * 100)}% × ${fmt(vatBase)}`, ref: 'الفصل 8: 7-3' });
    if (local) lines.push({ kind: 'info', label: 'النقل الداخلي من الميناء للمخازن', amount: local, note: 'لا يدخل في سعر الاستيراد ولا في وعاء الضرائب، ويُضاف لكلفة البضاعة فقط', ref: 'الفصل 8' });
    const totalTaxes = customs + protection + purchase + vat;
    lines.push({ kind: 'total', label: 'مجموع الضرائب المستحقة', amount: r2(totalTaxes) });
    lines.push({ kind: 'total', label: 'ثمن البضاعة شاملاً جميع الضرائب', amount: r2(vatBase + vat) });
    return { lines, customsValue: r2(cv), customs: r2(customs), uplift: r2(uplift), protection: r2(protection), purchaseTax: r2(purchase),
      vatBase: r2(vatBase), vat: r2(vat), totalTaxes: r2(totalTaxes), total: r2(vatBase + vat) };
  }

  /** تصنيف المكلف في ض.ق.م حسب حصيلة صفقاته السنوية (ص 272-273). */
  function vatTaxpayerClass(annualTurnover, freeProfession) {
    const t = n(annualTurnover);
    if (freeProfession || t >= 185000) return { kind: 'licensed', label: 'مشتغل مرخص', note: 'يصدر فاتورة ضريبية ويخصم المدخلات. المهن الحرة مرخصة دائماً بلا حد أدنى', ref: 'الفصل 8: التكليف' };
    if (t >= 44200) return { kind: 'small', label: 'مشتغل صغير', note: 'بين 44,200 و185,000: يصدر فاتورة صفقة لا فاتورة ضريبية، ويخصم مدخلاته من ضريبة صفقاته، ولا يسترد الرصيد نقداً', ref: 'المادة 32 بند 3' };
    return { kind: 'exempt', label: 'مشتغل معفى', note: 'أقل من 44,200: يقدم الكشف الدوري ولا يدفع ضريبة', ref: 'الفصل 8: التكليف' };
  }

  /* تصنيف الصفقات كما ورد في الكتاب (ص 276-277). */
  const VAT_CLASSES = [
    // نسبة صفر
    { status: 'zero', title: 'تصدير البضائع', keys: ['تصدير', 'صادرات', 'بيعت في الاردن', 'مبيعات للخارج'] },
    { status: 'zero', title: 'مبيعات غير ملموسة لأشخاص يقيمون خارج المنطقة', keys: ['غير ملموسه', 'برامج كمبيوتر', 'الشهره لغير مقيم'] },
    { status: 'zero', title: 'مبيعات خدمات لأشخاص يقيمون في الخارج', keys: ['خدمات لاشخاص يقيمون في الخارج', 'خدمات لمقيم في الخارج', 'خدمات لغير مقيم', 'يقيمون في الخارج'] },
    { status: 'zero', title: 'بضائع وخدمات الفنادق للسائحين', keys: ['الفنادق للسائحين', 'فندق للسائحين', 'سائحين', 'سياح', 'سيارات سياحيه'] },
    { status: 'zero', title: 'صفقات تجارية تتم خارج البلاد للمكلف المسجل', keys: ['خارج البلاد'] },
    { status: 'zero', title: 'صفقات تجارية مباعة لغير المقيم', keys: ['لغير المقيم', 'لغير مقيم'] },
    { status: 'zero', title: 'مبيعات الخضار والفواكه', keys: ['خضار', 'خضروات', 'فواكه', 'فاكهه'] },
    { status: 'zero', title: 'خدمات النقل الخارجي لدولة أخرى', keys: ['نقل خارجي', 'النقل الخارجي', 'نقل لدوله اخري'] },
    { status: 'zero', title: 'مبيعات شركة مساهمة لشركة عادية تملك فيها أكثر من 90%', keys: ['90%', 'شركه مساهمه الي شركه عاديه'] },
    { status: 'zero', title: 'بيع كل ممتلكات شراكة عند فضها لأحد الشركاء', keys: ['فض الشركه', 'فض الشراكه', 'ممتلكات شراكه'] },
    { status: 'zero', title: 'فرق العملة عند تبديل العملات', keys: ['فرق العمله', 'تبديل العملات', 'صرافه'] },
    { status: 'zero', title: 'تحويل عملة للخارج', keys: ['تحويل عمله للخارج', 'تحويلات عمله', 'حواله للخارج', 'تحويل للخارج'] },
    // معفاة
    { status: 'exempt', title: 'تأجير السكن لمدة لا تزيد عن 10 سنوات (عدا الفنادق)', keys: ['تاجير سكن', 'ايجار سكن', 'تاجير شقه', 'ايجار شقه', 'ايجار بيت', 'تاجير بيت'] },
    { status: 'exempt', title: 'تأجير بيوت محمية بنظام الخلو أو المفتاحية', keys: ['تاجير بيوت محميه', 'بيوت محميه'] },
    { status: 'exempt', title: 'بيع أرض مستأجرة محمية بنظام الخلو أو المفتاحية', keys: ['ارض مستاجره', 'اراضي مستاجره', 'محميه بموجب نظام الخلو', 'الخلو', 'المفتاحيه'] },
    { status: 'exempt', title: 'صفقات المشتغل الصغير التي لا تزيد عن 12000 دولار', keys: ['مشتغل صغير'] },
    { status: 'exempt', title: 'بيع ممتلكات اشتُريت قبل وجود نصوص تشريعية بشأنها', keys: ['قبل وجود نصوص'] },
    { status: 'exempt', title: 'إيداع أو اقتراض أموال من البنوك', keys: ['ايداع', 'اقتراض', 'قرض من البنك', 'ودائع'] },
    { status: 'exempt', title: 'صفقات الماس (عدا الماس الصناعي)', keys: ['الماس', 'الالماس', 'ماس'] },
    // 16% (استثناءات من الإعفاء أو ما لم يرد فيه نص)
    { status: 'standard', title: 'الماس الصناعي (مستثنى من الإعفاء، فيخضع 16%)', keys: ['الماس الصناعي', 'ماس صناعي'] },
    { status: 'standard', title: 'تأجير لأغراض الضيافة في الفندق (مستثنى من إعفاء السكن)', keys: ['ضيافه في الفندق', 'غرف فندق'] },
    { status: 'standard', title: 'تأجير محل أو عقار تجاري (ليس سكناً)', keys: ['تاجير محل', 'ايجار محل', 'ايراد تاجير محل', 'تاجير مكتب', 'تاجير مخزن', 'محل تجاري'] },
    { status: 'standard', title: 'خدمات النقل الداخلي (لم ترد في الإعفاء ولا في نسبة الصفر)', keys: ['نقل داخلي', 'النقل الداخلي'] },
    { status: 'standard', title: 'المؤسسات المالية: 16% على الأجور والأرباح', keys: ['بنك', 'مؤسسه ماليه', 'مصرف'] },
  ];
  const VAT_STATUS_LABEL = { zero: 'خاضعة بنسبة صفر', exempt: 'معفاة', standard: 'خاضعة بنسبة 16%' };

  function classifyVat(text) {
    const t = normalize(text);
    let best = null;
    for (const c of VAT_CLASSES) {
      for (const k of c.keys) {
        if (t.includes(normalize(k)) && (!best || k.length > best.len)) best = { len: k.length, c };
      }
    }
    if (!best) return { status: 'standard', label: VAT_STATUS_LABEL.standard, title: 'لم ترد في قائمتي الإعفاء ونسبة الصفر، والأصل أن كل البضائع والخدمات تخضع 16% إلا ما استُثني بنص', ref: 'الفصل 8: 4-2', matched: false };
    return { status: best.c.status, label: VAT_STATUS_LABEL[best.c.status], title: best.c.title, ref: 'الفصل 8: 4-2 سعر ض.ق.م', matched: true,
      note: best.c.status === 'exempt' ? 'لا ضريبة على البيع، ولا يحق خصم ضريبة المدخلات المتعلقة بها'
        : best.c.status === 'zero' ? 'لا ضريبة على البيع، لكن يحق خصم واسترداد ضريبة المدخلات' : 'تُحصّل 16% وتُخصم المدخلات' };
  }

  function normalize(s) {
    return String(s || '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/\s+/g, ' ').trim();
  }

  return { RULES, bracketTax, incomeFromTax, individual, company, evaluateExpenses, businessExpenses, lifeInsurer,
    withholding, vatPeriod, importDuties, vatTaxpayerClass, classifyVat, VAT_CLASSES, EXPENSE_TYPES, normalize, fmt, r2 };
});
