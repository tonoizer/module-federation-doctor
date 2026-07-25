# Security and privacy

`check` and `federation` are offline. They never collect source bodies,
environment values, request headers, cookies, or secrets. Reports redact URL
credentials, auth-like keys, tokens, and absolute user paths. Review reports
before sharing because package names, import names, and federation topology are
still project metadata.

`probe` is an explicit network action. It accepts HTTPS, plus HTTP for local
development only. It limits redirects, time, and response size. It removes
queries and fragments from reported URLs and never executes the remote entry.
The requested server can still see the caller's IP address and normal HTTP
metadata. Do not pass secret headers; the command has no header option.
