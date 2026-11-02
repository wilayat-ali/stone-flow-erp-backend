// How invitations and password links reach people by email. The invite
// endpoints always return the link as well, so the owner can share it by
// WhatsApp. Phone OTP or automatic WhatsApp can be added later as another
// implementation of this class without touching the callers.
export abstract class InviteNotifier {
  abstract isEnabled(): boolean;

  abstract sendInvitation(data: {
    to: string;
    url: string;
    companyName: string;
    roleName: string;
  }): Promise<void>;

  abstract sendPasswordLink(data: {
    to: string;
    url: string;
    companyName: string;
  }): Promise<void>;
}
