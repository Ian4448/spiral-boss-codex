import { computeStats, SCHOOLS } from '../../site/src/stats.js';
import { readFileSync } from 'fs';
const items = JSON.parse(readFileSync('data/gear/items_sample.json'));
const byName = (n) => items.find((i) => i.name === n);

// Build a small known set and verify the math by hand.
const able = byName("Able Ranger's Hat");   // crit Death88/Ice73/Storm105, dmg D14/I14/S19, pierce Global2, hp318, ppc6, shadow8
const pick2 = items.filter(i => i.stats.damage && i.stats.resist).slice(0, 1)[0];
console.log('item A:', able.name, JSON.stringify(able.stats));
console.log('item B:', pick2.name, JSON.stringify(pick2.stats));

const t = computeStats([able, pick2]);
// checks
const expHealth = able.stats.maxHealth + (pick2.stats.maxHealth || 0);
console.log('\n--- assertions ---');
console.log('maxHealth sum:', t.maxHealth, '==', expHealth, t.maxHealth === expHealth ? 'OK' : 'FAIL');

// pierce Global2 should add to ALL schools
const pierceGlobalOK = SCHOOLS.every(s => t.pierce[s] >= 2);
console.log('pierce Global distributed to all schools:', pierceGlobalOK ? 'OK' : 'FAIL', '(Fire pierce =', t.pierce.Fire, ')');

// critical Storm should include Able's 105 (+ any from B)
const bStorm = (pick2.stats.critical && (pick2.stats.critical.Storm||0) + (pick2.stats.critical.Global||0)) || 0;
console.log('critical Storm:', t.critical.Storm, '== 105 +', bStorm, t.critical.Storm === 105 + bStorm ? 'OK' : 'FAIL');

// damage Storm = Able 19 + B(Storm+Global)
const bDmgStorm = (pick2.stats.damage.Storm||0)+(pick2.stats.damage.Global||0);
console.log('damage Storm:', t.damage.Storm, '== 19 +', bDmgStorm, t.damage.Storm === 19 + bDmgStorm ? 'OK' : 'FAIL');

console.log('\nfull totals:', JSON.stringify(t, null, 0).slice(0, 500));
