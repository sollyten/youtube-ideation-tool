/**
 * Per-director YouTube OAuth (SPEC §9, §4b). Authorization-code flow, all
 * server-side:
 *
 *   - buildAuthUrl() sends the director to Google's consent screen with a
 *     signed `state` that binds the callback to (user, profile) and defeats CSRF.
 *   - exchangeCode() swaps the returned code for tokens on the server; the
 *     browser never sees the client secret or the tokens.
 *   - The resulting token blob is stored ENCRYPTED via ScopedData; the client
 *     secret is the app's shared identity, not a per-user secret.
 *
 * A director can only ever authorize channels they personally connect: the
 * callback verifies both the signed state AND that the live session user matches
 * the user encoded in the state.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config/env.js";
import { BadRequestError, UpstreamError } from "../errors.js";

const SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
];
const STATE_TTL_MS = 15 * 60 * 1000;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

interface StatePayload {
  userId: string;
  profileId: string;
  nonce: string;
  exp: number;
}

function sign(data: string): string {
  return createHmac("sha256", config.authSecret).update(data).digest("base64url");
}

function encodeState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeState(state: string): StatePayload {
  const [body, mac] = state.split(".");
  if (!body || !mac) throw new BadRequestError("Malformed OAuth state");
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new BadRequestError("Invalid OAuth state signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  if (Date.now() > payload.exp) throw new BadRequestError("OAuth state expired — restart the connection");
  return payload;
}

export function buildAuthUrl(userId: string, profileId: string): string {
  const state = encodeState({ userId, profileId, nonce: randomBytes(8).toString("hex"), exp: Date.now() + STATE_TTL_MS });
  const params = new URLSearchParams({
    client_id: config.googleOAuth.clientId,
    redirect_uri: config.googleOAuth.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * The stored (encrypted) token shape. Matches google-auth's authorized_user
 * file so fetch_analytics.py can consume it directly after decryption.
 */
export interface StoredYoutubeToken {
  token: string; // access token
  refresh_token: string;
  token_uri: string;
  client_id: string;
  client_secret: string;
  scopes: string[];
  expiry?: string;
}

export async function exchangeCode(code: string): Promise<StoredYoutubeToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleOAuth.clientId,
      client_secret: config.googleOAuth.clientSecret,
      redirect_uri: config.googleOAuth.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    throw new UpstreamError(`Google token exchange failed: ${body.error ?? res.status}`);
  }
  if (typeof body.refresh_token !== "string") {
    throw new UpstreamError(
      "Google did not return a refresh token. Revoke prior access and reconnect with consent.",
    );
  }
  const expiry =
    typeof body.expires_in === "number"
      ? new Date(Date.now() + body.expires_in * 1000).toISOString()
      : undefined;
  return {
    token: body.access_token,
    refresh_token: body.refresh_token,
    token_uri: TOKEN_ENDPOINT,
    client_id: config.googleOAuth.clientId,
    client_secret: config.googleOAuth.clientSecret,
    scopes: typeof body.scope === "string" ? body.scope.split(" ") : SCOPES,
    ...(expiry ? { expiry } : {}),
  };
}
