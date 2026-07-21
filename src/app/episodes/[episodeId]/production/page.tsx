import { redirect } from "next/navigation";

interface ProductionPageProps {
  readonly params: Promise<{ readonly episodeId: string }>;
  readonly searchParams: Promise<{ readonly fixture?: string }>;
}

export default async function ProductionPage({
  params,
  searchParams,
}: ProductionPageProps) {
  const [{ episodeId }, query] = await Promise.all([params, searchParams]);
  const fixture = query.fixture ? `&fixture=${encodeURIComponent(query.fixture)}` : "";
  redirect(`/episodes/${episodeId}/create?resumeCreation=edit${fixture}`);
}
