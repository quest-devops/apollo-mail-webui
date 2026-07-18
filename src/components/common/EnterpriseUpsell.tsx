/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 * SPDX-FileCopyrightText: 2026 Apollo Solution — upsell Enterprise ocultado no rebrand ApolloMail
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

interface EnterpriseUpsellProps {
  open: boolean;
  onClose: () => void;
}

// ApolloMail: o card original abria um modal "comprar Stalwart Enterprise" com link para
// license.stalw.art — o que fura o white-label se um admin cliente o vê. Ocultado: renderiza nada.
// Para reativar (ou trocar por um upsell Apollo), restaurar a versão anterior do histórico git.
export function EnterpriseUpsell(_props: EnterpriseUpsellProps) {
  return null;
}
