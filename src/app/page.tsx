import { StudioAtrium } from "@/components/studio/studio-atrium";
import { consumeBuildSecretCanary } from "@/config/build-boundary";

export default function HomePage() {
  return (
    <div data-server-secret-boundary={consumeBuildSecretCanary()}>
      <StudioAtrium />
    </div>
  );
}
