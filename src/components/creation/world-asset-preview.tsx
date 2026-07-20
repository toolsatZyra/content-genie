"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

interface SignedAssetResponse {
  readonly ok?: boolean;
  readonly signedUrl?: string;
}

export function WorldAssetPreview({
  alt,
  assetVersionId,
}: Readonly<{ alt: string; assetVersionId: string }>) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    void fetch(`/api/assets/${encodeURIComponent(assetVersionId)}/sign`, {
      cache: "no-store",
      method: "POST",
      signal: abortController.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as SignedAssetResponse;
        if (!response.ok || body.ok !== true || typeof body.signedUrl !== "string") {
          throw new Error("Preview unavailable");
        }
        setSignedUrl(body.signedUrl);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => abortController.abort();
  }, [assetVersionId]);

  if (!signedUrl) {
    return (
      <div className="world-preview-placeholder" role={failed ? "status" : undefined}>
        <span aria-hidden="true">{failed ? "◇" : "✦"}</span>
        <small>
          {failed ? "Secure preview unavailable" : "Opening secure preview"}
        </small>
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      fill
      sizes="(max-width: 760px) 92vw, (max-width: 1120px) 44vw, 360px"
      src={signedUrl}
      unoptimized
    />
  );
}
