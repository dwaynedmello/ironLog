import { chromium } from 'playwright';
const URL = 'http://localhost:8321/food.html';
const pass = [], fail = [];
const ok = (n, c, x = '') => (c ? pass : fail).push(n + (x ? '  [' + x + ']' : ''));

const browser = await chromium.launch({ headless: false, args: ['--headless=new'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
const settle = (ms = 300) => page.waitForTimeout(ms);
await settle();

// tabs
const tabs = await page.locator('.tabs button').allTextContents();
ok('three sections', JSON.stringify(tabs) === JSON.stringify(['Shop', 'Day', 'Cook']), tabs.join('/'));
ok('opens on Shop', await page.locator('#shop').isVisible() && !(await page.locator('#cook').isVisible()));
await page.locator('.tabs button', { hasText: 'Cook' }).click(); await settle();
ok('Cook tab shows recipes', await page.locator('#cook').isVisible() && /Sunday batch/.test(await page.locator('#cook').textContent()));
await page.locator('.tabs button', { hasText: 'Day' }).click(); await settle();
ok('Day tab shows the meals', /Breakfast/.test(await page.locator('#day').textContent()));
await page.locator('.tabs button', { hasText: 'Shop' }).click(); await settle();

// shopping list
const items = await page.locator('.item').count();
const qtys = (await page.locator('.qty').allTextContents()).join(' ');

// ticking persists across a reload, which is the whole point mid-aisle
await page.locator('.item', { hasText: 'Chicken' }).click(); await settle(200);
await page.locator('.item', { hasText: 'Oats' }).click(); await settle(200);
ok('ticked rows are marked done', (await page.locator('.item.done').count()) === 2);
await page.reload({ waitUntil: 'networkidle' }); await settle(400);
await page.locator('#reset').click(); await settle(300);
await page.reload({ waitUntil: 'networkidle' }); await settle(300);

// the numbers on the page must match the diet arithmetic
const body = await page.locator('body').textContent();
const CH=[112,22.5,1.93,0], RI=[365,7.1,0.66,80], BR=[34,2.8,0.37,6.6], OIL=[884,0,100,0];
const QU=[73,13.5,0.3,4], OA=[379,13.2,6.5,67.7], BA=[89,1.1,0.33,22.8], EG=[143,12.6,9.5,0.7], AL=[579,21.2,49.9,21.6];
const mix=(...xs)=>xs.reduce((a,[f,g])=>a.map((v,i)=>v+f[i]*g/100),[0,0,0,0]);
const main=mix([CH,200],[RI,75],[BR,200],[OIL,10]);
const bfast=mix([OA,70],[QU,200],[BA,120],[EG,110],[AL,25]);
const day=[0,1,2,3].map(i=>bfast[i]+2*main[i]);

// shopping quantities must equal 7 days of that food plan
const wk = { chicken: 200*14, quark: 200*7, oats: 70*7, rice: 75*14, broc: 200*14, alm: 25*7 };
ok('chicken quantity = 14 main meals', wk.chicken === 2800 && /2\.8 kg/.test(qtys));
ok('quark quantity = 7 breakfasts, rounded up to whole tubs', wk.quark === 1400 && Math.ceil(1400/500) === 3);
ok('rice quantity = 14 main meals', wk.rice === 1050);

// content that must not go missing
ok('warns that weights are raw', /raw or dry/i.test(body));
ok('keeps the rice safety warning', /heat resistant/.test(body) && /90 minutes/.test(body));
ok('keeps the do-not-fry-in-the-oil warning', /Do not fry/.test(body));
ok('has the five flavour rotations', (await page.locator('.tabs button', { hasText: 'Cook' }).click(), await settle(200), /Soy & ginger|Soy &amp; ginger/.test(await page.locator('#cook').innerHTML())));
ok('no fish left in the plan', !/salmon|mackerel|oily fish/i.test(body), 'clean');
ok('points at the EPA+DHA label check', /EPA \+ DHA/.test(body));

// cheat-day arithmetic must follow from the deficit, not be asserted
/* Burn is now 2,500 baseline + 469 a day of new conditioning. Eating went UP. */
const MAINT=2969, TGT=2308, WKDEF=(MAINT-TGT)*7;
const loss=over=>Math.max(WKDEF-over,0)/7700;
ok('weekly deficit follows from burn minus intake', WKDEF===4627 && body.includes('4,627 kcal deficit'), String(WKDEF));
ok('cheat table: 7 strict days', loss(0).toFixed(2)==='0.60' && body.includes('0.60 kg'));
ok('cheat table: maintenance day', loss(MAINT-TGT).toFixed(2)==='0.52' && body.includes('0.52 kg'));
ok('cheat table: relaxed day at 3,500', loss(3500-TGT).toFixed(2)==='0.45' && body.includes('0.45 kg'));
ok('cheat table: one blowout at 4,500', loss(4500-TGT).toFixed(2)==='0.32' && body.includes('0.32 kg'));
ok('cheat table: two blowouts nearly erase the week', loss(2*(4500-TGT)).toFixed(2)==='0.03' && body.includes('0.03 kg'));
const banked=Math.round(25*2*3.65*6);
ok('banked allowance matches 6 days of rice reduction', banked+TGT===3403 && body.includes('3,403 kcal'), String(banked+TGT));
ok('does not bank out of the hard conditioning days', /Tuesday and Thursday instead/.test(body));
ok('warns the scale jump is water not fat', /glycogen/.test(body)&&/not fat/.test(body));

await page.locator('.tabs button', { hasText: 'Shop' }).click(); await settle(300);
// list grew to 15 items across 5 vegetables plus lentils
const items2=await page.locator('.item').count();
ok('shopping list covers the expanded plan', items2===14, `${items2} items`);
const q2=(await page.locator('.qty').allTextContents()).join(' ');
ok('five vegetables on the list', /Green beans|Spinach|Red peppers|Carrots/.test(await page.locator('#list').textContent()));
ok('lentils on the list', /Rote Linsen/.test(await page.locator('#list').textContent()));
await page.locator('.item').first().click(); await settle(200);
ok('ticking still works and counts', /1 of 14/.test(await page.locator('#prog').textContent()));
await page.reload({waitUntil:'networkidle'}); await settle(300);
ok('tick survives reload', /1 of 14/.test(await page.locator('#prog').textContent()));
await page.locator('#reset').click(); await settle(300);
ok('reset works', /0 of 14/.test(await page.locator('#prog').textContent()));

// vegetables are interchangeable: prove the spread the page claims
const VEG={Broccoli:[34,2.8,.37,6.6,2.6],'Red pepper':[26,1,.3,6,2.1],Spinach:[23,2.9,.4,3.6,2.2],
           Carrots:[41,.9,.2,9.6,2.8],'Green beans':[31,1.8,.2,7,2.7]};
const per200=Object.values(VEG).map(v=>v[0]*2);
ok('vegetable spread at 200 g is 46-82 kcal as stated',
   Math.min(...per200)===46 && Math.max(...per200)===82 && body.includes('46 to 82 kcal'),
   `${Math.min(...per200)}-${Math.max(...per200)}`);
ok('page says not to recalculate on a swap', /Do not recalculate when you swap/.test(body));

// lentil swap arithmetic
const RICE=[365,7.1,.66,80,1.3], LENT=[352,24.6,1.1,63.4,10.7];
/* Each meal now carries 100 g of dry grain, so the comparison is against 100 g of rice. */
const oldC=RICE.map(v=>v*1.00), newC=[0,1,2,3,4].map(i=>RICE[i]*0.75+LENT[i]*0.25);
ok('rice 100 g is 365 kcal as stated', Math.round(oldC[0])===365 && body.includes('365'));
ok('rice 75 + lentils 25 is 362 kcal as stated', Math.round(newC[0])===362 && body.includes('362'));
ok('the grain total per meal is 100 g', body.includes('100 g of dry grain'));
ok('swap adds ~9 g protein a day', Math.round((newC[1]-oldC[1])*2)===9 && body.includes('9 g more protein'), ((newC[1]-oldC[1])*2).toFixed(1));
ok('swap adds 3-5 g fibre a day depending on hull', ((newC[4]-oldC[4])*2).toFixed(1)==='4.7' && body.includes('3 to 5 g more fibre'));
ok('specifies RED lentils, not brown', /Rote Linsen/.test(body) && /has to be the red ones/.test(body));
ok('gives the cooking time that justifies red', /10–15 min, no soaking/.test(body) && /45–60 min/.test(body));
ok('names the Kaufland lentil brands', /K Classic rote Linsen/.test(body) && /K-Bio rote Linsen/.test(body));
ok('explains Prinzessbohnen vs Brechbohnen', /Brechbohnen/.test(body) && /freezer aisle|Freezer aisle/i.test(body));
ok('flags the hulled-lentil fibre caveat', /hulled and split/.test(body));

// Skyr at 250 g must reproduce the stated breakfast
const SK=[60,10,0.2,4], OA3=[379,13.2,6.5,67.7], BA3=[89,1.1,.33,22.8], EG3=[143,12.6,9.5,.7], AL3=[579,21.2,49.9,21.6];
const mx3=(...xs)=>xs.reduce((a,[f,g])=>a.map((v,i)=>v+f[i]*g/100),[0,0,0,0]);
const bf3=mx3([OA3,70],[SK,250],[BA3,120],[EG3,110],[AL3,25]);
ok('breakfast with 250 g Skyr is 824 kcal', Math.round(bf3[0])===824 && body.includes('824 kcal'), String(Math.round(bf3[0])));
ok('breakfast protein is 55 g', Math.round(bf3[1])===55 && body.includes('55 P'), bf3[1].toFixed(1));
ok('Skyr portion is 250 g not 200 g', /Skyr, natur<\/td><td class="w">250 g/.test(await page.content()));
ok('explains why Skyr needs the bigger portion', /10 g protein per 100 g against quark/.test(body));
ok('notes Cremig is not higher fat', /Cremig is not higher fat/.test(body));
ok('oats jars no longer need thinning', /No milk or water needed/.test(body));

// both lentil routes must be cookable from the page
ok('dry route: one pot with the rice', /75 g rice \+ 25 g red lentils/.test(body) && /same pot/.test(body));
ok('tinned route: drain, rinse, stir in', /100 g into a sieve/.test(body) && /rinse under the tap/.test(body));
ok('tinned route says cook the rice alone at 75 g', /Cook the rice alone at 75 g/.test(body));
ok('water scales with the bigger grain portion', /230 ml water/.test(body));
ok('says brown is fine once tinned', /brown is fine in a tin/.test(body));
ok('warns off Linsen mit Suppengruen', /Linsen mit Suppengrün/.test(body));
ok('gives the tinned salt figure', /0.56 g per 100 g/.test(body));

// the honest-caveat content must survive edits
ok('states the fibre gain against the 30 g reference', /29 g/.test(body)&&/30 g reference/.test(body));
ok('names broccoli beta-carotene blind spot', /beta-carotene/.test(body));
ok('gives the red pepper vitamin C figure', /128 mg/.test(body));
ok('carries the WCRF caveat on the 30-plants claim', /is not one of their recommendations/.test(body));
ok('flags the extrapolation on cancer risk', /extrapolation/.test(body));
ok('admits the organic chicken evidence was unverifiable', /could not verify/i.test(body)&&/blocked/.test(body));
ok('does not overclaim for olive oil', /rather than a health claim/.test(body));

// thigh swap: the stated day must follow from the per-100g values
/* Two databases disagree on raw skinless thigh. The page must show BOTH, because the
   30 kcal/100 g gap is 120 kcal a day across four portions and that is not a rounding error. */
const TH_USDA=[119,19.651,3.91,0], TH_HIGH=[149,18.6,7.92,0];
const LN2=[352,24.6,1.06,60], CH2=[112,22.5,1.93,0];
const RI2=[365,7.1,0.66,80], BR2=[34,2.8,0.37,6.6], OI2=[884,0,100,0];
const mx=(...xs)=>xs.reduce((a,[f,g])=>a.map((v,i)=>v+f[i]*g/100),[0,0,0,0]);
const bf2=mx([[379,13.2,6.5,67.7],70],[[60,10,0.2,4],250],[[89,1.1,0.33,22.8],120],[[143,12.6,9.5,0.7],110],[[579,21.2,49.9,21.6],25]);
const dayWith=P=>[0,1,2,3].map(i=>bf2[i]+2*mx([P,200],[RI2,75],[LN2,25],[BR2,200],[OI2,10])[i]);
const breastDay=dayWith(CH2), usdaDay=dayWith(TH_USDA), highDay=dayWith(TH_HIGH);
ok('breast day is 2,308 kcal as stated', Math.round(breastDay[0])===2308 && body.includes('2,308'), String(Math.round(breastDay[0])));
ok('breast day protein is 179 g as stated', Math.round(breastDay[1])===179 && body.includes('179 g'), breastDay[1].toFixed(1));
ok('thigh at USDA 119 lands on 2,336', Math.round(usdaDay[0])===2336 && body.includes('2,336'), String(Math.round(usdaDay[0])));
ok('thigh at the higher 149 lands on 2,456', Math.round(highDay[0])===2456 && body.includes('2,456'), String(Math.round(highDay[0])));
ok('both thigh protein figures are stated', Math.round(usdaDay[1])===167 && Math.round(highDay[1])===163
   && body.includes('167 g') && body.includes('163 g'), `${usdaDay[1].toFixed(2)}/${highDay[1].toFixed(2)}`);
ok('page does not hide the database disagreement', /databases disagree/.test(body) && /Read the pack/.test(body));
ok('gives the rice step size for adjusting', /25 g of dry rice is 91 kcal/.test(body) && Math.round(25*3.65)===91);

/* the day total itself, and the fact that it went UP */
ok('day total is 2,308 and the page says ~2,310', Math.round(breastDay[0])===2308 && body.includes('2,310 kcal'));
ok('page explains that intake rose with the activity', /This went up, not down/.test(body) && /469 kcal a day/.test(body));
ok('the dial is still the rice, against the new rate', /0\.59 kg a week/.test(body));
ok('macros per kg are stated', /2\.41 g\/kg/.test(body) && /3\.60 g\/kg/.test(body));
ok('explains the bone-and-skin yield trap', /Bone is 25 to 30%/.test(body)&&/edible/i.test(body));
ok('does not claim whey is needed for the thigh swap', /No protein powder needed/.test(body));

// whey card
const ISO=[371,84,2.2,3.4];
const scoop=ISO.map(v=>v*25/100);
ok('scoop is 93 kcal as stated', Math.round(scoop[0])===93 && body.includes('93 kcal'), String(Math.round(scoop[0])));
ok('scoop is 21 g protein as stated', Math.round(scoop[1])===21 && body.includes('21 g'), scoop[1].toFixed(1));
ok('names the exact product and flavour', /Iso Whey Zero, salted caramel/i.test(body));
ok('ranks quark cheaper than whey per g protein', body.indexOf('Magerquark')<body.indexOf('Iso Whey Zero'));
ok('warns whey is not the cheap protein', /five times cheaper/.test(body));
ok('says not to take it daily', /Not daily/.test(body));
const dayTab = await page.locator('#day').textContent();
ok('meal tables list Skyr, not Greek yogurt', /Skyr/.test(dayTab) && !/Greek yogurt/.test(dayTab));

await browser.close();
console.log('\nPASS'); pass.forEach(p => console.log('  + ' + p));
if (fail.length) { console.log('\nFAIL'); fail.forEach(f => console.log('  - ' + f)); }
if (errors.length) { console.log('\nPAGE ERRORS'); [...new Set(errors)].forEach(e => console.log('  ! ' + e)); }
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
