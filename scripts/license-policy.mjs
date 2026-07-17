const allowedProductionLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "ISC",
  "MIT",
]);

// Sharp's Linux runtime installs libvips as a separately replaceable native
// dependency. Genie uses it only inside its internal SaaS/container runtime;
// the exception must never authorize unrelated LGPL packages.
const packageScopedLicenseExceptions = new Map([
  ["@img/sharp-libvips-linux-x64", new Set(["LGPL-3.0-or-later"])],
]);

function isAllowedPackageLicense(license, packageName) {
  return (
    allowedProductionLicenses.has(license) ||
    packageScopedLicenseExceptions.get(packageName)?.has(license) === true
  );
}

export function evaluateProductionLicenses(inventory) {
  const rejected = [];
  let packages = 0;
  for (const [license, entries] of Object.entries(inventory)) {
    const list = Array.isArray(entries) ? entries : [];
    packages += list.length;
    const rejectedPackages = list
      .map((entry) =>
        typeof entry?.name === "string" && entry.name.length > 0
          ? entry.name
          : "<unnamed>",
      )
      .filter((name) => !isAllowedPackageLicense(license, name));
    if (rejectedPackages.length > 0) {
      rejected.push({
        license,
        packages: rejectedPackages,
      });
    }
  }
  return { packages, rejected };
}
