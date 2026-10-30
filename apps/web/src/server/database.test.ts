import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

test("SQLite adapter loads the built-in Node22 driver from a fresh Node process", () => {
  const directory = mkdtempSync(join(tmpdir(), "tastip-node-sqlite-"));
  try {
    const source = readFileSync(new URL("./database.ts", import.meta.url), "utf8");
    const module = join(directory, "database.mjs");
    writeFileSync(
      module,
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
    const script = `const {openDatabase}=await import(${JSON.stringify(pathToFileURL(module).href)}); const db=openDatabase(":memory:"); db.prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)").run("test","test","synthetic",0); console.log(JSON.stringify(db.prepare("SELECT count(*) AS total FROM accounts").get())); db.close();`;
    const result = spawnSync("node", ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ total: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
