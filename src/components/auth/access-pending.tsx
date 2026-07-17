"use client";

import { useState } from "react";

import { sendCommand } from "@/lib/commands/client";

export function AccessPending({
  displayEmail,
  invitationToken,
}: Readonly<{
  displayEmail: string;
  invitationToken?: string | undefined;
}>) {
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  async function accept(): Promise<void> {
    if (!invitationToken) return;
    setWorking(true);
    try {
      await sendCommand("invitation.accept", { token: invitationToken });
      window.location.assign("/");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invitation rejected.");
      setWorking(false);
    }
  }

  return (
    <main className="pending-shell" id="main-content">
      <span className="pending-orbit" aria-hidden="true">
        ✦
      </span>
      <span className="eyebrow">Identity verified</span>
      <h1>Your place in the studio is being prepared.</h1>
      <p>
        You are signed in as <strong>{displayEmail}</strong>, but do not yet have an
        active Genie workspace membership.
      </p>
      {invitationToken ? (
        <button className="primary-button" disabled={working} onClick={accept}>
          {working ? "Unlocking workspace…" : "Accept studio invitation"}
        </button>
      ) : (
        <p className="pending-note">
          Ask a Genie administrator for a fresh invitation.
        </p>
      )}
      {status ? <p role="alert">{status}</p> : null}
      <form action="/auth/sign-out" method="post">
        <button className="quiet-button">Sign out</button>
      </form>
    </main>
  );
}
