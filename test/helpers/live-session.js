const AUTH_COOKIE = /^(?:__Secure-)?(?:next-auth|authjs)\.session-token(?:\.\d+)?$/;
const SESSION_CONTEXT_COOKIES = new Set([
  "oai-did",
  "oai-sc",
  "_account",
  "_account_is_fedramp",
  "oai-client-session-epoch",
]);

function parseSessionCookies(source) {
  if (!source) {
    return [];
  }

  let cookies;
  try {
    cookies = JSON.parse(source);
  } catch {
    throw new Error("Invalid CHATGPT_TEST_SESSION_COOKIES JSON.");
  }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error("CHATGPT_TEST_SESSION_COOKIES must contain session cookies.");
  }

  if (!cookies.some((cookie) => cookie && AUTH_COOKIE.test(cookie.name))) {
    throw new Error("CHATGPT_TEST_SESSION_COOKIES must include an authentication cookie.");
  }

  return cookies.map((cookie) => {
    if (
      !cookie ||
      typeof cookie.name !== "string" ||
      (!AUTH_COOKIE.test(cookie.name) && !SESSION_CONTEXT_COOKIES.has(cookie.name)) ||
      typeof cookie.value !== "string" ||
      !cookie.value ||
      !["chatgpt.com", ".chatgpt.com"].includes(cookie.domain) ||
      (cookie.expirationDate !== undefined &&
        (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate <= Date.now() / 1000))
    ) {
      throw new Error("CHATGPT_TEST_SESSION_COOKIES contains an invalid or expired first-party session cookie.");
    }

    return {
      url: "https://chatgpt.com/",
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: "/",
      secure: true,
      httpOnly: AUTH_COOKIE.test(cookie.name) || Boolean(cookie.httpOnly),
      sameSite: "lax",
      ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    };
  });
}

module.exports = { AUTH_COOKIE, SESSION_CONTEXT_COOKIES, parseSessionCookies };
