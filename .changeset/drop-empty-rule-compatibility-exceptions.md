---
"@tonoizer/mfdoctor": major
---

Stop exporting the empty V1 closeout `RULE_COMPATIBILITY_EXCEPTIONS` list and `RuleCompatibilityException` type from `@tonoizer/mfdoctor`. Every current built-in stays `migrated`; closeout tests still prove that without a public empty array. This is a breaking change for anyone who imported those symbols from the public package root.
