export function retainDistinctResearchReference<T extends { contentSha256: string }>(
  selected: T[],
  candidate: T,
  maximum = 4,
): boolean {
  if (
    selected.length >= maximum ||
    selected.some(({ contentSha256 }) => contentSha256 === candidate.contentSha256)
  ) {
    return false;
  }
  selected.push(candidate);
  return true;
}
