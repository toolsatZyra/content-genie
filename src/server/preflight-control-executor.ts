import "server-only";

import { findLookByVersionId, type LookDefinition } from "@/domain/look/look-registry";
import type { PreflightTaskEnvelope } from "../../trigger/preflight-contract";
import {
  getPreflightControlExecutionInput,
  getVerifiedPreflightAudioIdentitySelection,
  getWorldExtractionReplayResult,
  PreflightControlLedgerError,
  recordPreflightControlOutput,
  recordWorldExtractionResult,
} from "@/server/preflight-control-ledger";
import { extractWorldFromLockedScript } from "@/server/world-extraction-agent";
import { ensurePreflightAudioIdentities } from "@/server/audio-identity-preflight";
import { prepareWorldAnchorProviderDispatches } from "@/server/world-anchor-provider";
import { prepareNarrationProviderDispatches } from "@/server/narration-provider";
import {
  executePlanPreflight,
  PreflightPlanAgentError,
} from "@/server/preflight-plan-agent";
import { ensureProductionQuote, ProductionQuoteError } from "@/server/production-quote";
import {
  failWorldBuildProgress,
  projectWorldExtractionProgress,
} from "@/server/world-build-progress";

export type ClassifiedPreflightControlFailure = Readonly<{
  retryable: boolean;
  safeErrorClass: string;
}>;

export function classifyPreflightControlFailure(
  error: unknown,
): ClassifiedPreflightControlFailure | null {
  if (
    !(error instanceof PreflightPlanAgentError) &&
    !(error instanceof ProductionQuoteError)
  ) {
    return null;
  }
  const safeErrorClass = error.code
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/[^a-z0-9.-]/gu, "-")
    .slice(0, 100);
  return Object.freeze({
    retryable: error.retryable,
    safeErrorClass: /^[a-z][a-z0-9.-]{2,99}$/u.test(safeErrorClass)
      ? safeErrorClass
      : "preflight-control-invalid",
  });
}

function verifiedLook(
  versionId: string,
  lockedLookBlockSha256: string,
): LookDefinition {
  const look = findLookByVersionId(versionId);
  if (!look || look.lockedLookBlockSha256 !== lockedLookBlockSha256) {
    throw new PreflightControlLedgerError(
      "Pinned look does not match the immutable look registry.",
      true,
    );
  }
  return look;
}

export async function executePreflightControl(input: {
  envelope: PreflightTaskEnvelope;
  taskId: string;
  triggerRunId: string;
}) {
  const executionInput = await getPreflightControlExecutionInput(input.envelope);
  if (
    executionInput.preflightRunId !== input.envelope.preflightRunId ||
    executionInput.workspaceId !== input.envelope.workspaceId
  ) {
    throw new PreflightControlLedgerError(
      "Preflight execution source binding is stale.",
      true,
    );
  }
  if (executionInput.kind === "narration_clock") {
    const preparedAudio = await ensurePreflightAudioIdentities({
      configurationCandidateId: executionInput.configurationCandidateId,
      preflightRunId: input.envelope.preflightRunId,
      stageAttemptId: input.envelope.stageAttemptId,
      trustedScopeHash: input.envelope.inputManifestSha256,
      workspaceId: executionInput.workspaceId,
    });
    const audioIdentitySelectionId = await getVerifiedPreflightAudioIdentitySelection(
      executionInput.configurationCandidateId,
    );
    if (audioIdentitySelectionId !== preparedAudio.selectionId) {
      throw new PreflightControlLedgerError(
        "Pinned audio identities changed during narration preparation.",
        true,
      );
    }
    const providerDispatches = await prepareNarrationProviderDispatches({
      audioIdentitySelectionId,
      configurationCandidateId: executionInput.configurationCandidateId,
      envelope: input.envelope,
      episodeId: executionInput.episodeId,
      exactText: executionInput.processingText,
      policyVersionId: executionInput.policyVersionId,
      scriptRevisionId: executionInput.scriptRevisionId,
      voiceVersionId: executionInput.voiceVersionId,
    });
    return Object.freeze({
      pendingExternal: true,
      providerDispatches,
      result: {
        audioIdentitySelectionId,
        processingTextSha256: executionInput.processingTextSha256,
        schemaVersion: "genie.narration-dispatch.v1",
      },
    });
  }
  if (executionInput.kind === "plan_evaluation") {
    const plan = await executePlanPreflight(input.envelope);
    const quote = await ensureProductionQuote({
      configurationCandidateId: executionInput.configurationCandidateId,
      workspaceId: executionInput.workspaceId,
    });
    const result = await recordPreflightControlOutput({
      envelope: input.envelope,
      output: Object.freeze({
        ...plan,
        productionQuoteHardCeilingMicrousd: quote.hardCeilingMicrousd,
        productionQuoteId: quote.quoteId,
        productionQuoteReplayed: quote.replayed,
      }),
      taskId: input.taskId,
      triggerRunId: input.triggerRunId,
    });
    return Object.freeze({
      pendingExternal: false,
      providerDispatches: Object.freeze([]),
      result,
    });
  }
  if (executionInput.kind !== "world_anchor") {
    throw new PreflightControlLedgerError(
      "This preflight executor is not implemented for the requested kind.",
      true,
    );
  }
  const look = verifiedLook(
    executionInput.lookVersionId,
    executionInput.lockedLookBlockSha256,
  );
  const replay = await getWorldExtractionReplayResult(input.envelope);
  const generated = replay
    ? null
    : await extractWorldFromLockedScript({
        authority: {
          configurationCandidateId: executionInput.configurationCandidateId,
          episodeId: executionInput.episodeId,
          policyVersionId: executionInput.policyVersionId,
          preflightRunId: input.envelope.preflightRunId,
          scriptRevisionId: executionInput.scriptRevisionId,
          stageAttemptId: input.envelope.stageAttemptId,
          trustedScopeHash: input.envelope.inputManifestSha256,
          workspaceId: executionInput.workspaceId,
        },
        script: executionInput.rawScript,
        scriptSha256: executionInput.rawScriptSha256,
      });
  const extracted = replay?.extraction ?? generated!.extraction;
  const recorded = replay
    ? replay
    : await recordWorldExtractionResult({
        envelope: input.envelope,
        extraction: generated!.extraction as unknown as Readonly<
          Record<string, unknown>
        >,
        lookVersionId: executionInput.lookVersionId,
        modelRequestHash: generated!.modelRequestHash,
        providerRequestId: generated!.responseRequestId,
        providerResponseId: generated!.responseId,
        scriptSha256: executionInput.rawScriptSha256,
      });
  await projectWorldExtractionProgress({
    configurationCandidateId: executionInput.configurationCandidateId,
    extraction: extracted,
    preflightRunId: input.envelope.preflightRunId,
    workspaceId: executionInput.workspaceId,
  });
  const blockingAmbiguities = extracted.ambiguities.filter(
    ({ blocksGeneration }) => blocksGeneration,
  ).length;
  const launchScopePass =
    extracted.scopeSignals.narrationOnly &&
    !extracted.scopeSignals.containsDialogue &&
    !extracted.scopeSignals.requiresLipSync;
  const anchorCount =
    extracted.characters.reduce((sum, character) => sum + character.forms.length, 0) +
    extracted.locations.length +
    extracted.props.length;
  const namedTempleResearchRequired = extracted.locations.some(
    ({ researchRequired }) => researchRequired,
  );
  if (blockingAmbiguities > 0 || !launchScopePass || anchorCount > 32) {
    await failWorldBuildProgress({
      detail:
        blockingAmbiguities > 0
          ? "World generation needs clarification before images can be created"
          : anchorCount > 32
            ? "The script exceeds the 32-anchor MVP limit"
            : "The script is outside the narration-only launch scope",
      preflightRunId: input.envelope.preflightRunId,
    });
    const result = await recordPreflightControlOutput({
      envelope: input.envelope,
      output: {
        anchorCount,
        blockingAmbiguities,
        characterCount: extracted.characters.length,
        extractionHash: recorded.extractionHash,
        extractionResultId: recorded.resultId,
        launchScopePass,
        locationCount: extracted.locations.length,
        propCount: extracted.props.length,
        namedTempleResearchRequired,
        schemaVersion: "genie.world-extraction-output.v1",
        worldGenerationBlocked: true,
      },
      taskId: input.taskId,
      triggerRunId: input.triggerRunId,
    });
    return Object.freeze({
      pendingExternal: false,
      providerDispatches: Object.freeze([]),
      result,
    });
  }
  const providerDispatches = await prepareWorldAnchorProviderDispatches({
    envelope: input.envelope,
    extraction: extracted,
    extractionResultId: recorded.resultId,
    look,
  });
  return Object.freeze({
    pendingExternal: true,
    providerDispatches,
    result: {
      anchorCount,
      extractionHash: recorded.extractionHash,
      extractionResultId: recorded.resultId,
      schemaVersion: "genie.world-anchor-dispatch.v1",
    },
  });
}
