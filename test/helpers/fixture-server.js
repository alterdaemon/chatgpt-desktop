const fs = require("fs");
const http = require("http");
const path = require("path");

function startFixtureServer(fixtureName = "chat-fixture.html") {
  const fixturePath = path.join(__dirname, "..", "fixtures", fixtureName);
  const fixture = fs.readFileSync(fixturePath);
  const server = http.createServer((request, response) => {
    // Any path serves the fixture so in-page route changes stay on the origin,
    // but the query/hash still distinguishes routes for the script registry.
    if (request.url.startsWith("/missing")) {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

module.exports = { startFixtureServer };
