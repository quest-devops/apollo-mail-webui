/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { type FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useAuthStore } from '@/stores/authStore';
import { getBasePath } from '@/lib/basePath';
import {
  authenticateWithPassword,
  startAuthFlow,
  startApolloAuthFlow,
  MfaRequiredError,
} from '@/services/auth/oauth';

import './login-apollo.css';

/**
 * Login em UMA tela, no padrão visual dos apps Apollo (réplica do ApolloAuth):
 * painel de nebula à esquerda com a lockup e a frase de marca, formulário solto
 * à direita (usuário + senha juntos). A autenticação é direta contra a API do
 * Stalwart — nada de redirecionar para a tela de login do servidor.
 */
export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const originalPath = (location.state as { from?: string } | null)?.from ?? null;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  function safeDestination(): string {
    const basePath = getBasePath();
    const candidate = originalPath ?? '/';
    const stripped = candidate.startsWith(basePath) ? candidate.slice(basePath.length) || '/' : candidate;
    const isAuthPath =
      stripped === '/login' ||
      stripped.startsWith('/login?') ||
      stripped === '/oauth/callback' ||
      stripped.startsWith('/oauth/callback?');
    return isAuthPath ? '/' : stripped;
  }

  async function handleApolloAuth() {
    if (loading || ssoLoading) return;
    setError(null);
    setSsoLoading(true);
    try {
      await startApolloAuthFlow(originalPath); // navega para o IdP; não retorna em caso de sucesso
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o login com ApolloAuth.');
      setSsoLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const user = username.trim();
    if (!user || !password || loading) return;

    setError(null);
    setLoading(true);

    try {
      const { tokens, tokenEndpoint, endSessionEndpoint } = await authenticateWithPassword(user, password);
      useAuthStore
        .getState()
        .setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in, tokenEndpoint, endSessionEndpoint);
      navigate(safeDestination(), { replace: true });
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        // Conta com verificação em duas etapas: cai no fluxo com a página do
        // servidor (que coleta o OTP) até esta tela ganhar o campo de código.
        try {
          await startAuthFlow(user, originalPath);
          return;
        } catch (flowErr) {
          setError(flowErr instanceof Error ? flowErr.message : 'Não foi possível iniciar a autenticação.');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível autenticar. Tente novamente.');
      }
      setLoading(false);
    }
  }

  return (
    <div className="alogin">
      <aside className="alogin-painel" aria-hidden="true">
        <span className="alogin-frase">ApolloMail — seu e-mail profissional, num só lugar.</span>
      </aside>

      <main className="alogin-col">
        <img className="alogin-lockup-mobile" src="/branding/am-lockup-verde.png" alt="ApolloMail" />

        <form className="alogin-form" onSubmit={handleSubmit} noValidate>
          <h1 className="alogin-titulo">Bem-vindo à Apollo.</h1>

          <label className="alogin-label" htmlFor="alogin-user">
            E-mail ou usuário <span className="alogin-req">*</span>
          </label>
          <input
            id="alogin-user"
            className="alogin-input"
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="Digite seu e-mail ou usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />

          <label className="alogin-label" htmlFor="alogin-pass">
            Senha <span className="alogin-req">*</span>
          </label>
          <input
            id="alogin-pass"
            className="alogin-input"
            type="password"
            autoComplete="current-password"
            placeholder="Digite sua senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />

          {error && (
            <p className="alogin-erro" role="alert">
              {error}
            </p>
          )}

          <button className="alogin-btn" type="submit" disabled={loading || !username.trim() || !password}>
            {loading ? <Loader2 className="alogin-spin" aria-label="Autenticando" /> : 'Conecte-se'}
          </button>

          <div className="alogin-divisor" aria-hidden="true">
            ou continue com
          </div>

          {/* SSO via ApolloAuth (Authentik/OIDC): authorization code + PKCE contra o IdP.
              O token que volta é validado pelo próprio Stalwart (Directory tipo OIDC). */}
          <button
            className="alogin-btn-sso"
            type="button"
            onClick={handleApolloAuth}
            disabled={loading || ssoLoading}
          >
            {ssoLoading ? (
              <Loader2 className="alogin-spin" aria-label="Redirecionando" />
            ) : (
              <>
                <img src="/branding/aa-icone.png" alt="" aria-hidden="true" />
                Continuar com ApolloAuth
              </>
            )}
          </button>

          <p className="alogin-legal">
            Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.
          </p>

          <p className="alogin-rodape">ApolloMail · Console</p>
        </form>
      </main>
    </div>
  );
}
