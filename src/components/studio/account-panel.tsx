"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { MembershipRole } from "@/domain/studio";
import { sendCommand } from "@/lib/commands/client";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

interface Enrollment {
  readonly factorId: string;
  readonly qrCode: string;
  readonly secret: string;
}

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
  const [aal, setAal] = useState("aal1");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorToVerify, setFactorToVerify] = useState<string | null>(null);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "reviewer">("member");
  const [inviteLink, setInviteLink] = useState("");

  useEffect(() => {
    const client = getBrowserSupabaseClient();
    void Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
    ]).then(([assurance, factors]) => {
      setAal(assurance.data?.currentLevel ?? "aal1");
      setVerifiedFactorId(factors.data?.totp[0]?.id ?? null);
    });
  }, []);

  async function beginEnrollment(): Promise<void> {
    setStatus("");
    const client = getBrowserSupabaseClient();
    const existing = await client.auth.mfa.listFactors();
    if (existing.error) {
      setStatus("Authenticator status could not be loaded.");
      return;
    }
    for (const factor of (existing.data?.all ?? []).filter(
      ({ status: factorStatus }) => factorStatus === "unverified",
    )) {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Genie Studio",
    });
    if (error) {
      setStatus("A new authenticator could not be started.");
      return;
    }
    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setFactorToVerify(data.id);
  }

  async function verifyEnrollment(event: FormEvent): Promise<void> {
    event.preventDefault();
    const factorId = factorToVerify ?? enrollment?.factorId;
    if (!factorId) return;
    const client = getBrowserSupabaseClient();
    const challenge = await client.auth.mfa.challenge({
      factorId,
    });
    if (challenge.error) {
      setStatus("Authenticator challenge failed.");
      return;
    }
    const verification = await client.auth.mfa.verify({
      challengeId: challenge.data.id,
      code,
      factorId,
    });
    if (verification.error) {
      setStatus("That six-digit code was not accepted.");
      return;
    }
    setAal("aal2");
    setVerifiedFactorId(factorId);
    setFactorToVerify(null);
    setEnrollment(null);
    setCode("");
    setStatus("Authenticator verified. Sensitive actions are now unlocked.");
  }

  async function createInvitation(event: FormEvent): Promise<void> {
    event.preventDefault();
    setStatus("");
    setInviteLink("");
    try {
      const response = await sendCommand("invitation.create", {
        email: inviteEmail,
        maximumRole: inviteRole,
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
      setStatus(
        aal === "aal2"
          ? "The invitation was rejected."
          : "Verify your authenticator before inviting a teammate.",
      );
    }
  }

  return (
    <section className="account-panel">
      <header>
        <div>
          <span className="eyebrow">Studio identity</span>
          <h2>Account &amp; trust</h2>
        </div>
        <button aria-label="Close account settings" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="account-identity">
        <span aria-hidden="true">{email.slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{email}</strong>
          <small>
            {role} · current assurance {aal}
          </small>
        </div>
      </div>
      <div className="trust-card">
        <span className={aal === "aal2" ? "trust-light is-on" : "trust-light"} />
        <div>
          <strong>Authenticator protection</strong>
          <p>
            Required for invitations, offboarding, approvals, publication and budget
            authority.
          </p>
        </div>
        {aal !== "aal2" && !enrollment ? (
          <button
            onClick={() =>
              verifiedFactorId ? setFactorToVerify(verifiedFactorId) : beginEnrollment()
            }
            type="button"
          >
            {verifiedFactorId ? "Verify" : "Set up"}
          </button>
        ) : null}
      </div>
      {enrollment || factorToVerify ? (
        <form className="totp-enrollment" onSubmit={verifyEnrollment}>
          {enrollment ? (
            <>
              {/* QR is a trusted, ephemeral SVG data URI returned by Supabase Auth. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Authenticator QR code"
                height={180}
                src={enrollment.qrCode}
                width={180}
              />
            </>
          ) : (
            <span className="authenticator-sigil" aria-hidden="true">
              ✦
            </span>
          )}
          <div>
            <strong>{enrollment ? "Scan, then prove it" : "Prove it is you"}</strong>
            {enrollment ? (
              <p>
                Manual key: <code>{enrollment.secret}</code>
              </p>
            ) : (
              <p>Enter the current code from your saved authenticator.</p>
            )}
            <label>
              Six-digit code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                pattern="[0-9]{6}"
                required
                value={code}
              />
            </label>
            <button className="primary-button">Verify authenticator</button>
          </div>
        </form>
      ) : null}
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
              Maximum role
              <select
                onChange={(event) =>
                  setInviteRole(event.target.value as "member" | "reviewer")
                }
                value={inviteRole}
              >
                <option value="member">Member</option>
                <option value="reviewer">Reviewer</option>
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
