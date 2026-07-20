"use client";

import { useState, type FormEvent } from "react";

import type { MembershipRole } from "@/domain/studio";
import { sendCommand } from "@/lib/commands/client";

export function AccountPanel({
  email,
  onClose,
  role,
  workspaceId,
}: Readonly<{
  email: string;
  onClose: () => void;
  role: MembershipRole;
  workspaceId: string;
}>) {
  const [status, setStatus] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");

  async function createInvitation(event: FormEvent): Promise<void> {
    event.preventDefault();
    setStatus("");
    setInviteLink("");
    try {
      const response = await sendCommand("invitation.create", {
        email: inviteEmail,
        maximumRole: "member",
        workspaceId,
      });
      if (!response.inviteToken) throw new Error("Invitation token missing.");
      setInviteLink(
        `${window.location.origin}/?invite=${encodeURIComponent(response.inviteToken)}`,
      );
      setStatus(
        "Invitation created. Copy this link now; Genie will not show it again.",
      );
    } catch {
      setStatus("The invitation was rejected.");
    }
  }

  return (
    <section className="account-panel">
      <header>
        <div>
          <span className="eyebrow">Studio identity</span>
          <h2>Account</h2>
        </div>
        <button aria-label="Close account settings" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="account-identity">
        <span aria-hidden="true">{email.slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{email}</strong>
          <small>{role}</small>
        </div>
      </div>
      {role === "admin" ? (
        <form className="invite-form" onSubmit={createInvitation}>
          <span className="eyebrow">Invite-only onboarding</span>
          <h3>Open a seat for a teammate</h3>
          <div>
            <label>
              Exact email
              <input
                onChange={(event) => setInviteEmail(event.target.value)}
                required
                type="email"
                value={inviteEmail}
              />
            </label>
            <label>
              Role
              <select aria-label="Role" defaultValue="member">
                <option value="member">Member</option>
              </select>
            </label>
          </div>
          <button className="quiet-button">Create 24-hour invitation</button>
          {inviteLink ? (
            <label>
              One-time invitation link
              <input
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                value={inviteLink}
              />
            </label>
          ) : null}
        </form>
      ) : null}
      {status ? (
        <p className="account-status" role="status">
          {status}
        </p>
      ) : null}
      <form action="/auth/sign-out" method="post">
        <button className="quiet-button">Sign out of this device</button>
      </form>
    </section>
  );
}
