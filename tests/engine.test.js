// اختبارات المحرك على أسئلة امتحانات سابقة ومسائل الكتاب. التشغيل: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('الشرائح', () => {
  assert.equal(E.bracketTax(75000).tax, 3750);
  assert.equal(E.bracketTax(150000).tax, 11250);
  assert.equal(E.bracketTax(200400).tax, 18810);
  near(E.incomeFromTax(13450), 164666.67, 0.01); // امتحان: مصطفى
});

test('امتحان النجاح: حمدي = 3984', () => {
  const r = E.individual({
    year: 2025, resident: true,
    jobs: [
      { label: 'الشركة الخاصة', sector: 'private', monthlySalary: 3000, months: 6, transportActual: 3000 },
      { label: 'الوزارة', sector: 'public', monthlySalary: 4000, months: 5, transportAllowanceMonthly: 600, pensionContrib: 750, healthContrib: 375 },
    ],
    endOfService: { amount: 60000, years: 15, lastMonthlySalary: 3000 },
    representation: { received: 10000, spent: 8400 },
    business: 90000,
    exemptIncome: [{ label: 'ربح أسهم من محفظة استثمارية', amount: 20000 }],
    students: 1,
    housing: { kind: 'interest', amount: 5000, startYear: 2015 },
    donations: 25000,
  });
  assert.equal(r.income, 144600);
  assert.equal(r.exemptions, 47925);
  assert.equal(r.taxable, 77340);
  assert.equal(r.tax, 3984);
});

test('نموذج 1 س1: مصطفى ضريبته صفر', () => {
  const r = E.individual({ jobs: [{ sector: 'private', monthlySalary: 5500, months: 6, transportActual: 9000 }],
    endOfService: { amount: 120000, years: 20, lastMonthlySalary: 5500 }, students: 1 });
  assert.equal(r.income, 43000);
  assert.equal(r.exemptions, 45300);
  assert.equal(r.tax, 0);
});

test('نموذج 1 س2: أحمد 18810 وسعيد 7650', () => {
  const a = E.individual({ jobs: [{ sector: 'private', monthlySalary: 8000, transportActual: 12000 }],
    partnerships: [{ label: 'شركة التضامن', profit: 450000, share: 1 / 3 }], dividends: 120000 });
  assert.equal(a.taxable, 200400);
  assert.equal(a.tax, 18810);
  const s = E.individual({ partnerships: [{ profit: 450000, share: 1 / 3 }] });
  assert.equal(s.tax, 7650);
});

test('نموذج 1 س3: محمد، تقاص الأملاك 4500 والواجب 3600', () => {
  const r = E.individual({ jobs: [{ monthlySalary: 9000 }], rental: { gross: 50500, propertyTaxPaid: 10000 } });
  assert.equal(r.rentalTax, 4500);
  assert.equal(r.payable, 3600);
});

test('مثال الكتاب ص107: ضريبة الإيجار 5124', () => {
  const r = E.individual({ jobs: [{ monthlySalary: 100000 / 12, withheldMonthly: 100 }], rental: { gross: 60000, propertyTaxPaid: 8160 } });
  near(r.rentalTax, 5124);
});

test('مسألة 3: الواجب 1450', () => {
  const r = E.individual({ jobs: [{ monthlySalary: 7500, withheldMonthly: 150 }], rental: { gross: 80000, propertyTaxPaid: 10000 } });
  assert.equal(r.tax, 9250);
  assert.equal(r.payable, 1450);
});

test('مسألة 9: التقاص يُحدّ بضريبة الإيجار، والواجب 500', () => {
  const r = E.individual({ jobs: [{ monthlySalary: 70000 / 12, withheldMonthly: 100 }], rental: { gross: 30000, propertyTaxPaid: 9000 } });
  assert.equal(r.rentalTax, 1320);
  assert.equal(r.payable, 500);
});

test('مسألة 1: موظف مع كل الإعفاءات = 6950', () => {
  const r = E.individual({ jobs: [{ monthlySalary: 10000, transportActual: 8000, healthContrib: 3000 }],
    otherTaxable: [{ label: 'إيجار صافٍ', amount: 50000 }], students: 3, housing: { kind: 'interest', amount: 5000 } });
  assert.equal(r.taxable, 107000);
  assert.equal(r.tax, 6950);
});

test('مسألة 2: مصاريف مختلطة وخسارة وتبرعات = 6450', () => {
  const r = E.individual({
    business: { taxableGross: 225000, exemptGross: 75000, expenses: [
      { type: 'rent', amount: 12000, priorYear: 3000 }, { type: 'admin', amount: 18000 }, { type: 'hospitality', amount: 6000 },
      { type: 'badDebts', amount: 10000, provenRatio: 0.6 }, { type: 'depreciation', amount: 20000 } ] },
    lossCarried: 30000, donations: 15000 });
  assert.equal(r.taxable, 102000);
  assert.equal(r.tax, 6450);
});

test('مسألة 8: متقاعد = 2700', () => {
  const r = E.individual({ pension: 60000, endOfService: { amount: 120000, years: 20, lastMonthlySalary: 5000 }, otherTaxable: [{ label: 'إيجار', amount: 70000 }] });
  assert.equal(r.tax, 2700);
});

test('مسألة 4: شركة مساهمة عامة = 164000', () => {
  const r = E.company({ companyType: 'public', grossProfit: 3000000, advances: 100000, donations: 200000, expenses: [
    { type: 'salaries', amount: 400000, withoutWithholding: 60000 }, { type: 'establishment', amount: 250000, total: 1000000 },
    { type: 'rnd', amount: 90000 }, { type: 'hospitality', amount: 50000 }, { type: 'provision', amount: 40000 },
    { type: 'depreciation', amount: 150000 }, { type: 'admin', amount: 100000 }, { type: 'fines', amount: 5000 },
    { type: 'training', amount: 40000 }, { type: 'badDebts', amount: 120000 } ] });
  assert.equal(r.netAdjusted, 2120000);
  assert.equal(r.taxable, 1760000);
  assert.equal(r.payable, 164000);
});

test('مسألة 7: شركة كبيرة = 1395600، واتصالات 1860800', () => {
  const base = { grossProfit: 20000000, donations: 3000000, expenses: [
    { type: 'salaries', amount: 3000000 }, { type: 'admin', amount: 1000000 }, { type: 'depreciation', amount: 600000 },
    { type: 'hospitality', amount: 250000 }, { type: 'rnd', amount: 700000 }, { type: 'fines', amount: 20000 },
    { type: 'provision', amount: 100000 }, { type: 'training', amount: 250000 }, { type: 'badDebts', amount: 3500000 } ] };
  assert.equal(E.company(Object.assign({ companyType: 'private' }, base)).tax, 1395600);
  assert.equal(E.company(Object.assign({ companyType: 'telecom' }, base)).tax, 1860800);
});

test('نموذج 1 س7: خسارة فترة الإعفاء لا تُدوَّر = 16500', () => {
  const r = E.company({ grossProfit: 110000, lossCarried: 50000, lossFromExemptPeriod: true });
  assert.equal(r.tax, 16500);
});

test('شركة تأمين على الحياة = 65000', () => {
  assert.equal(E.lifeInsurer({ lifePremiums: 400000, investmentIncome: 300000 }).tax, 65000);
});

test('نموذج 1 س4: الاستيراد (النقل الداخلي خارج الوعاء)', () => {
  const r = E.importDuties({ goods: 140000, freight: 50000, localCosts: 4000, customsRate: 0.2, purchaseRate: 0.3 });
  assert.equal(r.customs, 38000);
  assert.equal(r.purchaseTax, 68400);
  assert.equal(r.vat, 47424);
});

test('الفصل 8 مثال 5: جمارك 4000 وشراء 14400 وض.ق.م 6144', () => {
  const r = E.importDuties({ goods: 20000, customsRate: 0.2, purchaseRate: 0.6 });
  assert.equal(r.totalTaxes, 24544);
  assert.equal(r.total, 44544);
});

test('الفصل 8: رسوم مركبة 8000 وحد أدنى 3000', () => {
  assert.equal(E.importDuties({ goods: 40000, customsRate: 0.1, customsPerUnit: 2, units: 2000 }).customs, 8000);
  assert.equal(E.importDuties({ goods: 15000, customsRate: 0.12, customsMinPerUnit: 1, units: 3000 }).customs, 3000);
});

test('الفصل 8 مثال الزيوت: تعلية 4560 وشراء 3192 (ض.ق.م 17%)', () => {
  const r = E.importDuties({ goods: 8000, customsRate: 0.15, customsPerUnit: 4.4, units: 500, upliftRate: 0.4, purchaseRate: 0.2, vatRate: 0.17 });
  assert.equal(r.customs, 3400);
  assert.equal(r.uplift, 4560);
  assert.equal(r.purchaseTax, 3192);
  near(r.vat, 3256);
});

test('تدريب 1: فاتورة أقدم من 6 شهور لا تُخصم = 3200', () => {
  const r = E.vatPeriod([{ type: 'export', amount: 30000 }, { type: 'sale', amount: 40000 }, { type: 'sale', amount: 30000 },
    { type: 'purchase', amount: 20000, ageMonths: 4 }, { type: 'purchase', amount: 30000, ageMonths: 3 }, { type: 'purchase', amount: 10000, ageMonths: 9 }]);
  assert.equal(r.balance, 3200);
});

test('تدريب 3: مدخلات الصفقات المعفاة لا تُخصم = 5600', () => {
  const r = E.vatPeriod([{ type: 'sale', amount: 300000 }, { type: 'export', amount: 40000 }, { type: 'exempt', amount: 20000 },
    { type: 'purchase', amount: 240000 }, { type: 'purchase', amount: 25000 }, { type: 'purchase', amount: 10000, forExempt: true }]);
  assert.equal(r.balance, 5600);
});

test('أمثلة الكتاب: شامل الضريبة 2069، ورصيد للإرجاع 3200', () => {
  near(E.vatPeriod([{ type: 'sale', amount: 40000, inclusive: true }, { type: 'purchase', amount: 25000, inclusive: true }]).balance, 2069);
  assert.equal(E.vatPeriod([{ type: 'sale', amount: 50000 }, { type: 'purchase', amount: 70000 }]).balance, -3200);
});

test('نموذج 1 س6: تصنيف الصفقات حسب الكتاب', () => {
  const s = (t) => E.classifyVat(t).status;
  assert.equal(s('بيع اراضي مستأجرة محمية بموجب نظام الخلو او المفتاحية'), 'exempt');
  assert.equal(s('خدمات النقل الداخلي'), 'standard');
  assert.equal(s('فرق العملة عند تبديل العملات'), 'zero');
  assert.equal(s('ايداع اموال في البنوك'), 'exempt');
  assert.equal(s('مبيعات خدمات لاشخاص يقيمون في الخارج'), 'zero');
  assert.equal(s('بيع الماس الصناعي'), 'standard');
  assert.equal(s('مبيعات البضائع والخدمات في الفنادق للسائحين'), 'zero');
  assert.equal(s('بيع الخضار'), 'zero');
  assert.equal(s('تحويل عملة للخارج'), 'zero');
  assert.equal(s('ايراد تاجير محل'), 'standard');
});

test('تصنيف المكلف في ض.ق.م', () => {
  assert.equal(E.vatTaxpayerClass(200000).kind, 'licensed');
  assert.equal(E.vatTaxpayerClass(100000).kind, 'small');
  assert.equal(E.vatTaxpayerClass(30000).kind, 'exempt');
});

test('نموذج 1 س5: محلات سامر = 9504 للدفع', () => {
  const r = E.vatPeriod([
    { type: 'purchase', amount: 26680, inclusive: true }, { type: 'asset', amount: 60000 },
    { type: 'purchaseReturn', amount: 1160, inclusive: true }, { type: 'sale', amount: 100000 },
    { type: 'export', amount: 60000 }, { type: 'sale', amount: 52200, inclusive: true },
    { type: 'discountGiven', amount: 3000 }, { type: 'noInvoice', amount: 20000 },
    { type: 'expense', amount: 696, inclusive: true, account: 'مصروف الهاتف' } ]);
  assert.equal(r.sales16, 142000);
  assert.equal(r.sales0, 60000);
  assert.equal(r.outputVat, 22720);
  assert.equal(r.inputVat, 13216);
  assert.equal(r.balance, 9504);
});

const P = require('../src/parser.js');
test('المحلل اللغوي: نموذج 1 س2 من النص مباشرة = 18810', () => {
  const r = P.parse('يعمل احمد موظف في شركة النجاح براتب شهري مقداره 8,000 شيكل. احمد شريك مع اشقائه سعيد وسمير في شركة تضامن ارباح الشركة توزع بالتساوي حيث بلغت ارباح الشركة لعام 2024 بقيمة 450,000 شيكل. قدم اثباتات بقيمة المواصلات الفعلية 12,000 شيكل');
  assert.equal(E.individual(r.input).tax, 18810);
});
test('المحلل اللغوي: مسألة 1 = 6950', () => {
  const r = P.parse('موظف مقيم راتبه السنوي 120000، وله ايجار 50000. مواصلاته الفعلية 8000، وتأمينه الصحي 3000، وفوائد قرض سكن 5000، وله 3 أبناء في الجامعة.');
  assert.equal(E.individual(r.input).tax, 6950);
});
test('المحلل اللغوي: أرقام عربية وآلاف', () => {
  const r = P.parse('راتبه الشهري ٧ آلاف شيكل وتبرع ب ٢٠٠٠');
  assert.equal(r.input.jobs[0].monthlySalary, 7000);
  assert.equal(r.input.donations, 2000);
});
