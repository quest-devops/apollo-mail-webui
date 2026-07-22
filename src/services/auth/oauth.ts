/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { getApiBaseUrl } from '@/services/api';
import { getBasePath } from '@/lib/basePath';
import i18n from '@/i18n';

const CLIENT_ID = (import.meta.env.VITE_OAUTH_CLIENT_ID as string) || 'stalwart-webui';
const SCOPES = import.meta.env.VITE_OAUTH_SCOPES as string | undefined;

const SESSION_PREFIX = 'stalwart-oauth-';

interface DiscoveryResponse {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  scopes_supported?: string[];
}

export async function discover(username: string): Promise<DiscoveryResponse> {
  const url = `${getApiBaseUrl()}/api/discover/${encodeURIComponent(username)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      i18n.t('oauth.discoveryFailed', 'Discovery failed for "{{username}}": {{status}} {{statusText}}', {
        username,
        status: response.status,
        statusText: response.statusText,
      }),
    );
  }
  return response.json() as Promise<DiscoveryResponse>;
}

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error(`code_verifier length must be 43-128, got ${length}`);
  }

  const out: string[] = [];
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i];
      if (b < 198) {
        out.push(UNRESERVED[b % 66]);
      }
    }
  }
  return out.join('');
}

export async function generateCodeChallenge(
  verifier: string,
): Promise<{ challenge: string; method: 'S256' | 'plain' }> {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    return { challenge: verifier, method: 'plain' };
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return { challenge: base64UrlEncode(new Uint8Array(digest)), method: 'S256' };
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join('');
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  tokenEndpoint: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(
      i18n.t('oauth.tokenExchangeFailed', 'Token exchange failed: {{status}} {{statusText}}', {
        status: response.status,
        statusText: response.statusText,
      }),
    );
  }

  return response.json() as Promise<TokenResponse>;
}

function getRedirectUri(): string {
  const basePath = getBasePath();
  return `${window.location.origin}${basePath}/oauth/callback`;
}

/** Conta exige verificação em duas etapas — esta tela ainda não coleta OTP. */
export class MfaRequiredError extends Error {}

export interface DirectAuthSuccess {
  tokens: TokenResponse;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
}

/**
 * Login em UMA tela (padrão Apollo): autentica usuário+senha direto contra o
 * POST /api/auth do Stalwart — o MESMO endpoint que a página /login dele usa
 * (payload authCode com PKCE; resposta {type:'authenticated', client_code}) —
 * e troca o code por tokens sem nunca navegar para a tela do servidor.
 */
export async function authenticateWithPassword(username: string, password: string): Promise<DirectAuthSuccess> {
  const discovery = await discover(username);
  const tokenEndpoint = resolveEndpoint(discovery.token_endpoint);
  const endSessionEndpoint = discovery.end_session_endpoint
    ? resolveEndpoint(discovery.end_session_endpoint)
    : undefined;

  const codeVerifier = generateCodeVerifier();
  const { challenge: codeChallenge, method: codeChallengeMethod } = await generateCodeChallenge(codeVerifier);
  const state = generateState();
  const redirectUri = getRedirectUri();

  // MESMA política de scope do fluxo por redirect (startAuthFlow): sem isso o
  // token sai com escopo diferente do esperado — a session JMAP vinha vazia
  // ("No primary account ID available") e, sem offline_access, sem refresh.
  const { scopes_supported } = discovery;
  let scope: string | undefined;
  if (SCOPES && SCOPES.length > 0) {
    scope = SCOPES;
  } else if (scopes_supported?.includes('openid')) {
    scope = ['openid', 'email', 'profile', 'offline_access'].filter((s) => scopes_supported.includes(s)).join(' ');
  }

  const response = await fetch(`${getApiBaseUrl()}/api/auth`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      type: 'authCode',
      accountName: username,
      accountSecret: password,
      clientId: CLIENT_ID,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      ...(scope ? { scope } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      i18n.t('login.serverError', 'Falha no servidor de autenticação ({{status}}). Tente novamente.', {
        status: response.status,
      }),
    );
  }

  const data = (await response.json()) as { type?: string; client_code?: string };

  if (data.type === 'failure') {
    throw new Error(i18n.t('login.badCredentials', 'Usuário ou senha inválidos. Tente novamente.'));
  }
  if (data.type === 'mfaRequired') {
    throw new MfaRequiredError();
  }
  if (data.type !== 'authenticated' || typeof data.client_code !== 'string') {
    throw new Error(
      i18n.t('login.unexpectedResponse', 'Resposta inesperada do servidor de autenticação.'),
    );
  }

  const tokens = await exchangeCode(data.client_code, codeVerifier, tokenEndpoint, redirectUri);
  return { tokens, tokenEndpoint, endSessionEndpoint };
}

// Os endpoints do discover vêm relativos (ex.: "/login", "/auth/token") — pertencem ao servidor da API.
// Em dev o SPA roda em porta separada (5173) e a API em 8080; sem resolver contra a base da API o
// navegador resolveria contra a origem do SPA e o login quebraria. Em produção (API = origem) é no-op.
function resolveEndpoint(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const base = getApiBaseUrl();
  return `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export async function startAuthFlow(username: string, returnUrl?: string | null): Promise<void> {
  const discovery = await discover(username);
  const authorization_endpoint = resolveEndpoint(discovery.authorization_endpoint);
  const token_endpoint = resolveEndpoint(discovery.token_endpoint);
  const end_session_endpoint = discovery.end_session_endpoint
    ? resolveEndpoint(discovery.end_session_endpoint)
    : undefined;
  const { scopes_supported } = discovery;

  const codeVerifier = generateCodeVerifier();
  const { challenge: codeChallenge, method: codeChallengeMethod } = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  const candidate = returnUrl ?? window.location.pathname + window.location.search;
  const basePath = getBasePath();
  const stripped = candidate.startsWith(basePath) ? candidate.slice(basePath.length) : candidate;
  const isAuthPath =
    stripped === '/login' ||
    stripped.startsWith('/login?') ||
    stripped === '/oauth/callback' ||
    stripped.startsWith('/oauth/callback?');
  const safeReturnUrl = isAuthPath ? '' : candidate;

  sessionStorage.setItem(`${SESSION_PREFIX}code_verifier`, codeVerifier);
  sessionStorage.setItem(`${SESSION_PREFIX}token_endpoint`, token_endpoint);
  sessionStorage.setItem(`${SESSION_PREFIX}state`, state);
  sessionStorage.setItem(`${SESSION_PREFIX}return_url`, safeReturnUrl);
  if (end_session_endpoint) {
    sessionStorage.setItem(`${SESSION_PREFIX}end_session_endpoint`, end_session_endpoint);
  } else {
    sessionStorage.removeItem(`${SESSION_PREFIX}end_session_endpoint`);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
    login_hint: username,
    prompt: 'login',
  });

  let scope: string;
  if (SCOPES && SCOPES.length > 0) {
    scope = SCOPES;
  } else if (scopes_supported?.includes('openid')) {
    scope = ['openid', 'email', 'profile', 'offline_access'].filter((s) => scopes_supported.includes(s)).join(' ');
  } else {
    scope = '';
  }
  if (scope) {
    params.set('scope', scope);
  }

  window.location.href = `${authorization_endpoint}?${params.toString()}`;
}

export function getStoredOAuthData() {
  return {
    codeVerifier: sessionStorage.getItem(`${SESSION_PREFIX}code_verifier`),
    tokenEndpoint: sessionStorage.getItem(`${SESSION_PREFIX}token_endpoint`),
    state: sessionStorage.getItem(`${SESSION_PREFIX}state`),
    returnUrl: sessionStorage.getItem(`${SESSION_PREFIX}return_url`),
    endSessionEndpoint: sessionStorage.getItem(`${SESSION_PREFIX}end_session_endpoint`),
  };
}

export function clearStoredOAuthData(): void {
  sessionStorage.removeItem(`${SESSION_PREFIX}code_verifier`);
  sessionStorage.removeItem(`${SESSION_PREFIX}token_endpoint`);
  sessionStorage.removeItem(`${SESSION_PREFIX}state`);
  sessionStorage.removeItem(`${SESSION_PREFIX}return_url`);
  sessionStorage.removeItem(`${SESSION_PREFIX}end_session_endpoint`);
}

export function getOAuthRedirectUri(): string {
  return getRedirectUri();
}

export function getPostLogoutRedirectUri(): string {
  const basePath = getBasePath();
  return `${window.location.origin}${basePath}/login`;
}

export function buildEndSessionUrl(endSessionEndpoint: string, postLogoutRedirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
  const sep = endSessionEndpoint.includes('?') ? '&' : '?';
  return `${endSessionEndpoint}${sep}${params.toString()}`;
}
