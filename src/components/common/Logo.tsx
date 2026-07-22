/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 * SPDX-FileCopyrightText: 2026 Apollo Solution — rebrand ApolloMail (lockup oficial do kit apps/mail/logo)
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseUrl } from '@/services/api';

// Lockup oficial ApolloMail (INTEIRA VERDE, horizontal) — public/branding/am-lockup-verde.png,
// derivada de apps/mail/logo/ (fonte canônica no Brand Engine; build de 22/jul com o ícone
// corrigido — proporção útil 6.27, o texto dá o tom). Readaptar, nunca redesenhar.
// 18px de altura ≈ os 17px da topbar do webmail (a topbar daqui é um tico mais alta).
export function DefaultLogo() {
  const { t } = useTranslation();
  return (
    <img
      src="/branding/am-lockup-verde.png"
      alt={t('logo.stalwartAlt', 'ApolloMail')}
      className="h-[18px] w-auto object-contain"
    />
  );
}

export default function Logo() {
  const { t } = useTranslation();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchLogo() {
      try {
        const response = await fetch(`${getApiBaseUrl()}/logo`, {
          signal: controller.signal,
        });
        const contentType = response.headers.get('content-type') ?? '';

        if (response.ok && contentType.startsWith('image/')) {
          const blob = await response.blob();
          if (!controller.signal.aborted) {
            const url = URL.createObjectURL(blob);
            setLogoUrl(url);
          }
        } else {
          if (!controller.signal.aborted) setFailed(true);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    fetchLogo();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (logoUrl) {
        URL.revokeObjectURL(logoUrl);
      }
    };
  }, [logoUrl]);

  if (logoUrl && !failed) {
    return <img src={logoUrl} alt={t('logo.alt', 'Logo')} className="h-7 w-auto max-w-[220px] object-contain" />;
  }

  return <DefaultLogo />;
}
