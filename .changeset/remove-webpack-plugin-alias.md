---
"@tonoizer/mfdoctor": minor
---

Remove the deprecated webpack adapter alias `moduleFederationDoctorPlugin`. Import `ModuleFederationDoctorPlugin` from `@tonoizer/mfdoctor/webpack` instead. The Rspack and Modern.js entries still export `moduleFederationDoctorPlugin` as their canonical factory.
