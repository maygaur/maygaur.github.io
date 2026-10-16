/*
 * Input form definition. Each section lists fields bound to a path in the inputs object.
 * type: money | pct | int | month | calmonth | select | bool | list | draws
 * req: mandatory. when(inp): show only if true. sug: field has an auto-suggested value when left blank.
 */
(function (root) {
  'use strict';
  var CAL = [[1, 'January'], [2, 'February'], [3, 'March'], [4, 'April'], [5, 'May'], [6, 'June'], [7, 'July'], [8, 'August'], [9, 'September'], [10, 'October'], [11, 'November'], [12, 'December']];

  var SECTIONS = [
    {
      id: 'basics', title: 'Plan basics', icon: 'calendar',
      intro: 'When the projection starts and how far ahead to look.',
      fields: [
        { path: 'settings.startMonth', label: 'Projection starts', type: 'month', help: 'Usually next month.' },
        { path: 'settings.horizonYears', label: 'Years to project', type: 'int', min: 3, max: 30, unit: 'years' },
        { path: 'settings.inflationPct', label: 'General inflation', type: 'pct', help: 'Default yearly rise for expenses and maintenance (applied every January).' },
        { path: 'settings.emergencyMonths', label: 'Safety buffer target', type: 'int', min: 0, max: 36, unit: 'months', help: 'How many months of commitments you want to always keep in savings. Used for warnings and the recommendation.' }
      ]
    },
    {
      id: 'income', title: 'Income (after tax)', icon: 'wallet',
      intro: 'Take-home amounts. The fixed salary rises every year in the hike month; the bonus is paid once a year.',
      fields: [
        { path: 'income.salaryMonthly', label: 'Monthly in-hand salary', type: 'money', req: true },
        { path: 'income.hikePct', label: 'Yearly salary hike', type: 'pct' },
        { path: 'income.hikeMonth', label: 'Hike month', type: 'calmonth' },
        { path: 'income.bonusAnnual', label: 'Annual bonus (after tax)', type: 'money', help: 'Fully variable, so try a cautious figure and stress it with the what-if sliders.' },
        { path: 'income.bonusMonth', label: 'Bonus paid in', type: 'calmonth' },
        { path: 'income.bonusGrowthPct', label: 'Bonus growth per year', type: 'pct' },
        { path: 'income.otherMonthly', label: 'Other monthly income', type: 'money', help: 'Spouse income, interest payouts, etc. Rental income from your homes goes in their own sections.' },
        { path: 'income.otherGrowthPct', label: 'Other income growth per year', type: 'pct' }
      ]
    },
    {
      id: 'expenses', title: 'Living expenses', icon: 'cart',
      intro: 'Everything you spend monthly except rent and home-loan EMIs, which are calculated separately. Mark SIPs as "Investment (SIP)" so they count towards your savings.',
      fields: [
        {
          path: 'expenses.items', label: 'Monthly expense lines', type: 'list', req: true, addLabel: 'Add expense line',
          newItem: function () { return { id: HBPEngine.uid('exp'), name: '', monthly: null, growthPct: null, kind: 'expense' }; },
          cols: [
            { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Groceries' },
            { key: 'monthly', label: 'Per month', type: 'money', req: true },
            { key: 'growthPct', label: 'Rise / yr', type: 'pct', placeholderFrom: 'settings.inflationPct' },
            { key: 'kind', label: 'Type', type: 'select', options: [['expense', 'Expense'], ['sip', 'Investment (SIP)']] },
            { key: 'holdingId', label: 'Invests into', type: 'holding', when: function (it) { return it.kind === 'sip'; } }
          ]
        },
        {
          path: 'expenses.oneOffs', label: 'One-time expenses', type: 'list', addLabel: 'Add one-time expense',
          help: 'Interiors, a car, school fees, travel. Paid from savings in that month.',
          newItem: function () { return { id: HBPEngine.uid('one'), name: '', month: null, amount: null }; },
          cols: [
            { key: 'name', label: 'What', type: 'text', placeholder: 'e.g. Interiors' },
            { key: 'month', label: 'Month', type: 'month' },
            { key: 'amount', label: 'Amount', type: 'money' }
          ]
        }
      ]
    },
    {
      id: 'rent', title: 'Flat you rent now', icon: 'key',
      intro: 'The rent stops the month after you buy the new flat.',
      fields: [
        { path: 'rent.monthly', label: 'Monthly rent', type: 'money', req: true },
        { path: 'rent.escalationPct', label: 'Rent increase at renewal', type: 'pct' },
        { path: 'rent.renewalMonth', label: 'Renewal month', type: 'calmonth', sug: true }
      ]
    },
    {
      id: 'home1', title: 'Home 1 (paid off, rented out)', icon: 'home',
      intro: 'Used as a funding option: keep it and its rent, or sell it to pay for the new flat.',
      fields: [
        { path: 'home1.owned', label: 'I own Home 1', type: 'bool' },
        { path: 'home1.value', label: 'Current market value', type: 'money', when: own1 },
        { path: 'home1.appreciationPct', label: 'Value growth per year', type: 'pct', when: own1 },
        { path: 'home1.rentMonthly', label: 'Rent received per month (net)', type: 'money', when: own1 },
        { path: 'home1.rentEscalationPct', label: 'Rent increase per year', type: 'pct', when: own1 },
        { path: 'home1.rentEscalationMonth', label: 'Rent increase month', type: 'calmonth', sug: true, when: own1 },
        { path: 'home1.maintenanceMonthly', label: 'Maintenance & tax you pay / month', type: 'money', when: own1 },
        { path: 'home1.sellingCostPct', label: 'Selling costs (brokerage etc.)', type: 'pct', when: own1 },
        { path: 'home1.capitalGainsTax', label: 'Capital gains tax if sold', type: 'money', when: own1, help: 'Your estimate after indexation / exemptions. Leave 0 if you plan to reinvest under an exemption.' }
      ]
    },
    {
      id: 'home2', title: 'Home 2 (under construction)', icon: 'crane',
      intro: 'Construction-linked plan: list the remaining builder demands and who pays each (bank disbursement or you). The EMI grows with each disbursement.',
      fields: [
        { path: 'home2.owned', label: 'I own Home 2', type: 'bool' },
        { path: 'home2.value', label: 'Current value (or agreement value)', type: 'money', when: own2 },
        { path: 'home2.appreciationPct', label: 'Value growth per year', type: 'pct', when: own2 },
        { path: 'home2.possessionMonth', label: 'Expected possession', type: 'month', sug: true, when: own2 },
        { path: 'home2.loan.outstanding', label: 'Loan outstanding today', type: 'money', when: own2, help: 'Principal disbursed and not yet repaid.' },
        { path: 'home2.loan.ratePct', label: 'Loan interest rate', type: 'pct', when: own2 },
        { path: 'home2.loan.remainingYears', label: 'Remaining loan tenure', type: 'int', unit: 'years', min: 1, max: 30, when: own2 },
        {
          path: 'home2.loan.mode', label: 'Repayment during construction', type: 'select', when: own2,
          options: [['emi', 'Full EMI on amount disbursed so far'], ['preemi', 'Interest only (pre-EMI) until possession']]
        },
        {
          path: 'home2.schedule', label: 'Remaining payments to builder', type: 'list', when: own2, addLabel: 'Add payment',
          help: 'Bank-paid amounts add to the loan; self-paid amounts come out of your savings.',
          newItem: function () { return { id: HBPEngine.uid('dem'), month: null, amount: null, paidBy: 'loan', note: '' }; },
          cols: [
            { key: 'month', label: 'Month', type: 'month' },
            { key: 'amount', label: 'Amount', type: 'money' },
            { key: 'paidBy', label: 'Paid by', type: 'select', options: [['loan', 'Bank (loan)'], ['self', 'Me (savings)']] },
            { key: 'note', label: 'Milestone', type: 'text', placeholder: 'e.g. Slab 60' }
          ]
        },
        {
          path: 'home2.afterPossession', label: 'After possession', type: 'select', when: own2,
          options: [['rentOut', 'Rent it out'], ['moveIn', 'Move in (stop paying rent)'], ['vacant', 'Keep it vacant']]
        },
        { path: 'home2.rentMonthly', label: 'Expected rent / month (today\'s level)', type: 'money', when: function (i) { return own2(i) && i.home2.afterPossession === 'rentOut'; } },
        { path: 'home2.rentStartDelayMonths', label: 'Months to find a tenant', type: 'int', min: 0, max: 24, unit: 'months', when: function (i) { return own2(i) && i.home2.afterPossession === 'rentOut'; } },
        { path: 'home2.rentEscalationPct', label: 'Rent increase per year', type: 'pct', when: function (i) { return own2(i) && i.home2.afterPossession === 'rentOut'; } },
        { path: 'home2.maintenanceMonthly', label: 'Maintenance after possession / month', type: 'money', when: own2 }
      ]
    },
    {
      id: 'assets', title: 'Savings & investments', icon: 'piggy',
      intro: 'Monthly surplus builds your cash up to the buffer, then goes into your first investment. Shortfalls are drawn from cash, then investments in the order listed.',
      fields: [
        { path: 'assets.cash', label: 'Cash & bank balance', type: 'money' },
        { path: 'assets.cashReturnPct', label: 'Interest on cash', type: 'pct' },
        { path: 'assets.cashBuffer', label: 'Cash to keep aside', type: 'money', sug: true, help: 'Suggested: your safety buffer months x today\'s monthly commitments.' },
        {
          path: 'assets.holdings', label: 'Investments', type: 'list', addLabel: 'Add investment',
          help: 'Mutual funds, stocks, FDs, PF, gold. The first one receives monthly surplus.',
          newItem: function () { return { id: HBPEngine.uid('hold'), name: '', balance: null, returnPct: 8 }; },
          cols: [
            { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Equity MFs' },
            { key: 'balance', label: 'Value today', type: 'money' },
            { key: 'returnPct', label: 'Return / yr', type: 'pct' }
          ]
        }
      ]
    },
    {
      id: 'purchase', title: 'The flat you want to buy', icon: 'tag',
      intro: 'Price, down payment and the new home loan.',
      fields: [
        { path: 'purchase.enabled', label: 'Buy the flat in this scenario', type: 'bool', help: 'Turn off to model "keep renting".' },
        { path: 'purchase.price', label: 'Purchase price', type: 'money', req: true, when: buy },
        { path: 'purchase.month', label: 'Purchase month', type: 'month', sug: true, when: buy },
        { path: 'purchase.downPayment', label: 'Down payment', type: 'money', sug: true, when: buy, help: 'Suggested: 20% of price (banks usually lend up to 80%), or what selling Home 1 frees up if you sell it.' },
        { path: 'purchase.stampDutyPct', label: 'Stamp duty & registration', type: 'pct', when: buy },
        { path: 'purchase.otherCosts', label: 'Other one-time costs', type: 'money', when: buy, help: 'Brokerage, legal, society transfer, shifting.' },
        { path: 'purchase.loanRatePct', label: 'New loan interest rate', type: 'pct', when: buy },
        { path: 'purchase.tenureYears', label: 'New loan tenure', type: 'int', unit: 'years', min: 1, max: 30, when: buy },
        { path: 'purchase.processingFeePct', label: 'Loan processing fee', type: 'pct', when: buy },
        { path: 'purchase.appreciationPct', label: 'Value growth per year', type: 'pct', when: buy },
        { path: 'purchase.maintenanceMonthly', label: 'Maintenance & tax / month', type: 'money', when: buy }
      ]
    },
    {
      id: 'funding', title: 'Funding the down payment', icon: 'coins',
      intro: 'Choose where the upfront money comes from. Anything not covered here is taken from cash, then investments.',
      when: buy,
      fields: [
        { path: 'purchase.sellHome1', label: 'Sell Home 1 to fund it', type: 'bool', when: function (i) { return buy(i) && i.home1.owned; } },
        { path: 'purchase.home1SaleMonth', label: 'Sale month', type: 'month', sug: true, when: function (i) { return buy(i) && i.home1.owned && i.purchase.sellHome1; } },
        { path: 'purchase.draws', label: 'Redeem from investments', type: 'draws', when: buy }
      ]
    },
    {
      id: 'prepay', title: 'Loan prepayments', icon: 'bolt',
      intro: 'Optional lump sums paid into a loan (e.g. from a bonus). The EMI stays the same and the loan closes earlier.',
      fields: [
        {
          path: 'prepayments', label: 'Prepayments', type: 'list', addLabel: 'Add prepayment',
          newItem: function () { return { id: HBPEngine.uid('pre'), loan: 'home3', month: null, amount: null }; },
          cols: [
            { key: 'loan', label: 'Loan', type: 'select', options: [['home3', 'New flat loan'], ['home2', 'Home 2 loan']] },
            { key: 'month', label: 'Month', type: 'month' },
            { key: 'amount', label: 'Amount', type: 'money' }
          ]
        }
      ]
    }
  ];

  function own1(i) { return !!i.home1.owned; }
  function own2(i) { return !!i.home2.owned; }
  function buy(i) { return !!i.purchase.enabled; }

  /** Quick what-if sliders shown above the results. min/max can be functions of the current value. */
  var SLIDERS = [
    { path: 'purchase.price', label: 'Purchase price', type: 'money', when: buy, range: function (v) { return [Math.round(v * 0.7), Math.round(v * 1.3), Math.max(10000, Math.round(v / 200 / 10000) * 10000)]; } },
    { path: 'purchase.downPayment', label: 'Down payment', type: 'money', when: buy, range: function (v, i) { var p = +i.purchase.price || 0; return [0, p, Math.max(10000, Math.round(p / 100 / 10000) * 10000)]; } },
    { path: 'purchase.loanRatePct', label: 'New loan rate', type: 'pct', when: buy, range: function () { return [6, 12, 0.05]; } },
    { path: 'purchase.tenureYears', label: 'New loan tenure', type: 'int', unit: 'yrs', when: buy, range: function () { return [5, 30, 1]; } },
    { path: 'income.hikePct', label: 'Salary hike / yr', type: 'pct', range: function () { return [0, 20, 0.5]; } },
    { path: 'income.bonusAnnual', label: 'Annual bonus', type: 'money', range: function (v) { var hi = Math.max(v * 2, 100000); return [0, Math.round(hi), Math.max(10000, Math.round(hi / 100 / 10000) * 10000)]; } },
    { path: 'settings.inflationPct', label: 'Inflation', type: 'pct', range: function () { return [0, 15, 0.5]; } },
    { path: 'home2.loan.ratePct', label: 'Home 2 loan rate', type: 'pct', when: own2, range: function () { return [6, 12, 0.05]; } }
  ];

  root.HBPSchema = { SECTIONS: SECTIONS, SLIDERS: SLIDERS, CAL: CAL };
})(this);
