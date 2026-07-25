# Security and privacy

`check`, `federation`, and `runtime` are offline. They never collect source
bodies, environment values, request headers, cookies, or secrets. Reports redact
URL credentials, auth-like keys, tokens, and absolute user paths. Review reports
before sharing because package names, import names, and federation topology are
still project metadata.

`runtime` only reads a user-supplied Observability Plugin export from disk. It
does not fetch URLs named in the trace and does not execute remote JavaScript.
Imported traces redact token, cookie, authorization, password, and secret fields,
and collapse full private URLs to origin plus basename before correlation
evidence is written.

`probe` is an explicit network action. It accepts HTTPS, plus HTTP for local
development only. It limits redirects, time, and response size. It removes
queries and fragments from reported URLs and never executes the remote entry.
The requested server can still see the caller's IP address and normal HTTP
metadata. Do not pass secret headers; the command has no header option.
