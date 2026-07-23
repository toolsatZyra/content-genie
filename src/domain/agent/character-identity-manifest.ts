export const CHARACTER_IDENTITY_MANIFEST_SCHEMA_VERSION =
  "genie-character-identity-manifest.v2";

type CharacterRules = Readonly<{
  prohibited: readonly string[];
  required: readonly string[];
}>;

export type CharacterIdentityManifest = Readonly<{
  allowedTransitions: readonly Readonly<{
    conditions: readonly string[];
    fromFormKey: string;
    toFormKey: string;
  }>[];
  deity: Readonly<{
    arms: readonly Readonly<{
      armId: string;
      handId: string;
      ordinal: number;
      side: "center" | "left" | "right";
    }>[];
    handObjectAssignments: readonly Readonly<{
      assignmentKind: "attribute" | "empty" | "mudra" | "weapon";
      handId: string;
      objectKey: string | null;
    }>[];
    vahana: Readonly<{
      key: string | null;
      status: "none" | "specified";
    }>;
    weapons: readonly Readonly<{
      key: string;
      required: boolean;
    }>[];
  }> | null;
  dignity: CharacterRules;
  form: Readonly<{
    rules: CharacterRules;
    topology: Readonly<{
      armCount: number;
      handCount: number;
      headCount: number;
      legCount: number;
    }>;
  }>;
  identity: Readonly<{
    canonicalName: string;
    characterKey: string;
    essentialAttributes: readonly string[];
    formKey: string;
    formName: string;
  }>;
  isDeity: boolean;
  ornaments: readonly Readonly<{
    key: string;
    placement: string;
    required: boolean;
  }>[];
  schemaVersion: typeof CHARACTER_IDENTITY_MANIFEST_SCHEMA_VERSION;
  skin: Readonly<{
    formRules: readonly string[];
    toneRules: readonly string[];
  }>;
  wardrobe: CharacterRules;
}>;

export class CharacterIdentityManifestError extends Error {
  override readonly name = "CharacterIdentityManifestError";
}

const keyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

function exact(value: unknown, keys: readonly string[], label: string) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  ) {
    throw new CharacterIdentityManifestError(`${label} is not exact.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string,
  maximum = 500,
  pattern?: RegExp,
): string {
  if (typeof value !== "string") {
    throw new CharacterIdentityManifestError(`${label} is invalid.`);
  }
  const normalized = value.trim().normalize("NFC");
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(normalized) ||
    (pattern && !pattern.test(normalized))
  ) {
    throw new CharacterIdentityManifestError(`${label} is invalid.`);
  }
  return normalized;
}

function key(value: unknown, label: string) {
  return stringValue(value, label, 128, keyPattern);
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new CharacterIdentityManifestError(`${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new CharacterIdentityManifestError(`${label} is invalid.`);
  }
  return value as number;
}

function strings(
  value: unknown,
  label: string,
  maximumItems: number,
  allowEmpty: boolean,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new CharacterIdentityManifestError(`${label} is invalid.`);
  }
  const result = value.map((item, index) => stringValue(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new CharacterIdentityManifestError(`${label} contains duplicates.`);
  }
  return Object.freeze(result);
}

function rules(value: unknown, label: string): CharacterRules {
  const input = exact(value, ["prohibited", "required"], label);
  return Object.freeze({
    prohibited: strings(input.prohibited, `${label}.prohibited`, 32, true),
    required: strings(input.required, `${label}.required`, 32, false),
  });
}

export function parseCharacterIdentityManifest(
  value: unknown,
): CharacterIdentityManifest {
  const input = exact(
    value,
    [
      "allowedTransitions",
      "deity",
      "dignity",
      "form",
      "identity",
      "isDeity",
      "ornaments",
      "schemaVersion",
      "skin",
      "wardrobe",
    ],
    "identityManifest",
  );
  if (input.schemaVersion !== CHARACTER_IDENTITY_MANIFEST_SCHEMA_VERSION) {
    throw new CharacterIdentityManifestError(
      "identityManifest.schemaVersion is invalid.",
    );
  }

  const identityInput = exact(
    input.identity,
    ["canonicalName", "characterKey", "essentialAttributes", "formKey", "formName"],
    "identityManifest.identity",
  );
  const identity = Object.freeze({
    canonicalName: stringValue(
      identityInput.canonicalName,
      "identityManifest.identity.canonicalName",
      200,
    ),
    characterKey: key(
      identityInput.characterKey,
      "identityManifest.identity.characterKey",
    ),
    essentialAttributes: strings(
      identityInput.essentialAttributes,
      "identityManifest.identity.essentialAttributes",
      32,
      false,
    ),
    formKey: key(identityInput.formKey, "identityManifest.identity.formKey"),
    formName: stringValue(
      identityInput.formName,
      "identityManifest.identity.formName",
      200,
    ),
  });

  const formInput = exact(input.form, ["rules", "topology"], "identityManifest.form");
  const topologyInput = exact(
    formInput.topology,
    ["armCount", "handCount", "headCount", "legCount"],
    "identityManifest.form.topology",
  );
  const topology = Object.freeze({
    armCount: integer(
      topologyInput.armCount,
      "identityManifest.form.topology.armCount",
    ),
    handCount: integer(
      topologyInput.handCount,
      "identityManifest.form.topology.handCount",
    ),
    headCount: integer(
      topologyInput.headCount,
      "identityManifest.form.topology.headCount",
      1,
    ),
    legCount: integer(
      topologyInput.legCount,
      "identityManifest.form.topology.legCount",
    ),
  });
  if (topology.handCount !== topology.armCount) {
    throw new CharacterIdentityManifestError(
      "identityManifest topology must declare one hand per arm.",
    );
  }
  const form = Object.freeze({
    rules: rules(formInput.rules, "identityManifest.form.rules"),
    topology,
  });

  const skinInput = exact(
    input.skin,
    ["formRules", "toneRules"],
    "identityManifest.skin",
  );
  const skin = Object.freeze({
    formRules: strings(
      skinInput.formRules,
      "identityManifest.skin.formRules",
      32,
      false,
    ),
    toneRules: strings(
      skinInput.toneRules,
      "identityManifest.skin.toneRules",
      32,
      false,
    ),
  });

  if (!Array.isArray(input.ornaments) || input.ornaments.length > 32) {
    throw new CharacterIdentityManifestError("identityManifest.ornaments is invalid.");
  }
  const ornaments = input.ornaments.map((item, index) => {
    const ornament = exact(
      item,
      ["key", "placement", "required"],
      `identityManifest.ornaments[${index}]`,
    );
    return Object.freeze({
      key: key(ornament.key, `identityManifest.ornaments[${index}].key`),
      placement: stringValue(
        ornament.placement,
        `identityManifest.ornaments[${index}].placement`,
        200,
      ),
      required: bool(
        ornament.required,
        `identityManifest.ornaments[${index}].required`,
      ),
    });
  });
  if (new Set(ornaments.map((item) => item.key)).size !== ornaments.length) {
    throw new CharacterIdentityManifestError(
      "identityManifest.ornaments contains duplicate keys.",
    );
  }

  if (
    !Array.isArray(input.allowedTransitions) ||
    input.allowedTransitions.length > 16
  ) {
    throw new CharacterIdentityManifestError(
      "identityManifest.allowedTransitions is invalid.",
    );
  }
  const allowedTransitions = input.allowedTransitions.map((item, index) => {
    const transition = exact(
      item,
      ["conditions", "fromFormKey", "toFormKey"],
      `identityManifest.allowedTransitions[${index}]`,
    );
    const fromFormKey = key(
      transition.fromFormKey,
      `identityManifest.allowedTransitions[${index}].fromFormKey`,
    );
    const toFormKey = key(
      transition.toFormKey,
      `identityManifest.allowedTransitions[${index}].toFormKey`,
    );
    if (fromFormKey !== identity.formKey || toFormKey === fromFormKey) {
      throw new CharacterIdentityManifestError(
        `identityManifest.allowedTransitions[${index}] is unbound.`,
      );
    }
    return Object.freeze({
      conditions: strings(
        transition.conditions,
        `identityManifest.allowedTransitions[${index}].conditions`,
        16,
        false,
      ),
      fromFormKey,
      toFormKey,
    });
  });

  const isDeity = bool(input.isDeity, "identityManifest.isDeity");
  let deity: CharacterIdentityManifest["deity"] = null;
  if (!isDeity) {
    if (input.deity !== null) {
      throw new CharacterIdentityManifestError(
        "A non-deity identityManifest must set deity to null.",
      );
    }
  } else {
    const deityInput = exact(
      input.deity,
      ["arms", "handObjectAssignments", "vahana", "weapons"],
      "identityManifest.deity",
    );
    if (
      !Array.isArray(deityInput.arms) ||
      deityInput.arms.length !== topology.armCount
    ) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity.arms does not match topology.",
      );
    }
    const arms = deityInput.arms.map((item, index) => {
      const arm = exact(
        item,
        ["armId", "handId", "ordinal", "side"],
        `identityManifest.deity.arms[${index}]`,
      );
      if (!["center", "left", "right"].includes(String(arm.side))) {
        throw new CharacterIdentityManifestError(
          `identityManifest.deity.arms[${index}].side is invalid.`,
        );
      }
      return Object.freeze({
        armId: key(arm.armId, `identityManifest.deity.arms[${index}].armId`),
        handId: key(arm.handId, `identityManifest.deity.arms[${index}].handId`),
        ordinal: integer(
          arm.ordinal,
          `identityManifest.deity.arms[${index}].ordinal`,
          1,
        ),
        side: arm.side as "center" | "left" | "right",
      });
    });
    const armIds = arms.map((item) => item.armId);
    const handIds = arms.map((item) => item.handId);
    const positions = arms.map((item) => `${item.side}:${item.ordinal}`);
    if (
      new Set(armIds).size !== arms.length ||
      new Set(handIds).size !== arms.length ||
      new Set(positions).size !== arms.length
    ) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity arms are not unique.",
      );
    }

    if (
      !Array.isArray(deityInput.handObjectAssignments) ||
      deityInput.handObjectAssignments.length !== topology.handCount
    ) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity.handObjectAssignments does not match topology.",
      );
    }
    const handObjectAssignments = deityInput.handObjectAssignments.map(
      (item, index) => {
        const assignment = exact(
          item,
          ["assignmentKind", "handId", "objectKey"],
          `identityManifest.deity.handObjectAssignments[${index}]`,
        );
        const assignmentKind = String(assignment.assignmentKind);
        const handId = key(
          assignment.handId,
          `identityManifest.deity.handObjectAssignments[${index}].handId`,
        );
        if (
          !["attribute", "empty", "mudra", "weapon"].includes(assignmentKind) ||
          !handIds.includes(handId)
        ) {
          throw new CharacterIdentityManifestError(
            `identityManifest.deity.handObjectAssignments[${index}] is invalid.`,
          );
        }
        const objectKey =
          assignment.objectKey === null
            ? null
            : key(
                assignment.objectKey,
                `identityManifest.deity.handObjectAssignments[${index}].objectKey`,
              );
        if (
          (assignmentKind === "empty" && objectKey !== null) ||
          (assignmentKind !== "empty" && objectKey === null)
        ) {
          throw new CharacterIdentityManifestError(
            `identityManifest.deity.handObjectAssignments[${index}] has an invalid object binding.`,
          );
        }
        return Object.freeze({
          assignmentKind: assignmentKind as "attribute" | "empty" | "mudra" | "weapon",
          handId,
          objectKey,
        });
      },
    );
    if (
      new Set(handObjectAssignments.map((item) => item.handId)).size !==
      handObjectAssignments.length
    ) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity hand assignments are not unique.",
      );
    }

    const vahanaInput = exact(
      deityInput.vahana,
      ["key", "status"],
      "identityManifest.deity.vahana",
    );
    if (!["none", "specified"].includes(String(vahanaInput.status))) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity.vahana.status is invalid.",
      );
    }
    const vahanaKey =
      vahanaInput.key === null
        ? null
        : key(vahanaInput.key, "identityManifest.deity.vahana.key");
    if (
      (vahanaInput.status === "none" && vahanaKey !== null) ||
      (vahanaInput.status === "specified" && vahanaKey === null)
    ) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity.vahana is inconsistent.",
      );
    }
    const vahana = Object.freeze({
      key: vahanaKey,
      status: vahanaInput.status as "none" | "specified",
    });

    if (!Array.isArray(deityInput.weapons) || deityInput.weapons.length > 16) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity.weapons is invalid.",
      );
    }
    const weapons = deityInput.weapons.map((item, index) => {
      const weapon = exact(
        item,
        ["key", "required"],
        `identityManifest.deity.weapons[${index}]`,
      );
      return Object.freeze({
        key: key(weapon.key, `identityManifest.deity.weapons[${index}].key`),
        required: bool(
          weapon.required,
          `identityManifest.deity.weapons[${index}].required`,
        ),
      });
    });
    if (new Set(weapons.map((item) => item.key)).size !== weapons.length) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity.weapons contains duplicate keys.",
      );
    }
    const heldWeapons = new Set(
      handObjectAssignments.flatMap((item) =>
        item.assignmentKind === "weapon" && item.objectKey ? [item.objectKey] : [],
      ),
    );
    const weaponKeys = new Set(weapons.map((item) => item.key));
    if (
      [...heldWeapons].some((item) => !weaponKeys.has(item)) ||
      weapons.some((item) => item.required && !heldWeapons.has(item.key))
    ) {
      throw new CharacterIdentityManifestError(
        "identityManifest.deity weapon assignments are inconsistent.",
      );
    }
    deity = Object.freeze({
      arms: Object.freeze(arms),
      handObjectAssignments: Object.freeze(handObjectAssignments),
      vahana,
      weapons: Object.freeze(weapons),
    });
  }

  return Object.freeze({
    allowedTransitions: Object.freeze(allowedTransitions),
    deity,
    dignity: rules(input.dignity, "identityManifest.dignity"),
    form,
    identity,
    isDeity,
    ornaments: Object.freeze(ornaments),
    schemaVersion: CHARACTER_IDENTITY_MANIFEST_SCHEMA_VERSION,
    skin,
    wardrobe: rules(input.wardrobe, "identityManifest.wardrobe"),
  });
}
