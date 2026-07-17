const allowedProductionLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "ISC",
  "MIT",
]);

export function evaluateProductionLicenses(inventory) {
  const rejected = [];
  let packages = 0;
  for (const [license, entries] of Object.entries(inventory)) {
    const list = Array.isArray(entries) ? entries : [];
    packages += list.length;
    if (!allowedProductionLicenses.has(license)) {
      rejected.push({
        license,
        packages: list.map((entry) => entry.name).filter(Boolean),
      });
    }
  }
  return { packages, rejected };
}
