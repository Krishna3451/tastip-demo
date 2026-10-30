import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// This consumes an existing REA observation. It never opens a browser or calls a target API.
const [input, origin, output] = process.argv.slice(2);
if (!input || !origin) {
  console.error(
    "Usage: bun scripts/inspect-rea-web-evidence.mjs INPUT.json EXACT_ORIGIN [OUTPUT.json]",
  );
  process.exit(1);
}

try {
  const expectedOrigin = new URL(origin).origin;
  if (expectedOrigin !== origin || !/^https?:$/.test(new URL(origin).protocol))
    throw new Error("Supply one exact HTTP(S) origin without a path.");
  const bytes = readFileSync(input);
  if (bytes.length > 64 * 1024 * 1024) throw new Error("Choose an observation smaller than 64 MB.");
  const evidence = JSON.parse(bytes.toString("utf8"));
  const capture = evidence.normalized_result;
  if (
    evidence.operation !== "inspect_web_page" ||
    typeof evidence.evidence_id !== "string" ||
    capture?.target?.origin !== expectedOrigin ||
    !Array.isArray(capture?.scripts?.items)
  )
    throw new Error("Choose REA inspect_web_page evidence for the exact requested origin.");

  const candidates = new Map();
  const sources = [];
  let literalCount = 0;
  let excludedComplexLiterals = 0;
  for (const script of capture.scripts.items) {
    if (script.origin !== expectedOrigin || script.source?.included !== true) continue;
    const artifact = script.source.artifact;
    if (typeof artifact?.text !== "string") continue;
    const text = artifact.text;
    const digest = createHash("sha256").update(text).digest("hex");
    if (digest !== artifact.sha256 || Buffer.byteLength(text) !== artifact.bytes)
      throw new Error("A captured script failed its digest or byte-length check.");
    sources.push({ script_key: script.script_key, sha256: digest, bytes: artifact.bytes });
    // A bounded literal inventory, not a JavaScript evaluator or a complete template parser.
    const pattern = /(["'`])((?:https:\/\/[^"'`\s]+\/)?\/?api\/[A-Za-z0-9_/:.?=&${}-]*)\1/g;
    for (const match of text.matchAll(pattern)) {
      const literal = match[2];
      if (literal.length > 300) continue;
      literalCount++;
      const queryStart = literal.indexOf("?");
      let path = queryStart === -1 ? literal : literal.slice(0, queryStart);
      // Do not retain query values, literal hosts, or executable template expressions.
      path = path.replace(/^https:\/\/[^/]+/, "").replace(/^api\//, "/api/");
      path = path.replace(/\$\{[A-Za-z0-9_.]+\}/g, "{param}");
      if (path.includes("${") || !/^\/api\/[A-Za-z0-9_/:.{}-]+$/.test(path)) {
        excludedComplexLiterals++;
        continue;
      }
      const queryKeys = [...literal.matchAll(/[?&]([A-Za-z0-9_]+)=/g)].map((item) => item[1]);
      const key = path;
      const previous = candidates.get(key);
      if (previous) {
        previous.query_parameter_names = [
          ...new Set([...previous.query_parameter_names, ...queryKeys]),
        ].sort();
        continue;
      }
      candidates.set(key, {
        path_pattern: path,
        family: path.split("/")[2],
        evidence_type: "static-client-literal",
        http_method: "not-established-by-this-inventory",
        runtime_status: "not-observed-by-this-inventory",
        query_parameter_names: [...new Set(queryKeys)].sort(),
        source: { script_key: script.script_key, sha256: digest, utf16_offset: match.index },
      });
    }
  }
  if (!sources.length)
    throw new Error(
      "This observation contains no included script sources for the requested origin.",
    );
  const endpoints = [...candidates.values()].sort((a, b) =>
    a.path_pattern.localeCompare(b.path_pattern),
  );
  const families = Object.create(null);
  for (const endpoint of endpoints)
    families[endpoint.family] = (families[endpoint.family] ?? 0) + 1;
  const report = {
    schema_version: 1,
    origin: expectedOrigin,
    parent_evidence_id: evidence.evidence_id,
    parent_file_sha256: createHash("sha256").update(bytes).digest("hex"),
    included_sources: sources,
    matched_literal_occurrences: literalCount,
    excluded_complex_literals: excludedComplexLiterals,
    endpoint_pattern_count: endpoints.length,
    families,
    endpoints,
    limitations: [
      "Static candidate paths do not prove an endpoint exists, is reachable, or is used by a visible feature.",
      "Methods, request/response schemas, pagination, permissions and UI transitions need separate evidence.",
      "This bounded literal scan misses computed paths, complex templates, unloaded chunks and server-only routes.",
      "Query values and source text are omitted. No recorded endpoint is invoked or replayed.",
      "Loaded client code does not establish backend implementation, algorithms, vendors or data completeness.",
    ],
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    writeFileSync(output, serialized, { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        output,
        parent_evidence_id: report.parent_evidence_id,
        sources: sources.length,
        endpoint_patterns: endpoints.length,
        families,
      }),
    );
  } else process.stdout.write(serialized);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "The REA observation could not be inspected.",
  );
  process.exit(1);
}
