import values from "../config/server-only-variables.json" with { type: "json" };

export const serverOnlyVariables = Object.freeze([...values]);
