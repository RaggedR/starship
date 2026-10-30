(() => {
  // src/swarm/genmaze.ts
  var HC = 12;
  var RC = 17;
  var NECK = 1;
  var TARGET = 75;
  var SCOUT_SPEED = 5;
  var FROZEN_SEED_R = 1592594996;
  var FROZEN_SEED_L = 1592629948;
  var LCOLS = 2 * HC + 1;
  var GW = 2 * LCOLS + 1;
  var GH = 2 * RC + 1;
  var CENTRE = HC;
  var MIDROW = Math.floor(RC / 2);
  var gx = (i) => 2 * i + 1;
  var gy = (j) => 2 * j + 1;
  var DIRS = [
    {
      dx: 0,
      dy: -1
    },
    {
      dx: 1,
      dy: 0
    },
    {
      dx: 0,
      dy: 1
    },
    {
      dx: -1,
      dy: 0
    }
  ];
  var edgeKey = (ax, ay, bx, by) => ax < bx || ax === bx && ay <= by ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;
  function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
      s = s + 1831565813 >>> 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle4(rng) {
    const a = [
      0,
      1,
      2,
      3
    ];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [
        a[j],
        a[i]
      ];
    }
    return a;
  }
  function carveBody(colLo, colHi, rootCol, rng, into) {
    const inBand = (cx, cy) => cx >= colLo && cx <= colHi && cy >= 0 && cy < RC;
    const visited = /* @__PURE__ */ new Set();
    const vk = (cx, cy) => `${cx},${cy}`;
    const stack = [
      {
        x: rootCol,
        y: MIDROW
      }
    ];
    visited.add(vk(rootCol, MIDROW));
    while (stack.length) {
      const { x: cx, y: cy } = stack[stack.length - 1];
      let advanced = false;
      for (const di of shuffle4(rng)) {
        const d = DIRS[di];
        const nx = cx + d.dx, ny = cy + d.dy;
        if (!inBand(nx, ny) || visited.has(vk(nx, ny))) continue;
        into.add(edgeKey(cx, cy, nx, ny));
        visited.add(vk(nx, ny));
        stack.push({
          x: nx,
          y: ny
        });
        advanced = true;
        break;
      }
      if (!advanced) stack.pop();
    }
  }
  function genSwarmMaze(seedR = FROZEN_SEED_R, seedL = FROZEN_SEED_L) {
    const rngRight = mulberry32(seedR);
    const rngLeft = mulberry32(seedL);
    const edges = /* @__PURE__ */ new Set();
    const rGate = CENTRE + NECK;
    for (let i = CENTRE; i < rGate; i++) edges.add(edgeKey(i, MIDROW, i + 1, MIDROW));
    carveBody(rGate, LCOLS - 1, rGate, rngRight, edges);
    const lGate = CENTRE - NECK;
    for (let i = CENTRE; i > lGate; i--) edges.add(edgeKey(i, MIDROW, i - 1, MIDROW));
    carveBody(0, lGate, lGate, rngLeft, edges);
    const grid = Array.from({
      length: GH
    }, () => new Array(GW).fill(true));
    const openCell = (x, y) => {
      if (x >= 0 && y >= 0 && x < GW && y < GH) grid[y][x] = false;
    };
    for (const e of edges) {
      const [a, b] = e.split("|");
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      openCell(gx(ax), gy(ay));
      openCell(gx(bx), gy(by));
      openCell((gx(ax) + gx(bx)) / 2, (gy(ay) + gy(by)) / 2);
    }
    openCell(gx(CENTRE), gy(MIDROW));
    const walls = grid.map((row) => row.map((w) => w ? "#" : ".").join(""));
    const start = {
      x: gx(CENTRE),
      y: gy(MIDROW)
    };
    const pk = (p) => `${p.x},${p.y}`;
    const isFloor = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && !grid[y][x];
    const parent = /* @__PURE__ */ new Map();
    const dist = /* @__PURE__ */ new Map();
    const bfsOrder = [];
    {
      const q = [
        start
      ];
      parent.set(pk(start), null);
      dist.set(pk(start), 0);
      while (q.length) {
        const p = q.shift();
        bfsOrder.push(p);
        for (const d of DIRS) {
          const n = {
            x: p.x + d.dx,
            y: p.y + d.dy
          };
          if (!isFloor(n.x, n.y) || parent.has(pk(n))) continue;
          parent.set(pk(n), pk(p));
          dist.set(pk(n), dist.get(pk(p)) + 1);
          q.push(n);
        }
      }
    }
    const children = /* @__PURE__ */ new Map();
    for (const p of bfsOrder) children.set(pk(p), []);
    for (const p of bfsOrder) {
      const par = parent.get(pk(p));
      if (par) children.get(par).push(p);
    }
    const subtree = (root) => {
      const out = [];
      const stk = [
        root
      ];
      while (stk.length) {
        const p = stk.pop();
        out.push(p);
        for (const c of children.get(pk(p))) stk.push(c);
      }
      return out;
    };
    const isLogical = (p) => p.x % 2 === 1 && p.y % 2 === 1;
    const degree = (p) => DIRS.filter((d) => isFloor(p.x + d.dx, p.y + d.dy)).length;
    const isLeaf = (p) => isLogical(p) && degree(p) === 1;
    const gateRight = {
      x: gx(rGate),
      y: gy(MIDROW)
    };
    const gateLeft = {
      x: gx(lGate),
      y: gy(MIDROW)
    };
    const rightCells = subtree(gateRight);
    const rightLogical = rightCells.filter(isLogical);
    let exit = rightLogical[0];
    for (const c of rightLogical) {
      if (Math.abs(dist.get(pk(c)) - TARGET) < Math.abs(dist.get(pk(exit)) - TARGET)) exit = c;
    }
    const exitPath = [];
    {
      let cur = pk(exit);
      while (cur) {
        const [x, y] = cur.split(",").map(Number);
        exitPath.unshift({
          x,
          y
        });
        cur = parent.get(cur);
      }
    }
    const orc = exitPath[Math.floor(exitPath.length * 0.7)];
    const leftCells = subtree(gateLeft);
    const leftLeaves = leftCells.filter(isLeaf).filter((c) => pk(c) !== pk(gateLeft));
    leftLeaves.sort((a, b) => dist.get(pk(b)) - dist.get(pk(a)));
    const goblins = leftLeaves.slice(0, 2);
    return {
      width: GW,
      height: GH,
      walls,
      units: [
        {
          id: "scout-1",
          pos: start,
          hp: 10,
          atk: 1,
          speed: SCOUT_SPEED
        },
        {
          id: "scout-2",
          pos: start,
          hp: 10,
          atk: 1,
          speed: SCOUT_SPEED
        },
        {
          id: "scout-3",
          pos: start,
          hp: 10,
          atk: 1,
          speed: SCOUT_SPEED
        },
        {
          id: "scout-4",
          pos: start,
          hp: 10,
          atk: 1,
          speed: SCOUT_SPEED
        },
        {
          id: "scout-5",
          pos: start,
          hp: 10,
          atk: 1,
          speed: SCOUT_SPEED
        },
        {
          id: "fighter-1",
          pos: start,
          hp: 20,
          atk: 3,
          speed: 1
        },
        {
          id: "fighter-2",
          pos: start,
          hp: 20,
          atk: 3,
          speed: 1
        },
        {
          id: "captain",
          pos: start,
          hp: 10,
          atk: 0,
          speed: 1
        }
      ],
      monsters: [
        {
          id: "ogre-1",
          pos: gateRight,
          hp: 5,
          atk: 2
        },
        {
          id: "ogre-2",
          pos: gateLeft,
          hp: 5,
          atk: 2
        },
        {
          id: "orc-1",
          pos: orc,
          hp: 5,
          atk: 2
        },
        {
          id: "goblin-1",
          pos: goblins[0],
          hp: 3,
          atk: 1
        },
        {
          id: "goblin-2",
          pos: goblins[1],
          hp: 3,
          atk: 1
        }
      ],
      exit
    };
  }

  // src/maze/world.ts
  function step(pos, dir) {
    switch (dir) {
      case "N":
        return {
          x: pos.x,
          y: pos.y - 1
        };
      case "S":
        return {
          x: pos.x,
          y: pos.y + 1
        };
      case "E":
        return {
          x: pos.x + 1,
          y: pos.y
        };
      case "W":
        return {
          x: pos.x - 1,
          y: pos.y
        };
    }
  }
  var DIRS2 = [
    "N",
    "E",
    "S",
    "W"
  ];
  function eq(a, b) {
    return a.x === b.x && a.y === b.y;
  }
  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  function isWall(world, pos) {
    if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
      return true;
    }
    return world.walls[pos.y][pos.x] === "#";
  }
  function monsterAt(world, pos) {
    return world.monsters.find((m) => eq(m.pos, pos)) ?? null;
  }
  function unitAt(world, pos) {
    return world.units.find((u) => eq(u.pos, pos)) ?? null;
  }
  function unitById(world, id) {
    return world.units.find((u) => u.id === id) ?? null;
  }
  function requireUnit(world, id) {
    const u = unitById(world, id);
    if (!u) throw new RefError(`no such unit: ${id}`);
    return u;
  }
  function bearingOf(from, to) {
    const v = to.y < from.y ? "N" : to.y > from.y ? "S" : "";
    const h = to.x < from.x ? "W" : to.x > from.x ? "E" : "";
    return v + h || "here";
  }
  function look(world, unitId) {
    const u = requireUnit(world, unitId);
    const neighbours = DIRS2.map((dir) => {
      const p = step(u.pos, dir);
      const cell = isWall(world, p) ? "wall" : eq(p, world.exit) ? "exit" : "floor";
      const m = monsterAt(world, p);
      const other = unitAt(world, p);
      return {
        dir,
        cell,
        monster: m ? m.id : null,
        unit: other ? other.id : null
      };
    });
    return {
      unit: {
        id: u.id,
        x: u.pos.x,
        y: u.pos.y,
        hp: u.hp
      },
      onExit: eq(u.pos, world.exit),
      neighbours,
      exit: world.exit,
      exitDistance: manhattan(u.pos, world.exit),
      exitBearing: bearingOf(u.pos, world.exit)
    };
  }
  function mapUnit(world, id, f) {
    return {
      ...world,
      units: world.units.map((u) => u.id === id ? f(u) : u)
    };
  }
  function applyEffect(world, effect) {
    switch (effect.tag) {
      case "move":
        return mapUnit(world, effect.unitId, (u) => ({
          ...u,
          pos: effect.to
        }));
      case "attack": {
        const monsters = effect.lethal ? world.monsters.filter((m) => m.id !== effect.targetId) : world.monsters.map((m) => m.id === effect.targetId ? {
          ...m,
          hp: effect.monsterHpAfter
        } : m);
        const withUnit = mapUnit(world, effect.unitId, (u) => ({
          ...u,
          hp: effect.unitHpAfter
        }));
        return {
          ...withUnit,
          monsters
        };
      }
    }
  }
  var RefError = class extends Error {
  };

  // src/maze/gates.ts
  var ok = (effect) => ({
    ok: true,
    effect
  });
  var refused = (reason) => ({
    ok: false,
    reason
  });
  function isDir(s) {
    return s === "N" || s === "S" || s === "E" || s === "W";
  }
  function moveGate(world, unitId, dir) {
    if (!isDir(dir)) return refused(`bad --dir ${JSON.stringify(dir)} (want N|S|E|W)`);
    const u = requireUnit(world, unitId);
    const to = step(u.pos, dir);
    if (to.x < 0 || to.y < 0 || to.x >= world.width || to.y >= world.height) {
      return refused(`the edge of the maze is to the ${dir}`);
    }
    if (isWall(world, to)) return refused(`a wall blocks the way ${dir}`);
    const m = monsterAt(world, to);
    if (m) return refused(`${m.id} blocks the way ${dir} \u2014 attack it or go around`);
    return ok({
      tag: "move",
      unitId,
      to,
      dir
    });
  }
  function attackGate(world, unitId, targetId) {
    const u = requireUnit(world, unitId);
    const m = world.monsters.find((mm) => mm.id === targetId);
    if (!m) return refused(`no such monster: ${targetId}`);
    if (manhattan(m.pos, u.pos) !== 1) {
      return refused(`${targetId} is not adjacent \u2014 move next to it first`);
    }
    const monsterHpAfter = m.hp - u.atk;
    const lethal = monsterHpAfter <= 0;
    const unitHpAfter = lethal ? u.hp : u.hp - m.atk;
    return ok({
      tag: "attack",
      unitId,
      targetId,
      monsterHpAfter,
      unitHpAfter,
      lethal
    });
  }

  // src/swarm/memory-con.ts
  var Refusal = class extends Error {
  };
  function memoryCon(initial) {
    let world = initial;
    const flag = (argv, k) => {
      const i = argv.indexOf("--" + k);
      return i >= 0 ? argv[i + 1] : void 0;
    };
    const reqReason = (argv, cmd) => {
      const r = flag(argv, "reason");
      if (!r || r.trim() === "") throw new Refusal(`${cmd} requires a non-empty --reason`);
    };
    const conRun = (argv) => {
      const cmd = argv[0];
      const unit = flag(argv, "unit") ?? "hero";
      switch (cmd) {
        case "look":
          return {
            value: look(world, unit)
          };
        case "move": {
          reqReason(argv, "move");
          const gate = moveGate(world, unit, flag(argv, "dir") ?? "");
          if (!gate.ok) throw new Refusal(gate.reason);
          world = applyEffect(world, gate.effect);
          return {
            value: {
              committed: true,
              command: "move",
              correlation_id: flag(argv, "corr") ?? "",
              effect: gate.effect
            }
          };
        }
        case "attack": {
          reqReason(argv, "attack");
          const gate = attackGate(world, unit, flag(argv, "target") ?? "");
          if (!gate.ok) throw new Refusal(gate.reason);
          world = applyEffect(world, gate.effect);
          return {
            value: {
              committed: true,
              command: "attack",
              correlation_id: flag(argv, "corr") ?? "",
              effect: gate.effect
            }
          };
        }
        default:
          throw new Refusal(`unknown command: ${cmd ?? "(none)"}`);
      }
    };
    return {
      conRun,
      current: () => world
    };
  }

  // src/log/intentlog.ts
  function latest(entries) {
    const m = /* @__PURE__ */ new Map();
    for (const e of entries) m.set(e.call_id, e);
    return m;
  }
  function memIntentLog(seed = []) {
    const entries = [
      ...seed
    ];
    return {
      append(r) {
        entries.push(r);
      },
      all: () => entries,
      latestByCall: () => latest(entries)
    };
  }

  // src/log/ids.ts
  var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function toCrockford(n, width) {
    let s = "";
    let v = Math.max(0, Math.floor(n));
    while (v > 0) {
      s = CROCKFORD[v % 32] + s;
      v = Math.floor(v / 32);
    }
    return s.padStart(width, "0").slice(-width);
  }
  function seededIds(seed) {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 1125899906842623;
    const prefix = toCrockford(h, 10);
    let counter = 0;
    return {
      next() {
        return prefix + toCrockford(counter++, 16);
      }
    };
  }
  function fixedClock(startMs = 176e10, stepMs = 1e3) {
    let t = startMs;
    return {
      now() {
        const iso = new Date(t).toISOString();
        t += stepMs;
        return iso;
      }
    };
  }

  // src/maze/fog.ts
  function joinKnown(a, b) {
    if (a === b) return a;
    if (a === "unknown") return b;
    if (b === "unknown") return a;
    return "conflict";
  }
  function emptyFog(width, height) {
    const cells = [];
    for (let y = 0; y < height; y++) {
      cells.push(new Array(width).fill("unknown"));
    }
    return {
      width,
      height,
      cells,
      monsters: {},
      exitSeen: false
    };
  }
  function inBounds(fog, p) {
    return p.x >= 0 && p.y >= 0 && p.x < fog.width && p.y < fog.height;
  }
  function learnCell(cells, p, k) {
    const row = cells[p.y];
    if (!row || p.x < 0 || p.x >= row.length) return;
    row[p.x] = joinKnown(row[p.x], k);
  }
  function copyCells(fog) {
    return fog.cells.map((row) => row.slice());
  }
  function mergeSighting(fog, s) {
    const cells = copyCells(fog);
    const monsters = {
      ...fog.monsters
    };
    const retractAt = (p) => {
      for (const [id, pos] of Object.entries(monsters)) {
        if (eq(pos, p)) delete monsters[id];
      }
    };
    learnCell(cells, s.at, s.onExit ? "exit" : "floor");
    retractAt(s.at);
    let exitSeen = fog.exitSeen || s.onExit;
    for (const n of s.neighbours) {
      learnCell(cells, n.pos, n.cell);
      if (n.cell === "exit") exitSeen = true;
      if (n.monster) monsters[n.monster] = n.pos;
      else retractAt(n.pos);
    }
    return {
      ...fog,
      cells,
      monsters,
      exitSeen
    };
  }
  function mergeFog(a, b) {
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error(`mergeFog: size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    }
    const cells = [];
    for (let y = 0; y < a.height; y++) {
      const row = [];
      for (let x = 0; x < a.width; x++) {
        row.push(joinKnown(a.cells[y][x], b.cells[y][x]));
      }
      cells.push(row);
    }
    return {
      width: a.width,
      height: a.height,
      cells,
      monsters: {
        ...a.monsters,
        ...b.monsters
      },
      exitSeen: a.exitSeen || b.exitSeen
    };
  }
  function knownPassable(fog, p) {
    if (!inBounds(fog, p)) return false;
    const k = fog.cells[p.y][p.x];
    return k === "floor" || k === "exit";
  }
  function frontier(fog) {
    const out = [];
    const dirs = [
      {
        x: 0,
        y: -1
      },
      {
        x: 1,
        y: 0
      },
      {
        x: 0,
        y: 1
      },
      {
        x: -1,
        y: 0
      }
    ];
    for (let y = 0; y < fog.height; y++) {
      for (let x = 0; x < fog.width; x++) {
        if (!knownPassable(fog, {
          x,
          y
        })) continue;
        for (const d of dirs) {
          const q = {
            x: x + d.x,
            y: y + d.y
          };
          if (inBounds(fog, q) && fog.cells[q.y][q.x] === "unknown") {
            out.push({
              x,
              y
            });
            break;
          }
        }
      }
    }
    return out;
  }
  function monsterKnownAt(fog, p) {
    for (const [id, pos] of Object.entries(fog.monsters)) {
      if (eq(pos, p)) return id;
    }
    return null;
  }
  function clearMonster(fog, id) {
    if (!(id in fog.monsters)) return fog;
    const monsters = {
      ...fog.monsters
    };
    delete monsters[id];
    return {
      ...fog,
      monsters
    };
  }
  function exitCell(fog) {
    for (let y = 0; y < fog.height; y++) {
      for (let x = 0; x < fog.width; x++) {
        if (fog.cells[y][x] === "exit") return {
          x,
          y
        };
      }
    }
    return null;
  }
  function unknownCount(fog) {
    let n = 0;
    for (const row of fog.cells) for (const k of row) if (k === "unknown") n++;
    return n;
  }

  // src/bridge/harness.ts
  function logRead(ctx, agentId, tool, args) {
    ctx.intentLog.append({
      call_id: ctx.ids.next(),
      ts: ctx.clock.now(),
      agent_id: agentId,
      session_id: ctx.sessionId,
      tool,
      args,
      reason: "",
      mutates: false,
      status: "ok",
      correlation_id: ""
    });
  }
  function conRead(ctx, reg, tool, argv, args) {
    if (!reg.allowed.has(tool)) {
      throw new Error(`${tool} is not in ${reg.agentId}'s registry`);
    }
    logRead(ctx, reg.agentId, tool, args);
    return ctx.conRun(argv).value;
  }
  function runMutation(ctx, reg, tool, argv, args, reason) {
    const base = (status, extra) => ({
      call_id: extra.call_id ?? ctx.ids.next(),
      ts: ctx.clock.now(),
      agent_id: reg.agentId,
      session_id: ctx.sessionId,
      tool,
      args,
      reason,
      mutates: true,
      status,
      correlation_id: extra.correlation_id ?? "",
      ...extra
    });
    if (!reg.allowed.has(tool)) {
      ctx.intentLog.append(base("refused", {}));
      return {
        ok: false,
        reason: `${tool} is not in ${reg.agentId}'s registry`
      };
    }
    if (!reason || reason.trim() === "") {
      ctx.intentLog.append(base("refused", {}));
      return {
        ok: false,
        reason: `${tool} requires a non-empty reason`
      };
    }
    const callId = ctx.ids.next();
    const correlationId = ctx.ids.next();
    ctx.intentLog.append(base("attempted", {
      call_id: callId,
      correlation_id: correlationId
    }));
    const fullArgv = [
      ...argv,
      "--reason",
      reason,
      "--corr",
      correlationId
    ];
    try {
      const { value } = ctx.conRun(fullArgv);
      ctx.intentLog.append(base("ok", {
        call_id: callId,
        correlation_id: correlationId,
        exit_code: 0
      }));
      return {
        ok: true,
        correlationId,
        result: value
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.intentLog.append(base("refused", {
        call_id: callId,
        correlation_id: correlationId,
        exit_code: 1
      }));
      return {
        ok: false,
        reason: msg
      };
    }
  }

  // src/fleet/ops.ts
  function unitLook(ctx, reg, unitId) {
    return conRead(ctx, reg, "look", [
      "look",
      "--unit",
      unitId
    ], {
      unit: unitId
    });
  }
  function unitMove(ctx, reg, unitId, dir, reason, emit) {
    const out = runMutation(ctx, reg, "move", [
      "move",
      "--dir",
      dir,
      "--unit",
      unitId
    ], {
      dir,
      unit: unitId
    }, reason);
    emit({
      actor: unitId,
      action: "move",
      detail: dir,
      reason,
      ok: out.ok,
      corr: out.ok ? out.correlationId : void 0
    });
    return out.ok ? {
      ok: true,
      corr: out.correlationId
    } : {
      ok: false,
      reason: out.reason
    };
  }
  function unitAttack(ctx, reg, unitId, targetId, reason, emit) {
    const out = runMutation(ctx, reg, "attack", [
      "attack",
      "--target",
      targetId,
      "--unit",
      unitId
    ], {
      target: targetId,
      unit: unitId
    }, reason);
    emit({
      actor: unitId,
      action: "attack",
      detail: targetId,
      reason,
      ok: out.ok,
      corr: out.ok ? out.correlationId : void 0
    });
    if (!out.ok) return {
      ok: false,
      reason: out.reason
    };
    const effect = out.result.effect;
    return {
      ok: true,
      effect
    };
  }
  function lookToSighting(look2) {
    const at = {
      x: look2.unit.x,
      y: look2.unit.y
    };
    return {
      at,
      onExit: look2.onExit,
      neighbours: look2.neighbours.map((n) => ({
        pos: step(at, n.dir),
        cell: n.cell,
        monster: n.monster
      }))
    };
  }
  var key = (p) => `${p.x},${p.y}`;
  function pathOverFog(fog, from, to, opts) {
    if (eq(from, to)) return [];
    const walkable = (p) => knownPassable(fog, p) && (!opts.avoidMonsters || !monsterKnownAt(fog, p));
    const prev = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set([
      key(from)
    ]);
    let q = [
      from
    ];
    while (q.length) {
      const next = [];
      for (const p of q) {
        for (const dir of DIRS2) {
          const nxt = step(p, dir);
          if (seen.has(key(nxt)) || !walkable(nxt)) continue;
          seen.add(key(nxt));
          prev.set(key(nxt), {
            from: p,
            dir
          });
          if (eq(nxt, to)) {
            const dirs = [];
            let cur = nxt;
            while (!eq(cur, from)) {
              const e = prev.get(key(cur));
              dirs.unshift(e.dir);
              cur = e.from;
            }
            return dirs;
          }
          next.push(nxt);
        }
      }
      q = next;
    }
    return null;
  }
  function nearestFrontierStep(fog, from) {
    const fset = new Set(frontier(fog).map(key));
    if (fset.size === 0) return null;
    const prev = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set([
      key(from)
    ]);
    let q = [
      from
    ];
    while (q.length) {
      const next = [];
      for (const p of q) {
        for (const dir of DIRS2) {
          const nxt = step(p, dir);
          if (seen.has(key(nxt)) || !knownPassable(fog, nxt)) continue;
          seen.add(key(nxt));
          prev.set(key(nxt), {
            from: p,
            dir
          });
          if (fset.has(key(nxt))) {
            let cur = nxt;
            while (true) {
              const e = prev.get(key(cur));
              if (eq(e.from, from)) return e.dir;
              cur = e.from;
            }
          }
          next.push(nxt);
        }
      }
      q = next;
    }
    return null;
  }
  function adjacentFreeCell(fog, at) {
    for (const dir of DIRS2) {
      const p = step(at, dir);
      if (knownPassable(fog, p) && !monsterKnownAt(fog, p)) return p;
    }
    return null;
  }
  function frontierField(fog) {
    const dist = /* @__PURE__ */ new Map();
    let q = [];
    for (const f of frontier(fog)) {
      dist.set(key(f), 0);
      q.push(f);
    }
    while (q.length) {
      const next = [];
      for (const p of q) {
        const d = dist.get(key(p));
        for (const dir of DIRS2) {
          const n = step(p, dir);
          if (!knownPassable(fog, n) || dist.has(key(n))) continue;
          dist.set(key(n), d + 1);
          next.push(n);
        }
      }
      q = next;
    }
    return dist;
  }

  // src/swarm/amalgamate.ts
  function fogOfSightings(width, height, sightings) {
    let f = {
      width,
      height,
      cells: emptyCells(width, height),
      monsters: {},
      exitSeen: false
    };
    for (const s of sightings) f = mergeSighting(f, s);
    return f;
  }
  function emptyCells(width, height) {
    const rows = [];
    for (let y = 0; y < height; y++) rows.push(new Array(width).fill("unknown"));
    return rows;
  }
  function amalgamate(base, reports) {
    let fog = base;
    for (const r of reports) {
      fog = mergeFog(fog, fogOfSightings(base.width, base.height, r.sightings));
    }
    return fog;
  }

  // src/swarm/types.ts
  function makePool(units) {
    return units.map((u) => ({
      id: u.id,
      kind: kindOf(u.id),
      state: "idle",
      pos: u.pos,
      hp: u.hp,
      toward: null,
      guarding: null,
      targetMonster: null,
      path: null
    }));
  }
  function kindOf(id) {
    if (id.startsWith("scout")) return "scout";
    if (id.startsWith("fighter")) return "fighter";
    if (id === "captain") return "captain";
    throw new Error(`cannot classify agent id: ${id}`);
  }
  function byKind(pool, kind) {
    return pool.filter((a) => a.kind === kind);
  }

  // src/swarm/captain.ts
  var key2 = (p) => `${p.x},${p.y}`;
  var HOLD = {
    scouts: [],
    fighters: [],
    march: false
  };
  function reachable(fog, from, to) {
    return pathOverFog(fog, from, to, {
      avoidMonsters: true
    }) !== null;
  }
  function openFrontiers(st) {
    return st.frontier.filter((f) => !monsterKnownAt(st.fog, f) && reachable(st.fog, st.captainPos, f));
  }
  function cellsAlong(from, dirs) {
    const out = [
      from
    ];
    let cur = from;
    for (const d of dirs) {
      cur = {
        x: cur.x + d.x,
        y: cur.y + d.y
      };
      out.push(cur);
    }
    return out;
  }
  var DELTA = {
    N: {
      x: 0,
      y: -1
    },
    S: {
      x: 0,
      y: 1
    },
    E: {
      x: 1,
      y: 0
    },
    W: {
      x: -1,
      y: 0
    }
  };
  function assignScouts(idleScouts, open) {
    const claimed = /* @__PURE__ */ new Set();
    const out = [];
    for (const s of idleScouts) {
      let best = null;
      let bestD = Infinity;
      for (const f of open) {
        if (claimed.has(key2(f))) continue;
        const d = manhattan(s.pos, f);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best) {
        claimed.add(key2(best));
        out.push({
          id: s.id,
          toward: best
        });
      }
    }
    return out;
  }
  function assignFighters(fog, idleFighters, candidates) {
    const claimed = /* @__PURE__ */ new Set();
    const out = [];
    for (const f of idleFighters) {
      let best = null;
      let bestLen = Infinity;
      for (const m of candidates) {
        if (claimed.has(m.id)) continue;
        const adj = adjacentFreeCell(fog, m.pos);
        if (!adj) continue;
        const path = pathOverFog(fog, f.pos, adj, {
          avoidMonsters: true
        });
        if (path === null) continue;
        if (path.length < bestLen) {
          bestLen = path.length;
          best = m.id;
        }
      }
      if (best) {
        claimed.add(best);
        out.push({
          id: f.id,
          target: best
        });
      }
    }
    return out;
  }
  function scriptedPlan(st) {
    const idleScouts = st.agents.filter((a) => a.kind === "scout" && a.state === "idle");
    const idleFighters = st.agents.filter((a) => a.kind === "fighter" && a.state === "idle");
    const taken = new Set(st.agents.filter((a) => a.kind === "fighter" && a.state !== "idle" && a.targetMonster).map((a) => a.targetMonster));
    const freeMonsters = st.monsters.filter((m) => !taken.has(m.id));
    if (st.exit) {
      const corridor = pathOverFog(st.fog, st.captainPos, st.exit, {
        avoidMonsters: false
      });
      if (corridor !== null) {
        const safe = pathOverFog(st.fog, st.captainPos, st.exit, {
          avoidMonsters: true
        });
        if (safe !== null) return {
          scouts: [],
          fighters: [],
          march: true
        };
        const onCorridor = new Set(cellsAlong(st.captainPos, corridor.map((d) => DELTA[d])).map(key2));
        const blockers = freeMonsters.filter((m) => onCorridor.has(key2(m.pos)));
        return {
          scouts: [],
          fighters: assignFighters(st.fog, idleFighters, blockers),
          march: false
        };
      }
    }
    const open = openFrontiers(st);
    const scouts = assignScouts(idleScouts, open);
    const guarded = freeMonsters.filter((m) => st.agents.some((a) => a.kind === "scout" && a.guarding === m.id));
    let fighters = assignFighters(st.fog, idleFighters, guarded);
    if (fighters.length === 0 && guarded.length === 0 && open.length === 0) {
      fighters = assignFighters(st.fog, idleFighters, freeMonsters);
    }
    return {
      scouts,
      fighters,
      march: false
    };
  }
  function scriptedCaptainBrain() {
    return {
      name: "scripted-greedy",
      // deno-lint-ignore require-await
      async plan(state) {
        return scriptedPlan(state);
      }
    };
  }

  // src/swarm/dispatch.ts
  var scoutReg = (id) => ({
    agentId: `agent:${id}`,
    allowed: /* @__PURE__ */ new Set([
      "look",
      "move"
    ])
  });
  var fighterReg = (id) => ({
    agentId: `agent:${id}`,
    allowed: /* @__PURE__ */ new Set([
      "move",
      "attack"
    ])
  });
  var captainReg = (id) => ({
    agentId: `agent:${id}`,
    allowed: /* @__PURE__ */ new Set([
      "move"
    ])
  });
  function dispatchScout(ctx, id, baseFog, toward, speed, emit) {
    const reg = scoutReg(id);
    let fog = baseFog;
    const sightings = [];
    let blockedBy = null;
    let exhausted = false;
    let movesMade = 0;
    let freeExplore = toward === null;
    let look2 = unitLook(ctx, reg, id);
    let pos = {
      x: look2.unit.x,
      y: look2.unit.y
    };
    while (true) {
      const sighting = lookToSighting(look2);
      fog = mergeSighting(fog, sighting);
      sightings.push(sighting);
      if (movesMade >= speed) break;
      let dir;
      if (!freeExplore && toward && !eq(pos, toward)) {
        const path = pathOverFog(fog, pos, toward, {
          avoidMonsters: true
        });
        if (path && path.length > 0) {
          dir = path[0];
        } else {
          freeExplore = true;
          dir = nearestFrontierStep(fog, pos);
        }
      } else {
        freeExplore = true;
        dir = nearestFrontierStep(fog, pos);
      }
      if (dir === null) {
        exhausted = true;
        break;
      }
      const target = step(pos, dir);
      const blocker = monsterKnownAt(fog, target);
      if (blocker) {
        blockedBy = {
          monsterId: blocker,
          at: target
        };
        break;
      }
      const out = unitMove(ctx, reg, id, dir, `scouting ${dir} toward unmapped ground`, emit);
      if (!out.ok) {
        exhausted = true;
        break;
      }
      movesMade++;
      pos = target;
      look2 = unitLook(ctx, reg, id);
    }
    return {
      sightings,
      scoutPos: pos,
      blockedBy,
      exhausted,
      movesMade,
      goalDone: freeExplore
    };
  }
  function dispatchFighter(ctx, id, pos, hp, target, phase, path, speed, emit) {
    const reg = fighterReg(id);
    if (phase === "travelling") {
      let steps = 0;
      let p = pos;
      while (steps < speed && path.length > 0) {
        const dir = path[0];
        const out2 = unitMove(ctx, reg, id, dir, `advancing ${dir} to engage ${target}`, emit);
        if (!out2.ok) return {
          pos: p,
          hp,
          killed: false,
          arrived: false,
          aborted: true
        };
        path.shift();
        p = step(p, dir);
        steps++;
      }
      return {
        pos: p,
        hp,
        killed: false,
        arrived: path.length === 0,
        aborted: false
      };
    }
    const out = unitAttack(ctx, reg, id, target, `attacking ${target} to clear the route`, emit);
    if (!out.ok || !out.effect) {
      return {
        pos,
        hp,
        killed: false,
        arrived: true,
        aborted: true
      };
    }
    return {
      pos,
      hp: out.effect.unitHpAfter,
      killed: out.effect.lethal,
      arrived: true,
      aborted: false
    };
  }
  function trailFront(ctx, f, fog, field, emit) {
    const key4 = (p) => `${p.x},${p.y}`;
    const d0 = field.get(key4(f.pos));
    if (d0 === void 0 || d0 <= 1) return;
    let best = null;
    let bestD = d0;
    for (const dir of DIRS2) {
      const n = step(f.pos, dir);
      if (!knownPassable(fog, n) || monsterKnownAt(fog, n)) continue;
      const dn = field.get(key4(n));
      if (dn !== void 0 && dn < bestD) {
        bestD = dn;
        best = dir;
      }
    }
    if (!best) return;
    const out = unitMove(ctx, fighterReg(f.id), f.id, best, "moving up behind the search front", emit);
    if (out.ok) f.pos = step(f.pos, best);
  }
  function marchCaptain(ctx, id, from, path, emit) {
    const reg = captainReg(id);
    let pos = from;
    for (const dir of path) {
      const out = unitMove(ctx, reg, id, dir, `advancing ${dir} along the mapped safe route to the exit`, emit);
      if (!out.ok) break;
      pos = step(pos, dir);
    }
    return pos;
  }

  // src/swarm/scheduler.ts
  function orchestrateSwarm(params) {
    const { ctx, width, height } = params;
    const brain = params.brain ?? scriptedCaptainBrain();
    const maxTicks = params.maxTicks ?? 2e3;
    const rawSink = params.sink ?? (() => {
    });
    const speedOf = new Map(params.units.map((u) => [
      u.id,
      u.speed
    ]));
    const pool = makePool(params.units);
    const captain = pool.find((a) => a.kind === "captain");
    let captainFog = emptyFog(width, height);
    const counts = {
      scout: 0,
      fighter: 0,
      captain: 0,
      kills: 0,
      plans: 0
    };
    const emit = (a) => {
      if (a.action === "move" && a.ok) {
        if (a.actor.startsWith("scout")) counts.scout++;
        else if (a.actor.startsWith("fighter")) counts.fighter++;
        else if (a.actor === "captain") counts.captain++;
      }
      rawSink(a, captainFog);
    };
    const viewOf = (a) => ({
      id: a.id,
      kind: a.kind,
      state: a.state,
      pos: a.pos,
      hp: a.hp,
      toward: a.toward,
      guarding: a.guarding,
      targetMonster: a.targetMonster
    });
    const buildState = () => ({
      fog: captainFog,
      captainPos: captain.pos,
      agents: pool.map(viewOf),
      monsters: Object.entries(captainFog.monsters).map(([id, pos]) => ({
        id,
        pos
      })),
      frontier: frontier(captainFog),
      exit: exitCell(captainFog)
    });
    const applyPlan = (plan) => {
      for (const { id, toward } of plan.scouts) {
        const a = pool.find((x) => x.id === id);
        if (a && a.kind === "scout" && a.state === "idle") {
          a.toward = toward;
          a.state = "exploring";
        }
      }
      for (const { id, target } of plan.fighters) {
        const a = pool.find((x) => x.id === id);
        if (!a || a.kind !== "fighter" || a.state !== "idle") continue;
        const mpos = captainFog.monsters[target];
        if (!mpos) continue;
        const adj = adjacentFreeCell(captainFog, mpos);
        if (!adj) continue;
        const path = pathOverFog(captainFog, a.pos, adj, {
          avoidMonsters: true
        });
        if (path === null) continue;
        a.targetMonster = target;
        a.path = path;
        a.state = path.length > 0 ? "travelling" : "fighting";
      }
    };
    const emitPlan = (plan) => {
      if (plan.scouts.length === 0 && plan.fighters.length === 0 && !plan.march) return;
      const parts = [];
      for (const s of plan.scouts) parts.push(`${s.id}\u2192(${s.toward.x},${s.toward.y})`);
      for (const f of plan.fighters) parts.push(`${f.id}\u2192${f.target}`);
      if (plan.march) parts.push("march");
      emit({
        actor: "captain",
        action: "plan",
        detail: parts.join("  "),
        reason: brain.lastReasoning ?? ""
      });
    };
    async function solve() {
      emit({
        actor: "-",
        action: "phase",
        detail: "explore",
        reason: "fan the scouts across the maze and clear only what blocks the way out"
      });
      for (const s of byKind(pool, "scout")) {
        const look2 = unitLook(ctx, scoutReg(s.id), s.id);
        s.pos = {
          x: look2.unit.x,
          y: look2.unit.y
        };
        s.hp = look2.unit.hp;
        captainFog = mergeSighting(captainFog, lookToSighting(look2));
      }
      counts.plans++;
      const firstPlan = await brain.plan(buildState());
      emitPlan(firstPlan);
      applyPlan(firstPlan);
      let ticks = 0;
      while (ticks < maxTicks) {
        ticks++;
        const baseFog = captainFog;
        const reports = [];
        for (const s of byKind(pool, "scout")) {
          if (s.state !== "exploring") continue;
          const rep = dispatchScout(ctx, s.id, baseFog, s.toward, speedOf.get(s.id), emit);
          s.pos = rep.scoutPos;
          reports.push(rep);
          if (rep.goalDone) s.toward = null;
          if (rep.blockedBy) {
            const m = rep.blockedBy.monsterId;
            const held = pool.some((a) => a.kind === "scout" && a.state === "guarding" && a.guarding === m);
            s.toward = null;
            if (held) {
              s.state = "idle";
            } else {
              s.state = "guarding";
              s.guarding = m;
            }
          } else if (rep.exhausted) {
            s.state = "idle";
            s.toward = null;
          }
        }
        if (reports.length > 0) {
          captainFog = amalgamate(captainFog, reports);
          emit({
            actor: "captain",
            action: "merge",
            detail: `+${reports.length} scout reports \xB7 ${unknownCount(captainFog)} cells still dark`,
            reason: "amalgamate the scouts' reports into the fog \u2014 the N-ary join"
          });
        }
        const field = frontierField(captainFog);
        for (const f of byKind(pool, "fighter")) {
          if (f.state === "travelling" || f.state === "fighting") {
            const res = dispatchFighter(ctx, f.id, f.pos, f.hp, f.targetMonster, f.state, f.path ?? [], speedOf.get(f.id), emit);
            f.pos = res.pos;
            f.hp = res.hp;
            if (res.killed) {
              captainFog = clearMonster(captainFog, f.targetMonster);
              counts.kills++;
              emit({
                actor: "captain",
                action: "note",
                detail: `${f.targetMonster} cleared by ${f.id}`,
                reason: "the way is open where a scout was blocked"
              });
              for (const g of pool) {
                if (g.kind === "scout" && g.guarding === f.targetMonster) {
                  g.state = "idle";
                  g.guarding = null;
                }
              }
              f.state = "idle";
              f.targetMonster = null;
              f.path = null;
            } else if (res.aborted) {
              f.state = "idle";
              f.targetMonster = null;
              f.path = null;
            } else if (res.arrived && f.state === "travelling") {
              f.state = "fighting";
            }
          } else if (f.state === "idle") {
            trailFront(ctx, f, captainFog, field, emit);
          }
        }
        const active = pool.some((a) => a.state === "exploring" || a.state === "travelling" || a.state === "fighting" || a.state === "guarding");
        const st = buildState();
        const greedy = scriptedPlan(st);
        if (greedy.scouts.length === 0 && greedy.fighters.length === 0 && !greedy.march) {
          if (!active) break;
          continue;
        }
        counts.plans++;
        const plan = await brain.plan(st);
        if (plan.march) {
          const exit = exitCell(captainFog);
          const safe = pathOverFog(captainFog, captain.pos, exit, {
            avoidMonsters: true
          });
          if (safe !== null) {
            emit({
              actor: "-",
              action: "phase",
              detail: "march",
              reason: "a monster-free route to the exit is known; the captain advances on it"
            });
            captain.pos = marchCaptain(ctx, captain.id, captain.pos, safe, emit);
            captain.state = "done";
            return finish(ticks, eq(captain.pos, exit));
          }
        }
        const planEmpty = plan.scouts.length === 0 && plan.fighters.length === 0;
        if (!active && planEmpty) break;
        emitPlan(plan);
        applyPlan(plan);
      }
      return finish(ticks, eq(captain.pos, exitCell(captainFog) ?? {
        x: -1,
        y: -1
      }));
    }
    function finish(ticks, solved) {
      emit({
        actor: "-",
        action: "done",
        detail: solved ? "the captain reached the exit" : "the captain did not reach the exit",
        reason: ""
      });
      return {
        solved,
        ticks,
        scoutMoves: counts.scout,
        fighterMoves: counts.fighter,
        captainMoves: counts.captain,
        kills: counts.kills,
        unknownAtEnd: unknownCount(captainFog),
        finalFog: captainFog,
        captainPos: captain.pos,
        plans: counts.plans
      };
    }
    return solve();
  }

  // src/cli/format.ts
  function fogGlyph(k) {
    switch (k) {
      case "unknown":
        return " ";
      case "floor":
        return ".";
      case "wall":
        return "#";
      case "exit":
        return "X";
      case "conflict":
        return "!";
    }
  }

  // src/swarm/model-captain.ts
  var key3 = (p) => `${p.x},${p.y}`;
  function reasoningOf(prose, orders) {
    const parts = orders.map((o) => {
      if (o.kind === "assign_scout") return `${o.id}\u2192(${o.toward.x},${o.toward.y}): ${o.reason}`;
      if (o.kind === "dispatch_fighter") return `${o.id}\u2192${o.target}: ${o.reason}`;
      if (o.kind === "march") return `march: ${o.reason}`;
      if (o.kind === "fallback") return `[greedy fallback: ${o.reason}]`;
      return `hold: ${o.reason}`;
    });
    const head = prose.trim();
    return (head ? head + " \xB7 " : "") + parts.join(" \xB7 ");
  }
  var SYSTEM = "You are the CAPTAIN of a swarm exploring a grid maze to reach the EXIT. You are BLIND: you see only the fog your scouts have revealed, never the true maze. You command FIVE scouts (your eyes \u2014 they map, they cannot fight) and TWO fighters (they clear monsters, they are blind). Each planning step you command only IDLE agents:\n\u2022 assign_scout: send an idle scout to a frontier cell (a '?' on the map) to reveal new ground. Spread scouts to DIFFERENT regions so they fan out.\n\u2022 dispatch_fighter: the MOMENT a scout is blocked and holding a monster (marked 'guarded' below), send a fighter \u2014 do not wait for more to be found. When two monsters block in DIFFERENT directions, send your two fighters to OPPOSITE sides \u2014 one each \u2014 so both regions open at once and your scouts can explore the maze in both directions. Never send both fighters the same way. Your idle fighters automatically trail just behind the scouts, so one is always near; the nearest will reach it fast. Monsters on dead-end branches lead nowhere \u2014 once you have a route to the exit, leave the rest alone. You have only two fighters.\n\u2022 march: commit YOURSELF to the exit \u2014 only valid once a monster-free revealed route exists.\n\u2022 hold: do nothing this step (when every agent is already busy).\nCall as many tools as you want per step, each with a short reason. Invalid orders are ignored. Your goal: reach the exit having revealed as little as possible.";
  function toolSpecs() {
    const obj = (properties, required) => ({
      type: "object",
      properties,
      required,
      additionalProperties: false
    });
    return [
      {
        name: "assign_scout",
        description: "Send an idle scout to a frontier cell (x,y) to explore from there.",
        mutates: true,
        inputSchema: obj({
          scout_id: {
            type: "string",
            description: "An idle scout, e.g. scout-3."
          },
          x: {
            type: "number",
            description: "Target cell column."
          },
          y: {
            type: "number",
            description: "Target cell row."
          },
          reason: {
            type: "string",
            description: "Why send it there (one short clause)."
          }
        }, [
          "scout_id",
          "x",
          "y",
          "reason"
        ])
      },
      {
        name: "dispatch_fighter",
        description: "Send an idle fighter to clear a known monster that blocks the route.",
        mutates: true,
        inputSchema: obj({
          fighter_id: {
            type: "string",
            description: "An idle fighter, e.g. fighter-1."
          },
          monster_id: {
            type: "string",
            description: "A known-alive monster, e.g. orc-2."
          },
          reason: {
            type: "string",
            description: "Why this monster is worth clearing."
          }
        }, [
          "fighter_id",
          "monster_id",
          "reason"
        ])
      },
      {
        name: "march",
        description: "Commit yourself to the exit along a known monster-free route.",
        mutates: true,
        inputSchema: obj({
          reason: {
            type: "string",
            description: "Why commit now."
          }
        }, [
          "reason"
        ])
      },
      {
        name: "hold",
        description: "Do nothing this step (all agents already busy).",
        mutates: true,
        inputSchema: obj({
          reason: {
            type: "string",
            description: "Why hold."
          }
        }, [
          "reason"
        ])
      }
    ];
  }
  function renderFog(st) {
    const fog = st.fog;
    const mark = /* @__PURE__ */ new Map();
    for (const f of st.frontier) if (!mark.has(key3(f))) mark.set(key3(f), "?");
    for (const m of st.monsters) mark.set(key3(m.pos), "M");
    for (const a of st.agents) {
      if (a.kind === "captain") mark.set(key3(a.pos), "C");
      else if (a.kind === "fighter") mark.set(key3(a.pos), "f");
      else mark.set(key3(a.pos), "s");
    }
    const rows = [];
    for (let y = 0; y < fog.height; y++) {
      let row = "";
      for (let x = 0; x < fog.width; x++) {
        const k = key3({
          x,
          y
        });
        row += mark.get(k) ?? fogGlyph(fog.cells[y][x]);
      }
      rows.push(row);
    }
    return rows.join("\n");
  }
  function renderState(st) {
    const idleScouts = st.agents.filter((a) => a.kind === "scout" && a.state === "idle");
    const busyScouts = st.agents.filter((a) => a.kind === "scout" && a.state !== "idle");
    const idleFighters = st.agents.filter((a) => a.kind === "fighter" && a.state === "idle");
    const busyFighters = st.agents.filter((a) => a.kind === "fighter" && a.state !== "idle");
    const posStr = (p) => `(${p.x},${p.y})`;
    const assignedMonsters = new Set(st.agents.map((a) => a.targetMonster).filter((t) => t !== null));
    const guardedMonsters = new Set(st.agents.map((a) => a.guarding).filter((t) => t !== null));
    const frontierList = st.frontier.slice(0, 30).map(posStr).join(" ");
    const lines = [];
    lines.push("FOG (legend: ' '=unknown ?=frontier .=floor #=wall X=exit C=you s=scout f=fighter M=monster):");
    lines.push(renderFog(st));
    lines.push("");
    lines.push(`You (captain) are at ${posStr(st.captainPos)}.`);
    lines.push(`Exit: ${st.exit ? posStr(st.exit) : "NOT yet found"}.`);
    lines.push(`Idle scouts: ${idleScouts.map((a) => `${a.id}@${posStr(a.pos)}`).join(", ") || "none"}.`);
    lines.push(`Busy scouts: ${busyScouts.map((a) => a.id).join(", ") || "none"}.`);
    lines.push(`Idle fighters: ${idleFighters.map((a) => `${a.id}@${posStr(a.pos)}`).join(", ") || "none"}.`);
    lines.push(`Busy fighters: ${busyFighters.map((a) => `${a.id}(->${a.targetMonster})`).join(", ") || "none"}.`);
    lines.push(`Known monsters: ${st.monsters.map((m) => {
      const tag = assignedMonsters.has(m.id) ? "(being cleared)" : guardedMonsters.has(m.id) ? "(GUARDED \u2014 a scout is blocked here, send a fighter)" : "";
      return `${m.id}@${posStr(m.pos)}${tag}`;
    }).join(", ") || "none"}.`);
    lines.push(`Some frontier cells to explore: ${frontierList || "none"}.`);
    lines.push("");
    lines.push("Command your idle agents now.");
    return lines.join("\n");
  }
  function reachable2(fog, from, to) {
    return knownPassable(fog, to) && pathOverFog(fog, from, to, {
      avoidMonsters: true
    }) !== null;
  }
  function decode(st, calls) {
    const idleScouts = new Set(st.agents.filter((a) => a.kind === "scout" && a.state === "idle").map((a) => a.id));
    const idleFighters = new Set(st.agents.filter((a) => a.kind === "fighter" && a.state === "idle").map((a) => a.id));
    const aliveMonsters = new Map(st.monsters.map((m) => [
      m.id,
      m.pos
    ]));
    const scoutClaims = /* @__PURE__ */ new Set();
    const fighterClaims = /* @__PURE__ */ new Set();
    const monsterClaims = /* @__PURE__ */ new Set();
    const scouts = [];
    const fighters = [];
    let march = false;
    const orders = [];
    const safeRoute = st.exit ? pathOverFog(st.fog, st.captainPos, st.exit, {
      avoidMonsters: true
    }) !== null : false;
    for (const c of calls) {
      const inp = c.input ?? {};
      const reason = typeof inp.reason === "string" && inp.reason.trim() ? inp.reason.trim() : "";
      if (!reason) continue;
      if (c.name === "assign_scout") {
        const id = String(inp.scout_id ?? "");
        const x = Number(inp.x), y = Number(inp.y);
        if (!idleScouts.has(id) || scoutClaims.has(id)) continue;
        if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
        const toward = {
          x,
          y
        };
        if (!reachable2(st.fog, st.captainPos, toward)) continue;
        scoutClaims.add(id);
        scouts.push({
          id,
          toward
        });
        orders.push({
          kind: "assign_scout",
          id,
          toward,
          reason
        });
      } else if (c.name === "dispatch_fighter") {
        const id = String(inp.fighter_id ?? "");
        const target = String(inp.monster_id ?? "");
        if (!idleFighters.has(id) || fighterClaims.has(id)) continue;
        if (!aliveMonsters.has(target) || monsterClaims.has(target)) continue;
        fighterClaims.add(id);
        monsterClaims.add(target);
        fighters.push({
          id,
          target
        });
        orders.push({
          kind: "dispatch_fighter",
          id,
          target,
          reason
        });
      } else if (c.name === "march") {
        if (!safeRoute) continue;
        march = true;
        orders.push({
          kind: "march",
          reason
        });
      } else if (c.name === "hold") {
        orders.push({
          kind: "hold",
          reason
        });
      }
    }
    return {
      plan: {
        scouts,
        fighters,
        march
      },
      orders
    };
  }
  function productive(plan) {
    return plan.scouts.length > 0 || plan.fighters.length > 0 || plan.march;
  }
  function modelCaptainBrain(client) {
    const brain = {
      name: client.name,
      async plan(state) {
        let turn;
        try {
          turn = await client.converse(SYSTEM, [
            {
              role: "user",
              text: renderState(state)
            }
          ], toolSpecs());
        } catch (err) {
          console.error(`  [captain model error: ${err instanceof Error ? err.message : err}]`);
          brain.lastReasoning = reasoningOf("(model error \u2014 greedy fallback)", [
            {
              kind: "fallback",
              reason: "model/transport error"
            }
          ]);
          return scriptedPlan(state);
        }
        const { plan, orders } = decode(state, turn.toolCalls);
        if (productive(plan)) {
          brain.lastReasoning = reasoningOf(turn.text ?? "", orders);
          return plan;
        }
        const greedy = scriptedPlan(state);
        if (productive(greedy)) {
          brain.lastReasoning = reasoningOf(turn.text ?? "", [
            ...orders,
            {
              kind: "fallback",
              reason: "model left idle agents with work to do"
            }
          ]);
          return greedy;
        }
        brain.lastReasoning = reasoningOf(turn.text ?? "", orders.length ? orders : [
          {
            kind: "hold",
            reason: "all agents busy"
          }
        ]);
        return HOLD;
      }
    };
    return brain;
  }

  // src/agent/groq.ts
  function toOpenAITools(tools) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }
    }));
  }
  function toOpenAIMessages(system, messages) {
    const out = [
      {
        role: "system",
        content: system
      }
    ];
    for (const m of messages) {
      if (m.role === "user") {
        out.push({
          role: "user",
          content: m.text
        });
      } else if (m.role === "assistant") {
        out.push({
          role: "assistant",
          content: m.text || null,
          tool_calls: m.toolCalls.length > 0 ? m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input)
            }
          })) : void 0
        });
      } else {
        for (const r of m.results) {
          out.push({
            role: "tool",
            tool_call_id: r.toolUseId,
            content: r.content
          });
        }
      }
    }
    return out;
  }
  function parseToolCalls(raw) {
    if (!raw) return [];
    return raw.map((tc) => {
      let input = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = {};
      }
      return {
        id: tc.id,
        name: tc.function.name,
        input
      };
    });
  }
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function retryDelayMs(resp, body, attempt) {
    let seconds = null;
    const header = resp.headers.get("retry-after");
    if (header) {
      const asNum = Number(header);
      if (Number.isFinite(asNum) && asNum >= 0) {
        seconds = asNum;
      } else {
        const asDate = Date.parse(header);
        if (Number.isFinite(asDate)) seconds = Math.max(0, (asDate - Date.now()) / 1e3);
      }
    }
    if (seconds === null) {
      const fromBody = body.match(/try again in ([\d.]+)s/);
      seconds = fromBody ? Number(fromBody[1]) : 2 * attempt;
    }
    return Math.min(seconds + 0.5, 120) * 1e3;
  }
  function makeGroqClient(cfg) {
    const baseUrl = cfg.baseUrl ?? "https://api.groq.com/openai/v1";
    const model = cfg.model ?? "openai/gpt-oss-120b";
    const apiKey = cfg.apiKey;
    const maxAttempts = 8;
    const reasoningEffort = cfg.reasoningEffort ?? "low";
    const maxCompletionTokens = cfg.maxCompletionTokens ?? 1024;
    const supportsEffort = model.includes("gpt-oss");
    return {
      name: `groq:${model}`,
      async converse(system, messages, tools) {
        if (!apiKey) {
          throw new Error("No Groq API key provided. For the Deno demos export GROQ_API_KEY (a free key from https://console.groq.com) before a --live run.");
        }
        const payload = JSON.stringify({
          model,
          messages: toOpenAIMessages(system, messages),
          tools: toOpenAITools(tools),
          tool_choice: "auto",
          temperature: 0,
          max_completion_tokens: maxCompletionTokens,
          ...supportsEffort ? {
            reasoning_effort: reasoningEffort
          } : {}
        });
        for (let attempt = 1; ; attempt++) {
          const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: payload
          });
          if (resp.ok) {
            const data = await resp.json();
            const msg = data?.choices?.[0]?.message ?? {};
            return {
              text: typeof msg.content === "string" ? msg.content : "",
              toolCalls: parseToolCalls(msg.tool_calls)
            };
          }
          const body = await resp.text();
          const retryable = resp.status === 429 || resp.status >= 500;
          if (retryable && attempt < maxAttempts) {
            const ms = retryDelayMs(resp, body, attempt);
            console.error(`  [groq ${resp.status}; waiting ${Math.round(ms / 1e3)}s then retrying]`);
            await sleep(ms);
            continue;
          }
          throw new Error(`groq ${resp.status}: ${body.slice(0, 300)}`);
        }
      }
    };
  }

  // web/app.ts
  var TICK_BUDGET = 110;
  var MAX_ATTEMPTS = 8;
  async function solveToTrace(world0, brain) {
    const mc = memoryCon(world0);
    const ctx = {
      ids: seededIds("agent"),
      clock: fixedClock(),
      intentLog: memIntentLog(),
      sessionId: "BROWSER",
      conRun: mc.conRun
    };
    const frames = [];
    let lastFogStr = " ";
    const fogRows = (fog) => fog.cells.map((row) => row.map(fogGlyph).join(""));
    const unknownOf = (fog) => {
      let n = 0;
      for (const row of fog.cells) for (const k of row) if (k === "unknown") n++;
      return n;
    };
    const sink = (a, fog) => {
      const w = mc.current();
      const rows = fogRows(fog);
      const fogStr = rows.join("\n");
      const changed = fogStr !== lastFogStr;
      if (changed) lastFogStr = fogStr;
      frames.push({
        i: frames.length,
        actor: a.actor,
        action: a.action,
        detail: a.detail ?? "",
        reason: a.reason ?? "",
        ok: a.ok ?? true,
        corr: a.corr ?? "",
        units: w.units.map((u) => ({
          id: u.id,
          x: u.pos.x,
          y: u.pos.y,
          hp: u.hp
        })),
        monsters: w.monsters.map((m) => ({
          id: m.id,
          x: m.pos.x,
          y: m.pos.y,
          hp: m.hp
        })),
        fog: changed ? rows : null,
        unknown: unknownOf(fog)
      });
    };
    const result = await orchestrateSwarm({
      ctx,
      width: world0.width,
      height: world0.height,
      units: world0.units.map((u) => ({
        id: u.id,
        pos: u.pos,
        hp: u.hp,
        speed: u.speed
      })),
      brain,
      sink
    });
    return {
      maze: {
        width: world0.width,
        height: world0.height,
        walls: world0.walls,
        exit: world0.exit,
        start: world0.units.find((u) => u.id === "captain").pos
      },
      frames,
      summary: {
        solved: result.solved,
        ticks: result.ticks,
        scoutMoves: result.scoutMoves,
        fighterMoves: result.fighterMoves,
        captainMoves: result.captainMoves,
        kills: result.kills,
        unknownAtEnd: result.unknownAtEnd,
        captain: brain.name
      }
    };
  }
  async function runNewMaze(seed) {
    const scripted = scriptedCaptainBrain();
    let best = null;
    let s = seed >>> 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const world = genSwarmMaze(s, s ^ 2654435769);
      const trace = await solveToTrace(world, scripted);
      if (trace.summary.solved) {
        if (trace.summary.ticks <= TICK_BUDGET) return trace;
        if (!best || trace.summary.ticks < best.summary.ticks) best = trace;
      }
      s = s + 2654435769 >>> 0;
    }
    return best ?? await solveToTrace(genSwarmMaze(seed, seed ^ 2654435769), scripted);
  }
  function llmConfig() {
    return globalThis.__SWARM_LLM__ ?? {};
  }
  function liveAvailable() {
    return !!llmConfig().key;
  }
  async function runNewMazeLive(seed, onProgress) {
    const cfg = llmConfig();
    if (!cfg.key) throw new Error("no embedded Groq key on this page");
    const client = makeGroqClient({
      apiKey: cfg.key,
      model: cfg.model,
      baseUrl: cfg.baseUrl
    });
    const base = modelCaptainBrain(client);
    let step2 = 0;
    const brain = {
      name: base.name,
      get lastReasoning() {
        return base.lastReasoning;
      },
      plan(state) {
        step2++;
        onProgress?.(step2);
        return base.plan(state);
      }
    };
    const world = genSwarmMaze(seed, seed ^ 2654435769);
    return await solveToTrace(world, brain);
  }
  Object.assign(globalThis, {
    runNewMaze,
    runNewMazeLive,
    liveAvailable
  });
})();
