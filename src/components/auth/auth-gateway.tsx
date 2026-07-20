"use client";

import { useState, type FormEvent } from "react";

import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

type SignInMode = "password" | "link";

export function AuthGateway({
  initialNotice,
}: Readonly<{ initialNotice?: string | undefined }>) {
  const [mode, setMode] = useState<SignInMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(initialNotice ?? "");
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setWorking(true);
    setStatus("");
    const client = getBrowserSupabaseClient();
    try {
      if (mode === "password") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.assign("/");
      } else {
        const { error } = await client.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            shouldCreateUser: false,
          },
        });
        if (error) throw error;
        setStatus("A private sign-in link is on its way. It expires shortly.");
      }
    } catch {
      setStatus(
        "Sign-in was not accepted. Check your details or ask a Genie admin for an invitation.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="gateway-shell" id="main-content">
      <section className="gateway-story" aria-labelledby="gateway-heading">
        <div className="gateway-brand">
          <span className="brand-orbit" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Genie</strong>
            <small>by Zyra</small>
          </span>
        </div>
        <span className="eyebrow">The devotional film atelier</span>
        <h1 id="gateway-heading">
          An agentic AI crew,
          <br />
          waiting inside.
        </h1>
        <p>
          Script in. A cinematic Hindi devotional episode out. Fifteen specialist AI
          agents create it; Monica guards every frame, voice, note and cultural decision
          along the way.
        </p>
        <div className="gateway-reel" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="gateway-card" aria-labelledby="sign-in-heading">
        <span className="gateway-sigil" aria-hidden="true">
          ✦
        </span>
        <span className="eyebrow">Private studio</span>
        <h2 id="sign-in-heading">Step into Genie</h2>
        <p>Only invited Zyra storytellers can enter.</p>
        <div className="gateway-tabs" role="tablist" aria-label="Sign-in method">
          <button
            aria-selected={mode === "password"}
            onClick={() => setMode("password")}
            role="tab"
            type="button"
          >
            Password
          </button>
          <button
            aria-selected={mode === "link"}
            onClick={() => setMode("link")}
            role="tab"
            type="button"
          >
            Magic link
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            Studio email
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          {mode === "password" ? (
            <label>
              Password
              <input
                autoComplete="current-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
          ) : null}
          <button className="primary-button gateway-submit" disabled={working}>
            {working
              ? "Opening the studio…"
              : mode === "password"
                ? "Enter Genie"
                : "Send private link"}
          </button>
        </form>
        {status ? (
          <p className="gateway-status" role="status">
            {status}
          </p>
        ) : null}
        <small>
          Access is logged. High-consequence reviews require a verified authenticator.
        </small>
      </section>
    </main>
  );
}
