class ZDD {
  constructor() {
    this.nodes = [
      { id: 0, v: Infinity, p0: 0, p1: 0 },
      { id: 1, v: Infinity, p0: 0, p1: 0 }
    ];
    this.uniqueTable = new Map();
    this.unionCache = new Map();
    this.poolsCache = new Map();
  }

  getNode(v, p0, p1) {
    if (p1 === 0) return p0;
    const key = `${v},${p0},${p1}`;
    const existing = this.uniqueTable.get(key);
    if (existing !== undefined) return existing;
    const id = this.nodes.length;
    this.nodes.push({ id, v, p0, p1 });
    this.uniqueTable.set(key, id);
    return id;
  }

  base(combo, idx = 0) {
    if (idx === combo.length) return 1;
    return this.getNode(combo[idx], 0, this.base(combo, idx + 1));
  }

  union(a, b) {
    if (a === 0) return b;
    if (b === 0) return a;
    if (a === b) return a;
    if (a > b) {
      const tmp = a; a = b; b = tmp;
    }
    const key = `${a},${b}`;
    const cached = this.unionCache.get(key);
    if (cached !== undefined) return cached;

    const nA = this.nodes[a];
    const nB = this.nodes[b];
    let res;

    if (nA.v < nB.v) {
      res = this.getNode(nA.v, this.union(nA.p0, b), nA.p1);
    } else if (nA.v > nB.v) {
      res = this.getNode(nB.v, this.union(a, nB.p0), nB.p1);
    } else {
      res = this.getNode(nA.v, this.union(nA.p0, nB.p0), this.union(nA.p1, nB.p1));
    }

    this.unionCache.set(key, res);
    return res;
  }

  extractPools(nodeId) {
    if (nodeId === 0) return [];
    if (nodeId === 1) return [ [] ];
    
    const cached = this.poolsCache.get(nodeId);
    if (cached !== undefined) return cached;

    const node = this.nodes[nodeId];
    const res1 = this.extractPools(node.p1).map(imp => [[node.v], ...imp]);
    const res0 = this.extractPools(node.p0);

    // Merge logic
    const map = new Map();
    const out0 = [];
    for (let i = 0; i < res0.length; i++) {
      const imp = res0[i];
      const suffix = JSON.stringify(imp.slice(1));
      if (!map.has(suffix)) map.set(suffix, []);
      map.get(suffix).push(i);
      out0.push(imp);
    }

    const out1 = [];
    for (const imp of res1) {
      const suffix = JSON.stringify(imp.slice(1));
      const indices = map.get(suffix);
      if (indices && indices.length > 0) {
        // Find one that hasn't been consumed
        let consumed = false;
        for (let idx of indices) {
          if (out0[idx] !== null) {
            const matched = out0[idx];
            const mergedFirstPool = [...new Set([...imp[0], ...matched[0]])].sort((a,b)=>a-b);
            out1.push([mergedFirstPool, ...imp.slice(1)]);
            out0[idx] = null;
            consumed = true;
            break;
          }
        }
        if (!consumed) out1.push(imp);
      } else {
        out1.push(imp);
      }
    }

    for (const imp of out0) {
      if (imp !== null) out1.push(imp);
    }

    this.poolsCache.set(nodeId, out1);
    return out1;
  }
}

function postMergeImplicants(implicants) {
  let current = implicants;
  let changed = true;
  while (changed) {
    changed = false;
    const nextCurrent = [];
    const used = new Set();
    
    for (let i = 0; i < current.length; i++) {
      if (used.has(i)) continue;
      const t1 = current[i];
      let merged = false;
      
      for (let j = i + 1; j < current.length; j++) {
        if (used.has(j)) continue;
        const t2 = current[j];
        if (t1.length !== t2.length) continue;
        
        let matchCount = 0;
        let diffIdx1 = -1;
        let diffIdx2 = -1;
        
        // Find how many pools match exactly
        const matched1 = new Array(t1.length).fill(false);
        const matched2 = new Array(t2.length).fill(false);
        
        for (let x = 0; x < t1.length; x++) {
          const k1 = t1[x].join(",");
          for (let y = 0; y < t2.length; y++) {
            if (!matched2[y] && k1 === t2[y].join(",")) {
              matched1[x] = true;
              matched2[y] = true;
              matchCount++;
              break;
            }
          }
        }
        
        if (matchCount === t1.length - 1) {
          // Exactly one differing pool
          for (let x = 0; x < t1.length; x++) if (!matched1[x]) diffIdx1 = x;
          for (let y = 0; y < t2.length; y++) if (!matched2[y]) diffIdx2 = y;
          
          const newImp = [];
          for (let x = 0; x < t1.length; x++) {
            if (x === diffIdx1) {
              const combined = [...new Set([...t1[diffIdx1], ...t2[diffIdx2]])].sort((a,b)=>a-b);
              newImp.push(combined);
            } else {
              newImp.push([...t1[x]]);
            }
          }
          nextCurrent.push(newImp);
          used.add(i);
          used.add(j);
          merged = true;
          changed = true;
          break;
        }
      }
      if (!merged) nextCurrent.push(t1);
    }
    current = nextCurrent;
  }
  return current;
}

function compressWithZDD(combos) {
  if (!combos || combos.length === 0) return null;
  const zdd = new ZDD();
  let root = 0;
  for (const combo of combos) {
    const cRoot = zdd.base([...combo].sort((a,b)=>a-b));
    root = zdd.union(root, cRoot);
  }
  let implicants = zdd.extractPools(root);
  implicants = postMergeImplicants(implicants);
  return implicants.length < combos.length ? implicants : null;
}

module.exports = { compressWithZDD, ZDD };
