#!/usr/bin/env node
// scripts/google-oauth.mjs — one-shot Google Ads OAuth refresh-token minter.
//
// Reads the OAuth *Desktop app* client_secret JSON downloaded from Google Cloud
// Console, runs the installed-app loopback flow (opens a browser → you click
// "Allow" once), exchanges the code for a refresh token, and prints all three
// values the collector needs: client_id, client_secret, refresh_token.
//
// The refresh token is durable (the OAuth app is "Internal", so it does not
// expire after 7 days). Run once per Google account/MCC — the manager-account
// token covers every client account linked under it.
//
// Usage:
//   node scripts/google-oauth.mjs                 # auto-finds newest ~/Downloads/client_secret*.json
//   node scripts/google-oauth.mjs /path/to/client_secret.json
//
// Zero dependencies — Node 18+ (built-in http + global fetch) only.

import http from "node:http";
import { readFileSync, readdirSync, statSync, openSync, writeSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const SCOPE = "https://www.googleapis.com/auth/adwords";
const OUT_FILE = join(process.cwd(), ".google-oauth.local.json");

// Credential resolution, most convenient first:
//   1. CLIENT_ID env + secret from the macOS clipboard (pbpaste) — the flow we use.
//   2. CLIENT_ID + CLIENT_SECRET both from env.
//   3. A downloaded client_secret*.json (arg path or newest in ~/Downloads).
function resolveCreds() {
  // 0. Pre-seeded local creds file (client_id + client_secret already captured).
  try {
    const seed = JSON.parse(readFileSync(OUT_FILE, "utf8"));
    if (seed.client_id && seed.client_secret)
      return { client_id: seed.client_id, client_secret: seed.client_secret, source: OUT_FILE };
  } catch {
    /* not seeded yet */
  }

  let client_id = process.env.CLIENT_ID;
  let client_secret = process.env.CLIENT_SECRET;

  if (client_id && !client_secret) {
    try {
      client_secret = execFileSync("pbpaste").toString().trim();
    } catch {
      /* not macOS / no clipboard */
    }
  }
  if (client_id && client_secret) return { client_id, client_secret, source: "env/clipboard" };

  // Fallback: JSON file.
  let path = process.argv[2];
  if (!path) {
    const dl = join(homedir(), "Downloads");
    const hits = readdirSync(dl)
      .filter((f) => f.startsWith("client_secret") && f.endsWith(".json"))
      .map((f) => join(dl, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    path = hits[0];
  }
  if (path) {
    const c = (JSON.parse(readFileSync(path, "utf8")).installed) || {};
    if (c.client_id && c.client_secret)
      return { client_id: c.client_id, client_secret: c.client_secret, source: path };
  }

  console.error(
    "Missing credentials. Provide the client ID and secret one of these ways:\n" +
      "  CLIENT_ID='...apps.googleusercontent.com' node scripts/google-oauth.mjs   (secret read from clipboard)\n" +
      "  CLIENT_ID='...' CLIENT_SECRET='GOCSPX-...' node scripts/google-oauth.mjs\n" +
      "  node scripts/google-oauth.mjs /path/to/client_secret.json"
  );
  process.exit(1);
}

const { client_id, client_secret, source } = resolveCreds();
if (!client_secret.startsWith("GOCSPX-")) {
  console.error(
    `Clipboard/secret doesn't look like a Google client secret (expected GOCSPX-…, got "${client_secret.slice(0, 8)}…").\n` +
      "Copy the secret again and rerun."
  );
  process.exit(1);
}
console.log(`Client ID:  ${client_id}`);
console.log(`Secret:     GOCSPX-…${client_secret.slice(-4)} (from ${source})\n`);

// Loopback server catches Google's redirect with the auth code.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (!code && !err) {
    res.writeHead(204).end();
    return;
  }
  if (err) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<h2>Authorization failed: ${err}</h2><p>You can close this tab.</p>`);
    console.error(`\nAuthorization failed: ${err}`);
    server.close();
    process.exit(1);
  }

  const port = server.address().port;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: `http://localhost:${port}`,
      grant_type: "authorization_code",
    }),
  });
  const tok = await tokenRes.json();

  res.writeHead(200, { "content-type": "text/html" });
  if (tok.refresh_token) {
    res.end("<h2>All set — refresh token captured.</h2><p>You can close this tab and return to Claude.</p>");
    // Write the full credential bundle to a gitignored local file so the
    // refresh token never has to transit the chat. Claude reads this file,
    // vaults the three values, then deletes it.
    // Owner-only (0o600) from creation — the file holds the client secret +
    // refresh token, so it must never be group/world readable.
    const fd = openSync(OUT_FILE, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify({ client_id, client_secret, refresh_token: tok.refresh_token }, null, 2));
    } finally {
      closeSync(fd);
    }
    console.log("\nGoogle Ads OAuth complete.");
    console.log(`  refresh_token captured (…${tok.refresh_token.slice(-6)})`);
    console.log(`  written to ${OUT_FILE}`);
    console.log("\nTell Claude it's done — it will vault the credentials and remove this file.");
  } else {
    res.end("<h2>No refresh token returned.</h2><p>See the terminal for details.</p>");
    console.error("\nNo refresh_token in response:", JSON.stringify(tok, null, 2));
    console.error(
      "\nTip: if you've authorized before, revoke prior access or the retry will\n" +
        "omit the refresh token. This script already sends prompt=consent to force it."
    );
  }
  server.close();
  process.exit(tok.refresh_token ? 0 : 1);
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id,
      redirect_uri: `http://localhost:${port}`,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
    });
  console.log("Opening your browser to authorize (sign in as thomas@trustedmarketing.com)...");
  console.log("If it doesn't open, paste this URL into Chrome:\n");
  console.log(authUrl + "\n");
  // Best-effort auto-open (macOS `open`, Linux `xdg-open`, Windows `start`).
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [authUrl], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).on(
    "error",
    () => {}
  );
});
