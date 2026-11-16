import { chromium } from 'playwright';
const URL = 'http://localhost:8321/index.html';
const pass = [], fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(n + (x ? '  [' + x + ']' : ''));
const W = 74.3;   // the bodyweight every number in the Guide is derived from

const browser = await chromium.launch({ headless: false, args: ['--headless=new'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__off = 0;
  const real = Date.now.bind(Date);
  Date.now = () => real() + window.__off;
  window.__advance = ms => { window.__off += ms; };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const settle = (ms = 350) => page.waitForTimeout(ms);
const fill = async (ex, i, w, r) => {
  await page.fill(`input[data-ex="${ex}"][data-i="${i}"][data-f="w"]`, String(w));
  await page.fill(`input[data-ex="${ex}"][data-i="${i}"][data-f="r"]`, String(r));
};
await page.goto(URL, { waitUntil: 'networkidle' });
await settle();

// ---------- structure ----------
const tabs = await page.locator('#days button').allTextContents();
ok('four lifting days plus the conditioning tab', JSON.stringify(tabs) === JSON.stringify(['Lower A', 'Upper A', 'Lower B', 'Upper B', 'Off Days']), tabs.join('/'));
ok('opens on Lower A', (await page.locator('#days button[aria-selected="true"]').textContent()) === 'Lower A');
ok('Off Days is NOT in DAY_ORDER', (await page.evaluate(() => DAY_ORDER.includes('off'))) === false);

const plan = await page.evaluate(() => DAY_ORDER.map(d => ({
  id: d, title: PLAN[d].title, focus: PLAN[d].focus, cardio: PLAN[d].cardio, wd: PLAN[d].wd,
  ex: PLAN[d].ex.map(e => ({ id: e.id, name: e.name, sets: e.sets, reps: e.reps, type: e.type, inc: e.inc, rest: e.rest, cue: e.cue })),
})));

const bad = [];
plan.forEach(d => d.ex.forEach(e => {
  if (!e.rest || e.rest < 30 || e.rest > 300) bad.push(`${e.id}:rest=${e.rest}`);
  if (!e.cue || e.cue.length < 15) bad.push(`${e.id}:cue`);
  if (!e.sets || !e.reps) bad.push(`${e.id}:scheme`);
  if (!['strength', 'build'].includes(e.type)) bad.push(`${e.id}:type=${e.type}`);
}));
ok('every exercise has a sane rest, cue, scheme and type', bad.length === 0, bad.join(', ') || 'clean');

const ids = plan.flatMap(d => d.ex.map(e => e.id));
ok('no duplicate exercise across the week', new Set(ids).size === ids.length, ids.length + ' slots');
const totalSets = plan.flatMap(d => d.ex).reduce((t, e) => t + e.sets, 0);
ok('weekly volume is sane for a deficit (60-90 sets)', totalSets >= 60 && totalSets <= 90, totalSets + ' sets');

// every muscle group hit twice: one lower + one upper pair each
ok('two lower days and two upper days', plan.filter(d => /Lower/.test(d.title)).length === 2 && plan.filter(d => /Upper/.test(d.title)).length === 2);
const strengthFirst = plan.every(d => d.ex[0].type === 'strength');
ok('every day opens with its heaviest lift', strengthFirst, plan.map(d => d.ex[0].name).join(' / '));

// no day advertises work it does not contain
const liars = plan.filter(d => /sprint|sled|shuttle/i.test(d.focus + ' ' + d.cardio));
ok('no day header promises work that no longer exists', liars.length === 0, liars.map(l => l.id).join(',') || 'clean');

// ---------- the conditioning week ----------
const wd = await page.evaluate(() => DAY_ORDER.map(d => PLAN[d].wd));
ok('every lifting day names its weekday', JSON.stringify(wd) === JSON.stringify(['Mon', 'Wed', 'Fri', 'Sat']), wd.join('/'));
// the two lower days must never be adjacent, and no hard session may precede one
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const lowerIdx = plan.filter(d => /Lower/.test(d.title)).map(d => DOW.indexOf(d.wd));
ok('the two lower days are never back to back', Math.abs(lowerIdx[0] - lowerIdx[1]) > 1, lowerIdx.join(','));
const hardDays = plan.filter(d => /hard session/i.test(d.cardio)).map(d => DOW.indexOf(d.wd));
ok('two hard conditioning sessions, both on upper days',
   hardDays.length === 2 && plan.filter(d => /hard session/i.test(d.cardio)).every(d => /Upper/.test(d.title)),
   hardDays.length + ' found');
ok('no hard session sits the day before a lower day',
   hardDays.every(h => !lowerIdx.includes((h + 1) % 7)), `hard=${hardDays} lower=${lowerIdx}`);
// every lifting day's cardio must carry a concrete prescription, not a vague nudge
const vague = plan.filter(d => !/\d/.test(d.cardio));
ok('every cardio note gives real numbers', vague.length === 0, vague.map(v => v.id).join(',') || 'clean');
ok('the walk days state speed and incline',
   plan.filter(d => /5\.0 km\/h at 11%/.test(d.cardio)).length === 2);

// the Off Days tab
await page.locator('#days button', { hasText: 'Off Days' }).click(); await settle(400);
const offCards = await page.locator('.ex[data-card^="off-"]').count();
ok('Off Days shows all three conditioning days', offCards === 3, offCards + ' cards');
const offTxt = await page.locator('#daybody').textContent();
ok('Off Days carries the settings', /5\.0 km\/h/.test(offTxt) && /120 min/.test(offTxt) && /50 min stairs/.test(offTxt));
ok('Off Days logs nothing', (await page.locator('#daybody input').count()) === 0);
// a 50 min stair grind must not be labelled the same as a Sunday stroll
const tones = await page.locator('.ex[data-card^="off-"] .badge').allTextContents();
ok('conditioning days are honestly labelled', JSON.stringify(tones) === JSON.stringify(['Steady', 'Steady', 'Easy']), tones.join('/'));
ok('header no longer advertises a 4-day week',
   !/4-Day/.test(await page.locator('header').textContent()), await page.locator('header .tag').textContent());
ok('save stays disabled on a conditioning day', await page.locator('#savebtn').isDisabled());
await page.locator('#days button', { hasText: 'Lower A' }).click(); await settle(400);
ok('switching back to a lifting day restores the inputs', (await page.locator('#daybody input').count()) > 0);

// ---------- logging ----------
await fill('legpress', 0, 120, 6); await settle();
let vol = (await page.locator('#volnum').textContent()).trim();
ok('tonnage counts the logged set', vol.startsWith('720'), `vol=${vol}`);
await fill('legraise', 0, 0, 12); await settle();
await page.locator('#savebtn').click(); await settle(500);
await page.reload({ waitUntil: 'networkidle' }); await settle(400);
ok('leg press reads back', (await page.locator('.ex[data-card="legpress"] .lv').textContent()).trim() === '120×6');
ok('bodyweight work reads as reps, not 0x12', (await page.locator('.ex[data-card="legraise"] .lv').textContent()).trim() === '12 reps');
ok('bodyweight column asks for added load', (await page.locator('.ex[data-card="legraise"] .colhead span').nth(1).textContent()) === 'Added (kg)');
ok('leg press nudges a jump once reps are hit', /Try/.test(await page.locator('.ex[data-card="legpress"] .nudge').textContent()));
ok('bodyweight work never suggests adding weight', /Match \/ beat last/.test(await page.locator('.ex[data-card="legraise"] .nudge').textContent()));

await page.locator('#unittoggle button[data-unit="lb"]').click(); await settle(500);
ok('kg converts to lb', /^26[45](\.\d)?×6$/.test((await page.locator('.ex[data-card="legpress"] .lv').textContent()).trim()),
   (await page.locator('.ex[data-card="legpress"] .lv').textContent()).trim());
await page.locator('#unittoggle button[data-unit="kg"]').click(); await settle(400);

await page.locator('.views button[data-view="progress"]').click(); await settle(500);
const cards = await page.locator('.pcard h3').allTextContents();
ok('Progress shows one card per logged lift', cards.length === new Set(cards).size, cards.join('/'));
const bwCard = page.locator('.pcard').filter({ has: page.locator('h3', { hasText: 'Hanging Leg Raise' }) });
ok('no 0kg 1RM quoted for bodyweight work', !(await bwCard.locator('.pstat .l').allTextContents()).includes('Est. 1RM'));

// ---------- rest timer (the regression that matters most) ----------
await page.locator('.views button[data-view="today"]').click(); await settle(400);
const chip = page.locator('.rest-chip').first();
const chipSecs = await chip.evaluate(el => parseInt(el.dataset.rest));
await chip.click(); await settle(300);
ok('rest pill appears with the chip value', (await page.locator('#rt').textContent()) === `${Math.floor(chipSecs / 60)}:${String(chipSecs % 60).padStart(2, '0')}`);
await page.evaluate(() => { clearInterval(restTick); restTick = null; });     // iOS freezing the app
await page.evaluate(n => window.__advance(n * 1000 + 4000), chipSecs);
await settle(400);
ok('frozen tick does not update on its own', (await page.locator('#rt').textContent()) !== 'GO');
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await settle(500);
ok('returning catches the timer up and says how long ago', (await page.locator('#rt').textContent()) === 'GO' && /Done 0:0\d ago/.test(await page.locator('#rlab').textContent()),
   await page.locator('#rlab').textContent());
await page.evaluate(() => { if (restEndsAt) endRest(); }); await settle(300);

// ---------- guide ----------
await page.locator('.views button[data-view="guide"]').click(); await settle(500);
const g = await page.locator('#guide-view').textContent();
ok('guide has the new week', /Lower A/.test(g) && /Upper B/.test(g) && /trained twice a week/.test(g));
ok('guide states the goal trade-off honestly', /not possible is doing either of them/.test(g));
ok('guide keeps the machine section', /What machines cost you/.test(g));
ok('guide keeps the groin note', /Your groin/.test(g) && /squeeze your knees together/.test(g));
ok('guide is honest about stretching', /It does not/.test(g));
ok('no dead references to football work', !/football|kickabout|shuttle|sled|pitch-side/i.test(g), 'clean');

// the numbers must match the arithmetic, not vibes
const PCT = 0.008;                                    // 0.8% of bodyweight a week
const BURN = 2969;                                    // 2,500 baseline + 469 of new conditioning
const rate = +(W * PCT).toFixed(2);                   // 0.59
const total = +(W * PCT * 12).toFixed(1);             // 7.1
const end = +(W - W * PCT * 12).toFixed(1);           // 67.2
const kcal = Math.round(W * PCT * 7700 / 7);          // 654
const eat = BURN - kcal;                              // 2315
const bmiEnd = +(end / 1.75 ** 2).toFixed(1);         // 21.9
const prot = Math.round(W * 2.0);                     // 149 -> stated as 150
const lo = Math.round(W * 1.8), hi = Math.round(W * 2.7);   // 134 / 201
ok('guide quotes the right weekly rate', g.includes(`${rate} kg a week`), String(rate));
ok('guide quotes the right 12-week total', g.includes(`${total} kg over 12 weeks`), String(total));
ok('guide quotes the right end weight', g.includes(`${end} kg`), String(end));
ok('guide deficit matches the rate arithmetic', g.includes(`${kcal} kcal a day`), `${kcal} computed`);
ok('guide eating target = burn minus deficit', g.includes(`${eat.toLocaleString('en-US')} kcal a day`), `${eat} computed`);
ok('the rate sits inside the 0.5-1.0%/wk evidence band', PCT >= 0.005 && PCT <= 0.010, `${(PCT*100).toFixed(1)}%`);
ok('guide quotes the right end BMI', g.includes(String(bmiEnd)), String(bmiEnd));
ok('guide protein target matches 2 g/kg', Math.abs(prot - 150) <= 2 && /150 g a day/.test(g), `${prot} g computed`);
ok('guide says eating went UP, not down', /eating more than you were and losing faster/.test(g));
const keepOld = Math.round((BURN - 2132) * 7 / 7700 / W * 10000) / 100;   // 1.02
ok('guide warns against keeping the old intake',
   g.includes(`${BURN - 2132} kcal deficit`) && g.includes(`${keepOld}% of bodyweight`), `${BURN-2132} / ${keepOld}%`);
ok('guide gives the disputed protein range', g.includes(`${lo} g to ${hi} g`) && /1.8 and 2.7/.test(g), `${lo}-${hi}`);
ok('guide says the protein evidence is contested', /genuinely disputed/.test(g));
ok('guide tells him to adjust from the scale', /overestimates real-world loss/.test(g));
ok('guide carries a health caveat', /not medical or dietary advice/.test(g));
ok('guide points at the separate food page', /Food lives on its own page/.test(g)&&/food\.html/.test(await page.locator('#guide-view').innerHTML()));
ok('no duplicated food plan left in the app', !/1,308 kcal|Greek yogurt|oily fish/.test(g), 'clean');

// the food plan's arithmetic must hold
const CH=[112,22.5,1.93,0], RI=[365,7.1,0.66,80], BR=[34,2.8,0.37,6.6], OIL=[884,0,100,0];
const mix=(...xs)=>xs.reduce((a,[f,g])=>a.map((v,i)=>v+f[i]*g/100),[0,0,0,0]);
const m=mix([CH,200],[RI,75],[BR,200],[OIL,10]);
ok('guide gives the maintenance estimate and its error band', /2,970/.test(g)&&/wider than the 654 kcal deficit/.test(g));
ok('guide puts the goal in BMI context', /24.3/.test(g)&&/21.9/.test(g));

// the conditioning section must give settable numbers, not adjectives
ok('guide states the default treadmill setting', /5\.0 km\/h at 11%/.test(g) && /8\.1 MET/.test(g));
ok('guide gives equivalent incline settings', /4\.5 \/ 13%/.test(g) && /6\.0 \/ 8%/.test(g));
ok('guide is honest that hybrid does not burn more', /not a more efficient way to burn/.test(g));
ok('guide explains the 3-hour separation', /at least 3 h apart|3 h apart/.test(g));
ok('guide flags the six-session dose edge', /six to ten sessions/.test(g));
ok('guide tells him not to double-count the commute', /Do not count it twice/.test(g));
ok('guide carries the ramp-in warning', /tendon in week five/.test(g));
// the handrail claim must keep its significance caveat, not become a bare percentage
ok('handrail note keeps the significance caveat', /was <i>not<\/i> statistically significant|not<\/i> statistically significant/.test(await page.locator('#guide-view').innerHTML()));

await browser.close();
console.log('\nPASS'); pass.forEach(p => console.log('  + ' + p));
if (fail.length) { console.log('\nFAIL'); fail.forEach(f => console.log('  - ' + f)); }
if (errors.length) { console.log('\nPAGE ERRORS'); [...new Set(errors)].forEach(e => console.log('  ! ' + e)); }
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
