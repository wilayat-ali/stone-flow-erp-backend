// Links the owner shares by hand (WhatsApp, SMS, in person). Nothing is sent
// from the server. The frontend routes below must exist in the web app.

export function buildInviteLink(
  frontendDomain: string | undefined,
  slug: string,
  token: string,
): string {
  return `${frontendDomain ?? ''}/${slug}/accept-invite?token=${token}`;
}

export function buildResetLink(
  frontendDomain: string | undefined,
  slug: string,
  token: string,
): string {
  return `${frontendDomain ?? ''}/${slug}/reset-password?token=${token}`;
}

// wa.me opens WhatsApp with the message ready to send. With a phone it opens
// that chat; without one it lets the owner pick a contact.
export function buildWhatsAppLink(
  phoneE164: string | null | undefined,
  message: string,
): string {
  const digits = phoneE164?.replace(/\D/g, '') ?? '';

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
