export type ProductionReferenceEdge = Readonly<{
  asset_version_id: string | null;
  reference_kind: string;
  shot_number: number;
}>;

export type ProductionEditorialReference = Readonly<{
  realWorldReferenceAssetVersionId: string | null;
  shotNumber: number;
}>;

export function selectProductionReferences(
  edgesInOrdinalOrder: readonly ProductionReferenceEdge[],
  editorial: readonly ProductionEditorialReference[],
): ReadonlyMap<number, string> {
  const selected = new Map<number, string>();
  const researchedEdges = new Map<number, string>();
  for (const edge of edgesInOrdinalOrder) {
    if (edge.reference_kind === "real_world") {
      if (edge.asset_version_id === null || researchedEdges.has(edge.shot_number)) {
        throw new Error("The executable real-world reference graph is ambiguous.");
      }
      researchedEdges.set(edge.shot_number, edge.asset_version_id);
    }
    if (edge.asset_version_id && !selected.has(edge.shot_number)) {
      selected.set(edge.shot_number, edge.asset_version_id);
    }
  }
  for (const shot of editorial) {
    const graphReference = researchedEdges.get(shot.shotNumber) ?? null;
    if (shot.realWorldReferenceAssetVersionId !== graphReference) {
      throw new Error(
        "The editorial and executable real-world references do not match.",
      );
    }
  }
  return selected;
}
