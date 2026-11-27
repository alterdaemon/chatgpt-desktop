const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { diagnosticPageProbe } = require("../../diagnostics/rendering/preload");
const { sanitize } = require("../../diagnostics/rendering/main");
const { prepareStage, replaceOnce } = require("../../diagnostics/rendering/build");

test("diagnostic payload summaries never contain private values", () => {
  const secret = "PRIVATE_VALUE_MUST_NOT_BE_RECORDED";
  const payload = { title: secret, mapping: { [secret]: { message: {
    id: secret, author: { role: "assistant" }, content: { content_type: "text", parts: [secret] },
    metadata: { model_dil_v2: { code: secret, fallbackMarkdown: secret, fallbackMarkdownVersion: 1 } },
  } } } };
  payload.cycle = payload;
  const summary = diagnosticPageProbe({ payload });
  assert.equal(summary.messages[0].textEqualsFallback, true);
  assert.equal(summary.messages[0].richCode, true);
  assert.ok(!JSON.stringify(summary).includes(secret));
});

test("diagnostic terminal output rejects arbitrary renderer strings and nested fields", () => {
  const secret = "PRIVATE_VALUE_MUST_NOT_BE_RECORDED";
  const output = sanitize({ event: "snapshot", route: secret, href: secret, constructor: secret,
    messages: [{ richCode: true, contentType: secret, text: secret }],
    metadata: [{ fallbackPresent: true, code: secret, id: secret }],
    error: secret, status: Infinity, app: secret,
  });
  assert.deepEqual(output, { event: "snapshot", messages: [{ richCode: true }], metadata: [{ fallbackPresent: true }] });
  assert.ok(!JSON.stringify(output).includes(secret));
});

test("diagnostic staging is isolated, versioned and fails closed when source anchors change", () => {
  const root = path.resolve(__dirname, "../..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-diagnostic-stage-"));
  const source = fs.readFileSync(path.join(root, "main.js"), "utf8");
  try {
    const stage = path.join(temporary, "source");
    const version = prepareStage(root, stage, "renderdiag.99");
    assert.equal(version, require("../../package.json").version + "-renderdiag.99");
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8"));
    const main = fs.readFileSync(path.join(stage, "main.js"), "utf8");
    assert.ok(pkg.build.files.includes("render-diagnostics.js"));
    assert.ok(!require("../../package.json").build.files.some(file => /diagnostic/.test(file)));
    assert.ok(main.includes('require("./render-diagnostics").install()'));
    for (const setting of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "devTools: false"]) assert.ok(main.includes(setting));
    assert.match(fs.readFileSync(path.join(stage, "packaging/flatpak/release/io.github.alterdaemon.chatgpt-desktop.yml"), "utf8"), /branch: render-diagnostic/);
    for (const name of [".env", ".live-chatgpt-profile", "dist", "test"]) assert.equal(fs.existsSync(path.join(stage, name)), false);
    assert.equal(fs.readFileSync(path.join(root, "main.js"), "utf8"), source);
    assert.throws(() => prepareStage(root, path.join(temporary, "invalid"), "../../unsafe"));
    assert.throws(() => replaceOnce("changed source", "missing anchor", "replacement"));
    assert.throws(() => replaceOnce("duplicate duplicate", "duplicate", "replacement"));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
