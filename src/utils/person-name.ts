// A person's display name for lists ("created by", "approved by"): first and
// last name, else their phone, else their email.
export function personName(member?: {
  user?: {
    firstName: string | null;
    lastName: string | null;
    phone?: string | null;
    email: string | null;
  };
}): string | null {
  const user = member?.user;

  if (!user) {
    return null;
  }

  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.phone ||
    user.email ||
    null
  );
}
