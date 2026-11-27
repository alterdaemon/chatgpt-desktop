const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Diagnostic staging anchor changed; review the builder before continuing.");
  return source.replace(before, after);
}

function prepareStage(root, stage, suffix) {
  if (!/^renderdiag\.[1-9]\d*$/.test(suffix)) throw new Error("Use a suffix such as renderdiag.3");
  fs.mkdirSync(stage);
  // Explicit inputs only: no profiles, credentials, tests, old outputs or .env.
  for (const name of ["package.json", "package-lock.json", "main.js", "app-logic.js", "preload.js", "LICENSE", "page-modules", "build/icons", "packaging/flatpak/release"]) {
    fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  }
  const pkgPath = path.join(stage, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("Diagnostic builds require a stable base version.");
  pkg.version += `-${suffix}`;
  pkg.build.files.push("render-diagnostics.js", "render-diagnostic-preload.js");
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const lockPath = path.join(stage, "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.version = lock.packages[""].version = pkg.version;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  let main = fs.readFileSync(path.join(stage, "main.js"), "utf8");
  // Only the diagnostic staging copy defaults to the old/native agent, so the
  // historical A/B experiment remains reproducible after the production fix.
  main = replaceOnce(main, "app.userAgentFallback = getBrowserUserAgent(app.userAgentFallback);", 'require("./render-diagnostics").install();');
  main = replaceOnce(main, 'preload: path.join(__dirname, "preload.js"),', 'preload: path.join(__dirname, process.argv.includes("--diagnose-rendering") ? "render-diagnostic-preload.js" : "preload.js"),\n      additionalArguments: process.argv.includes("--diagnose-rendering") ? ["--render-diagnostic-enabled"] : [],');
  fs.writeFileSync(path.join(stage, "main.js"), main);
  for (const [source, destination] of [["main.js", "render-diagnostics.js"], ["preload.js", "render-diagnostic-preload.js"]]) {
    fs.copyFileSync(path.join(root, "diagnostics/rendering", source), path.join(stage, destination));
  }
  const manifestPath = path.join(stage, "packaging/flatpak/release/io.github.alterdaemon.chatgpt-desktop.yml");
  fs.writeFileSync(manifestPath, replaceOnce(fs.readFileSync(manifestPath, "utf8"), "branch: stable", "branch: render-diagnostic"));
  const builderPath = path.join(stage, "packaging/flatpak/release/build-flatpak.sh");
  fs.writeFileSync(builderPath, replaceOnce(fs.readFileSync(builderPath, "utf8"), '"${APP_ID}" stable', '"${APP_ID}" render-diagnostic'));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(stage, "node_modules"), "dir");
  return pkg.version;
}

function build(suffix) {
  if (process.versions.node.split(".")[0] !== "24") throw new Error("Use Node 24 in the Debian build container.");
  const root = path.resolve(__dirname, "../..");
  const internal = path.resolve(root, "../internal");
  fs.mkdirSync(internal, { recursive: true });
  const task = fs.mkdtempSync(path.join(internal, "render-diagnostic-build-"));
  try {
    const stage = path.join(task, "source");
    const version = prepareStage(root, stage, suffix);
    const arch = execFileSync("flatpak", ["--default-arch"], { encoding: "utf8" }).trim();
    const filename = `chatgpt-desktop_${version}_${arch}.flatpak`;
    const destination = path.join(root, "dist", filename);
    if (fs.existsSync(destination)) throw new Error("Diagnostic output exists; choose a new revision suffix.");
    for (const command of ["build:linux:dir", "build:flatpak:release"]) {
      execFileSync("npm", ["run", command], { cwd: stage, stdio: "inherit" });
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(stage, "dist", filename), destination, fs.constants.COPYFILE_EXCL);
    console.log(`Diagnostic bundle: ${destination}`);
  } finally {
    fs.rmSync(task, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { build(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareStage, replaceOnce };
