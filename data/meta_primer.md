# Wizard101 combat meta primer (for strategy writers)

## The core PvE loop
Combat is turn-based with pips (1 pip/round, power pips count double for your school).
The dominant strategy for almost every fight: **stack blades (+damage charms) and traps,
then end the fight with one huge attack — usually an AoE so minions die with the boss.**
Typical kill: 2-4 setup rounds → one hit. Feint (+70% trap, -30% self) is the highest-value
trap. Cheats exist specifically to break this loop; a boss's cheats tell you which part of
the loop you must adapt.

## Key tools players reach for
- **Aegis**: protects ONE positive charm/ward (blade, shield) from removal/steal — survives one cheat.
- **Indemnity**: protects ONE negative charm/ward (Feint, weakness) from cleanse/removal.
- **Sharpened Blade / Potent Trap**: enchants that let identical blades/traps stack.
- **Accuracy buffs / Sniper-enchants**: prevent fizzles (base accuracy: Storm 70% … Life 90%).
- **Prisms**: convert damage school — used when the boss resists your school.
- **Shadow spells / shadow-enhanced hits**: endgame damage, need shadow pips.
- **Doom and Gloom / infections**: cut boss healing.
- **Stun blocks**: counter stun cheats.
- **Triage**: removes a damage-over-time; **Cleanse Charm** removes a weakness/infection.

## School matchups
A boss resists its own school heavily and takes boosted damage from listed boost schools
(usually the opposite: Fire<->Ice, Storm<->Myth, Life<->Death; Balance resists itself, is
hit with anything or Spectral hits). Prefer the boosted school; never attack into resist
without a prism.

## Reading cheats
- "If a Wizard casts X, boss does Y" → punish cheat. Either avoid X, protect X (Aegis/
  Indemnity), or eat Y deliberately when Y is cheap.
- Round-timer cheats ("at the beginning of every Nth round") → plan burst windows around them.
- Threshold cheats ("below N health") → burst THROUGH the threshold in one round.
- Kill-order / respawn cheats → the order is the strategy; state it explicitly.
- Steal/cleanse cheats → Aegis on blades, Indemnity on Feints, or same-round setup+hit.
- Some cheats are exploitable in reverse (e.g. a cheat that moves the boss's own buffs to
  players on some trigger — deliberately trigger it). Look for these; they're the best tips.
- Fizzle-trigger cheats: fizzles can be forced deliberately (cast a low-accuracy spell with
  no accuracy buffs) or avoided (accuracy gear/enchants) — say which direction helps.

## Solo vs team fights
High-HP bosses (roughly 10k+ health, several minions, end-of-world or dungeon bosses —
e.g. Waterworks, Darkmoor Graveyard, Tartarus, Karamelle/Novus/Wallaru finales) are
usually fought as a team of 4:
one **hitter** (all blades funnel to them, hits last in turn order), **supports** who blade
the hitter and Feint the boss, and a **healer/utility** who manages cheats. If the boss is
clearly a big dungeon fight, write the plan in team terms (who blades, who triggers cheats,
when the hitter goes). Otherwise write it solo-friendly.

## Writing style for this site
- Minimal, direct, no emojis, no hype. Short sentences. Player second person ("open with…").
- Steps must be concrete and reference the boss's ACTUAL cheats/spells/numbers from the
  provided text. Never invent mechanics not present in the data.
- If cheat text is ambiguous, give the cautious practical reading rather than guessing.
