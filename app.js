"use strict";
(function (root) {
  const HOSTILE = new Set(["mafia", "sk", "wolf"]);
  const has = (p, m) => (p.mods || []).includes(m);

  const draw = (n, rnd) => Math.floor((rnd ? rnd() : Math.random()) * n);
  const pick = (arr, rnd) => arr[draw(arr.length, rnd)];
  function shuffle(arr, rnd) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = draw(i + 1, rnd); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const inst = (c) => ({ role: c.role, align: c.align, mods: c.mods ? [...c.mods] : [], items: c.items ? [...c.items] : [], as: c.as || null });
  const expandEntry = (e) => Array.from({ length: e.count ?? 1 }, () => inst(e));

  function matrixLines(rz) {
    const g = rz.grid, rows = g.length, cols = g[0].length, out = [];
    if (rz.lines.includes("rows")) for (const r of g) out.push(r);
    if (rz.lines.includes("cols")) for (let c = 0; c < cols; c++) out.push(g.map((r) => r[c]));
    if (rz.lines.includes("diagonals") && rows === cols) {
      out.push(g.map((r, i) => r[i]));
      out.push(g.map((r, i) => r[cols - 1 - i]));
    }
    return out;
  }

  function rollComposition(setup, rnd) {
    const rz = setup.randomize;
    if (rz && rz.mode === "matrix") {
      const line = pick(matrixLines(rz), rnd);
      return [...rz.base.flatMap(expandEntry), ...line.map(inst)];
    }
    if (rz && rz.mode === "oneOf") return pick(rz.options, rnd).flatMap(expandEntry);
    return (setup.roster || []).flatMap(expandEntry);
  }

  function deal(names, comp, rnd) {
    const roles = shuffle(comp, rnd);
    return shuffle(names, rnd).map((name, i) => ({ seat: i + 1, name, ...roles[i] }));
  }

  const KILLERS = new Set(["vigilante", "sniper", "serial-killer", "werewolf"]);
  const COPS = { cop: "sane", "naive-cop": "naive", "paranoid-cop": "paranoid", "insane-cop": "insane", "parity-cop": "parity", neapolitan: "neapolitan", rolecop: "role" };
  const VISITORS = new Set(["fruit-vendor", "silencer", "neighbourizer", "heartbreaker"]);
  function caps(p) {
    const r = p.role;
    const dayOnly = r === "sniper" || has(p, "day");
    return {
      protector: ["medic", "nerfed-medic", "jailkeeper"].includes(r),
      bodyguard: r === "bodyguard",
      blocker: r === "roleblocker" || r === "jailkeeper",
      cop: COPS[r] || null,
      tracker: r === "tracker",
      watcher: r === "watcher",
      mortician: r === "mortician",
      commuter: r === "commuter",
      joat: r === "joat" || r === "mafia-joat",
      gunsmith: r === "gunsmith",
      visitor: VISITORS.has(r),
      nightKiller: KILLERS.has(r) && !dayOnly,
      dayKiller: (KILLERS.has(r) && dayOnly) || (p.items || []).includes("gun"),
      shots: shotCount(p),
      poisoner: r === "poisoner",
      poisonHealer: r === "poison-healer",
      strongman: r === "strongman",
      godfather: r === "godfather",
      absorbs: r === "bulletproof" || (p.items || []).includes("vest"),
      linked: r === "lover",
      vengeful: has(p, "vengeful") || r === "heartbreaker",
      smart: has(p, "smart"),
      stupid: has(p, "stupid"),
    };
  }
  function shotCount(p) {
    if (has(p, "one-shot")) return 1;
    if (has(p, "two-shot")) return 2;
    if (has(p, "three-shot")) return 3;
    return Infinity;
  }
  function nightAllowed(p, n) {
    if (has(p, "odd-night")) return n % 2 === 1;
    if (has(p, "even-night")) return n % 2 === 0;
    return true;
  }

  function kpFor(setup, mafiaAlive, n, ghosts) {
    const x = setup.mafiaKp ?? 1;
    if (n === 0) return Math.max(0, (setup.n0Kp ?? x) - (ghosts || 0));
    const till = setup.kpTill || 0;
    return till && mafiaAlive <= till ? Math.max(0, x - 1) : x;
  }

  const alive = (players, dead) => players.filter((p) => !dead.has(p.name));
  const byName = (players, name) => players.find((p) => p.name === name);

  function winnerAt(players, dead) {
    const live = alive(players, dead);
    const threats = live.filter((p) => HOSTILE.has(p.align));
    if (!threats.length) return "Town";
    const byFaction = {};
    for (const p of threats) byFaction[p.align] = (byFaction[p.align] || 0) + 1;
    for (const [f, c] of Object.entries(byFaction))
      if (c >= live.length - c) return f[0].toUpperCase() + f.slice(1);
    return null;
  }

  function resolveNight(setup, players, night, before, priorNights, priorDays) {
    const live = alive(players, before);
    const liveNames = new Set(live.map((p) => p.name));
    const act = (name) => liveNames.has(name);
    const kills = night.kills || {};
    const acts = night.acts || {};
    const modes = night.modes || {};
    const can = (p) => acts[p.name] && nightAllowed(p, night.n) && shotsLeft(p, priorNights, priorDays) > 0;
    const joatAs = (p, mode) => caps(p).joat && modes[p.name] === mode && !joatUsed(p, mode, priorNights);

    const cs = new Map(live.map((p) => [p, caps(p)]));
    const blocked = new Set();
    for (const [p, c] of cs) {
      const t = acts[p.name];
      if (c.blocker && can(p) && act(t)) blocked.add(t);
    }
    const working = (p) => !blocked.has(p.name);

    const commuting = new Set();
    const protectedOf = new Set();
    const redirect = new Map();
    for (const [p, c] of cs) {
      if (!working(p) || !can(p)) continue;
      const t = acts[p.name];
      if (c.commuter) { commuting.add(p.name); continue; }
      if (!act(t)) continue;
      if (c.protector || joatAs(p, "save")) protectedOf.add(t);
      if (c.bodyguard) redirect.set(t, p.name);
    }

    const force = night.force || {};
    const killForce = night.killForce || [];
    const strong = live.some((p) => cs.get(p).strongman);
    const shots = [];
    (kills.mafia || []).forEach((t, i) => {
      if (t) shots.push({ target: t, faction: "mafia", unsaveable: strong, force: killForce[i] });
    });
    for (const [f, targets] of [["sk", kills.sk || []], ["wolf", kills.wolf || []]])
      for (const t of targets) if (t) shots.push({ target: t, faction: f });
    for (const [p, c] of cs) {
      const t = acts[p.name];
      if (!working(p) || !can(p) || !act(t)) continue;
      if (c.nightKiller || joatAs(p, "shoot"))
        shots.push({ target: t, faction: p.align, smart: c.smart, stupid: c.stupid, force: force[p.name] });
    }

    const deaths = new Set();
    const absorbUsed = new Set();
    for (const s of shots) {
      if (s.force === "none") continue;
      if (s.force === "kill") { if (!before.has(s.target)) deaths.add(s.target); continue; }
      let victim = s.target;
      if (redirect.has(victim)) victim = redirect.get(victim);
      const vp = byName(players, victim);
      if (!vp || before.has(victim) || commuting.has(victim)) continue;
      if (s.smart && vp.align === "town") continue;
      if (s.stupid && vp.align !== "town") continue;
      if (!s.unsaveable && protectedOf.has(victim)) continue;
      if (caps(vp).absorbs && !absorbUsed.has(victim)) { absorbUsed.add(victim); continue; }
      deaths.add(victim);
    }

    const checks = {};
    for (const [p, c] of cs) {
      const t = acts[p.name];
      if (!working(p) || !can(p)) continue;
      if (c.mortician) {
        if (before.has(t)) {
          const dp = byName(players, t);
          checks[p.name] = { kind: "mortician", target: t, result: `${dp.as || dp.role} (${dp.align})` };
        }
        continue;
      }
      if (!act(t)) continue;
      if (c.cop) checks[p.name] = copResult(c.cop, p, byName(players, t), t, priorNights, players);
      else if (joatAs(p, "check")) checks[p.name] = copResult("sane", p, byName(players, t), t, priorNights, players);
      else if (c.tracker) checks[p.name] = { kind: "tracker", target: t, visited: acts[t] && act(acts[t]) ? acts[t] : null };
      else if (c.watcher) checks[p.name] = { kind: "watcher", target: t, visitors: live.filter((q) => acts[q.name] === t && working(q)).map((q) => q.name) };
    }

    const poisoned = [], guns = [];
    for (const [p, c] of cs) {
      const t = acts[p.name];
      if (!working(p) || !can(p) || !act(t)) continue;
      if (c.poisoner && force[p.name] !== "none") poisoned.push(t);
      if (c.gunsmith) guns.push(t);
    }

    return { deaths, checks, poisoned, guns };
  }

  function shotsLeft(p, priorNights, priorDays) {
    const max = shotCount(p);
    if (max === Infinity) return Infinity;
    let used = priorNights.filter((nd) => nd.acts && nd.acts[p.name]).length;
    for (const d of Object.values(priorDays || {}))
      if (d && d.shots && d.shots[p.name]) used++;
    return max - used;
  }
  function joatUsed(p, mode, priorNights) {
    return priorNights.some((nd) => nd.acts && nd.acts[p.name] && nd.modes && nd.modes[p.name] === mode);
  }

  function copResult(kind, cop, target, targetName, priorNights, players) {
    if (kind === "role") return { kind: "role", target: targetName, role: target ? (target.as || target.role) : "?" };
    if (kind === "neapolitan") return { kind: "neapolitan", target: targetName, result: target && target.role === "vt" && target.align === "town" ? "vanilla" : "not vanilla" };
    let real = target ? readsAs(target) : "town";
    if (kind === "naive") real = "town";
    else if (kind === "paranoid") real = "mafia";
    else if (kind === "insane") real = real === "town" ? "mafia" : "town";
    if (kind === "parity") {
      const prev = priorNights.filter((nd) => copActed(nd, cop.name)).at(-1);
      if (!prev) return { kind: "parity", target: targetName, result: "first check, no result" };
      const prevT = byName(players, prev.acts[cop.name]);
      const same = prevT && readsAs(prevT) === readsAs(target);
      return { kind: "parity", target: targetName, vs: prev.acts[cop.name], result: same ? "SAME" : "DIFFERENT" };
    }
    return { kind: "align", target: targetName, result: real.toUpperCase() };
  }
  const readsAs = (p) => (caps(p).godfather ? "town" : p.align === "town" ? "town" : "mafia");
  const copActed = (nd, name) => nd.acts && nd.acts[name];

  function timeline(setup, players, nights, votes, ghosts, days) {
    days = days || {};
    const dead = new Set();
    const beforeDay = {}, beforeNight = {}, deaths = {}, dayDeaths = {}, nightInfo = {}, owedPoison = {}, gunsFor = {};
    const nightMax = nights.length ? Math.max(...nights.map((x) => x.n)) : -1;
    const voteMax = Object.keys(votes).length ? Math.max(...Object.keys(votes).map(Number)) : -1;
    const dayMax = Object.keys(days).length ? Math.max(...Object.keys(days).map(Number)) : -1;
    const maxN = Math.max(nightMax, voteMax, dayMax);
    const lovers = players.filter((p) => caps(p).linked).map((p) => p.name);

    const cascade = (justDied) => {
      let added = true;
      while (added) {
        added = false;
        for (const name of [...justDied]) {
          if (lovers.includes(name)) for (const other of lovers)
            if (other !== name && !dead.has(other)) { dead.add(other); justDied.add(other); added = true; }
        }
      }
    };
    const die = (name, bag) => {
      if (dead.has(name) || !byName(players, name)) return;
      dead.add(name); bag.push(name);
      const chain = new Set([name]);
      cascade(chain);
      for (const x of chain) if (x !== name && !bag.includes(x)) bag.push(x);
    };

    for (let n = 0; n <= maxN; n++) {
      beforeDay[n] = new Set(dead);
      dayDeaths[n] = [];
      if (n >= 1 && !winnerAt(players, beforeDay[n])) {
        const d = days[n] || {};
        const cured = new Set(d.cures || []);
        for (const name of owedPoison[n - 1] || []) if (!cured.has(name)) die(name, dayDeaths[n]);
        for (const [actor, target] of Object.entries(d.shots || {}))
          if (actor && target && !dead.has(actor) && !dead.has(target) && (d.shotForce || {})[actor] !== "none")
            die(target, dayDeaths[n]);
        let lynched = false;
        for (const v of votes[n] || []) if (v && !dead.has(v)) { die(v, dayDeaths[n]); lynched = true; }
        if (setup.sleepPunishment && !lynched && d.sleepKill) die(d.sleepKill, dayDeaths[n]);
        for (const e of d.events || []) if (e.kind === "death" && e.who) die(e.who, dayDeaths[n]);
      }
      beforeNight[n] = new Set(dead);
      const nd = nights.find((x) => x.n === n);
      if (nd && !winnerAt(players, beforeNight[n]) && !setup.nightless) {
        const prior = nights.filter((x) => x.n < n);
        const priorDays = {};
        for (const k of Object.keys(days)) if (Number(k) <= n) priorDays[k] = days[k];
        const info = resolveNight(setup, players, nd, beforeNight[n], prior, priorDays);
        nightInfo[n] = info;
        const bag = [];
        if (n === 0 && ghosts) for (const g of ghosts) die(g, bag);
        for (const name of info.deaths) die(name, bag);
        for (const e of nd.events || []) if (e.kind === "death" && e.who) die(e.who, bag);
        deaths[n] = bag;
        owedPoison[n] = info.poisoned;
        gunsFor[n + 1] = info.guns;
      } else { deaths[n] = []; nightInfo[n] = null; }
    }
    return { beforeDay, beforeNight, deaths, dayDeaths, nightInfo, dead, owedPoison, gunsFor };
  }

  root.Engine = {
    shuffle, matrixLines, rollComposition, deal, caps, kpFor, shotsLeft, nightAllowed,
    winnerAt, resolveNight, timeline, alive, byName, HOSTILE,
  };
})(typeof module !== "undefined" && module.exports ? module.exports : (typeof window !== "undefined" ? window : globalThis));
if (typeof module !== "undefined" && module.exports) module.exports = module.exports.Engine;

const E = typeof window !== "undefined" ? window.Engine : null;
let CATALOG = null;
const MINE_KEY = "setup-desk-mine";
const GAME_KEY = "setup-desk-game";

const GUIDES = {
  library: [
    { sel: "#g-setups", title: "Setup library",
      body: "Every confirmed setup, smallest to largest, plus anything you saved in this browser (tagged \"yours\"). Click one to preview it.\nNew setup opens the builder empty; Import loads a setup JSON someone sent you." },
    { sel: "#g-detail", title: "Setup preview",
      body: "The full role list — hover any role or modifier for what it does. Below: special rules the app leaves to you, and the link to the original setup description you can share with players.\nRun in console starts a game with it; Edit / copy opens it in the builder." },
  ],
  builder: [
    { sel: "#g-meta", title: "Game shape",
      body: "Name, player count, and the table rules: day or night start, whether deaths reveal alignment, how many parallel day votes, mafia kill power as X KP stepping down once the team shrinks to N, nightless, and sleep punishment (no exile grants the mafia a night kill).\nThe seat counter top-right goes green when the roster matches the player count." },
    { sel: "#g-roster", title: "Roster",
      body: "One row per role block: pick the base role, how many, which side, and an optional display name for flavour.\nEngine modifiers are the programmed ones — hover each for what it does; ticking it changes how the console resolves the role. Tags are free-text flavour shown to the mod but not enforced." },
    { sel: "#g-save", title: "Saving",
      body: "Save to my browser keeps the setup in your own Library on this device. Export JSON downloads it as a file — send that to Dr Morris to get the setup added to the shared dropdown for everyone." },
  ],
  "console-names": [
    { sel: "#g-names", title: "Seating",
      body: "Paste or type the players, one per line or comma separated. The counter goes green at the exact player count, then Deal roles shuffles the setup onto them.\nThe description link here is the one you share with the lobby." },
  ],
  "console-deal": [
    { sel: "#g-deal", title: "The deal",
      body: "Roles are dealt at random and listed mafia first (power roles above vanilla), then town. For randomised setups the matrix or sub-setup roll happens now — Re-deal rolls again.\nCopy the reveal block for Discord, then Accept & run." },
  ],
  "console-play": [
    { sel: ".stats", title: "Counts",
      body: "Live town and threat counts, players alive, and the votes needed for a lynch." },
    { sel: "#g-proster", title: "Roster",
      body: "Alive players with their roles — hover a role for what it does. Dead players get struck through with a †D or †N mark for when they died. Click a name to rename them mid-game; everything recorded follows the rename." },
    { sel: "#g-reveal", title: "Reveal and exports",
      body: "The spoilered role reveal for Discord, the setup description link to share, and Full export — the whole game as one text block. New game discards this one." },
    { sel: "main .card.phase-day", title: "Days",
      body: "Each day card records the vote (or several, when the setup uses parallel votes). Poisoned players show here with a cure option when a healer is alive, day shooters get their shot controls, and on a no-exile day sleep punishment offers the mafia kill.\n+ event records anything a special rule caused: pick a person, death or note, and the reason. Deaths count mechanically; notes just go in the log." },
    { sel: "main .card.phase-night", title: "Nights",
      body: "Record the mafia kill(s) and every power role's action. Investigative results appear inline next to the action, and each check also gets its own copy block so you can DM it to the player as-is.\n+ event records anything a special rule caused — deaths count, notes just log. The discord block lists everything that happened; rolls for next day's formals live here too." },
  ],
};

const blankGame = () => ({ phase: "names", nameInput: "", pending: [], players: [], nights: [], votes: {}, days: {}, err: "" });
const blankNight = (n) => ({ n, kills: { mafia: [] }, acts: {}, modes: {}, force: {}, killForce: [], dream: {}, events: [], rng: [null, null] });
const blankDay = () => ({ shots: {}, shotForce: {}, cures: [], events: [], sleepKill: "" });

const blankDraft = () => ({
  name: "", players: 9, start: "day", nightless: false, reveal: "full",
  sleepPunishment: false, mafiaKp: 1, kpTill: 0, dayVotes: 1, pastebin: "", notes: "",
  roster: [{ role: "mafia", count: 1, align: "mafia", mods: [], tags: [], tagsText: "", as: "" }],
  randomize: null,
});

function boot() {
const app = Vue.createApp({
  data() {
    return {
      route: "library",
      catalog: CATALOG,
      bundled: window.__setups,
      mine: JSON.parse(localStorage.getItem(MINE_KEY) || "[]"),
      selected: null,
      libSearch: "",
      folds: JSON.parse(localStorage.getItem("setup-desk-folds") || "{}"),
      theme: localStorage.getItem("setup-desk-theme") || "gruvbox",
      font: localStorage.getItem("setup-desk-font") || "classic",
      draft: blankDraft(),
      run: { setup: null },
      game: blankGame(),
      exportOpen: false,
      tour: { on: false, i: 0, total: 0, title: "", body: "", spot: {}, tip: {} },
    };
  },
  watch: {
    game: { deep: true, handler() { this.persist(); } },
    "run.setup"() { this.persist(); },
  },
  computed: {
    allSetups() { return [...this.bundled, ...this.mine.map((s) => ({ ...s, _mine: true }))]; },
    groupedSetups() {
      const terms = this.libSearch.toLowerCase().split(/\s+/).filter(Boolean).filter((t) => t !== "players" && t !== "player");
      const hay = (s) => {
        const bits = [s.name, s.start + " start",
          s.nightless ? "nightless" : "", s.sleepPunishment ? "sleep punishment" : "",
          s.randomize ? "randomised random matrix" : "", s._mine ? "yours mine" : "", s.notes || ""];
        const entries = s.randomize
          ? [...(s.randomize.base || []), ...(s.randomize.grid || []).flat(), ...(s.randomize.options || []).flat()]
          : (s.roster || []);
        for (const e of entries) bits.push(e.role, this.displayName(e), ...(e.mods || []), ...(e.tags || []));
        return bits.join(" ").toLowerCase();
      };
      const matches = (s) => {
        const h = hay(s);
        return terms.every((t) => {
          const num = t.match(/^(\d+)p?$/);
          return num ? s.players === Number(num[1]) : h.includes(t);
        });
      };
      const match = terms.length ? this.allSetups.filter(matches) : this.allSetups;
      const groups = {};
      for (const s of match) (groups[s.players] = groups[s.players] || []).push(s);
      return Object.keys(groups).map(Number).sort((a, b) => a - b)
        .map((p) => ({ players: p, setups: groups[p], open: terms.length > 0 || !!this.folds[p] }));
    },
    rosterSum() { return (this.draft.roster || []).reduce((n, e) => n + (e.count || 0), 0); },
    exportJson() { return JSON.stringify(this.cleanDraft(), null, 2); },

    nameList() { return this.game.nameInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean); },
    rolledSummary() { return this.game.pending.map((p) => this.instName(p)).join(", "); },

    timeline() {
      if (this.game.phase !== "play") return null;
      return E.timeline(this.run.setup, this.game.players, this.game.nights, this.game.votes, [], this.game.days);
    },
    deadSet() { return this.timeline ? this.timeline.dead : new Set(); },
    winner() { return this.timeline ? E.winnerAt(this.game.players, this.timeline.dead) : null; },
    marks() {
      const m = {}, t = this.timeline;
      if (!t) return m;
      for (const [d, ds] of Object.entries(t.dayDeaths || {})) for (const nm of ds) m[nm] = "†D" + d;
      for (const [n, ds] of Object.entries(t.deaths)) for (const nm of ds) m[nm] = m[nm] || "†N" + n;
      return m;
    },
    live() {
      const al = E.alive(this.game.players, this.deadSet);
      const threat = al.filter((p) => E.HOSTILE.has(p.align)).length;
      return { total: al.length, threat, town: al.length - threat, majority: Math.floor(al.length / 2) + 1 };
    },
    revealText() {
      const groups = {};
      const roster = this.game.players.length ? this.game.players : this.game.pending;
      for (const p of roster) {
        const k = this.instName(p) + "|" + p.align;
        (groups[k] = groups[k] || []).push(p.name);
      }
      const lines = ["**Reveal**"];
      const maf = roster.filter((p) => p.align === "mafia").map((p) => p.name);
      if (maf.length) lines.push(`Mafia team: ||${maf.join(", ")}||`);
      for (const [k, names] of Object.entries(groups)) {
        const [role, align] = k.split("|");
        if (align === "mafia" && role === "Mafia") continue;
        lines.push(`${role}: ||${names.join(", ")}||`);
      }
      return lines.join("\n");
    },
    phaseBlocks() {
      const t = this.timeline, setup = this.run.setup, out = [];
      if (!t) return out;
      const aliveNames = (dead) => E.alive(this.game.players, dead).map((p) => p.name);
      for (const nd of [...this.game.nights].sort((a, b) => a.n - b.n)) {
        const n = nd.n;
        if (n >= 1) {
          const dead = t.beforeDay[n] || new Set();
          const decided = !!E.winnerAt(this.game.players, dead);
          const aliveP = decided ? [] : E.alive(this.game.players, dead);
          const aliveD = aliveP.map((p) => p.name);
          const owed = decided ? [] : (t.owedPoison[n - 1] || []).filter((x) => !dead.has(x));
          const healers = aliveP.filter((p) => E.caps(p).poisonHealer && this.dayShotsLeft(p, n) > 0).map((p) => p.name);
          const granted = new Set(t.gunsFor[n] || []);
          const shooters = aliveP
            .filter((p) => granted.has(p.name) || (E.caps(p).dayKiller && this.dayShotsLeft(p, n) > 0))
            .map((p) => ({ name: p.name, role: this.instName(p) + (granted.has(p.name) ? " (gun)" : ""), targets: aliveD.filter((x) => x !== p.name) }));
          out.push({ key: "d" + n, type: "day", n, decided,
            slots: setup.dayVotes || 1, alive: aliveD, owed, healers, shooters, sleep: !!setup.sleepPunishment });
        }
        if (setup.nightless) continue;
        const before = t.beforeNight[n] || new Set();
        if (E.winnerAt(this.game.players, before)) { out.push({ key: "n" + n, type: "night", n, decided: true }); continue; }
        const liveP = E.alive(this.game.players, before);
        const names = liveP.map((p) => p.name);
        const mafiaAlive = liveP.filter((p) => p.align === "mafia").length;
        const kp = setup.nightless ? 0 : E.kpFor(setup, mafiaAlive, n, 0);
        const info = t.nightInfo[n];
        const checks = info ? Object.entries(info.checks) : [];
        const priorN = this.game.nights.filter((x) => x.n < n);
        const priorD = {};
        for (const k of Object.keys(this.game.days)) if (Number(k) <= n) priorD[k] = this.game.days[k];
        const benched = [];
        const actors = liveP.map((p) => ({ p, c: E.caps(p) }))
          .filter(({ p, c }) => c.cop || c.tracker || c.watcher || c.protector || c.bodyguard || c.blocker
            || c.nightKiller || c.poisoner || c.mortician || c.commuter || c.joat || c.gunsmith || c.visitor || p.role === "dreamer")
          .filter(({ p, c }) => {
            if (c.dayKiller && !c.nightKiller && !c.cop) return false;
            if (!E.nightAllowed(p, n) && !(nd.acts || {})[p.name]) {
              benched.push({ name: p.name, role: this.instName(p), why: (p.mods || []).includes("odd-night") ? "acts on odd nights" : "acts on even nights" });
              return false;
            }
            if (!c.joat && E.shotsLeft(p, priorN, priorD) <= 0 && !(nd.acts || {})[p.name]) {
              benched.push({ name: p.name, role: this.instName(p), why: "no uses left" });
              return false;
            }
            return true;
          })
          .map(({ p, c }) => {
            let targets = names.filter((x) => x !== p.name);
            if (c.mortician) targets = this.game.players.filter((q) => before.has(q.name)).map((q) => q.name);
            if (c.commuter) targets = ["(commute)"];
            return {
              name: p.name, role: this.instName(p), desc: this.roleDesc(p),
              forceable: !!(c.nightKiller || c.poisoner || (c.joat && (nd.modes || {})[p.name] === "shoot")),
              force: (nd.force || {})[p.name] || "",
              targets, joat: c.joat, mode: (nd.modes || {})[p.name] || "",
              modeOpts: c.joat ? ["save", "shoot", "check"].filter((m) =>
                m === (nd.modes || {})[p.name] ||
                !this.game.nights.some((x) => x.n < n && x.acts && x.acts[p.name] && x.modes && x.modes[p.name] === m)) : [],
              dreamer: p.role === "dreamer", dream: (nd.dream || {})[p.name] || "",
              holster: c.nightKiller || c.poisoner || c.joat ? "holster" : "no action",
              result: info && info.checks[p.name] ? this.checkInline(info.checks[p.name]) : "",
            };
          });
        const checkList = checks.map(([who, r]) => ({ who, msg: this.checkMsg(r) }));
        for (const [who, txt] of Object.entries(nd.dream || {})) if (txt) checkList.push({ who, msg: txt });
        out.push({
          key: "n" + n, type: "night", n, decided: false, kp,
          alive: names, actors, benched,
          checks: checkList,
          discord: this.nightDiscord(n, nd, info),
        });
      }
      return out;
    },
    nextLabel() {
      const ns = this.game.nights.map((x) => x.n);
      const next = ns.length ? Math.max(...ns) + 1 : (this.run.setup.start === "night" ? 0 : 1);
      if (this.run.setup.nightless) return `Start Day ${next}`;
      return next === 0 ? "Start Night 0" : `Start Day ${next} & Night ${next}`;
    },
  },
  methods: {
    rosterOf(s) { return s.randomize ? (s.randomize.base || []) : (s.roster || []); },
    kpLabel(s) { const x = s.mafiaKp ?? 1; return `mafia ${x} KP` + (s.kpTill ? ` till ${s.kpTill}` : ""); },
    setPref(kind, val) {
      const base = kind === "theme" ? "gruvbox" : "classic";
      if (val === base) delete document.documentElement.dataset[kind];
      else document.documentElement.dataset[kind] = val;
      localStorage.setItem("setup-desk-" + kind, val);
    },
    importFile(ev) {
      const f = ev.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        try { this.editSetup(JSON.parse(txt)); }
        catch (e) { alert("that file is not a valid setup JSON"); }
        ev.target.value = "";
      });
    },
    set(o, k, v) { if (v) o[k] = v; else delete o[k]; },
    setIdx(arr, i, v) { arr[i] = v; },
    toggleFold(p) {
      this.folds = { ...this.folds, [p]: !this.folds[p] };
      localStorage.setItem("setup-desk-folds", JSON.stringify(this.folds));
    },
    roleDesc(e) {
      const r = this.catalog.roles[e.role];
      return r ? r.desc + (e.mods || []).map((m) => this.catalog.mods[m] ? `\n${m}: ${this.catalog.mods[m].desc}` : "").join("") : "";
    },
    modDescs(e) {
      return (e.mods || []).map((m) => this.catalog.mods[m] ? `${m}: ${this.catalog.mods[m].desc}` : m).join("\n");
    },

    guidePage() {
      if (this.route !== "console") return this.route;
      return "console-" + (this.game.phase === "play" ? "play" : this.game.phase);
    },
    tourVisible() {
      return (GUIDES[this.guidePage()] || []).filter((st) => {
        const el = document.querySelector(st.sel);
        return el && el.offsetParent !== null;
      });
    },
    tourStart() { this.tour.on = true; this.tour.i = 0; this.tourShow(); },
    tourEnd() { this.tour.on = false; this.tour.title = ""; },
    tourNext() {
      if (this.tour.i < this.tourVisible().length - 1) { this.tour.i++; this.tourShow(); }
      else this.tourEnd();
    },
    tourPrev() { if (this.tour.i > 0) { this.tour.i--; this.tourShow(); } },
    tourShow() {
      const t = this.tour;
      const steps = this.tourVisible();
      t.total = steps.length;
      const st = steps[t.i];
      if (!st) { this.tourEnd(); return; }
      const el = document.querySelector(st.sel);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      t.title = "";
      setTimeout(() => {
        const r = el.getBoundingClientRect(), pad = 6;
        t.spot = { left: (r.left - pad) + "px", top: (r.top - pad) + "px",
          width: (r.width + pad * 2) + "px", height: (r.height + pad * 2) + "px" };
        t.title = st.title; t.body = st.body;
        this.$nextTick(() => {
          const tip = document.querySelector(".gtip");
          const w = (tip && tip.offsetWidth) || 330, h = (tip && tip.offsetHeight) || 170;
          let top = r.bottom + 12;
          if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 12);
          const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
          t.tip = { top: top + "px", left: left + "px" };
        });
      }, 240);
    },
    displayName(e) { return e.as || (this.catalog.roles[e.role] ? this.catalog.roles[e.role].name : e.role); },
    instName(p) { return p.as || (this.catalog.roles[p.role] ? this.catalog.roles[p.role].name : p.role); },
    toConsole(s) {
      this.run.setup = JSON.parse(JSON.stringify(s));
      this.game = blankGame();
      this.route = "console";
    },
    editSetup(s) {
      const d = JSON.parse(JSON.stringify(s));
      d.dayVotes = d.dayVotes || 1; d.kpTill = d.kpTill || 0;
      d.start = d.start || "day"; d.reveal = d.reveal || "full";
      d.mafiaKp = d.mafiaKp ?? 1; d.pastebin = d.pastebin || ""; d.notes = d.notes || "";
      for (const e of d.roster || []) { e.mods = e.mods || []; e.tags = e.tags || []; e.tagsText = e.tags.join(", "); e.as = e.as || ""; }
      this.draft = d; this.route = "builder";
    },
    newSetup() { this.draft = blankDraft(); this.route = "builder"; },

    addRosterRow() { this.draft.roster.push({ role: "vt", count: 1, align: "town", mods: [], tags: [], tagsText: "", as: "" }); },
    splitMods(s) { return s.split(",").map((x) => x.trim()).filter(Boolean); },
    hasMod(e, id) { return (e.mods || []).includes(id); },
    toggleMod(e, id) {
      if (!e.mods) e.mods = [];
      const i = e.mods.indexOf(id);
      if (i >= 0) e.mods.splice(i, 1); else e.mods.push(id);
    },
    cleanDraft() {
      const d = JSON.parse(JSON.stringify(this.draft));
      delete d.importText;
      if (d.roster) d.roster = d.roster.map((e) => {
        const o = { role: e.role, count: e.count, align: e.align };
        if (e.mods && e.mods.length) o.mods = e.mods;
        if (e.tags && e.tags.length) o.tags = e.tags;
        if (e.as) o.as = e.as;
        return o;
      });
      return d;
    },
    saveMine() {
      const clean = this.cleanDraft();
      if (!clean.name) { alert("give the setup a name first"); return; }
      const i = this.mine.findIndex((s) => s.name === clean.name);
      if (i >= 0) this.mine.splice(i, 1, clean); else this.mine.push(clean);
      localStorage.setItem(MINE_KEY, JSON.stringify(this.mine));
      this.route = "library"; this.selected = this.allSetups.find((s) => s.name === clean.name);
    },
    downloadExport() {
      const blob = new Blob([this.exportJson], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (this.draft.name || "setup").toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
      a.click();
    },

    dealNow() {
      const comp = E.rollComposition(this.run.setup);
      if (comp.length !== this.run.setup.players) {
        this.game.err = `setup deals ${comp.length}, expected ${this.run.setup.players}`; return;
      }
      this.game.err = "";
      this.game.pending = this.sortRoster(E.deal(this.nameList, comp));
      this.game.phase = "deal";
    },
    sortRoster(players) {
      const rank = { mafia: 0, sk: 1, wolf: 2, town: 3 };
      const vanilla = (p) => (p.role === "vt" || p.role === "mafia" ? 1 : 0);
      return [...players]
        .sort((a, b) => (rank[a.align] - rank[b.align]) || (vanilla(a) - vanilla(b)) || a.name.localeCompare(b.name))
        .map((p, i) => ({ ...p, seat: i + 1 }));
    },
    startGame() {
      this.game.players = this.game.pending;
      this.game.nights = [];
      this.game.votes = {};
      const first = this.run.setup.nightless ? 1 : (this.run.setup.start === "night" ? 0 : 1);
      this.openPhase(first);
      this.game.phase = "play";
    },
    advance() {
      const missing = [];
      for (const blk of this.phaseBlocks) {
        if (blk.type !== "night" || blk.decided) continue;
        const set = this.night(blk.n).kills.mafia.filter(Boolean).length;
        if (set < blk.kp) missing.push(`Night ${blk.n}: ${blk.kp - set} mafia kill(s) not recorded`);
      }
      if (missing.length && !confirm("Finish recording first?\n" + missing.join("\n") + "\n\nContinue anyway?")) return;
      const ns = this.game.nights.map((x) => x.n);
      this.openPhase(Math.max(...ns) + 1);
    },
    openPhase(n) {
      this.game.nights.push(blankNight(n));
      if (n >= 1) {
        if (!this.game.votes[n]) this.game.votes[n] = [];
        if (!this.game.days[n]) this.game.days[n] = blankDay();
      }
    },
    persist() {
      if (this.game.phase === "play" || this.game.phase === "deal")
        localStorage.setItem(GAME_KEY, JSON.stringify({ run: this.run, game: this.game }));
    },
    newGame() {
      if (!confirm("Start a new game? The current one is discarded.")) return;
      localStorage.removeItem(GAME_KEY);
      this.game = blankGame();
      this.exportOpen = false;
    },
    renamePlayer(p) {
      const cur = p.name;
      const input = prompt(`Rename ${cur}:`, cur);
      if (input == null) return;
      const n = input.trim();
      if (!n || n === cur) return;
      if (this.game.players.some((x) => x !== p && x.name.toLowerCase() === n.toLowerCase())) { alert(`"${n}" is taken.`); return; }
      p.name = n;
      for (const nd of this.game.nights) {
        nd.kills.mafia = (nd.kills.mafia || []).map((k) => (k === cur ? n : k));
        const acts = {};
        for (const [w, t] of Object.entries(nd.acts || {})) acts[w === cur ? n : w] = t === cur ? n : t;
        nd.acts = acts;
      }
      for (const nd of this.game.nights) {
        for (const e of nd.events || []) if (e.who === cur) e.who = n;
        for (const key of ["modes", "force", "dream"]) {
          if (!nd[key]) continue;
          const m = {};
          for (const [w, v] of Object.entries(nd[key])) m[w === cur ? n : w] = v;
          nd[key] = m;
        }
      }
      for (const d of Object.keys(this.game.votes))
        this.game.votes[d] = (this.game.votes[d] || []).map((v) => (v === cur ? n : v));
      for (const d of Object.values(this.game.days)) {
        for (const key of ["shots", "shotForce"]) {
          if (!d[key]) continue;
          const m = {};
          for (const [w, t] of Object.entries(d[key])) m[w === cur ? n : w] = t === cur ? n : t;
          d[key] = m;
        }
        if (d.cures) d.cures = d.cures.map((v) => (v === cur ? n : v));
        for (const e of d.events || []) if (e.who === cur) e.who = n;
        if (d.sleepKill === cur) d.sleepKill = n;
      }
    },
    cureToggle(n, name, on) {
      const cures = this.game.days[n].cures;
      const i = cures.indexOf(name);
      if (on && i < 0) cures.push(name);
      if (!on && i >= 0) cures.splice(i, 1);
    },
    dayShotsLeft(p, n) {
      const c = E.caps(p);
      let max = c.shots;
      if (max === Infinity && (p.items || []).includes("gun")) max = 1;
      if (max === Infinity) return 1;
      let used = 0;
      for (const nd of this.game.nights) if (nd.acts && nd.acts[p.name]) used++;
      for (const [k, d] of Object.entries(this.game.days))
        if (Number(k) < n && d.shots && d.shots[p.name]) used++;
      return max - used;
    },
    rollDream(n, name, mode) {
      const t = this.timeline;
      const liveP = E.alive(this.game.players, t.beforeNight[n] || new Set()).filter((p) => p.name !== name);
      let txt;
      if (mode === "one") {
        const town = E.shuffle(liveP.filter((p) => p.align === "town"));
        txt = town.length ? `You dream of one: ${town[0].name} (town)` : "no town to dream of";
      } else {
        const maf = E.shuffle(liveP.filter((p) => p.align !== "town"));
        const rest = E.shuffle(liveP.filter((p) => p.name !== (maf[0] && maf[0].name)));
        const three = E.shuffle([maf[0], rest[0], rest[1]].filter(Boolean)).map((p) => p.name);
        txt = `You dream of three: ${three.join(", ")} (at least one is mafia)`;
      }
      this.night(n).dream[name] = txt;
    },
    nightRng(n) { const nd = this.night(n); return (nd && nd.rng) || [null, null]; },
    rollRng(n, i) {
      this.night(n).rng[i] = i === 1 ? (Math.random() < 0.5 ? 1 : 0) : (Math.random() < 2 / 3 ? 1 : 0);
    },
    night(n) { return this.game.nights.find((x) => x.n === n); },

    checkInline(r) {
      if (r.kind === "role") return "→ " + r.role;
      if (r.kind === "tracker") return "→ " + (r.visited || "no visit");
      if (r.kind === "watcher") return "→ " + (r.visitors.length ? r.visitors.join(", ") : "no visitors");
      return "→ " + r.result;
    },
    checkMsg(r) {
      if (r.kind === "mortician") return `${r.target} was ${r.result}`;
      if (r.kind === "align") return `Your check on ${r.target}: ${r.result}`;
      if (r.kind === "parity") return r.vs ? `${r.target} is ${r.result} to ${r.vs}` : `${r.target}: first check, no result`;
      if (r.kind === "role") return `${r.target} is ${r.role}`;
      if (r.kind === "neapolitan") return `${r.target} is ${r.result}`;
      if (r.kind === "tracker") return r.visited ? `${r.target} visited ${r.visited}` : `${r.target} did not visit anyone`;
      if (r.kind === "watcher") return r.visitors.length ? `${r.target} was visited by ${r.visitors.join(", ")}` : `${r.target} was not visited`;
      return `${r.target}`;
    },
    actVerb(p, nd) {
      const c = E.caps(p);
      if (c.joat) return (nd && nd.modes && nd.modes[p.name]) || "visited";
      if (c.protector) return "protected";
      if (c.bodyguard) return "guarded";
      if (c.blocker) return "blocked";
      if (c.nightKiller) return "shot";
      if (c.poisoner) return "poisoned";
      if (c.gunsmith) return "armed";
      if (c.mortician) return "examined";
      if (c.commuter) return "commuted";
      if (c.cop) return "checked";
      if (c.tracker) return "tracked";
      if (c.watcher) return "watched";
      return "visited";
    },
    nightDiscord(n, nd, info) {
      const lines = [`=== Night ${n} ===`];
      const kills = [...new Set((nd.kills.mafia || []).filter(Boolean))];
      if (kills.length) lines.push(`mafia: killed ${kills.join(", ")}`);
      for (const [who, target] of Object.entries(nd.acts || {})) {
        if (!target) continue;
        const p = E.byName(this.game.players, who);
        if (p) lines.push(`${who} (${this.instName(p)}): ${this.actVerb(p, nd)} ${target === "(commute)" ? "" : target}`.trim());
      }
      for (const e of nd.events || [])
        if (e.who || e.note) lines.push(`mod: ${e.who ? e.who + " " : ""}${e.kind === "death" ? "died" : ""}${e.note ? " — " + e.note : ""}`.replace("  ", " "));
      const deaths = info ? this.timeline.deaths[n] : [];
      lines.push(`down: ${deaths && deaths.length ? deaths.join(", ") : "nobody"}`);
      if (nd.rng && nd.rng[0] != null && nd.rng[1] != null) lines.push(`D${n + 1} rngs: ${nd.rng[0] + nd.rng[1]}`);
      return lines.join("\n");
    },
    exportText() {
      const t = this.timeline;
      if (!t) return "";
      const secs = [[this.winner ? `**${this.winner.toUpperCase()} WINS**` : "**GAME IN PROGRESS**"]];
      secs.push([`**${this.run.setup.name}**` + (this.run.setup.pastebin ? ` — ${this.run.setup.pastebin}` : "")]);
      secs.push(["**Players**", ...this.game.players.map((p) => `${p.seat}. ${p.name}`)]);
      secs.push([this.revealText]);
      for (const nd of [...this.game.nights].sort((a, b) => a.n - b.n)) {
        const lines = [];
        if (nd.n >= 1 && !E.winnerAt(this.game.players, t.beforeDay[nd.n] || new Set())) {
          const vs = (this.game.votes[nd.n] || []).filter(Boolean);
          lines.push(`=== Day ${nd.n} ===`, vs.length ? `voted out ${vs.join(", ")}` : "no lynch");
          const extra = (t.dayDeaths[nd.n] || []).filter((x) => !vs.includes(x));
          if (extra.length) lines.push(`also died: ${extra.join(", ")}`);
        }
        if (!this.run.setup.nightless && !E.winnerAt(this.game.players, t.beforeNight[nd.n] || new Set()))
          lines.push(this.nightDiscord(nd.n, nd, t.nightInfo[nd.n]));
        if (lines.length) secs.push(lines);
      }
      return secs.map((s) => s.join("\n")).join("\n\n");
    },
    copy(ev, text) {
      navigator.clipboard.writeText(text).then(() => {
        const b = ev.target; const o = b.textContent;
        b.textContent = "Copied"; b.classList.add("done");
        setTimeout(() => { b.textContent = o; b.classList.remove("done"); }, 1400);
      });
    },
  },
  mounted() {
    this.setPref("theme", this.theme);
    this.setPref("font", this.font);
    try {
      const saved = JSON.parse(localStorage.getItem(GAME_KEY));
      if (saved && saved.run && saved.run.setup && saved.game && saved.game.phase !== "names") {
        for (const nd of saved.game.nights) {
          Object.assign(nd, { ...blankNight(nd.n), ...nd });
          if (!nd.events) nd.events = [];
          for (const w of nd.modKills || []) nd.events.push({ who: w, kind: "death", note: "" });
        }
        for (const nd of saved.game.nights) if (nd.n >= 1) {
          if (!saved.game.votes[nd.n]) saved.game.votes[nd.n] = [];
          saved.game.days[nd.n] = { ...blankDay(), ...(saved.game.days[nd.n] || {}) };
        }
        this.run = saved.run;
        this.game = saved.game;
        this.route = "console";
      }
    } catch (e) {}
    if (location.search.includes("debug")) window.__vm = this;
  },
});
app.mount("#app");
}

function setupFiles() {
  if (location.hostname.endsWith("github.io")) {
    const owner = location.hostname.split(".")[0];
    const repo = location.pathname.split("/").filter(Boolean)[0];
    return getJson("https://api.github.com/repos/" + owner + "/" + repo + "/contents/setups")
      .then((rows) => rows.map((x) => x.name).filter((n) => n.endsWith(".json") && n !== "index.json" && n !== "catalog.json"));
  }
  return getJson("setups/index.json").then((idx) => idx.map((row) => row.file));
}

function getJson(url, tries) {
  return fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(url + " came back " + r.status);
    return r.json();
  }).catch((e) => {
    if (tries > 0) return new Promise((wait) => setTimeout(wait, 700)).then(() => getJson(url, tries - 1));
    throw e;
  });
}

if (typeof window !== "undefined") Promise.all([
  getJson("setups/catalog.json", 3),
  setupFiles(),
]).then(([catalog, files]) => {
  CATALOG = catalog;
  return Promise.all(files.map((f) => getJson("setups/" + f, 3).catch(() => null)));
}).then((setups) => {
  window.__setups = setups.filter(Boolean);
  boot();
}).catch((e) => {
  document.body.insertAdjacentText("afterbegin", "failed to load the setup data: " + e);
});
