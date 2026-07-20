const allowedProductionLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "(Apache-2.0 AND BSD-3-Clause)",
  "Apache-2.0 AND BSD-3-Clause",
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
  ["@img/sharp-libvips-linuxmusl-x64", new Set(["LGPL-3.0-or-later"])],
  // postgres.js is the pinned, trusted broker-side database client. Its npm
  // package metadata declares the permissive public-domain Unlicense; keep the
  // exception package-scoped so no unrelated dependency inherits it.
  ["postgres", new Set(["Unlicense"])],
  // Trigger.dev depends on humanize-duration, whose package metadata uses the
  // permissive public-domain Unlicense. Keep the exception exact and scoped.
  ["humanize-duration", new Set(["Unlicense"])],
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
