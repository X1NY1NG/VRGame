/**
 * functions/index.js  —  FAST KG VERSION
 */
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const OpenAI = require("openai");

admin.initializeApp();
const db = admin.firestore();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// ===== Enums =====
const ALLOWED_NODE = new Set(["Person", "Place", "Event", "Food", "Artist", "Song", "Theme"]);
const ALLOWED_EDGE = new Set([
  "is_family_of",
  "friend_of",
  "lives_in",
  "visited_place_with",
  "attended",
  "enjoys",
  "avoid_topic",
  "remembers_with",
  "photo_shows",
]);

// Third-person pronouns that should NOT become Person names
const THIRD_PERSON_PRONOUNS = new Set([
  "he", "she", "they", "him", "her", "them", "his", "hers", "their", "theirs",
]);

// ===== Utils =====
function cleanName(s) {
  return String(s || "").trim();
}

// Firestore-safe, stable ID (base64url, no + or /, no =)
function stableId(s) {
  const input = String(s).trim().toLowerCase();
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function splitEndpoint(v) {
  if (typeof v === "string") return { name: v, type: null };
  return { name: v?.name || "", type: v?.type || null };
}

// show role when present
// show role when present, and include subject when not the User
function edgeToFact(e, userName = "User") {
  const subj = String(e.from_name || "");
  const obj  = String(e.to_name || "");
  const role = e.props?.role ? ` (${e.props.role})` : "";
  const isUser = subj.trim().toLowerCase() === userName.toLowerCase();

  switch (e.type) {
    case "lives_in":
      return isUser ? `Lives in ${obj}` : `${subj} lives in ${obj}`;
    case "is_family_of":
      return isUser ? `Family: ${obj}${role}` : `${subj} is family of ${obj}${role}`;
    case "friend_of":
      return isUser ? `Friends with ${obj}${role}` : `${subj} is friends with ${obj}${role}`;
    case "enjoys":
      return isUser ? `Enjoys ${obj}` : `${subj} enjoys ${obj}`;
    case "attended":
      return isUser ? `Attended ${obj}` : `${subj} attended ${obj}`;
    case "visited_place_with":
      return isUser ? `Visited a place with ${obj}` : `${subj} visited a place with ${obj}`;
    case "remembers_with":
      return isUser ? `Remembers moments with ${obj}` : `${subj} remembers moments with ${obj}`;
    default:
      return null;
  }
}

// conservative guard (keeps graph clean)
function validPair(e) {
  const ft = e.from_type, tt = e.to_type, t = e.type;
  if (t === "is_family_of" || t === "friend_of" || t === "remembers_with" || t === "visited_place_with")
    return ft === "Person" && tt === "Person";
  if (t === "lives_in")    return ft === "Person" && tt === "Place";
  if (t === "attended")    return ft === "Person" && tt === "Event";
  if (t === "enjoys")      return ft === "Person" && ["Artist", "Song", "Food", "Event", "Theme"].includes(tt);
  if (t === "avoid_topic") return ft === "Person" && tt === "Theme";
  if (t === "photo_shows") return true;
  return false;
}

// light heuristic to block obvious role-noun “names”
const ROLE_WORDS = /^(son|daughter|child|children|kid|kids|mother|father|mom|dad|friend|neighbour|neighbor|nurse)$/i;
function isRoleNoun(s) {
  if (!s) return false;
  const lc = String(s).trim().toLowerCase();
  if (/^user'?s\s+(son|daughter|child|children|kid|kids)$/i.test(lc)) return true;
  return ROLE_WORDS.test(lc);
}

// --- Fallback seed extraction (names & nouns) ---
function buildSeedsFromText(text) {
  const seeds = new Set();
  // Proper names: "John", "Emily", "Toa Payoh", "Jay Chou"
  const proper = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g) || [];
  proper.forEach((s) => seeds.add(cleanName(s).toLowerCase()));
  // Quoted things: "Simple Love", "Korean food"
  const quoted = [...text.matchAll(/"([^"]{2,40})"|'([^']{2,40})'/g)].map((m) => cleanName(m[1] || m[2]));
  quoted.forEach((s) => seeds.add(s.toLowerCase()));
  // “… food”
  const foodish = text.match(/\b([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+food\b/i);
  if (foodish) seeds.add(cleanName(foodish[0]).toLowerCase()); // "korean food"
  return [...seeds].slice(0, 8);
}

// Commit helper that splits writes into ≤500 ops per batch
async function commitWrites(writes) {
  const MAX = 500;
  for (let i = 0; i < writes.length; i += MAX) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + MAX)) w(batch);
    await batch.commit();
  }
}

/* ============================
   ==== Mention Cache / Coref ====
   ============================ */

async function getMentionCache(nricId) {
  const snap = await db.doc(`users/${nricId}/state/mentions`).get();
  return snap.exists ? (snap.data() || {}) : {};
}
async function saveMentionCache(nricId, cache) {
  await db.doc(`users/${nricId}/state/mentions`).set(cache, { merge: true });
}

function updateCacheWithPerson(cache, personName, role = "") {
  const name = cleanName(personName);
  if (!name || name.toLowerCase() === "user") return cache;

  const entry = (cache.people && cache.people[name]) || {};
  const r = String(role || "").toLowerCase();
  const inferredGender =
    /\b(son|father|dad|brother|uncle|grandfather)\b/.test(r) ? "male" :
    /\b(daughter|mother|mom|sister|aunt|grandmother)\b/.test(r) ? "female" :
    entry.gender || null;

  const people = { ...(cache.people || {}), [name]: { name, gender: inferredGender } };

  const push = (arr, v) => {
    const out = [v, ...(arr || []).filter((x) => x !== v)];
    return out.slice(0, 8);
  };

  let mr = cache.mru || { any: [], male: [], female: [], plural: [] };
  mr.any = push(mr.any, name);
  if (inferredGender === "male") mr.male = push(mr.male, name);
  if (inferredGender === "female") mr.female = push(mr.female, name);

  return { people, mru: mr };
}

const PRONOUN_MAP = {
  he: "male", him: "male", his: "male",
  she: "female", her: "female", hers: "female",
  they: "plural", them: "plural", their: "plural", theirs: "plural",
};

function pickFromCache(cache, kind) {
  const mru = cache.mru || {};
  if (kind === "male")   return (mru.male && mru.male[0]) || (mru.any && mru.any[0]) || null;
  if (kind === "female") return (mru.female && mru.female[0]) || (mru.any && mru.any[0]) || null;
  if (kind === "plural") return (mru.any && mru.any[0]) || null;
  return (mru.any && mru.any[0]) || null;
}

// Heuristic inline replacement: "He said" -> "John said" when unambiguous.
function heuristicallyResolvePronouns(text, cache) {
  return String(text || "").replace(/\b(he|she|they|him|her|them|his|hers|their|theirs)\b/gi, (m) => {
    const kind = PRONOUN_MAP[m.toLowerCase()];
    const who = pickFromCache(cache, kind);
    if (!who) return m; // no change if unknown
    const cap = m[0] === m[0].toUpperCase();
    const repl = cap ? who.replace(/^./, (c) => c.toUpperCase()) : who;
    return repl;
  });
}

// Optional: LLM coref pass when heuristics are unsure (quick fallback)
async function llmResolveCoref(openai, originalText, cacheNames = []) {
  const sys = `Rewrite the text by replacing third-person pronouns (he/she/they/him/her/them/his/hers/their/theirs)
with the most likely explicit names based on the recent mention order provided.
Only replace if unambiguous; otherwise leave the pronoun as-is.
Return ONLY the rewritten text (no extra commentary).`;
  const u = `Recent people (most recent first): ${cacheNames.join(", ") || "None"}\n\nText:\n${originalText}`;

  const out = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: sys }, { role: "user", content: u }],
  });
  const rewritten = out.choices?.[0]?.message?.content || originalText;
  return rewritten.trim();
}

// Post-edge patching for leftover pronouns
function resolveEdgePronouns(edges, cache) {
  for (const e of edges) {
    const fromLC = String(e.from_name || "").toLowerCase();
    const toLC   = String(e.to_name   || "").toLowerCase();

    const swap = (nameLC) => {
      const kind =
        ["he","him","his"].includes(nameLC) ? "male" :
        ["she","her","hers"].includes(nameLC) ? "female" :
        ["they","them","their","theirs"].includes(nameLC) ? "plural" : null;
      if (!kind) return null;
      return pickFromCache(cache, kind);
    };

    if (PRONOUN_MAP[fromLC]) {
      const rep = swap(fromLC);
      if (rep) { e.from_name = rep; e.from_type = "Person"; }
    }
    if (PRONOUN_MAP[toLC]) {
      const rep = swap(toLC);
      if (rep) { e.to_name = rep; e.to_type = "Person"; }
    }
  }
  return edges;
}

/* ============================
   ======== FAST BFS ==========
   ============================ */

// NEW: bulk edges fetch for any of N names (chunked to 30)
async function edgesTouchingAny(nricId, namesLC, limitPerChunk = 200) {
  const coll = db.collection(`users/${nricId}/kg_edges`);
  const out = [];
  for (let i = 0; i < namesLC.length; i += 30) {
    const chunk = namesLC.slice(i, i + 30);
    const snap = await coll
      .where("names_lc", "array-contains-any", chunk)
      .limit(limitPerChunk)
      .get();
    snap.forEach(d => out.push(d.data()));
  }
  return out;
}

/* ============================
   ========= Main API =========
   ============================ */

exports.extractFactsForTurn = onRequest(
  { region: "asia-southeast1", secrets: [OPENAI_API_KEY] },
  async (req, res) => {
    const T0 = Date.now();
    try {
      res.set("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "POST");
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        return res.status(204).send("");
      }

      const { nricId, text, history = [] } = req.body || {};
      if (!nricId || !text) return res.status(400).json({ error: "nricId and text required" });

      const openai = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

      // ===== Mention cache → pre-resolve pronouns
      let mentionCache = await getMentionCache(nricId);

      let preText = heuristicallyResolvePronouns(text, mentionCache);
      const pronounCount = (text.match(/\b(he|she|they|him|her|them|his|hers|their|theirs)\b/gi) || []).length;
      if (pronounCount >= 2) {
        const mruList = (mentionCache.mru?.any || []);
        try {
          // soft timeout wrapper (3s)
          const withTimeout = (p, ms = 3000) =>
            Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("coref_timeout")), ms))]);
          preText = await withTimeout(llmResolveCoref(openai, text, mruList), 3000);
        } catch {
          // fallback to heuristic preText
        }
      }

      // ===== Prompt to extract (unchanged model; strict JSON)
      const sys = `Extract entities and relations for a personal knowledge graph.

Return STRICT JSON only in this form:
{
  "nodes":[
    {"type":"Person|Place|Event|Food|Artist|Song|Theme","name":"...","aliases":[],"props":{}}
  ],
  "edges":[
    {
      "type":"is_family_of|friend_of|lives_in|visited_place_with|attended|enjoys|avoid_topic|remembers_with|photo_shows",
      "from":{"type":"Person","name":"User"},
      "to":{"type":"Person|Place|Event|Food|Artist|Song|Theme","name":"..."},
      "props":{"role":"","since":"","when":"","location":"","context":""},
      "confidence":0.0
    }
  ]
}

Rules:
- Treat the speaker as {"type":"Person","name":"User"} for "I/me/my/we/our".
- Use ONLY the provided enums.
- A node "name" must be a concrete proper name or place/thing name (never a generic role word).
- If a role noun appears beside a named person (e.g., "my daughter Emily"), put it in edge.props.role.
- If a person likes a generic activity/thing (e.g., shopping, clothes), use enjoys → {"type":"Theme","name":"<paraphrased theme>"}.
- It is valid to output edges about non-speaker people (e.g., "John enjoys Korean food").
- Include all clearly stated facts; omit edges with confidence < 0.7.
- Output pure JSON (no explanations).`;

      const tPrompt0 = Date.now();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: preText }],
      });
      let parsed = {};
      try {
        parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
      } catch (_) {
        parsed = { nodes: [], edges: [] };
      }
      const tPrompt1 = Date.now();

      const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      let rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];

      // ===== Normalize & validate
      const nodes = rawNodes
        .filter((n) => ALLOWED_NODE.has(n.type) && n.name)
        .map((n) => ({ ...n, name: cleanName(n.name) }));

      let edges = rawEdges
        .map((e) => {
          const from = splitEndpoint(e.from);
          const to = splitEndpoint(e.to);

          let type = e.type;
          let from_name = cleanName(from.name);
          let to_name = cleanName(to.name);

          let from_type = (from.type && ALLOWED_NODE.has(from.type)) ? from.type : "Person";
          let to_type = (to.type && ALLOWED_NODE.has(to.type)) ? to.type : null;

          // Heuristics for missing/ambiguous target type
          if (!to_type) {
            if (type === "lives_in") to_type = "Place";
            else if (type === "attended") to_type = "Event";
            else if (type === "avoid_topic") to_type = "Theme";
            else if (type === "enjoys") {
              const nm = to_name.toLowerCase();
              if (/\b(food|pasta|noodles?|soup|cake|tea|coffee|bread)\b/.test(nm)) {
                to_type = "Food";
              } else if (/\b(song|single|track)\b/.test(nm)) {
                to_type = "Song";
              } else if (/\b(artist|singer|band|composer)\b/.test(nm)) {
                to_type = "Artist";
              } else {
                to_type = "Theme"; // e.g., "clothes shopping", "gardening"
              }
            } else {
              to_type = "Person";
            }
          }

          return {
            type,
            from_name,
            from_type,
            to_name,
            to_type,
            props: e.props || {},
            confidence: e.confidence ?? 0.8,
          };
        })
        .filter((e) => ALLOWED_EDGE.has(e.type))
        .filter((e) => e.from_name && e.to_name)
        .filter((e) => (e.confidence ?? 0.8) >= 0.7)
        .filter(validPair); // strict type guard

      // pronoun → "User" aliases
      const USER = "User";
      const USER_ALIASES = new Set(["i", "me", "my", "mine", "myself", "we", "our", "ours", "ourselves"]);
      for (const e of edges) {
        if (USER_ALIASES.has(String(e.from_name || "").toLowerCase())) {
          e.from_name = USER;
          e.from_type = "Person";
        }
        if (USER_ALIASES.has(String(e.to_name || "").toLowerCase())) {
          e.to_name = USER;
          e.to_type = "Person";
        }
      }

      // Post-fix any remaining pronoun endpoints using cache
      edges = resolveEdgePronouns(edges, mentionCache);

      // Drop edges whose endpoint is an unnamed third-person pronoun (not the User)
      edges = edges.filter((e) => {
        const fromIsPronoun = THIRD_PERSON_PRONOUNS.has(String(e.from_name).toLowerCase());
        const toIsPronoun = THIRD_PERSON_PRONOUNS.has(String(e.to_name).toLowerCase());
        if (fromIsPronoun && e.from_name !== "User") return false;
        if (toIsPronoun && e.to_name !== "User") return false;
        return true;
      });

      // Family > friend dedupe (symmetric)
      const familyPairs = new Set(
        edges
          .filter((e) => e.type === "is_family_of")
          .map((e) => `${e.from_name.toLowerCase()}→${e.to_name.toLowerCase()}`)
      );
      edges = edges.filter((e) => {
        if (e.type !== "friend_of") return true;
        const key1 = `${e.from_name.toLowerCase()}→${e.to_name.toLowerCase()}`;
        const key2 = `${e.to_name.toLowerCase()}→${e.from_name.toLowerCase()}`;
        return !(familyPairs.has(key1) || familyPairs.has(key2));
      });

      // ====== BATCHED WRITES (no per-node await) ======
      const writes = [];
      const needNodes = new Map(); // key: `${type}|${name}` -> {t,nm}

      const wantNode = (type, name) => {
        const t = ALLOWED_NODE.has(type || "") ? type : "Person";
        const nm = cleanName(name);
        if (t === "Person" && isRoleNoun(nm)) return null;
        const key = `${t}|${nm}`;
        if (!needNodes.has(key)) needNodes.set(key, { t, nm });
        return stableId(`${nricId}|${t}|${nm}`);
      };

      // Collect node ids for edges
      for (const e of edges) {
        e.from_id = wantNode(e.from_type, e.from_name);
        e.to_id   = wantNode(e.to_type,   e.to_name);
      }
      // ensure "User" node exists
      wantNode("Person", USER);

      // Push node upserts
      for (const { t, nm } of needNodes.values()) {
        const nodeId = stableId(`${nricId}|${t}|${nm}`);
        const ref = db.doc(`users/${nricId}/kg_nodes/${nodeId}`);
        writes.push((batch) =>
          batch.set(
            ref,
            {
              ownerUid: nricId,
              type: t,
              name: nm,
              aliases: [],
              props: {},
              name_lc: nm.toLowerCase(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
        );
      }

      // Push edge upserts (with names_lc for fast BFS)
      for (const e of edges) {
        if (!e.from_id || !e.to_id) continue;
        const from_name_lc = cleanName(e.from_name).toLowerCase();
        const to_name_lc   = cleanName(e.to_name).toLowerCase();

        const edgeId = stableId(`${nricId}|${e.type}|${e.from_name}|${e.to_name}`);
        const ref = db.doc(`users/${nricId}/kg_edges/${edgeId}`);
        writes.push((batch) =>
          batch.set(
            ref,
            {
              ownerUid: nricId,
              type: e.type,
              from_id: e.from_id,
              from_name: e.from_name,
              from_type: e.from_type,
              from_name_lc,
              to_id: e.to_id,
              to_name: e.to_name,
              to_type: e.to_type,
              to_name_lc,
              names_lc: [from_name_lc, to_name_lc], // <-- for bulk BFS
              props: e.props ?? {},
              confidence: e.confidence ?? 0.8,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
        );
      }

      // Commit in safe chunks
      if (writes.length) await commitWrites(writes);
      const tWrite1 = Date.now();

      // ===== Update mention cache from nodes/edges
      for (const n of nodes) {
        if (n.type === "Person" && n.name && !isRoleNoun(n.name)) {
          mentionCache = updateCacheWithPerson(mentionCache, n.name, n.props?.role || "");
        }
      }
      for (const e of edges) {
        if (e.from_type === "Person" && e.from_name && e.from_name !== USER) {
          mentionCache = updateCacheWithPerson(mentionCache, e.from_name, e.props?.role || "");
        }
        if (e.to_type === "Person" && e.to_name && e.to_name !== USER) {
          mentionCache = updateCacheWithPerson(mentionCache, e.to_name, e.props?.role || "");
        }
      }
      await saveMentionCache(nricId, mentionCache);

      // ===== FAST BFS with bulk reads
      const relatedFacts = new Set();
      const avoidTopics = new Set();

      // facts from this-turn edges
      for (const e of edges) {
        if (e.type === "avoid_topic" && e.to_name) avoidTopics.add(e.to_name);
        const s = edgeToFact(e);
        if (s) relatedFacts.add(s);
      }

      // seeds from edges or from cache/text if no edges
      let seedNames = [...new Set(edges.flatMap((e) => [e.from_name, e.to_name]))]
        .filter(Boolean)
        .map((s) => cleanName(s).toLowerCase());

      if (seedNames.length === 0) {
        const mru = mentionCache.mru?.any || [];
        if (mru.length) seedNames = mru.map((s) => s.toLowerCase());
        if (seedNames.length === 0) seedNames = buildSeedsFromText(preText);
      }

      const MAX_HOPS = 2, FANOUT = 20, VISITED_CAP = 200;
      const visited = new Set(seedNames);
      let frontier = [...visited];

      for (let hop = 1; hop <= MAX_HOPS && frontier.length; hop++) {
        const neighborEdges = await edgesTouchingAny(nricId, frontier, FANOUT * 10);

        const next = [];
        for (const ed of neighborEdges) {
          if (ed.type === "avoid_topic" && ed.to_name) avoidTopics.add(ed.to_name);
          const s = edgeToFact(ed);
          if (s) relatedFacts.add(s);
          for (const nm of [ed.from_name_lc, ed.to_name_lc]) {
            const key = cleanName(nm || "").toLowerCase();
            if (key && !visited.has(key) && visited.size < VISITED_CAP) {
              visited.add(key);
              next.push(key);
            }
          }
        }
        // keep frontier tight
        frontier = next.slice(0, FANOUT);
      }

      const factsOut = Array.from(relatedFacts).slice(0, 12);
      const avoidsOut = Array.from(avoidTopics).slice(0, 8);

      const resp = { facts: factsOut, avoids: avoidsOut };
      const T1 = Date.now();
      console.log(JSON.stringify({
        nricId,
        dt_total_ms: T1 - T0,
        dt_prompt_ms: tPrompt1 - tPrompt0,
        dt_writes_ms: tWrite1 - tPrompt1,
        facts: factsOut.length,
        avoids: avoidsOut.length
      }));

      return res.json(resp);
    } catch (err) {
      console.error("extractFactsForTurn error:", err);
      return res.status(500).json({ error: String(err.message || err) });
    }
  }
);

exports.getUserGraph = onRequest({ region: "asia-southeast1" }, async (req, res) => {
  try {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");

    const nricId = req.query.nricId;
    if (!nricId) return res.status(400).json({ error: "nricId required" });

    // ---- NEW: dump the entire per-user graph (no BFS) ----
    if ((req.query.mode || "").toLowerCase() === "all") {
      const [nodesSnap, edgesSnap] = await Promise.all([
        db.collection(`users/${nricId}/kg_nodes`).get(),
        db.collection(`users/${nricId}/kg_edges`).get()
      ]);

      const nodes = nodesSnap.docs.map(d => {
        const n = d.data();
        return { id: d.id, label: n.name, type: n.type };
      });

      const edges = edgesSnap.docs.map(d => {
        const e = d.data();
        return {
          id: d.id,
          type: e.type,
          from: e.from_id,
          to:   e.to_id,
          props: e.props || {},
          label: e.props?.role ? `${e.type} (${e.props.role})` : e.type
        };
      });

      return res.json({ nodes, edges });
    }

    // ---- existing BFS code continues here ----
    // ... (keep your current BFS/subgraph block)
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});



