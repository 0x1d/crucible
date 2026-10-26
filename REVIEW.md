# Elixir runtime review checklist

Use this when reviewing `runtime/` (Mix control plane). Ignore `docs/internal/`.

## Anti-patterns

| ID | Pattern | Prefer |
| --- | --- | --- |
| R1 | Mix scaffold (`hello/0`, placeholder `@moduledoc`) in shipped apps | Root module documents the app; no dead APIs |
| R2 | Duplicated `try/rescue/catch` for JSON error envelopes | `Runtime.Result.wrap/1` (or one helper) |
| R3 | `Jason.decode!/1` on disk metadata (`meta.json`) | `Jason.decode/1` with fallback record |
| R4 | Docs name the wrong OTP owner (e.g. BEAM = only `Runtime.Server`) | Match supervision: acceptor, serializer, task supervisor |
| R5 | `@moduledoc false` on modules hosts/operators read | Brief moduledoc on public-facing modules |
| R6 | Version skew (`mix.exs` Elixir vs repo AGENTS/README) | Align minimum Elixir with dev environment |
| R7 | Tests coupled to placeholder doctests | Test real invariants (supervision, protocol) |

## Verification

```bash
(cd runtime && mix test)
node scripts/registry-cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'
npm run check
```
